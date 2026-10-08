import { OAuthProvider } from "@cloudflare/workers-oauth-provider"
import { createMcpHandler } from "agents/mcp/server"
import { Clock, Effect, Schema } from "effect"
import { Api, makeCoordinatorLayer } from "./api"
import {
  BodyMeasurementSavePreview,
  createBodyMeasurementSavePreview,
  RequestedBodyMeasurementSave,
  toCreateBodyMeasurementBody,
  toUpdateBodyMeasurementBody,
  validateBodyMeasurementSavePreview,
  verifyBodyMeasurementAfterWrite,
} from "./body-measurement"
import { searchExercisesWithTemplates } from "./catalog"
import { ApiError, type HevyApiError, type SessionStorageError } from "./errors"
import { createWorkoutMcpServer } from "./mcp"
import { makeAuthorizationHandler } from "./oauth"
import {
  applyPreview,
  createPreview,
  decodeRequestedChanges,
  toRoutinePutBody,
  verifyPreview,
} from "./progression"
import { publicCompletedSet, publicWorkout } from "./public"
import { secureEqual } from "./security"
import { buildTrainingSummary } from "./training-summary"
import {
  type ApiRoutine,
  type BodyMeasurement,
  type CompletedWorkout,
  type CustomExercise,
  type Env,
  PreviewRequestSchema,
  ProgressionPreview,
  type UserAccount,
  WorkoutEditPreview,
  WorkoutEditPreviewRequestSchema,
  WorkoutExerciseInsertPreview,
  WorkoutExerciseInsertPreviewRequestSchema,
  WorkoutSyncRequestSchema,
} from "./types"
import { SERVER_NAME, SERVER_VERSION } from "./version"
import { HevyWorkoutWebhook, WebhookEventStore } from "./webhook"
import {
  applyWorkoutEditPreview,
  createWorkoutEditPreview,
  decodeWorkoutSetChanges,
  toWorkoutUpdateBody,
  verifyWorkoutEditPreview,
} from "./workout-edit"
import {
  applyWorkoutExerciseInsertPreview,
  createWorkoutExerciseInsertPreview,
  verifyWorkoutExerciseInsertPreview,
} from "./workout-insert"
import {
  ActiveWorkoutStore,
  createWorkoutDeletePreview,
  DiscardWorkoutSessionRequest,
  PreviewWorkoutFinishRequest,
  previewWorkoutFinish,
  StartWorkoutSessionRequest,
  startWorkoutSession,
  toCreateWorkoutBody,
  UpdateWorkoutSessionRequest,
  updateWorkoutSession,
  validateWorkoutDeletePreview,
  validateWorkoutFinishPreview,
  WorkoutDeletePreview,
  WorkoutFinishPreview,
} from "./workout-lifecycle"

const MAX_BODY_BYTES = 64 * 1024

type WorkerError = ApiError | SessionStorageError | HevyApiError

const readJson = Effect.fn("Http.readJson")(function* (request: Request) {
  const text = yield* Effect.tryPromise({
    try: () => request.text(),
    catch: cause =>
      new ApiError({
        status: 400,
        code: "invalid_body",
        message: "Request body could not be read",
        details: cause,
      }),
  })
  if (text.length > MAX_BODY_BYTES) {
    return yield* new ApiError({
      status: 413,
      code: "payload_too_large",
      message: "Body is too large",
    })
  }
  return yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () =>
      new ApiError({
        status: 400,
        code: "invalid_json",
        message: "Request body is not valid JSON",
      }),
  })
})

function decodeBody<A>(schema: Schema.Decoder<A>, value: unknown, message: string) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      cause =>
        new ApiError({
          status: 400,
          code: "invalid_body",
          message,
          details: cause.message,
        }),
    ),
  )
}

const fetchRoutine = Effect.fn("Routine.fetch")(function* (routineId: string) {
  const api = yield* Api
  const sync = yield* api.routineSync()
  const routine = sync.updated.find(candidate => candidate.id === routineId)
  if (routine === undefined) {
    return yield* new ApiError({
      status: 404,
      code: "routine_not_found",
      message: "Routine was not returned by sync",
    })
  }
  return routine
})

