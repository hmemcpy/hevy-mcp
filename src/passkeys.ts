import { base64UrlDecode, base64UrlEncode } from "./webauthn"

// Owner passkey credentials live in the OAUTH_KV namespace under a dedicated
// prefix; the OAuth provider never touches keys it does not create. Challenge
// transactions are stateless: an HMAC-signed payload binds the purpose,
// challenge, RP ID, and expiry, so nothing has to be written before the browser
// ceremony and reads never race KV propagation. The signing key is derived from
// the automation token, so rotating the token also invalidates in-flight
// sign-in transactions without affecting enrolled credentials.

export interface StoredPasskey {
  id: string
  alg: number
  jwk: JsonWebKey
  rpId: string
  origin: string
  createdAt: string
  signCount: number
}

export type TransactionPurpose = "enroll" | "assert"

interface TransactionPayload {
  purpose: TransactionPurpose
  challenge: string
  rpId: string
  exp: number
}

const CREDENTIALS_KEY = "passkey:credentials"
export const MAX_PASSKEYS = 5
const TRANSACTION_TTL_MS = 5 * 60_000

async function transactionKey(secret: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`hevy-mcp:passkey-transaction:${secret}`)
  const digest = await crypto.subtle.digest("SHA-256", material as BufferSource)
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await transactionKey(secret)
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload) as BufferSource,
  )
  return base64UrlEncode(new Uint8Array(mac))
}

export async function listPasskeys(kv: KVNamespace): Promise<StoredPasskey[]> {
  const raw = await kv.get(CREDENTIALS_KEY)
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as StoredPasskey[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function savePasskey(kv: KVNamespace, passkey: StoredPasskey): Promise<void> {
  const existing = await listPasskeys(kv)
  const updated = [passkey, ...existing.filter(item => item.id !== passkey.id)].slice(
    0,
    MAX_PASSKEYS,
  )
  await kv.put(CREDENTIALS_KEY, JSON.stringify(updated))
}

export async function updateSignCount(
  kv: KVNamespace,
  credentialId: string,
  signCount: number,
): Promise<void> {
  const existing = await listPasskeys(kv)
  const updated = existing.map(item => (item.id === credentialId ? { ...item, signCount } : item))
  if (updated.some(item => item.id === credentialId)) {
    await kv.put(CREDENTIALS_KEY, JSON.stringify(updated))
  }
}

export async function issueTransaction(
  secret: string,
  purpose: TransactionPurpose,
  challenge: Uint8Array,
  rpId: string,
): Promise<string> {
  const payload: TransactionPayload = {
    purpose,
    challenge: base64UrlEncode(challenge),
    rpId,
    exp: Date.now() + TRANSACTION_TTL_MS,
  }
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const mac = await sign(body, secret)
  return `${body}.${mac}`
}

export class TransactionError extends Error {}

export async function readTransaction(
  secret: string,
  transactionId: string,
  purpose: TransactionPurpose,
): Promise<{ challenge: Uint8Array; rpId: string }> {
  const [body, mac] = transactionId.split(".")
  if (body === undefined || mac === undefined) throw new TransactionError("Malformed transaction")
  const expected = await sign(body, secret)
  if (mac !== expected) throw new TransactionError("Transaction signature is invalid")
  let payload: TransactionPayload
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(body))
    payload = JSON.parse(decoded) as TransactionPayload
  } catch {
    throw new TransactionError("Malformed transaction")
  }
  if (payload.purpose !== purpose) throw new TransactionError("Transaction purpose does not match")
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    throw new TransactionError("Transaction expired; start again")
  }
  if (typeof payload.challenge !== "string" || typeof payload.rpId !== "string") {
    throw new TransactionError("Malformed transaction")
  }
  return { challenge: base64UrlDecode(payload.challenge), rpId: payload.rpId }
}
