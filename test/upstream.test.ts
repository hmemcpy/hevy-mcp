import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import { MobileSession, type UpstreamConfig } from "../src/types"
import { makeUpstreamLayer, SessionStore, Upstream } from "../src/upstream"

const config: UpstreamConfig = {
  UPSTREAM_BASE_URL: "https://api.example.test",
  UPSTREAM_API_KEY: "application-key",
  UPSTREAM_APP_VERSION: "3.1.10",
  UPSTREAM_APP_BUILD: "3252321",
  UPSTREAM_PLATFORM: "android 33",
  UPSTREAM_USER_AGENT: "okhttp/4.12.0",
}

describe("upstream session refresh", () => {
  it("persists a rotated refresh token before the original request", async () => {
    const initial = MobileSession.make({
      accessToken: "old-access",
      authToken: "legacy-token",
      refreshToken: "old-refresh",
      expiresAt: "2000-01-01T00:00:00.000Z",
    })
    const calls: Array<{ url: string; headers: Headers; body?: string }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        headers: new Headers(init?.headers),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      })
      if (url.endsWith("/auth/refresh_token")) {
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: "2099-01-01T00:00:00.000Z",
        })
      }
      return Response.json({
        updated: [],
        deleted: [],
        isMore: false,
        updated_at: "2099-01-01T00:00:00.000Z",
      })
    })
    const persist = vi.fn()
    const sessionLayer = Layer.succeed(SessionStore, {
      load: () => Effect.succeed(initial),
      save: session => Effect.sync(() => persist(session)),
    })
    const upstreamLayer = makeUpstreamLayer(config, fetcher).pipe(Layer.provide(sessionLayer))

    await Effect.runPromise(
      Effect.flatMap(Upstream, upstream => upstream.routineSync()).pipe(
        Effect.provide(upstreamLayer),
      ),
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.headers.get("auth-token")).toBeNull()
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer old-access")
    expect(calls[0]?.body).toBe(JSON.stringify({ refresh_token: "old-refresh" }))
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer new-access")
    expect(calls[1]?.headers.get("auth-token")).toBe("legacy-token")
    expect(persist).toHaveBeenCalledWith(
      MobileSession.make({
        accessToken: "new-access",
        authToken: "legacy-token",
        refreshToken: "new-refresh",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    )
  })

  it("decodes confirmed mobile read endpoints", async () => {
    const active = MobileSession.make({
      accessToken: "active-access",
      authToken: "legacy-token",
      refreshToken: "active-refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === "/workout_count") return Response.json({ workout_count: 42 })
      if (path === "/workouts_sync_batch") {
        expect(init?.method).toBe("POST")
        expect(init?.body).toBe(JSON.stringify({ "workout-1": "2026-08-23T08:00:00.000Z" }))
        return Response.json({
          updated: [],
          deleted: ["workout-deleted"],
          isMore: false,
          updated_at: "2026-08-23T09:00:00.000Z",
        })
      }
      if (path === "/body_measurements") {
        return Response.json([
          {
            id: 1,
            date: "2026-08-23",
            weight_kg: 80.5,
            fat_percent: null,
            created_at: "2026-08-23T08:00:00.000Z",
          },
        ])
      }
      if (path === "/user/account") {
        return Response.json({
          id: "user-1",
          username: "athlete",
          full_name: "Test Athlete",
          height_cm: 180,
          last_workout_at: "2026-08-22T19:00:00.000Z",
        })
      }
      if (path === "/routine_folders") return Response.json([])
      return Response.json({ error: "unexpected_path" }, { status: 404 })
    })
    const sessionLayer = Layer.succeed(SessionStore, {
      load: () => Effect.succeed(active),
      save: () => Effect.void,
    })
    const upstreamLayer = makeUpstreamLayer(config, fetcher).pipe(Layer.provide(sessionLayer))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const upstream = yield* Upstream
        return {
          count: yield* upstream.workoutCount(),
          sync: yield* upstream.workoutSync({
            "workout-1": "2026-08-23T08:00:00.000Z",
          }),
          measurements: yield* upstream.bodyMeasurements(),
          account: yield* upstream.userAccount(),
          folders: yield* upstream.routineFolders(),
        }
      }).pipe(Effect.provide(upstreamLayer)),
    )

    expect(result.count.workout_count).toBe(42)
    expect(result.measurements[0]?.weight_kg).toBe(80.5)
    expect(result.sync.deleted).toEqual(["workout-deleted"])
    expect(result.account.username).toBe("athlete")
    expect(result.folders).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it("reconciles a stale history page when the sync response omits its unused updated_at", async () => {
    const active = MobileSession.make({
      accessToken: "active-access",
      authToken: "legacy-token",
      refreshToken: "active-refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === "/workouts_batch/0") {
        return Response.json([
          {
            id: "older-workout",
            name: "Pull",
            start_time: 1_787_245_200,
            updated_at: "2026-08-20T19:20:48.206Z",
            exercises: [],
          },
        ])
      }
      if (path === "/workouts_sync_batch") {
        expect(init?.method).toBe("POST")
        expect(init?.body).toBe(JSON.stringify({ "older-workout": "2026-08-20T19:20:48.206Z" }))
        return Response.json({
          updated: [
            {
              id: "new-workout",
              name: "Push",
              start_time: 1_787_590_501,
              updated_at: "2026-08-24T19:14:57.524Z",
              exercises: [
                {
                  exercise_template_id: "79D0BB3A",
                  title: "Bench Press (Barbell)",
                  sets: [
                    {
                      index: 0,
                      indicator: "normal",
                      weight_kg: 90,
                      reps: 5,
                      rpe: null,
                      distance_meters: null,
                      duration_seconds: null,
                      custom_metric: null,
                    },
                  ],
                },
              ],
            },
          ],
          deleted: [],
          isMore: false,
        })
      }
      return Response.json({ error: "unexpected_path" }, { status: 404 })
    })
    const sessionLayer = Layer.succeed(SessionStore, {
      load: () => Effect.succeed(active),
      save: () => Effect.void,
    })
    const upstreamLayer = makeUpstreamLayer(config, fetcher).pipe(Layer.provide(sessionLayer))

    const workouts = await Effect.runPromise(
      Effect.flatMap(Upstream, upstream => upstream.workouts()).pipe(Effect.provide(upstreamLayer)),
    )

    expect(workouts.map(workout => workout.id)).toEqual(["new-workout", "older-workout"])
    expect(workouts[0]?.exercises[0]?.sets[0]).toEqual(
      expect.objectContaining({ weight_kg: 90, reps: 5 }),
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("uses the statically confirmed completed-workout update route and envelope", async () => {
    const active = MobileSession.make({
      accessToken: "active-access",
      authToken: "legacy-token",
      refreshToken: "active-refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/v2/workout/workout-1")
      expect(init?.method).toBe("PUT")
      expect(init?.body).toBe(
        JSON.stringify({ workoutUpdate: { exercises: [{ exercise_template_id: "ROW001" }] } }),
      )
      return Response.json({ updated: true })
    })
    const sessionLayer = Layer.succeed(SessionStore, {
      load: () => Effect.succeed(active),
      save: () => Effect.void,
    })
    const upstreamLayer = makeUpstreamLayer(config, fetcher).pipe(Layer.provide(sessionLayer))

    await Effect.runPromise(
      Effect.flatMap(Upstream, upstream =>
        upstream.updateWorkout("workout-1", {
          workoutUpdate: { exercises: [{ exercise_template_id: "ROW001" }] },
        }),
      ).pipe(Effect.provide(upstreamLayer)),
    )

    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("uses the observed completed-workout create and delete routes", async () => {
    const active = MobileSession.make({
      accessToken: "active-access",
      authToken: "legacy-token",
      refreshToken: "active-refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    const calls: Array<{ path: string; method?: string; body?: BodyInit | null }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      calls.push({
        path,
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.body === undefined ? {} : { body: init.body }),
      })
      return path === "/v2/workout"
        ? Response.json({ id: "workout-1", exercises: [] })
        : new Response(null, { status: 200 })
    })
    const sessionLayer = Layer.succeed(SessionStore, {
      load: () => Effect.succeed(active),
      save: () => Effect.void,
    })
    const upstreamLayer = makeUpstreamLayer(config, fetcher).pipe(Layer.provide(sessionLayer))

    await Effect.runPromise(
      Effect.gen(function* () {
        const upstream = yield* Upstream
        yield* upstream.createWorkout({ workout: { workout_id: "workout-1" } })
        yield* upstream.deleteWorkout("workout-1")
      }).pipe(Effect.provide(upstreamLayer)),
    )

    expect(calls).toEqual([
      {
        path: "/v2/workout",
        method: "POST",
        body: JSON.stringify({ workout: { workout_id: "workout-1" } }),
      },
      { path: "/workout/workout-1", method: "DELETE", body: undefined },
    ])
  })
})

describe("upstream error redaction", () => {
  it("does not expose credentials from a malformed refresh response", async () => {
    const sentinel = "synthetic-secret-must-not-leak"
    const initial = MobileSession.make({
      accessToken: "old-access",
      authToken: "legacy-token",
      refreshToken: "old-refresh",
      expiresAt: "2000-01-01T00:00:00.000Z",
    })
    const sessionLayer = Layer.succeed(SessionStore, {
      load: () => Effect.succeed(initial),
      save: () => Effect.void,
    })
    const fetcher = vi.fn(async () =>
      Response.json({
        access_token: { secret: sentinel },
        refresh_token: sentinel,
        expires_at: "2099-01-01T00:00:00.000Z",
      }),
    )
    const upstreamLayer = makeUpstreamLayer(config, fetcher).pipe(Layer.provide(sessionLayer))
    const error = await Effect.runPromise(
      Effect.flatMap(Upstream, upstream => upstream.routineSync()).pipe(
        Effect.provide(upstreamLayer),
        Effect.flip,
      ),
    )
    expect(error._tag).toBe("ApiError")
    expect(JSON.stringify(error)).not.toContain(sentinel)
    expect(JSON.stringify(error)).toContain("invalid_upstream_response")
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