const fetchWorkout = Effect.fn("Workout.fetch")(function* (workoutId: string) {
  const api = yield* Api
  const workout = (yield* api.workouts()).find(candidate => candidate.id === workoutId)
  if (workout === undefined) {
    return yield* new ApiError({
      status: 404,
      code: "workout_not_found",
      message: "Workout was not returned by the latest batch",
    })
  }
  return workout
})

const previewRoutine = Effect.fn("Routine.preview")(function* (
  routineId: string,
  request: Request,
) {
  const value = yield* readJson(request)
  const body = yield* decodeBody(PreviewRequestSchema, value, "Preview body is invalid")
  const changes = yield* decodeRequestedChanges(body.changes)
  const routine = yield* fetchRoutine(routineId)
  return json(yield* createPreview(routine, changes))
})

const applyRoutine = Effect.fn("Routine.apply")(function* (routineId: string, request: Request) {
  const value = yield* readJson(request)
  const preview = yield* decodeBody(
    ProgressionPreview,
    value,
    "Apply body must be an unchanged preview response",
  )
  if (preview.routineId !== routineId) {
    return yield* new ApiError({
      status: 400,
      code: "routine_mismatch",
      message: "Request path and preview routine differ",
    })
  }
  const routine = yield* fetchRoutine(routineId)
  const updated = yield* applyPreview(routine, preview)
  const api = yield* Api
  yield* api.updateRoutine(routineId, toRoutinePutBody(updated))
  const verified = yield* fetchRoutine(routineId)
  yield* verifyPreview(verified, preview)
  return json({
    applied: true,
    routineId,
    revision: verified.updated_at,
    changes: preview.changes,
  })
})

const previewWorkoutEdit = Effect.fn("Workout.previewEdit")(function* (
  workoutId: string,
  request: Request,
) {
  const value = yield* readJson(request)
  const body = yield* decodeBody(
    WorkoutEditPreviewRequestSchema,
    value,
    "Workout edit preview body is invalid",
  )
  const changes = yield* decodeWorkoutSetChanges(body.changes)
  return json(yield* createWorkoutEditPreview(yield* fetchWorkout(workoutId), changes))
})

const applyWorkoutEdit = Effect.fn("Workout.applyEdit")(function* (
  workoutId: string,
  request: Request,
) {
  const value = yield* readJson(request)
  const preview = yield* decodeBody(
    WorkoutEditPreview,
    value,
    "Apply body must be an unchanged workout edit preview",
  )
  if (preview.workoutId !== workoutId) {
    return yield* new ApiError({
      status: 400,
      code: "workout_mismatch",
      message: "Request path and preview workout differ",
    })
  }
  const workout = yield* fetchWorkout(workoutId)
  const updated = yield* applyWorkoutEditPreview(workout, preview)
  const api = yield* Api
  yield* api.updateWorkout(workoutId, toWorkoutUpdateBody(updated))
  const verified = yield* fetchWorkout(workoutId)
  yield* verifyWorkoutEditPreview(verified, preview)
  return json({
    applied: true,
    workoutId,
    revision: verified.updated_at,
    changes: preview.changes,
  })
})

const previewWorkoutExerciseInsert = Effect.fn("Workout.previewExerciseInsert")(function* (
  workoutId: string,
  request: Request,
) {
  const body = yield* decodeBody(
    WorkoutExerciseInsertPreviewRequestSchema,
    yield* readJson(request),
    "Workout exercise insertion preview body is invalid",
  )
  return json(
    yield* createWorkoutExerciseInsertPreview(yield* fetchWorkout(workoutId), body.insertions),
  )
})

const applyWorkoutExerciseInsert = Effect.fn("Workout.applyExerciseInsert")(function* (
  workoutId: string,
  request: Request,
) {
  const preview = yield* decodeBody(
    WorkoutExerciseInsertPreview,
    yield* readJson(request),
    "Apply body must be an unchanged workout exercise insertion preview",
  )
  if (preview.workoutId !== workoutId) {
    return yield* new ApiError({
      status: 400,
      code: "workout_mismatch",
      message: "Request path and insertion preview workout differ",
    })
  }
  const workout = yield* fetchWorkout(workoutId)
  const updated = yield* applyWorkoutExerciseInsertPreview(workout, preview)
  const api = yield* Api
  yield* api.updateWorkout(workoutId, toWorkoutUpdateBody(updated))
  const verified = yield* fetchWorkout(workoutId)
  yield* verifyWorkoutExerciseInsertPreview(verified, preview)
  return json({
    applied: true,
    workoutId,
    revision: verified.updated_at,
    insertions: preview.insertions,
  })
})

