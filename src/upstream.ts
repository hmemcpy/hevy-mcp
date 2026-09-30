import { Clock, Context, Effect, Layer, Result, Schema } from "effect"
import { ApiError, SessionStorageError, UpstreamError } from "./errors"
import { decodeSession, shouldRefresh } from "./session"
import {
  BodyMeasurement,
  CompletedWorkout,
  CustomExercise,
  type Env,
  type MobileSession,
  RefreshResponse,
  RoutineSyncResponse,
  type UpstreamConfig,
  UpstreamErrorBodySchema,
  UserAccount,
  WorkoutCountResponse,
  WorkoutSyncResponse,
} from "./types"
import { type ActiveWorkoutStoreApi, makeActiveWorkoutStoreLayer } from "./workout-lifecycle"

const SESSION_KEY = "mobile-session"
const MAX_WORKOUT_SYNC_PAGES = 100

export type UpstreamFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface SessionStoreApi {
  readonly load: (
    bootstrap: boolean,
  ) => Effect.Effect<MobileSession, ApiError | SessionStorageError>
  readonly save: (session: MobileSession) => Effect.Effect<void, SessionStorageError>
}

export const SessionStore = Context.Service<SessionStoreApi>("SessionStore")

export interface UpstreamApi {
  readonly refreshSession: () => Effect.Effect<
    MobileSession,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly routineSync: () => Effect.Effect<
    RoutineSyncResponse,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly customExercises: () => Effect.Effect<
    ReadonlyArray<CustomExercise>,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly workouts: () => Effect.Effect<
    ReadonlyArray<CompletedWorkout>,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly workoutCount: () => Effect.Effect<
    WorkoutCountResponse,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly workoutSync: (
    known: Readonly<Record<string, string>>,
  ) => Effect.Effect<WorkoutSyncResponse, ApiError | SessionStorageError | UpstreamError>
  readonly bodyMeasurements: () => Effect.Effect<
    ReadonlyArray<BodyMeasurement>,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly userAccount: () => Effect.Effect<
    UserAccount,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly routineFolders: () => Effect.Effect<
    ReadonlyArray<unknown>,
    ApiError | SessionStorageError | UpstreamError
  >
  readonly updateRoutine: (
    routineId: string,
    body: object,
  ) => Effect.Effect<void, ApiError | SessionStorageError | UpstreamError>
  readonly updateWorkout: (
    workoutId: string,
    body: object,
  ) => Effect.Effect<void, ApiError | SessionStorageError | UpstreamError>
  readonly createWorkout: (
    body: object,
  ) => Effect.Effect<CompletedWorkout, ApiError | SessionStorageError | UpstreamError>
  readonly deleteWorkout: (
    workoutId: string,
  ) => Effect.Effect<void, ApiError | SessionStorageError | UpstreamError>
}

export const Upstream = Context.Service<UpstreamApi>("Upstream")

function workoutTimestamp(workout: CompletedWorkout): number {
  if (typeof workout.start_time === "number") return workout.start_time * 1_000
  if (typeof workout.start_time === "string") {
    const parsed = Date.parse(workout.start_time)
    if (Number.isFinite(parsed)) return parsed
  }
  const created = workout.created_at === undefined ? Number.NaN : Date.parse(workout.created_at)
  if (Number.isFinite(created)) return created
  const updated = workout.updated_at === undefined ? Number.NaN : Date.parse(workout.updated_at)
  return Number.isFinite(updated) ? updated : 0
}

function workoutRevisions(workouts: ReadonlyArray<CompletedWorkout>): Record<string, string> {
  return Object.fromEntries(
    workouts.flatMap(workout =>
      workout.updated_at === undefined ? [] : [[workout.id, workout.updated_at]],
    ),
  )
}

function applyWorkoutSync(
  workouts: ReadonlyArray<CompletedWorkout>,
  sync: WorkoutSyncResponse,
): ReadonlyArray<CompletedWorkout> {
  const byId = new Map(workouts.map(workout => [workout.id, workout]))
  for (const workout of sync.updated) byId.set(workout.id, workout)
  for (const workoutId of sync.deleted) byId.delete(workoutId)
  return Array.from(byId.values()).sort(
    (left, right) => workoutTimestamp(right) - workoutTimestamp(left),
  )
}

