// Minimal WebAuthn verification for the owner's authorization page. The server
// side needs three things from the WebAuthn spec: decode the attestation object
// produced at registration (CBOR), extract the credential's public key (COSE),
// and verify assertion signatures with WebCrypto. Everything here is pure so it
// can be unit-tested outside the Workers runtime.

export interface AttestedCredential {
  aaguid: Uint8Array
  credentialId: Uint8Array
  coseKey: Uint8Array
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array
  userPresent: boolean
  userVerified: boolean
  signCount: number
  attestedCredential: AttestedCredential | undefined
}

export interface ParsedAttestation {
  fmt: string
  authenticatorData: AuthenticatorData
  coseKey: Uint8Array
}

export class WebAuthnError extends Error {}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// Decodes the definite-length CBOR subset that appears in WebAuthn
// attestation objects and COSE keys: integers, byte and text strings, arrays,
// maps, and null/true/false. Floats are consumed but returned as null.
export function decodeCbor(input: Uint8Array): unknown {
  const value = decodeCborValue(input, 0)
  if (value.offset !== input.length) {
    throw new WebAuthnError("Trailing bytes after CBOR value")
  }
  return value.result
}

function decodeCborValue(input: Uint8Array, offset: number): { result: unknown; offset: number } {
  const initial = input[offset]
  if (initial === undefined) throw new WebAuthnError("Truncated CBOR value")
  const major = initial >> 5
  const info = initial & 0x1f
  let length: number
  let next = offset + 1
  if (info < 24) length = info
  else if (info === 24) {
    length = readByte(input, next)
    next += 1
  } else if (info === 25) {
    length = (readByte(input, next) << 8) | readByte(input, next + 1)
    next += 2
  } else if (info === 26) {
    length =
      ((readByte(input, next) << 24) |
        (readByte(input, next + 1) << 16) |
        (readByte(input, next + 2) << 8) |
        readByte(input, next + 3)) >>>
      0
    next += 4
  } else if (info === 27) {
    let big = 0n
    for (let index = 0; index < 8; index += 1)
      big = (big << 8n) | BigInt(readByte(input, next + index))
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new WebAuthnError("CBOR integer is too large")
    length = Number(big)
    next += 8
  } else {
    throw new WebAuthnError("Indefinite CBOR lengths are not supported")
  }

  switch (major) {
    case 0:
      return { result: length, offset: next }
    case 1:
      return { result: -1 - length, offset: next }
    case 2: {
      const bytes = slice(input, next, next + length)
      return { result: bytes, offset: next + length }
    }
    case 3: {
      const bytes = slice(input, next, next + length)
      return { result: new TextDecoder().decode(bytes), offset: next + length }
    }
    case 4: {
      const items: unknown[] = []
      for (let index = 0; index < length; index += 1) {
        const item = decodeCborValue(input, next)
        items.push(item.result)
        next = item.offset
      }
      return { result: items, offset: next }
    }
    case 5: {
      const map = new Map<unknown, unknown>()
      for (let index = 0; index < length; index += 1) {
        const key = decodeCborValue(input, next)
        next = key.offset
        const value = decodeCborValue(input, next)
        next = value.offset
        map.set(key.result, value.result)
      }
      return { result: map, offset: next }
    }
    default: {
      if (info === 20) return { result: false, offset: next }
      if (info === 21) return { result: true, offset: next }
      if (info === 22 || info === 23) return { result: null, offset: next }
      // Floats (info 25-27): skip the 2/4/8-byte payload.
      const floatBytes = info === 25 ? 2 : info === 26 ? 4 : 8
      slice(input, next, next + floatBytes)
      return { result: null, offset: next + floatBytes }
    }
  }
}

function readByte(input: Uint8Array, offset: number): number {
  const byte = input[offset]
  if (byte === undefined) throw new WebAuthnError("Truncated CBOR value")
  return byte
}

function slice(input: Uint8Array, start: number, end: number): Uint8Array {
  if (end > input.length) throw new WebAuthnError("Truncated CBOR value")
  return input.slice(start, end)
}