const currentIsoTime = Effect.fn("Clock.currentIsoTime")(function* () {
  return new Date(yield* Clock.currentTimeMillis).toISOString()
})

const previewBodyMeasurementSave = Effect.fn("BodyMeasurement.previewSave")(function* (
  request: Request,
) {
  const body = yield* decodeBody(
    RequestedBodyMeasurementSave,
    yield* readJson(request),
    "Body-measurement preview body is invalid",
  )
  const api = yield* Api
  const existing = yield* api.bodyMeasurement(body.date)
  return json(yield* createBodyMeasurementSavePreview(body, existing))
})

const applyBodyMeasurementSave = Effect.fn("BodyMeasurement.applySave")(function* (
  request: Request,
) {
  const preview = yield* decodeBody(
    BodyMeasurementSavePreview,
    yield* readJson(request),
    "Apply body must be an unchanged body-measurement preview",
  )
  const api = yield* Api
  const current = yield* api.bodyMeasurement(preview.date)
  yield* validateBodyMeasurementSavePreview(preview, current)
  if (preview.operation === "create") {
    yield* api.createBodyMeasurement(toCreateBodyMeasurementBody(preview))
  } else {
    yield* api.updateBodyMeasurement(preview.date, toUpdateBodyMeasurementBody(preview))
  }
  const saved = yield* verifyBodyMeasurementAfterWrite(preview, api.bodyMeasurement(preview.date))
  return json({
    saved: true,
    date: preview.date,
    operation: preview.operation,
    measurement: saved === null ? null : publicBodyMeasurement(saved),
  })
})

const requireActiveWorkout = Effect.fn("Workout.requireActive")(function* () {
  const store = yield* ActiveWorkoutStore
  const active = yield* store.load()
  if (active === undefined) {
    return yield* new ApiError({
      status: 404,
      code: "active_workout_not_found",
      message: "No workout session is active",
    })
  }
  return active
})

const startActiveWorkout = Effect.fn("Workout.startActive")(function* (request: Request) {
  const store = yield* ActiveWorkoutStore
  if ((yield* store.load()) !== undefined) {
    return yield* new ApiError({
      status: 409,
      code: "active_workout_exists",
      message: "Discard or finish the active workout before starting another",
    })
  }
  const body = yield* decodeBody(
    StartWorkoutSessionRequest,
    yield* readJson(request),
    "Start workout body is invalid",
  )
  const routine = body.routineId === undefined ? undefined : yield* fetchRoutine(body.routineId)
  const active = yield* startWorkoutSession(body, routine, yield* currentIsoTime(), () =>
    crypto.randomUUID(),
  )
  yield* store.save(active)
  return json(active, 201)
})

const updateActiveWorkout = Effect.fn("Workout.updateActive")(function* (request: Request) {
  const store = yield* ActiveWorkoutStore
  const body = yield* decodeBody(
    UpdateWorkoutSessionRequest,
    yield* readJson(request),
    "Update workout body is invalid",
  )
  const updated = yield* updateWorkoutSession(
    yield* requireActiveWorkout(),
    body,
    yield* currentIsoTime(),
    () => crypto.randomUUID(),
  )
  yield* store.save(updated)
  return json(updated)
})

const previewActiveWorkoutFinish = Effect.fn("Workout.previewActiveFinish")(function* (
  request: Request,
) {
  const body = yield* decodeBody(
    PreviewWorkoutFinishRequest,
    yield* readJson(request),
    "Finish preview body is invalid",
  )
  return json(
    yield* previewWorkoutFinish(
      yield* requireActiveWorkout(),
      body.endTime ?? (yield* currentIsoTime()),
    ),
  )
})

