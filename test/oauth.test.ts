import { describe, expect, it } from "vitest"
import { secureEqual } from "../src/security"

describe("secureEqual", () => {
  it("accepts identical non-empty values", async () => {
    await expect(secureEqual("secret", "secret")).resolves.toBe(true)
  })

  it("rejects empty, different-length, and different values", async () => {
    await expect(secureEqual("", "")).resolves.toBe(false)
    await expect(secureEqual("short", "longer")).resolves.toBe(false)
    await expect(secureEqual("secret", "secRet")).resolves.toBe(false)
  })
})
