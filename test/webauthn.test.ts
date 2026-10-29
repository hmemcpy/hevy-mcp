import { describe, expect, it, vi } from "vitest"
import {
  issueTransaction,
  listPasskeys,
  MAX_PASSKEYS,
  readTransaction,
  savePasskey,
  TransactionError,
  updateSignCount,
} from "../src/passkeys"
import {
  base64UrlDecode,
  base64UrlEncode,
  coseKeyToJwk,
  decodeCbor,
  parseAttestationObject,
  verifyAssertion,
  WebAuthnError,
} from "../src/webauthn"

// ---- Independent CBOR encoder: fixtures must not share code with the decoder ----

function encodeHead(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length]
  if (length < 0x100) return [(major << 5) | 24, length]
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff]
  return [
    (major << 5) | 26,
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ]
}

function encodeCbor(value: unknown): Uint8Array {
  const bytes: number[] = []
  const write = (chunk: number[]) => bytes.push(...chunk)
  if (typeof value === "boolean") {
    write([value ? 0xf5 : 0xf4])
  } else if (typeof value === "number") {
    if (value >= 0) write(encodeHead(0, value))
    else write(encodeHead(1, -1 - value))
  } else if (typeof value === "string") {
    const encoded = new TextEncoder().encode(value)
    write(encodeHead(3, encoded.length))
    write([...encoded])
  } else if (value instanceof Uint8Array) {
    write(encodeHead(2, value.length))
    write([...value])
  } else if (Array.isArray(value)) {
    write(encodeHead(4, value.length))
    for (const item of value) write([...encodeCbor(item)])
  } else if (value instanceof Map) {
    write(encodeHead(5, value.size))
    for (const [key, item] of value) {
      write([...encodeCbor(key)])
      write([...encodeCbor(item)])
    }
  } else {
    throw new Error("Unsupported test fixture value")
  }
  return new Uint8Array(bytes)
}

// ---- Authenticator fixture helpers ----

const RP_ID = "login.example"
const ORIGIN = "https://login.example"

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))
}

async function makeCredentialKey(): Promise<{ privateKey: CryptoKey; jwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  return { privateKey: pair.privateKey, jwk }
}

function coseKeyFor(jwk: JsonWebKey): Uint8Array {
  return encodeCbor(
    new Map<unknown, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, base64UrlDecode(jwk.x as string)],
      [-3, base64UrlDecode(jwk.y as string)],
    ]),
  )
}

async function makeAttestationObject(
  jwk: JsonWebKey,
  credentialId: Uint8Array,
): Promise<Uint8Array> {
  const authData = await buildAuthData(0x45, 0, credentialId, coseKeyFor(jwk))
  return encodeCbor(
    new Map<unknown, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]),
  )
}

async function buildAuthData(
  flags: number,
  signCount: number,
  credentialId?: Uint8Array,
  coseKey?: Uint8Array,
): Promise<Uint8Array> {
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID))
  const parts: Uint8Array[] = [
    rpIdHash,
    new Uint8Array([flags]),
    new Uint8Array([
      (signCount >>> 24) & 0xff,
      (signCount >>> 16) & 0xff,
      (signCount >>> 8) & 0xff,
      signCount & 0xff,
    ]),
  ]
  if (credentialId !== undefined && coseKey !== undefined) {
    parts.push(new Uint8Array(16))
    parts.push(new Uint8Array([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff]))
    parts.push(credentialId)
    parts.push(coseKey)
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const combined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }
  return combined
}

interface AssertionFixture {
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
  signature: Uint8Array
}

async function makeAssertion(
  privateKey: CryptoKey,
  challenge: Uint8Array,
  overrides: { flags?: number; signCount?: number; origin?: string; type?: string } = {},
): Promise<AssertionFixture> {
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: overrides.type ?? "webauthn.get",
      challenge: base64UrlEncode(challenge),
      origin: overrides.origin ?? ORIGIN,
      crossOrigin: false,
    }),
  )
  const authenticatorData = await buildAuthData(overrides.flags ?? 0x05, overrides.signCount ?? 1)
  const signed = new Uint8Array(authenticatorData.length + 32)
  signed.set(authenticatorData)
  signed.set(await sha256(clientDataJSON), authenticatorData.length)
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      signed as BufferSource,
    ),
  )
  return { clientDataJSON, authenticatorData, signature: rawToDer(raw) }
}

// Real authenticators emit ASN.1 DER Ecdsa-Sig-Value for ES256 (WebAuthn
// section 6.5.5), unlike WebCrypto's raw P1363 output.
function rawToDer(raw: Uint8Array): Uint8Array {
  const derInteger = (half: Uint8Array) => {
    let start = 0
    while (start < half.length - 1 && half[start] === 0) start += 1
    let bytes = half.slice(start)
    if ((bytes[0] as number) & 0x80) bytes = new Uint8Array([0x00, ...bytes])
    return new Uint8Array([0x02, bytes.length, ...bytes])
  }
  const r = derInteger(raw.slice(0, 32))
  const s = derInteger(raw.slice(32))
  const body = new Uint8Array(r.length + s.length)
  body.set(r)
  body.set(s, r.length)
  return new Uint8Array([0x30, body.length, ...body])
}