export function parseAuthenticatorData(authData: Uint8Array): AuthenticatorData {
  if (authData.length < 37) throw new WebAuthnError("Authenticator data is too short")
  const rpIdHash = authData.slice(0, 32)
  const flags = authData[32] as number
  const signCount =
    ((authData[33] as number) << 24) |
    ((authData[34] as number) << 16) |
    ((authData[35] as number) << 8) |
    (authData[36] as number)
  const userPresent = (flags & 0x01) !== 0
  const userVerified = (flags & 0x04) !== 0
  let attestedCredential: AttestedCredential | undefined
  let offset = 37
  if ((flags & 0x40) !== 0) {
    if (authData.length < offset + 18)
      throw new WebAuthnError("Attested credential data is truncated")
    const aaguid = authData.slice(offset, offset + 16)
    offset += 16
    const idLength = ((authData[offset] as number) << 8) | (authData[offset + 1] as number)
    offset += 2
    const credentialId = authData.slice(offset, offset + idLength)
    if (credentialId.length !== idLength) throw new WebAuthnError("Credential id is truncated")
    offset += idLength
    const cose = decodeCborValue(authData, offset)
    const coseKey = authData.slice(offset, cose.offset)
    if (coseKey.length === 0) throw new WebAuthnError("Credential public key is missing")
    attestedCredential = { aaguid, credentialId, coseKey }
    offset = cose.offset
  }
  return { rpIdHash, userPresent, userVerified, signCount, attestedCredential }
}

export function parseAttestationObject(attestationObject: Uint8Array): ParsedAttestation {
  const decoded = decodeCbor(attestationObject)
  if (!(decoded instanceof Map)) throw new WebAuthnError("Attestation object is not a CBOR map")
  const fmt = decoded.get("fmt")
  const authData = decoded.get("authData")
  if (typeof fmt !== "string" || !(authData instanceof Uint8Array)) {
    throw new WebAuthnError("Attestation object is missing fmt or authData")
  }
  const authenticatorData = parseAuthenticatorData(authData)
  if (authenticatorData.attestedCredential === undefined) {
    throw new WebAuthnError("Attestation does not contain a credential")
  }
  return {
    fmt,
    authenticatorData,
    coseKey: authenticatorData.attestedCredential.coseKey,
  }
}

export interface CosePublicKey {
  alg: number
  jwk: JsonWebKey
}

// COSE algorithm identifiers used by WebAuthn credentials this server accepts.
const COSE_ES256 = -7
const COSE_RS256 = -257
const COSE_EC2 = 2
const COSE_RSA = 3
const COSE_P256 = 1

export function coseKeyToJwk(coseKey: Uint8Array): CosePublicKey {
  const decoded = decodeCbor(coseKey)
  if (!(decoded instanceof Map)) throw new WebAuthnError("Credential key is not a CBOR map")
  // COSE key labels per RFC 9052: 1 = kty, 3 = alg, -1/-2/-3 = key parameters.
  const keyType = decoded.get(1)
  const alg = decoded.get(3)
  if (typeof alg !== "number" || typeof keyType !== "number") {
    throw new WebAuthnError("Credential key is missing algorithm or key type")
  }
  if (alg === COSE_ES256 && keyType === COSE_EC2) {
    const curve = decoded.get(-1)
    const x = decoded.get(-2)
    const y = decoded.get(-3)
    if (curve !== COSE_P256 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      throw new WebAuthnError("Unsupported EC credential key parameters")
    }
    return {
      alg,
      jwk: { kty: "EC", crv: "P-256", x: base64UrlEncode(x), y: base64UrlEncode(y), ext: true },
    }
  }
  if (alg === COSE_RS256 && keyType === COSE_RSA) {
    const n = decoded.get(-1)
    const e = decoded.get(-2)
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new WebAuthnError("Unsupported RSA credential key parameters")
    }
    return {
      alg,
      jwk: { kty: "RSA", n: base64UrlEncode(n), e: base64UrlEncode(e), ext: true },
    }
  }
  throw new WebAuthnError("Unsupported credential key algorithm")
}

function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return crypto.subtle
    .digest("SHA-256", bytes as BufferSource)
    .then(digest => new Uint8Array(digest))
}

