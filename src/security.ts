export async function secureEqual(actual: string, expected: string): Promise<boolean> {
  if (expected === "") return false
  const encoder = new TextEncoder()
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ])
  const actualBytes = new Uint8Array(actualHash)
  const expectedBytes = new Uint8Array(expectedHash)
  let difference = 0
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}