// ---- CBOR decoder ----

describe("decodeCbor", () => {
  it("round-trips the WebAuthn subset against an independent encoder", () => {
    const value = new Map<unknown, unknown>([
      ["fmt", "none"],
      ["count", -7],
      [258, new Uint8Array([1, 2, 3, 0xff])],
      ["nested", [1, "two", new Map([[true, false]])]],
    ])
    const decoded = decodeCbor(encodeCbor(value))
    expect(decoded).toEqual(value)
  })

  it("rejects truncated and trailing input", () => {
    const encoded = encodeCbor(new Uint8Array([1, 2, 3, 4, 5]))
    expect(() => decodeCbor(encoded.slice(0, 4))).toThrow(WebAuthnError)
    const withTrailing = new Uint8Array([...encodeCbor(1), 0x00])
    expect(() => decodeCbor(withTrailing)).toThrow(WebAuthnError)
  })
})

// ---- Attestation parsing ----

describe("parseAttestationObject", () => {
  it("extracts the credential id and COSE public key", async () => {
    const { jwk } = await makeCredentialKey()
    const credentialId = crypto.getRandomValues(new Uint8Array(32))
    const attestation = await makeAttestationObject(jwk, credentialId)
    const parsed = parseAttestationObject(attestation)
    expect(parsed.fmt).toBe("none")
    expect(
      base64UrlEncode(
        parsed.authenticatorData.attestedCredential?.credentialId ?? new Uint8Array(),
      ),
    ).toBe(base64UrlEncode(credentialId))
    const key = coseKeyToJwk(parsed.coseKey)
    expect(key.alg).toBe(-7)
    expect(key.jwk.x).toBe(jwk.x)
    expect(key.jwk.y).toBe(jwk.y)
  })
})

describe("coseKeyToJwk", () => {
  it("maps RSA COSE parameters to a JWK", () => {
    const n = crypto.getRandomValues(new Uint8Array(256))
    const e = new Uint8Array([0x01, 0x00, 0x01])
    const cose = encodeCbor(
      new Map<unknown, unknown>([
        [1, 3],
        [3, -257],
        [-1, n],
        [-2, e],
      ]),
    )
    const key = coseKeyToJwk(cose)
    expect(key.alg).toBe(-257)
    expect(key.jwk).toEqual({ kty: "RSA", n: base64UrlEncode(n), e: base64UrlEncode(e), ext: true })
  })

  it("rejects unsupported algorithms", () => {
    const cose = encodeCbor(
      new Map<unknown, unknown>([
        [1, 2],
        [3, -36],
      ]),
    )
    expect(() => coseKeyToJwk(cose)).toThrow(WebAuthnError)
  })
})

// ---- Assertion verification ----