const finishActiveWorkout = Effect.fn("Workout.finishActive")(function* (request: Request) {
  const preview = yield* decodeBody(
    WorkoutFinishPreview,
    yield* readJson(request),
    "Finish body must be an unchanged workout preview",
  )
  const active = yield* requireActiveWorkout()
  if (active.id !== preview.sessionId || active.revision !== preview.revision) {
    return yield* new ApiError({
      status: 409,
      code: "active_workout_changed",
      message: "Active workout changed after finish preview",
    })
  }
  yield* validateWorkoutFinishPreview(active, preview)
  const api = yield* Api
  const created = yield* api.createWorkout(toCreateWorkoutBody(preview))
  yield* (yield* ActiveWorkoutStore).clear()
  return json(
    {
      saved: true,
      workout: publicWorkout(created),
      timing: {
        startTime: preview.startTime,
        endTime: preview.endTime,
        durationSeconds: preview.durationSeconds,
        exercises: preview.exercises.map(exercise => ({
          exerciseTemplateId: exercise.exerciseTemplateId,
          restSeconds: exercise.restSeconds,
          sets: exercise.sets.map(set => ({
            index: set.index,
            completedAt: set.completedAt,
            elapsedSeconds: set.elapsedSeconds,
          })),
        })),
      },
    },
    201,
  )
})

const discardActiveWorkout = Effect.fn("Workout.discardActive")(function* (request: Request) {
  const body = yield* decodeBody(
    DiscardWorkoutSessionRequest,
    yield* readJson(request),
    "Discard workout body is invalid",
  )
  const active = yield* requireActiveWorkout()
  if (active.revision !== body.revision) {
    return yield* new ApiError({
      status: 409,
      code: "active_workout_changed",
      message: "Active workout changed after it was read",
    })
  }
  yield* (yield* ActiveWorkoutStore).clear()
  return json({ discarded: true, sessionId: active.id })
})

const previewWorkoutDelete = Effect.fn("Workout.previewDelete")(function* (workoutId: string) {
  return json(yield* createWorkoutDeletePreview(yield* fetchWorkout(workoutId)))
})

const applyWorkoutDelete = Effect.fn("Workout.applyDelete")(function* (
  workoutId: string,
  request: Request,
) {
  const preview = yield* decodeBody(
    WorkoutDeletePreview,
    yield* readJson(request),
    "Delete body must be an unchanged workout delete preview",
  )
  if (preview.workoutId !== workoutId) {
    return yield* new ApiError({
      status: 400,
      code: "workout_mismatch",
      message: "Request path and delete preview workout differ",
    })
  }
  const workout = yield* fetchWorkout(workoutId)
  yield* validateWorkoutDeletePreview(workout, preview)
  const api = yield* Api
  yield* api.deleteWorkout(workoutId)
  const remains = (yield* api.workouts()).some(candidate => candidate.id === workoutId)
  if (remains) {
    return yield* new ApiError({
      status: 502,
      code: "verification_failed",
      message: "Deleted workout is still present",
    })
  }
  return json({ deleted: true, workoutId })
})

function exerciseHistory(workouts: ReadonlyArray<CompletedWorkout>, exerciseTemplateId: string) {
  const history = workouts.flatMap(workout =>
    workout.exercises
      .filter(exercise => exercise.exercise_template_id === exerciseTemplateId)
      .map(exercise => ({
        workoutId: workout.id,
        workoutTitle: workout.name,
        startTime: workout.start_time,
        endTime: workout.end_time,
        createdAt: workout.created_at,
        exerciseTitle: exercise.title,
        sets: exercise.sets.map(publicCompletedSet),
      })),
  )
  return { exerciseTemplateId, history }
}

