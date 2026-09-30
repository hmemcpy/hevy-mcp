import { Effect, Schema } from "effect"
import { ApiError } from "./errors"
import { MobileSession, SnakeCaseMobileSessionSchema } from "./types"

const SessionInputSchema = Schema.Union([MobileSession, SnakeCaseMobileSessionSchema])

const parseJson = Effect.fn("MobileSession.parseJson")((text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () =>
      new ApiError({
        status: 400,
        code: "invalid_session",
        message: "Session JSON is invalid",
      }),
  }),
)

export const decodeSession = Effect.fn("MobileSession.decode")(function* (input: unknown) {
  const value = typeof input === "string" ? yield* parseJson(input) : input
  const decoded = yield* Schema.decodeUnknownEffect(SessionInputSchema)(value).pipe(
    Effect.mapError(
      () =>
        new ApiError({
          status: 400,
          code: "invalid_session",
          message: "Session fields are missing or invalid",
        }),
    ),
  )
  const session =
    "accessToken" in decoded
      ? decoded
      : MobileSession.make({
          accessToken: decoded.access_token,
          authToken: decoded.auth_token,
          refreshToken: decoded.refresh_token,
          expiresAt: decoded.expires_at,
        })
  if (!Number.isFinite(Date.parse(session.expiresAt))) {
    return yield* new ApiError({
      status: 400,
      code: "invalid_session",
      message: "Session expiresAt must be an ISO timestamp",
    })
  }
  return session
})

export function shouldRefresh(
  session: MobileSession,
  nowMs: number,
  safetyThresholdMs = 60_000,
): boolean {
  return nowMs >= Date.parse(session.expiresAt) - safetyThresholdMs
}

export function redactedSessionStatus(session: MobileSession | undefined, nowMs: number): object {
  if (session === undefined) return { configured: false }
  return {
    configured: true,
    expiresAt: session.expiresAt,
    refreshRequired: shouldRefresh(session, nowMs),
  }
}