describe("verifyAssertion", () => {
  it("accepts a valid user-verified assertion and reports the sign count", async () => {
    const { privateKey, jwk } = await makeCredentialKey()
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const fixture = await makeAssertion(privateKey, challenge, { signCount: 7 })
    const signCount = await verifyAssertion({
      jwk,
      alg: -7,
      ...fixture,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID,
      storedSignCount: 3,
    })
    expect(signCount).toBe(7)
  })

  const rejections: [
    string,
    (fixture: AssertionFixture, challenge: Uint8Array) => Promise<unknown>,
  ][] = []

  async function expectRejected(
    label: string,
    build: () => Promise<{
      fixture: AssertionFixture
      jwk: JsonWebKey
      challenge?: Uint8Array
      expectedOrigin?: string
      expectedRpId?: string
      storedSignCount?: number
    }>,
  ) {
    rejections.push([
      label,
      async (_base, baseChallenge) => {
        const case_ = await build()
        return verifyAssertion({
          jwk: case_.jwk,
          alg: -7,
          clientDataJSON: case_.fixture.clientDataJSON,
          authenticatorData: case_.fixture.authenticatorData,
          signature: case_.fixture.signature,
          expectedChallenge: case_.challenge ?? baseChallenge,
          expectedOrigin: case_.expectedOrigin ?? ORIGIN,
          expectedRpId: case_.expectedRpId ?? RP_ID,
          storedSignCount: case_.storedSignCount ?? 0,
        })
      },
    ])
  }

  it("rejects every tampered variant", async () => {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const otherChallenge = crypto.getRandomValues(new Uint8Array(32))
    const { privateKey, jwk } = await makeCredentialKey()
    const otherKey = await makeCredentialKey()

    const valid = await makeAssertion(privateKey, challenge, { signCount: 5 })

    const tamper = async (mutate: (bytes: Uint8Array) => void) => {
      const fixture = await makeAssertion(privateKey, challenge, { signCount: 5 })
      mutate(fixture.signature)
      return { fixture, jwk }
    }

    await expectRejected("challenge mismatch", async () => ({
      fixture: await makeAssertion(privateKey, otherChallenge),
      jwk,
      challenge,
    }))
    await expectRejected("origin mismatch", async () => ({
      fixture: await makeAssertion(privateKey, challenge, { origin: "https://evil.example" }),
      jwk,
      challenge,
    }))
    await expectRejected("type mismatch", async () => ({
      fixture: await makeAssertion(privateKey, challenge, { type: "webauthn.create" }),
      jwk,
      challenge,
    }))
    await expectRejected("rpId mismatch", async () => ({
      fixture: valid,
      jwk,
      challenge,
      expectedRpId: "other.example",
    }))
    await expectRejected("missing user verification", async () => ({
      fixture: await makeAssertion(privateKey, challenge, { flags: 0x01 }),
      jwk,
      challenge,
    }))
    await expectRejected("missing user presence", async () => ({
      fixture: await makeAssertion(privateKey, challenge, { flags: 0x04 }),
      jwk,
      challenge,
    }))
    await expectRejected("tampered signature", () =>
      tamper(bytes => {
        bytes[10] = (bytes[10] ?? 0) ^ 0xff
      }),
    )
    await expectRejected("malformed DER signature", () =>
      tamper(bytes => {
        bytes[0] = 0x31
      }),
    )
    await expectRejected("wrong key", async () => ({
      fixture: await makeAssertion(otherKey.privateKey, challenge),
      jwk,
      challenge,
    }))
    await expectRejected("sign count regression", async () => ({
      fixture: await makeAssertion(privateKey, challenge, { signCount: 5 }),
      jwk,
      challenge,
      storedSignCount: 10,
    }))

    for (const [label, run] of rejections) {
      await expect(run(valid, challenge), label).rejects.toThrow(WebAuthnError)
    }
  })
})

// ---- Passkey store and transactions ----

function fakeKv(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
  } as unknown as KVNamespace
}

function samplePasskey(id: string) {
  return {
    id,
    alg: -7,
    jwk: { kty: "EC" },
    rpId: "login.example",
    origin: ORIGIN,
    createdAt: "2026-10-29T00:00:00.000Z",
    signCount: 0,
  }
}

describe("passkey store", () => {
  it("returns an empty list when nothing is enrolled", async () => {
    expect(await listPasskeys(fakeKv())).toEqual([])
  })

  it("saves, replaces by id, and caps stored credentials", async () => {
    const kv = fakeKv()
    await savePasskey(kv, samplePasskey("a"))
    await savePasskey(kv, { ...samplePasskey("a"), signCount: 9 })
    expect(await listPasskeys(kv)).toEqual([{ ...samplePasskey("a"), signCount: 9 }])
    for (const id of ["b", "c", "d", "e", "f", "g"]) await savePasskey(kv, samplePasskey(id))
    const stored = await listPasskeys(kv)
    expect(stored).toHaveLength(MAX_PASSKEYS)
    expect(stored.map(item => item.id)).toEqual(["g", "f", "e", "d", "c"])
  })

  it("updates the sign count of one credential", async () => {
    const kv = fakeKv()
    await savePasskey(kv, samplePasskey("a"))
    await savePasskey(kv, samplePasskey("b"))
    await updateSignCount(kv, "a", 4)
    expect(await listPasskeys(kv)).toEqual([
      samplePasskey("b"),
      { ...samplePasskey("a"), signCount: 4 },
    ])
  })
})

describe("passkey transactions", () => {
  const secret = "synthetic-automation-token"
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  it("round-trips an enrollment transaction", async () => {
    const transactionId = await issueTransaction(secret, "enroll", challenge, RP_ID)
    const read = await readTransaction(secret, transactionId, "enroll")
    expect(read.rpId).toBe(RP_ID)
    expect(base64UrlEncode(read.challenge)).toBe(base64UrlEncode(challenge))
  })

  it("rejects the wrong purpose, tampering, and expiry", async () => {
    const transactionId = await issueTransaction(secret, "assert", challenge, RP_ID)
    await expect(readTransaction(secret, transactionId, "enroll")).rejects.toThrow(TransactionError)
    await expect(readTransaction("other-secret", transactionId, "assert")).rejects.toThrow(
      TransactionError,
    )
    await expect(
      readTransaction(secret, `${transactionId.slice(0, -2)}aa`, "assert"),
    ).rejects.toThrow(TransactionError)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 6 * 60_000)
      await expect(readTransaction(secret, transactionId, "assert")).rejects.toThrow(
        TransactionError,
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