const route = Effect.fn("Http.route")(function* (request: Request) {
  const url = new URL(request.url)
  const api = yield* Api

  if (request.method === "GET" && url.pathname === "/v1/workout-session") {
    const active = yield* (yield* ActiveWorkoutStore).load()
    return json({ active: active ?? null })
  }
  if (request.method === "POST" && url.pathname === "/v1/workout-session/start") {
    return yield* startActiveWorkout(request)
  }
  if (request.method === "POST" && url.pathname === "/v1/workout-session/update") {
    return yield* updateActiveWorkout(request)
  }
  if (request.method === "POST" && url.pathname === "/v1/workout-session/finish/preview") {
    return yield* previewActiveWorkoutFinish(request)
  }
  if (request.method === "POST" && url.pathname === "/v1/workout-session/finish/apply") {
    return yield* finishActiveWorkout(request)
  }
  if (request.method === "POST" && url.pathname === "/v1/workout-session/discard") {
    return yield* discardActiveWorkout(request)
  }

  if (request.method === "GET" && url.pathname === "/v1/routines") {
    const sync = yield* api.routineSync()
    return json({ updatedAt: sync.updated_at, routines: sync.updated.map(publicRoutine) })
  }
  if (request.method === "GET" && url.pathname === "/v1/custom-exercises") {
    const exercises = yield* api.customExercises()
    return json({ exercises: exercises.map(publicCustomExercise) })
  }
  if (request.method === "GET" && url.pathname === "/v1/exercises") {
    return json(yield* searchExercisesWithTemplates(url.searchParams, api.exerciseTemplates()))
  }
  if (request.method === "GET" && url.pathname === "/v1/workouts") {
    const workouts = yield* api.workouts()
    return json({ workouts: workouts.map(publicWorkout) })
  }
  if (request.method === "GET" && url.pathname === "/v1/workouts/count") {
    return json({ count: (yield* api.workoutCount()).workout_count })
  }
  if (request.method === "POST" && url.pathname === "/v1/workouts/sync") {
    const value = yield* readJson(request)
    const body = yield* decodeBody(WorkoutSyncRequestSchema, value, "Workout sync body is invalid")
    const sync = yield* api.workoutSync(body.known)
    return json({
      updatedAt: sync.updated_at,
      isMore: sync.isMore,
      updated: sync.updated.map(publicWorkout),
      deleted: sync.deleted,
    })
  }
  if (request.method === "GET" && url.pathname === "/v1/body-measurements") {
    const measurements = yield* api.bodyMeasurements()
    return json({ measurements: measurements.map(publicBodyMeasurement) })
  }
  if (request.method === "POST" && url.pathname === "/v1/body-measurements/save/preview") {
    return yield* previewBodyMeasurementSave(request)
  }
  if (request.method === "POST" && url.pathname === "/v1/body-measurements/save/apply") {
    return yield* applyBodyMeasurementSave(request)
  }
  if (request.method === "GET" && url.pathname === "/v1/training-summary") {
    const rawWeeks = url.searchParams.get("weeks") ?? "4"
    const weeks = Number(rawWeeks)
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) {
      return yield* new ApiError({
        status: 400,
        code: "invalid_query",
        message: "weeks must be an integer between 1 and 12",
      })
    }
    const workouts = yield* api.workouts()
    const measurements = yield* api.bodyMeasurements()
    return json(buildTrainingSummary(workouts, measurements, weeks, yield* currentIsoTime()))
  }
  if (request.method === "GET" && url.pathname === "/v1/account") {
    return json(publicUserAccount(yield* api.userAccount()))
  }
  if (request.method === "GET" && url.pathname === "/v1/routine-folders") {
    return json({ folders: yield* api.routineFolders() })
  }
  if (request.method === "GET" && url.pathname === "/v1/webhook-events") {
    return json({ events: yield* (yield* WebhookEventStore).list() })
  }
  if (request.method === "POST" && url.pathname === "/v1/webhook-events") {
    const value = yield* readJson(request)
    const body = yield* decodeBody(HevyWorkoutWebhook, value, "Webhook body is invalid")
    yield* (yield* WebhookEventStore).record({
      workoutId: body.workoutId,
      receivedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })
    return json({ recorded: true })
  }

  const workoutMatch = url.pathname.match(/^\/v1\/workouts\/([^/]+)$/)
  const workoutId = workoutMatch?.[1]
  if (request.method === "GET" && workoutId !== undefined) {
    const decodedWorkoutId = decodeURIComponent(workoutId)
    return json(publicWorkout(yield* fetchWorkout(decodedWorkoutId)))
  }

  const workoutEditMatch = url.pathname.match(/^\/v1\/workouts\/([^/]+)\/(preview|apply)$/)
  const workoutEditId = workoutEditMatch?.[1]
  const workoutEditOperation = workoutEditMatch?.[2]
  if (request.method === "POST" && workoutEditId !== undefined) {
    const decodedWorkoutId = decodeURIComponent(workoutEditId)
    return yield* workoutEditOperation === "preview"
      ? previewWorkoutEdit(decodedWorkoutId, request)
      : applyWorkoutEdit(decodedWorkoutId, request)
  }

  const workoutInsertMatch = url.pathname.match(
    /^\/v1\/workouts\/([^/]+)\/exercise-insert\/(preview|apply)$/,
  )
  const workoutInsertId = workoutInsertMatch?.[1]
  const workoutInsertOperation = workoutInsertMatch?.[2]
  if (request.method === "POST" && workoutInsertId !== undefined) {
    const decodedWorkoutId = decodeURIComponent(workoutInsertId)
    return yield* workoutInsertOperation === "preview"
      ? previewWorkoutExerciseInsert(decodedWorkoutId, request)
      : applyWorkoutExerciseInsert(decodedWorkoutId, request)
  }

  const workoutDeleteMatch = url.pathname.match(
    /^\/v1\/workouts\/([^/]+)\/delete\/(preview|apply)$/,
  )
  const workoutDeleteId = workoutDeleteMatch?.[1]
  const workoutDeleteOperation = workoutDeleteMatch?.[2]
  if (request.method === "POST" && workoutDeleteId !== undefined) {
    const decodedWorkoutId = decodeURIComponent(workoutDeleteId)
    return yield* workoutDeleteOperation === "preview"
      ? previewWorkoutDelete(decodedWorkoutId)
      : applyWorkoutDelete(decodedWorkoutId, request)
  }

  const routineReadMatch = url.pathname.match(/^\/v1\/routines\/([^/]+)$/)
  const routineReadId = routineReadMatch?.[1]
  if (request.method === "GET" && routineReadId !== undefined) {
    return json(publicRoutine(yield* fetchRoutine(decodeURIComponent(routineReadId))))
  }

  const historyMatch = url.pathname.match(/^\/v1\/history\/([^/]+)$/)
  const historyId = historyMatch?.[1]
  if (request.method === "GET" && historyId !== undefined) {
    return json(exerciseHistory(yield* api.workouts(), decodeURIComponent(historyId)))
  }

  const routineMatch = url.pathname.match(/^\/v1\/routines\/([^/]+)\/(preview|apply)$/)
  const routineId = routineMatch?.[1]
  const operation = routineMatch?.[2]
  if (request.method === "POST" && routineId !== undefined) {
    const decodedRoutineId = decodeURIComponent(routineId)
    return yield* operation === "preview"
      ? previewRoutine(decodedRoutineId, request)
      : applyRoutine(decodedRoutineId, request)
  }

  return yield* new ApiError({ status: 404, code: "not_found", message: "Route not found" })
})

