import { Context, Effect, Layer, Result, Schema } from "effect"
import { ApiError, HevyApiError } from "./errors"
import { makePublicApi } from "./public-api"
import {
  type BodyMeasurement,
  type CompletedWorkout,
  type CustomExercise,
  type Env,
  HevyApiErrorBodySchema,
  type RoutineSyncResponse,
  type UserAccount,
  type WorkoutCountResponse,
  type WorkoutSyncResponse,
} from "./types"
import { makeWebhookEventStoreLayer, type WebhookEventStoreApi } from "./webhook"
import { type ActiveWorkoutStoreApi, makeActiveWorkoutStoreLayer } from "./workout-lifecycle"

// The Hevy API service. This server integrates only with Hevy's documented
// public developer API (https://api.hevyapp.com/docs/); the adapter lives in
// public-api.ts.

export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface Api {
  readonly routineSync: () => Effect.Effect<RoutineSyncResponse, ApiError | HevyApiError>
  readonly customExercises: () => Effect.Effect<
    ReadonlyArray<CustomExercise>,
    ApiError | HevyApiError
  >
  readonly workouts: () => Effect.Effect<ReadonlyArray<CompletedWorkout>, ApiError | HevyApiError>
  readonly workoutCount: () => Effect.Effect<WorkoutCountResponse, ApiError | HevyApiError>
  readonly workoutSync: (
    known: Readonly<Record<string, string>>,
  ) => Effect.Effect<WorkoutSyncResponse, ApiError | HevyApiError>
  readonly bodyMeasurements: () => Effect.Effect<
    ReadonlyArray<BodyMeasurement>,
    ApiError | HevyApiError
  >
  readonly userAccount: () => Effect.Effect<UserAccount, ApiError | HevyApiError>
  readonly routineFolders: () => Effect.Effect<ReadonlyArray<unknown>, ApiError | HevyApiError>
  readonly updateRoutine: (
    routineId: string,
    body: object,
  ) => Effect.Effect<void, ApiError | HevyApiError>
  readonly updateWorkout: (
    workoutId: string,
    body: object,
  ) => Effect.Effect<void, ApiError | HevyApiError>
  readonly createWorkout: (body: object) => Effect.Effect<CompletedWorkout, ApiError | HevyApiError>
  readonly deleteWorkout: (workoutId: string) => Effect.Effect<void, ApiError | HevyApiError>
}

export const Api = Context.Service<Api>("Api")

function parseJson(text: string) {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () =>
      new ApiError({
        status: 502,
        code: "invalid_api_response",
        message: "Hevy API returned invalid JSON",
      }),
  })
}

export const readErrorCode = Effect.fn("Api.readErrorCode")((response: Response) =>
  Effect.tryPromise({
    try: () => response.json().then((value: unknown) => value),
    catch: cause => cause,
  }).pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: value => {
        const decoded = Schema.decodeUnknownResult(HevyApiErrorBodySchema)(value)
        return Result.isSuccess(decoded) ? decoded.success.error : undefined
      },
    }),
  ),
)

export function decodeResponse<A>(
  response: Response,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, ApiError | HevyApiError> {
  return Effect.gen(function* () {
    if (!response.ok) {
      const apiCode = yield* readErrorCode(response)
      return yield* new HevyApiError({
        apiStatus: response.status,
        ...(apiCode === undefined ? {} : { apiCode }),
      })
    }
    if (response.status === 204) {
      return yield* Schema.decodeUnknownEffect(schema)(undefined).pipe(
        Effect.mapError(
          () =>
            new ApiError({
              status: 502,
              code: "invalid_api_response",
              message: "Hevy API response did not match its contract",
            }),
        ),
      )
    }
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: cause => new HevyApiError({ apiStatus: response.status, cause }),
    })
    const value = text === "" ? undefined : yield* parseJson(text)
    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        () =>
          new ApiError({
            status: 502,
            code: "invalid_api_response",
            message: "Hevy API response did not match its contract",
          }),
      ),
    )
  })
}

export function makeCoordinatorLayer(
  state: DurableObjectState,
  env: Env,
): Layer.Layer<ActiveWorkoutStoreApi | WebhookEventStoreApi | Api, ApiError> {
  const activeWorkoutStore = makeActiveWorkoutStoreLayer(state)
  const webhookEventStore = makeWebhookEventStoreLayer(state)
  // Fail clearly when the Worker is deployed without the API key secret.
  const api = Layer.effect(
    Api,
    Effect.gen(function* () {
      const apiKey = env.HEVY_API_KEY ?? ""
      if (apiKey.trim() === "") {
        return yield* new ApiError({
          status: 503,
          code: "api_key_not_configured",
          message:
            "The HEVY_API_KEY secret is not set. Create an API key in Hevy account settings and run: bunx wrangler secret put HEVY_API_KEY",
        })
      }
      return yield* makePublicApi({ API_BASE_URL: env.API_BASE_URL, HEVY_API_KEY: apiKey }, fetch)
    }),
  )
  return Layer.mergeAll(activeWorkoutStore, webhookEventStore, api)
}