export function makeSessionStoreLayer(
  state: DurableObjectState,
  env: Env,
): Layer.Layer<SessionStoreApi> {
  const save: SessionStoreApi["save"] = Effect.fn("SessionStore.save")(session =>
    Effect.tryPromise({
      try: () => state.storage.put(SESSION_KEY, session),
      catch: cause => new SessionStorageError({ operation: "put", cause }),
    }),
  )

  const load: SessionStoreApi["load"] = Effect.fn("SessionStore.load")(function* (bootstrap) {
    const stored = yield* Effect.tryPromise({
      try: () => state.storage.get<unknown>(SESSION_KEY),
      catch: cause => new SessionStorageError({ operation: "get", cause }),
    })
    if (stored !== undefined) return yield* decodeSession(stored)
    if (!bootstrap || env.BOOTSTRAP_SESSION_JSON === "") {
      return yield* new ApiError({
        status: 503,
        code: "session_not_configured",
        message: "No mobile session is configured",
      })
    }
    const session = yield* decodeSession(env.BOOTSTRAP_SESSION_JSON)
    yield* save(session)
    return session
  })

  return Layer.succeed(SessionStore, SessionStore.of({ load, save }))
}

function parseJson(text: string) {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () =>
      new ApiError({
        status: 502,
        code: "invalid_upstream_response",
        message: "Upstream returned invalid JSON",
      }),
  })
}

const readErrorCode = Effect.fn("Upstream.readErrorCode")((response: Response) =>
  Effect.tryPromise({
    try: () => response.json().then((value: unknown) => value),
    catch: cause => cause,
  }).pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: value => {
        const decoded = Schema.decodeUnknownResult(UpstreamErrorBodySchema)(value)
        return Result.isSuccess(decoded) ? decoded.success.error : undefined
      },
    }),
  ),
)

function decodeResponse<A>(
  response: Response,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, ApiError | UpstreamError> {
  return Effect.gen(function* () {
    if (!response.ok) {
      const upstreamCode = yield* readErrorCode(response)
      return yield* new UpstreamError({
        upstreamStatus: response.status,
        ...(upstreamCode === undefined ? {} : { upstreamCode }),
      })
    }
    if (response.status === 204) {
      return yield* Schema.decodeUnknownEffect(schema)(undefined).pipe(
        Effect.mapError(
          () =>
            new ApiError({
              status: 502,
              code: "invalid_upstream_response",
              message: "Upstream response did not match its contract",
            }),
        ),
      )
    }
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: cause => new UpstreamError({ upstreamStatus: response.status, cause }),
    })
    const value = text === "" ? undefined : yield* parseJson(text)
    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        () =>
          new ApiError({
            status: 502,
            code: "invalid_upstream_response",
            message: "Upstream response did not match its contract",
          }),
      ),
    )
  })
}