export class SessionCoordinator implements DurableObject {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  fetch(request: Request): Promise<Response> {
    return this.exclusive(() =>
      Effect.runPromise(
        route(request).pipe(
          Effect.provide(makeCoordinatorLayer(this.state, this.env)),
          Effect.catch(error => Effect.succeed(errorResponse(error))),
        ),
      ),
    )
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release: () => void = () => undefined
    this.tail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

const restHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION })
    }
    const webhookToken = url.pathname.match(/^\/webhook\/hevy\/([^/]+)$/)?.[1]
    if (webhookToken !== undefined) {
      return handleHevyWebhook(request, env, ctx, decodeURIComponent(webhookToken))
    }
    if (!(await authorized(request, env.AUTOMATION_API_TOKEN))) {
      return json({ error: "unauthorized" }, 401)
    }
    const length = Number(request.headers.get("content-length") ?? 0)
    if (length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413)
    return env.SESSION_COORDINATOR.getByName("primary").fetch(request)
  },
} satisfies ExportedHandler<Env>

// Hevy POSTs {"workoutId": "..."} when a new workout is saved and expects a
// 200 OK within 5 seconds. Ack immediately, then record the event in the
// Durable Object in the background. The path token is the only credential
// because Hevy sends no signature.
async function handleHevyWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  suppliedToken: string,
): Promise<Response> {
  if (!(await secureEqual(suppliedToken, env.HEVY_WEBHOOK_TOKEN ?? ""))) {
    return json({ error: "not_found" }, 404)
  }
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413)
  let webhook: HevyWorkoutWebhook
  try {
    webhook = Schema.decodeUnknownSync(HevyWorkoutWebhook)(JSON.parse(await request.text()))
  } catch {
    return json({ error: "invalid_body" }, 400)
  }
  const record = env.SESSION_COORDINATOR.getByName("primary")
    .fetch(
      new Request("https://webhook.internal/v1/webhook-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workoutId: webhook.workoutId }),
      }),
    )
    .then(recorded => {
      if (!recorded.ok) {
        console.error(`Webhook event was not recorded: ${recorded.status}`)
      }
    })
    .catch(cause => {
      console.error("Webhook event was not recorded", cause)
    })
  ctx.waitUntil(record)
  return json({ received: true }, 200)
}

const mcpHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createMcpHandler(() => createWorkoutMcpServer(env), {
      route: "/mcp",
      responseMode: "auto",
    })(request, env, ctx)
  },
} satisfies ExportedHandler<Env>

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: makeAuthorizationHandler(restHandler),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
})

function authorized(request: Request, expected: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? ""
  const actual = header.startsWith("Bearer ") ? header.slice(7) : ""
  return secureEqual(actual, expected)
}

function publicRoutine(routine: ApiRoutine): object {
  return {
    id: routine.id,
    title: routine.title,
    index: routine.index,
    updatedAt: routine.updated_at,
    exercises: routine.exercises.map(exercise => ({
      exerciseTemplateId: exercise.exercise_template_id,
      title: exercise.title,
      exerciseType: exercise.exercise_type,
      equipmentCategory: exercise.equipment_category,
      muscleGroup: exercise.muscle_group,
      otherMuscles: exercise.other_muscles,
      restSeconds: exercise.rest_seconds,
      notes: exercise.notes,
      sets: exercise.sets.map(set => ({
        index: set.index,
        indicator: set.indicator,
        weightKg: set.weight_kg,
        reps: set.reps,
        rpe: set.rpe,
        distanceMeters: set.distance_meters,
        durationSeconds: set.duration_seconds,
        customMetric: set.custom_metric,
      })),
    })),
  }
}

function publicCustomExercise(exercise: CustomExercise): object {
  return {
    id: exercise.id,
    title: exercise.title,
    exerciseType: exercise.exercise_type,
    equipmentCategory: exercise.equipment_category,
    muscleGroup: exercise.muscle_group,
    otherMuscles: exercise.other_muscles,
    isArchived: exercise.is_archived,
  }
}

function publicBodyMeasurement(measurement: BodyMeasurement): object {
  return {
    id: measurement.id,
    date: measurement.date,
    weightKg: measurement.weight_kg,
    leanMassKg: measurement.lean_mass_kg,
    fatPercent: measurement.fat_percent,
    neckCm: measurement.neck_cm,
    shoulderCm: measurement.shoulder_cm,
    chestCm: measurement.chest_cm,
    leftBicepCm: measurement.left_bicep_cm,
    rightBicepCm: measurement.right_bicep_cm,
    leftForearmCm: measurement.left_forearm_cm,
    rightForearmCm: measurement.right_forearm_cm,
    abdomenCm: measurement.abdomen,
    waistCm: measurement.waist,
    hipsCm: measurement.hips,
    leftThighCm: measurement.left_thigh,
    rightThighCm: measurement.right_thigh,
    leftCalfCm: measurement.left_calf,
    rightCalfCm: measurement.right_calf,
    createdAt: measurement.created_at,
  }
}

function publicUserAccount(account: UserAccount): object {
  return {
    id: account.id,
    username: account.username,
    fullName: account.full_name,
    countryCode: account.country_code,
    city: account.city,
    sex: account.sex,
    birthday: account.birthday,
    heightCm: account.height_cm,
    lastWorkoutAt: account.last_workout_at,
    isCoached: account.is_coached,
    isCoach: account.is_a_coach,
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  })
}

function errorResponse(error: WorkerError): Response {
  if (error._tag === "ApiError") {
    return json(
      {
        error: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      error.status,
    )
  }
  if (error._tag === "HevyApiError") {
    return json(
      {
        error: "hevy_api_error",
        apiStatus: error.apiStatus,
        apiCode: error.apiCode,
      },
      502,
    )
  }
  return json({ error: "session_storage_error" }, 500)
}
