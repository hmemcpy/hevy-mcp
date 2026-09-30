import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { decodeSession, redactedSessionStatus, shouldRefresh } from "../src/session"
import { MobileSession } from "../src/types"

const session = MobileSession.make({
  accessToken: "access",
  authToken: "legacy",
  refreshToken: "refresh",
  expiresAt: "2026-08-22T19:26:45.727Z",
})

describe("session", () => {
  it("decodes camelCase and snake_case sessions", async () => {
    expect(await Effect.runPromise(decodeSession(session))).toEqual(session)
    expect(
      await Effect.runPromise(
        decodeSession({
          access_token: "access",
          auth_token: "legacy",
          refresh_token: "refresh",
          expires_at: session.expiresAt,
        }),
      ),
    ).toEqual(session)
  })

  it("refreshes inside the one-minute safety window", () => {
    const expiry = Date.parse(session.expiresAt)
    expect(shouldRefresh(session, expiry - 60_001)).toBe(false)
    expect(shouldRefresh(session, expiry - 60_000)).toBe(true)
  })

  it("never exposes tokens in status", () => {
    expect(redactedSessionStatus(session, Date.parse(session.expiresAt))).toEqual({
      configured: true,
      expiresAt: session.expiresAt,
      refreshRequired: true,
    })
  })
})