export function makeUpstreamLayer(
  env: UpstreamConfig,
  fetchImpl: UpstreamFetch,
): Layer.Layer<UpstreamApi, never, SessionStoreApi> {
  return Layer.effect(
    Upstream,
    Effect.gen(function* () {
      const sessions = yield* SessionStore

      function headers(session: MobileSession, includeAuthToken: boolean, nowMs: number): Headers {
        const requestHeaders = new Headers({
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "x-api-key": env.UPSTREAM_API_KEY,
          "hevy-app-version": env.UPSTREAM_APP_VERSION,
          "hevy-app-build": env.UPSTREAM_APP_BUILD,
          "hevy-platform": env.UPSTREAM_PLATFORM,
          "user-agent": env.UPSTREAM_USER_AGENT,
          "x-client-time": String(nowMs / 1000),
          authorization: `Bearer ${session.accessToken}`,
        })
        if (includeAuthToken) requestHeaders.set("auth-token", session.authToken)
        return requestHeaders
      }

      const send = Effect.fn("Upstream.send")(function* (
        session: MobileSession,
        path: string,
        init: RequestInit,
        includeAuthToken: boolean,
      ) {
        const requestHeaders = new Headers(init.headers)
        for (const [key, value] of headers(
          session,
          includeAuthToken,
          yield* Clock.currentTimeMillis,
        )) {
          requestHeaders.set(key, value)
        }
        return yield* Effect.tryPromise({
          try: () =>
            fetchImpl(new URL(path, env.UPSTREAM_BASE_URL), {
              ...init,
              headers: requestHeaders,
            }),
          catch: cause => new UpstreamError({ upstreamStatus: 0, cause }),
        })
      })

      const refresh = Effect.fn("Upstream.refresh")(function* (session: MobileSession) {
        const response = yield* send(
          session,
          "/auth/refresh_token",
          {
            method: "POST",
            body: JSON.stringify({ refresh_token: session.refreshToken }),
          },
          false,
        )
        const refreshed = yield* decodeResponse(response, RefreshResponse)
        const next = yield* decodeSession({
          accessToken: refreshed.access_token,
          authToken: session.authToken,
          refreshToken: refreshed.refresh_token,
          expiresAt: refreshed.expires_at,
        })
        yield* sessions.save(next)
        return next
      })

      const request = Effect.fn("Upstream.request")(function* <A>(
        path: string,
        init: RequestInit,
        schema: Schema.Decoder<A>,
      ) {
        const loaded = yield* sessions.load(true)
        let session = shouldRefresh(loaded, yield* Clock.currentTimeMillis)
          ? yield* refresh(loaded)
          : loaded
        let response = yield* send(session, path, init, true)
        if (response.status === 401) {
          const code = yield* readErrorCode(response.clone())
          if (code === "AccessTokenExpired") {
            session = yield* refresh(session)
            response = yield* send(session, path, init, true)
          }
        }
        return yield* decodeResponse(response, schema)
      })

      return Upstream.of({
        refreshSession: Effect.fn("Upstream.refreshSession")(function* () {
          return yield* refresh(yield* sessions.load(true))
        }),
        routineSync: Effect.fn("Upstream.routineSync")(() =>
          request("/routines_sync_batch", { method: "POST", body: "{}" }, RoutineSyncResponse),
        ),
        customExercises: Effect.fn("Upstream.customExercises")(() =>
          request("/custom_exercise_templates", {}, Schema.Array(CustomExercise)),
        ),
        workouts: Effect.fn("Upstream.workouts")(function* () {
          let workouts: ReadonlyArray<CompletedWorkout> = yield* request(
            "/workouts_batch/0",
            {},
            Schema.Array(CompletedWorkout),
          )
          for (let page = 0; page < MAX_WORKOUT_SYNC_PAGES; page += 1) {
            const sync = yield* request(
              "/workouts_sync_batch",
              { method: "POST", body: JSON.stringify(workoutRevisions(workouts)) },
              WorkoutSyncResponse,
            )
            workouts = applyWorkoutSync(workouts, sync)
            if (!sync.isMore) return workouts
          }
          return yield* new ApiError({
            status: 502,
            code: "workout_sync_incomplete",
            message: "Workout synchronization exceeded the page limit",
          })
        }),
        workoutCount: Effect.fn("Upstream.workoutCount")(() =>
          request("/workout_count", {}, WorkoutCountResponse),
        ),
        workoutSync: Effect.fn("Upstream.workoutSync")((known: Readonly<Record<string, string>>) =>
          request(
            "/workouts_sync_batch",
            { method: "POST", body: JSON.stringify(known) },
            WorkoutSyncResponse,
          ),
        ),
        bodyMeasurements: Effect.fn("Upstream.bodyMeasurements")(() =>
          request("/body_measurements", {}, Schema.Array(BodyMeasurement)),
        ),
        userAccount: Effect.fn("Upstream.userAccount")(() =>
          request("/user/account", {}, UserAccount),
        ),
        routineFolders: Effect.fn("Upstream.routineFolders")(() =>
          request("/routine_folders", {}, Schema.Array(Schema.Unknown)),
        ),
        updateRoutine: Effect.fn("Upstream.updateRoutine")((routineId, body) =>
          request(
            `/routine/${encodeURIComponent(routineId)}`,
            { method: "PUT", body: JSON.stringify(body) },
            Schema.Void,
          ),
        ),
        updateWorkout: Effect.fn("Upstream.updateWorkout")((workoutId, body) =>
          request(
            `/v2/workout/${encodeURIComponent(workoutId)}`,
            { method: "PUT", body: JSON.stringify(body) },
            Schema.Unknown,
          ).pipe(Effect.map(() => undefined)),
        ),
        createWorkout: Effect.fn("Upstream.createWorkout")(body =>
          request("/v2/workout", { method: "POST", body: JSON.stringify(body) }, CompletedWorkout),
        ),
        deleteWorkout: Effect.fn("Upstream.deleteWorkout")(workoutId =>
          request(`/workout/${encodeURIComponent(workoutId)}`, { method: "DELETE" }, Schema.Void),
        ),
      })
    }),
  )
}

export function makeCoordinatorLayer(
  state: DurableObjectState,
  env: Env,
): Layer.Layer<SessionStoreApi | ActiveWorkoutStoreApi | UpstreamApi> {
  const sessionStore = makeSessionStoreLayer(state, env)
  const activeWorkoutStore = makeActiveWorkoutStoreLayer(state)
  const upstream = makeUpstreamLayer(env, fetch).pipe(Layer.provide(sessionStore))
  return Layer.mergeAll(sessionStore, activeWorkoutStore, upstream)
}