function importVerifyKey(jwk: JsonWebKey, alg: number): Promise<CryptoKey> {
  if (alg === COSE_ES256)
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ])
  if (alg === COSE_RS256)
    return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5" }, false, ["verify"])
  throw new WebAuthnError("Unsupported credential key algorithm")
}

// WebAuthn requires ES256 assertion signatures in ASN.1 DER Ecdsa-Sig-Value
// form (spec section 6.5.5); WebCrypto expects the raw P1363 r||s form.
// Converts the two DER INTEGERs into fixed-width 32-byte halves.
function derSignatureToRaw(signature: Uint8Array): Uint8Array {
  const failure = () => new WebAuthnError("Malformed ECDSA signature")
  if (signature.length < 8 || signature.length > 72) throw failure()
  if (signature[0] !== 0x30) throw failure()
  let offset = 2
  if ((signature[1] as number) & 0x80) {
    const lengthBytes = (signature[1] as number) & 0x7f
    if (lengthBytes > 2 || lengthBytes === 0) throw failure()
    offset = 2 + lengthBytes
  }
  const halves: Uint8Array[] = []
  for (let part = 0; part < 2; part += 1) {
    if (signature[offset] !== 0x02) throw failure()
    const length = signature[offset + 1] as number
    if (length === 0 || length > 33) throw failure()
    let start = offset + 2
    const end = start + length
    if (end > signature.length) throw failure()
    if (length === 33 && signature[start] === 0x00) {
      start += 1
    }
    const half = new Uint8Array(32)
    half.set(signature.slice(start, end), 32 - (end - start))
    halves.push(half)
    offset = end
  }
  if (offset !== signature.length) throw failure()
  const raw = new Uint8Array(64)
  raw.set(halves[0] as Uint8Array)
  raw.set(halves[1] as Uint8Array, 32)
  return raw
}

export interface AssertionCheck {
  jwk: JsonWebKey
  alg: number
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
  signature: Uint8Array
  expectedChallenge: Uint8Array
  expectedOrigin: string
  expectedRpId: string
  storedSignCount: number
}

// Verifies an assertion the way the WebAuthn spec requires for this server's
// policy: user present AND user-verified (the fingerprint), challenge, origin,
// RP ID, signature, and monotonic sign count. Returns the new sign count.
export async function verifyAssertion(check: AssertionCheck): Promise<number> {
  const clientData = JSON.parse(new TextDecoder().decode(check.clientDataJSON)) as {
    type?: unknown
    challenge?: unknown
    origin?: unknown
  }
  if (clientData.type !== "webauthn.get") throw new WebAuthnError("Unexpected client data type")
  if (clientData.challenge !== base64UrlEncode(check.expectedChallenge)) {
    throw new WebAuthnError("Challenge does not match")
  }
  if (clientData.origin !== check.expectedOrigin) throw new WebAuthnError("Origin does not match")
  const authData = parseAuthenticatorData(check.authenticatorData)
  const expectedRpIdHash = await sha256(new TextEncoder().encode(check.expectedRpId))
  if (!bytesEqual(authData.rpIdHash, expectedRpIdHash))
    throw new WebAuthnError("RP ID does not match")
  if (!authData.userPresent) throw new WebAuthnError("User presence flag is not set")
  if (!authData.userVerified)
    throw new WebAuthnError("User verification (fingerprint) was not performed")
  if (authenticatorSignCountDecreased(authData.signCount, check.storedSignCount)) {
    throw new WebAuthnError("Signature counter moved backwards")
  }
  const key = await importVerifyKey(check.jwk, check.alg)
  const algorithm =
    check.alg === COSE_ES256 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }
  const signed = concatenate(check.authenticatorData, await sha256(check.clientDataJSON))
  const signature = check.alg === COSE_ES256 ? derSignatureToRaw(check.signature) : check.signature
  const valid = await crypto.subtle.verify(
    algorithm,
    key,
    signature as BufferSource,
    signed as BufferSource,
  )
  if (!valid) throw new WebAuthnError("Assertion signature is invalid")
  return authData.signCount
}

function authenticatorSignCountDecreased(reported: number, stored: number): boolean {
  if (stored === 0 || reported === 0) return false
  return reported < stored
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left)
  combined.set(right, left.length)
  return combined
}
