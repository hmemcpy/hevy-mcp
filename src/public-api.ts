import { Effect, Schema } from "effect"
import { type Api, type ApiFetch, decodeResponse } from "./api"
import { ApiError, HevyApiError } from "./errors"
import {
  ApiRoutine,
  ApiRoutineExercise,
  ApiSet,
  BodyMeasurement,
  CompletedWorkout,
  CompletedWorkoutExercise,
  CustomExercise,
  ExerciseTemplate,
  RoutineSyncResponse,
  UserAccount,
  WorkoutCountResponse,
  WorkoutSyncResponse,
} from "./types"

// Adapter for Hevy's official public developer API (https://api.hevyapp.com/docs/).
// This is the only Hevy integration in this repository: the coordinator routes
// and MCP tools talk to the Api service it implements. The public API is
// weaker than what the Hevy app itself supports; unsupported operations and
// unrepresentable values fail closed instead of being silently degraded.
// See docs/deployment.md for the full difference list, and
// docs/delete-workout-proposal.md for the delete endpoint requested from Hevy.

export interface PublicApiConfig {
  readonly API_BASE_URL: string
  readonly HEVY_API_KEY: string
}

const EPOCH_ISO = "1970-01-01T00:00:00.000Z"
const PUBLIC_PAGE_SIZE = 10
// The exercise-template catalog is an order of magnitude larger than the
// other listings; use the maximum page size Hevy documents (100) so a full
// fetch stays within a handful of requests.
const TEMPLATE_PAGE_SIZE = 100
const MAX_PUBLIC_PAGES = 100
const SET_TYPES = ["warmup", "normal", "failure", "dropset"]
const RPE_VALUES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10]

const PublicSetSchema = Schema.Struct({
  index: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  weight_kg: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  reps: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  distance_meters: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  duration_seconds: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  rpe: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  custom_metric: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
})

const PublicWorkoutExerciseSchema = Schema.Struct({
  index: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  exercise_template_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  superset_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  sets: Schema.optionalKey(Schema.Array(PublicSetSchema)),
})

const PublicWorkoutSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  routine_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  start_time: Schema.optionalKey(Schema.NullOr(Schema.String)),
  end_time: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_private: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  exercises: Schema.optionalKey(Schema.Array(PublicWorkoutExerciseSchema)),
})

const PublicRoutineExerciseSchema = Schema.Struct({
  index: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rest_seconds: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  exercise_template_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  superset_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  sets: Schema.optionalKey(Schema.Array(PublicSetSchema)),
})

const PublicRoutineSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  folder_id: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  exercises: Schema.optionalKey(Schema.Array(PublicRoutineExerciseSchema)),
})

const PublicExerciseTemplateSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  primary_muscle_group: Schema.optionalKey(Schema.NullOr(Schema.String)),
  secondary_muscle_groups: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  equipment: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_custom: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
})

const PublicBodyMeasurementSchema = Schema.Struct({
  date: Schema.NonEmptyString,
  weight_kg: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  lean_mass_kg: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  fat_percent: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  neck_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  shoulder_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  chest_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_bicep_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_bicep_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_forearm_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_forearm_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  abdomen: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  waist: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  hips: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_thigh: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_thigh: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_calf: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_calf: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
})

const PublicUserInfoSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  username: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

const PublicUserInfoResponseSchema = Schema.Struct({
  data: PublicUserInfoSchema,
})

const PublicWorkoutPageSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  page_count: Schema.optionalKey(Schema.Finite),
  workouts: Schema.optionalKey(Schema.Array(PublicWorkoutSchema)),
})

const PublicRoutinePageSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  page_count: Schema.optionalKey(Schema.Finite),
  routines: Schema.optionalKey(Schema.Array(PublicRoutineSchema)),
})

const PublicExerciseTemplatePageSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  page_count: Schema.optionalKey(Schema.Finite),
  exercise_templates: Schema.optionalKey(Schema.Array(PublicExerciseTemplateSchema)),
})

const PublicRoutineFolderPageSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  page_count: Schema.optionalKey(Schema.Finite),
  routine_folders: Schema.optionalKey(Schema.Array(Schema.Unknown)),
})

const PublicBodyMeasurementPageSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  page_count: Schema.optionalKey(Schema.Finite),
  body_measurements: Schema.optionalKey(Schema.Array(PublicBodyMeasurementSchema)),
})

const PublicWorkoutEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("updated"),
    workout: PublicWorkoutSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("deleted"),
    id: Schema.NonEmptyString,
  }),
])

const PublicWorkoutEventPageSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  page_count: Schema.optionalKey(Schema.Finite),
  events: Schema.optionalKey(Schema.Array(PublicWorkoutEventSchema)),
})

type PublicSet = Schema.Schema.Type<typeof PublicSetSchema>
type PublicWorkout = Schema.Schema.Type<typeof PublicWorkoutSchema>
type PublicRoutine = Schema.Schema.Type<typeof PublicRoutineSchema>
type PublicExerciseTemplate = Schema.Schema.Type<typeof PublicExerciseTemplateSchema>
type PublicBodyMeasurement = Schema.Schema.Type<typeof PublicBodyMeasurementSchema>
type PublicWorkoutEvent = Schema.Schema.Type<typeof PublicWorkoutEventSchema>

function invalidContract(detail: string): ApiError {
  return new ApiError({
    status: 502,
    code: "invalid_api_response",
    message: `Public API response did not match its contract (${detail})`,
  })
}

function unrepresentable(value: unknown, what: string, allowed: string): ApiError {
  return new ApiError({
    status: 400,
    code: "value_not_representable",
    message: `${what} ${JSON.stringify(value) ?? "value"} cannot be written through the public API; allowed: ${allowed}`,
  })
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") throw invalidContract(`missing ${what}`)
  return value
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function nullOrText(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

// Request side: reject non-integer values instead of mutating them.
function intOrNull(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isInteger(value))
    throw invalidContract(`${what} is not an integer`)
  return value
}

// Response side: normalize defensively so one odd field cannot break a read.
function truncIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null
}

function setIndex(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback
}

function isoTimestamp(value: unknown, what: string): string {
  const ms = typeof value === "number" ? value * 1_000 : Date.parse(String(value ?? ""))
  if (!Number.isFinite(ms))
    throw unrepresentable(value, what, "an epoch-seconds number or ISO timestamp")
  return new Date(ms).toISOString()
}

function toPublicSetType(indicator: unknown): string {
  const value = typeof indicator === "string" && indicator.trim() !== "" ? indicator : "normal"
  if (!SET_TYPES.includes(value)) throw unrepresentable(value, "Set type", SET_TYPES.join(", "))
  return value
}

function toPublicRpe(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const rpe = Number(value)
  if (!RPE_VALUES.includes(rpe)) throw unrepresentable(value, "RPE", RPE_VALUES.join(", "))
  return rpe
}

function toPublicIntegerId(value: unknown, what: string): number | null {
  if (value === null || value === undefined || value === "") return null
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric)) throw unrepresentable(value, what, "an integer or null")
  return numeric
}

// Api-shaped request set -> public API request set. completed_at, rest
// metadata, and volume-doubling flags have no public representation and are
// dropped by the callers.
function toPublicSetFromApi(
  set: Record<string, unknown>,
  indicatorKey: "type" | "indicator",
): Record<string, unknown> {
  return {
    type: toPublicSetType(set[indicatorKey]),
    weight_kg: finiteOrNull(set.weight_kg),
    reps: intOrNull(set.reps, "reps"),
    rpe: toPublicRpe(set.rpe),
    distance_meters: intOrNull(set.distance_meters, "distance_meters"),
    duration_seconds: intOrNull(set.duration_seconds, "duration_seconds"),
    custom_metric: finiteOrNull(set.custom_metric),
  }
}

function toApiSet(set: PublicSet, position: number): ApiSet {
  return ApiSet.make({
    index: setIndex(set.index, position),
    indicator: set.type ?? "normal",
    weight_kg: finiteOrNull(set.weight_kg),
    reps: truncIntOrNull(set.reps),
    rpe: finiteOrNull(set.rpe),
    distance_meters: finiteOrNull(set.distance_meters),
    duration_seconds: finiteOrNull(set.duration_seconds),
    custom_metric: finiteOrNull(set.custom_metric),
  })
}

function toCompletedWorkout(workout: PublicWorkout): CompletedWorkout {
  const name = optionalText(workout.title)
  const createdAt = optionalText(workout.created_at)
  const updatedAt = optionalText(workout.updated_at)
  return CompletedWorkout.make({
    id: workout.id,
    ...(name === undefined ? {} : { name }),
    ...(workout.description === undefined ? {} : { description: workout.description }),
    ...(workout.routine_id === undefined ? {} : { routine_id: workout.routine_id }),
    ...(workout.start_time === undefined ? {} : { start_time: workout.start_time }),
    ...(workout.end_time === undefined ? {} : { end_time: workout.end_time }),
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
    ...(workout.is_private === null || workout.is_private === undefined
      ? {}
      : { is_private: workout.is_private }),
    exercises: (workout.exercises ?? []).map((exercise, position) => {
      const title = optionalText(exercise.title)
      return CompletedWorkoutExercise.make({
        exercise_template_id: requireText(
          exercise.exercise_template_id,
          `workout ${workout.id} exercise ${position} template id`,
        ),
        ...(title === undefined ? {} : { title }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
        ...(exercise.superset_id === undefined ? {} : { superset_id: exercise.superset_id }),
        sets: (exercise.sets ?? []).map((set, setIndex) => toApiSet(set, setIndex)),
      })
    }),
  })
}

function toApiRoutine(routine: PublicRoutine, position: number): ApiRoutine {
  const rawRest = (routine.exercises ?? []).map(exercise => exercise.rest_seconds)
  return ApiRoutine.make({
    id: routine.id,
    title: routine.title ?? "",
    index: position,
    updated_at: routine.updated_at ?? EPOCH_ISO,
    parent_routine_id: null,
    folder_id:
      routine.folder_id === null || routine.folder_id === undefined
        ? null
        : String(routine.folder_id),
    program_id: null,
    notes: routine.notes ?? null,
    coach_force_rpe_enabled: false,
    exercises: (routine.exercises ?? []).map((exercise, exercisePosition) => {
      const rest = rawRest[exercisePosition]
      const restSeconds =
        typeof rest === "number" ? rest : typeof rest === "string" ? Number(rest) : Number.NaN
      return ApiRoutineExercise.make({
        exercise_template_id: requireText(
          exercise.exercise_template_id,
          `routine ${routine.id} exercise ${exercisePosition} template id`,
        ),
        title: exercise.title ?? "",
        notes: exercise.notes ?? null,
        rest_seconds: Number.isFinite(restSeconds) ? restSeconds : 0,
        sets: (exercise.sets ?? []).map((set, setIndex) => toApiSet(set, setIndex)),
      })
    }),
  })
}

function toCustomExercise(template: PublicExerciseTemplate): CustomExercise {
  const exerciseType = optionalText(template.type)
  const equipment = optionalText(template.equipment)
  const muscleGroup = optionalText(template.primary_muscle_group)
  const otherMuscles = template.secondary_muscle_groups ?? undefined
  return CustomExercise.make({
    id: template.id,
    title: template.title ?? "",
    ...(exerciseType === undefined ? {} : { exercise_type: exerciseType }),
    ...(equipment === undefined ? {} : { equipment_category: equipment }),
    ...(muscleGroup === undefined ? {} : { muscle_group: muscleGroup }),
    ...(otherMuscles === undefined ? {} : { other_muscles: otherMuscles }),
  })
}

function toExerciseTemplate(template: PublicExerciseTemplate): ExerciseTemplate {
  const exerciseType = optionalText(template.type)
  const equipment = optionalText(template.equipment)
  const muscleGroup = optionalText(template.primary_muscle_group)
  const otherMuscles = template.secondary_muscle_groups ?? undefined
  const isCustom =
    template.is_custom === null || template.is_custom === undefined ? undefined : template.is_custom
  return ExerciseTemplate.make({
    id: template.id,
    title: template.title ?? "",
    ...(exerciseType === undefined ? {} : { exercise_type: exerciseType }),
    ...(equipment === undefined ? {} : { equipment_category: equipment }),
    ...(muscleGroup === undefined ? {} : { muscle_group: muscleGroup }),
    ...(otherMuscles === undefined ? {} : { other_muscles: otherMuscles }),
    ...(isCustom === undefined ? {} : { is_custom: isCustom }),
  })
}

function toBodyMeasurement(measurement: PublicBodyMeasurement): BodyMeasurement {
  return BodyMeasurement.make({
    date: measurement.date,
    weight_kg: finiteOrNull(measurement.weight_kg),
    lean_mass_kg: finiteOrNull(measurement.lean_mass_kg),
    fat_percent: finiteOrNull(measurement.fat_percent),
    neck_cm: finiteOrNull(measurement.neck_cm),
    shoulder_cm: finiteOrNull(measurement.shoulder_cm),
    chest_cm: finiteOrNull(measurement.chest_cm),
    left_bicep_cm: finiteOrNull(measurement.left_bicep_cm),
    right_bicep_cm: finiteOrNull(measurement.right_bicep_cm),
    left_forearm_cm: finiteOrNull(measurement.left_forearm_cm),
    right_forearm_cm: finiteOrNull(measurement.right_forearm_cm),
    abdomen: finiteOrNull(measurement.abdomen),
    waist: finiteOrNull(measurement.waist),
    hips: finiteOrNull(measurement.hips),
    left_thigh: finiteOrNull(measurement.left_thigh),
    right_thigh: finiteOrNull(measurement.right_thigh),
    left_calf: finiteOrNull(measurement.left_calf),
    right_calf: finiteOrNull(measurement.right_calf),
  })
}

// Api-shaped create body (toCreateWorkoutBody) -> public POST /v1/workouts.
// The client workout id, routine linkage, rest metadata, per-set completion
// times, and share/biometrics flags have no public representation.
function toPublicWorkoutCreateBody(body: object): Record<string, unknown> {
  const workout = record(record(body).workout)
  return {
    workout: {
      title: requireText(workout.title, "workout title"),
      description: nullOrText(workout.description),
      start_time: isoTimestamp(workout.start_time, "workout start_time"),
      end_time: isoTimestamp(workout.end_time, "workout end_time"),
      ...(workout.is_private === undefined ? {} : { is_private: workout.is_private === true }),
      exercises: arrayOrEmpty(workout.exercises).map(entry => {
        const exercise = record(entry)
        return {
          exercise_template_id: requireText(exercise.exercise_template_id, "exercise template id"),
          superset_id: null,
          notes: nullOrText(exercise.notes),
          sets: arrayOrEmpty(exercise.sets).map(set => toPublicSetFromApi(record(set), "type")),
        }
      }),
    },
  }
}

// The public PUT /v1/workouts/{id} replaces the whole workout and requires
// title and timestamps, so the current workout is merged with the Api-shaped
// exercise update body (toWorkoutUpdateBody).
function toPublicWorkoutUpdateBody(current: PublicWorkout, body: object): Record<string, unknown> {
  const update = record(record(body).workoutUpdate)
  return {
    workout: {
      title: requireText(current.title, "current workout title"),
      description: nullOrText(current.description),
      start_time: requireText(current.start_time, "current workout start_time"),
      end_time: requireText(current.end_time, "current workout end_time"),
      ...(current.is_private === undefined || current.is_private === null
        ? {}
        : { is_private: current.is_private === true }),
      exercises: arrayOrEmpty(update.exercises).map(entry => {
        const exercise = record(entry)
        return {
          exercise_template_id: requireText(exercise.exercise_template_id, "exercise template id"),
          superset_id: toPublicIntegerId(exercise.superset_id, "superset id"),
          notes: nullOrText(exercise.notes),
          sets: arrayOrEmpty(exercise.sets).map(set => toPublicSetFromApi(record(set), "type")),
        }
      }),
    },
  }
}

// Api-shaped routine body (toRoutinePutBody) -> public PUT /v1/routines.
// Routine ordering, parent/program links, the coach RPE flag, and superset ids
// have no public routine representation.
function toPublicRoutinePutBody(body: object): Record<string, unknown> {
  const routine = record(record(body).routine)
  return {
    routine: {
      title: requireText(routine.title, "routine title"),
      folder_id: toPublicIntegerId(routine.folder_id, "routine folder id"),
      notes: nullOrText(routine.notes),
      exercises: arrayOrEmpty(routine.exercises).map(entry => {
        const exercise = record(entry)
        return {
          exercise_template_id: requireText(exercise.exercise_template_id, "exercise template id"),
          superset_id: null,
          rest_seconds: intOrNull(exercise.rest_seconds, "rest_seconds"),
          notes: nullOrText(exercise.notes),
          sets: arrayOrEmpty(exercise.sets).map(set =>
            toPublicSetFromApi(record(set), "indicator"),
          ),
        }
      }),
    },
  }
}

function minKnownRevision(known: Readonly<Record<string, string>>): string {
  const times = Object.values(known)
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value))
  if (times.length === 0) return EPOCH_ISO
  return new Date(Math.min(...times)).toISOString()
}

export function makePublicApi(config: PublicApiConfig, fetchImpl: ApiFetch): Effect.Effect<Api> {
  return Effect.gen(function* () {
    const send = Effect.fn("PublicApi.send")(function* (path: string, init: RequestInit) {
      const requestHeaders = new Headers(init.headers)
      requestHeaders.set("accept", "application/json")
      requestHeaders.set("content-type", "application/json")
      requestHeaders.set("api-key", config.HEVY_API_KEY)
      return yield* Effect.tryPromise({
        try: () =>
          fetchImpl(new URL(path, config.API_BASE_URL), { ...init, headers: requestHeaders }),
        catch: cause => new HevyApiError({ apiStatus: 0, cause }),
      })
    })

    const request = Effect.fn("PublicApi.request")(function* <A>(
      path: string,
      init: RequestInit,
      schema: Schema.Decoder<A>,
    ) {
      const response = yield* send(path, init)
      return yield* decodeResponse(response, schema)
    })

    const translate = Effect.fn("PublicApi.translate")(function* <A>(make: () => A) {
      return yield* Effect.try({
        try: make,
        catch: cause =>
          cause instanceof ApiError
            ? cause
            : new ApiError({
                status: 400,
                code: "invalid_body",
                message: "Api request body could not be represented via the public API",
                details: cause,
              }),
      })
    })

    const mapResponse = Effect.fn("PublicApi.mapResponse")(function* <A>(make: () => A) {
      return yield* Effect.try({
        try: make,
        catch: cause => (cause instanceof ApiError ? cause : invalidContract("unexpected value")),
      })
    })

    const paged = Effect.fn("PublicApi.paged")(function* <A, B>(
      path: string,
      pageSchema: Schema.Decoder<A>,
      readItems: (page: A) => ReadonlyArray<B>,
      pageSize: number = PUBLIC_PAGE_SIZE,
    ) {
      const separator = path.includes("?") ? "&" : "?"
      const items: B[] = []
      let pageCount = 1
      for (let page = 1; page <= Math.min(pageCount, MAX_PUBLIC_PAGES); page += 1) {
        const decoded = yield* request(
          `${path}${separator}page=${page}&pageSize=${pageSize}`,
          {},
          pageSchema,
        )
        const envelope = record(decoded)
        pageCount = typeof envelope.page_count === "number" ? envelope.page_count : pageCount
        items.push(...readItems(decoded))
      }
      if (pageCount > MAX_PUBLIC_PAGES) {
        return yield* new ApiError({
          status: 502,
          code: "api_pagination_limit",
          message: `Api reported ${pageCount} pages; the limit is ${MAX_PUBLIC_PAGES}`,
        })
      }
      return items
    })

    return {
      routineSync: Effect.fn("PublicApi.routineSync")(function* () {
        const routines = yield* paged(
          "/v1/routines",
          PublicRoutinePageSchema,
          page => arrayOrEmpty(record(page).routines) as PublicRoutine[],
        )
        const updated = yield* Effect.forEach(routines, (routine, position) =>
          mapResponse(() => toApiRoutine(routine, position)),
        )
        const updatedAt = updated.reduce(
          (latest, routine) => (routine.updated_at > latest ? routine.updated_at : latest),
          EPOCH_ISO,
        )
        return RoutineSyncResponse.make({
          updated,
          deleted: [],
          isMore: false,
          updated_at: updatedAt,
        })
      }),
      customExercises: Effect.fn("PublicApi.customExercises")(function* () {
        const templates = yield* paged(
          "/v1/exercise_templates",
          PublicExerciseTemplatePageSchema,
          page => arrayOrEmpty(record(page).exercise_templates) as PublicExerciseTemplate[],
        )
        const custom = templates.filter(template => template.is_custom === true)
        return yield* Effect.forEach(custom, template =>
          mapResponse(() => toCustomExercise(template)),
        )
      }),
      exerciseTemplates: Effect.fn("PublicApi.exerciseTemplates")(function* () {
        const templates = yield* paged(
          "/v1/exercise_templates",
          PublicExerciseTemplatePageSchema,
          page => arrayOrEmpty(record(page).exercise_templates) as PublicExerciseTemplate[],
          TEMPLATE_PAGE_SIZE,
        )
        return yield* Effect.forEach(templates, template =>
          mapResponse(() => toExerciseTemplate(template)),
        )
      }),
      workouts: Effect.fn("PublicApi.workouts")(function* () {
        const workouts = yield* paged(
          "/v1/workouts",
          PublicWorkoutPageSchema,
          page => arrayOrEmpty(record(page).workouts) as PublicWorkout[],
        )
        return yield* Effect.forEach(workouts, workout =>
          mapResponse(() => toCompletedWorkout(workout)),
        )
      }),
      workoutCount: Effect.fn("PublicApi.workoutCount")(() =>
        request("/v1/workouts/count", {}, WorkoutCountResponse),
      ),
      workoutSync: Effect.fn("PublicApi.workoutSync")(function* (
        known: Readonly<Record<string, string>>,
      ) {
        // The public API cannot accept a revision map; the oldest known
        // revision becomes the event cursor instead.
        const since = encodeURIComponent(minKnownRevision(known))
        const events = yield* paged(
          `/v1/workouts/events?since=${since}`,
          PublicWorkoutEventPageSchema,
          page => arrayOrEmpty(record(page).events) as PublicWorkoutEvent[],
        )
        const updatedById = new Map<string, CompletedWorkout>()
        const deleted: string[] = []
        for (const event of events) {
          if (event.type === "updated") {
            const workout = yield* mapResponse(() => toCompletedWorkout(event.workout))
            if (!updatedById.has(workout.id)) updatedById.set(workout.id, workout)
          } else {
            deleted.push(event.id)
            updatedById.delete(event.id)
          }
        }
        return WorkoutSyncResponse.make({
          updated: Array.from(updatedById.values()),
          deleted,
          isMore: false,
        })
      }),
      bodyMeasurements: Effect.fn("PublicApi.bodyMeasurements")(function* () {
        const measurements = yield* paged(
          "/v1/body_measurements",
          PublicBodyMeasurementPageSchema,
          page => arrayOrEmpty(record(page).body_measurements) as PublicBodyMeasurement[],
        )
        return yield* Effect.forEach(measurements, measurement =>
          mapResponse(() => toBodyMeasurement(measurement)),
        )
      }),
      bodyMeasurement: Effect.fn("PublicApi.bodyMeasurement")(function* (date: string) {
        const path = `/v1/body_measurements/${encodeURIComponent(date)}`
        return yield* request(path, {}, PublicBodyMeasurementSchema).pipe(
          Effect.map(measurement => toBodyMeasurement(measurement)),
          Effect.catchIf(
            (error): error is HevyApiError =>
              error._tag === "HevyApiError" && error.apiStatus === 404,
            () => Effect.succeed<BodyMeasurement | null>(null),
          ),
        )
      }),
      createBodyMeasurement: Effect.fn("PublicApi.createBodyMeasurement")(function* (body) {
        // Hevy documents a flat request body; a 409 means the date already
        // exists and the caller must preview an update instead.
        yield* request(
          "/v1/body_measurements",
          { method: "POST", body: JSON.stringify(body) },
          Schema.Unknown,
        )
      }),
      updateBodyMeasurement: Effect.fn("PublicApi.updateBodyMeasurement")(function* (date, body) {
        // PUT replaces every field: the body carries the complete field set,
        // and a 404 means the date vanished between preview and apply.
        yield* request(
          `/v1/body_measurements/${encodeURIComponent(date)}`,
          { method: "PUT", body: JSON.stringify(body) },
          Schema.Unknown,
        )
      }),
      userAccount: Effect.fn("PublicApi.userAccount")(function* () {
        const response = yield* request("/v1/user/info", {}, PublicUserInfoResponseSchema)
        return UserAccount.make({
          id: response.data.id,
          username: response.data.username,
          full_name: response.data.name ?? null,
        })
      }),
      routineFolders: Effect.fn("PublicApi.routineFolders")(function* () {
        return yield* paged("/v1/routine_folders", PublicRoutineFolderPageSchema, page =>
          arrayOrEmpty(record(page).routine_folders),
        )
      }),
      updateRoutine: Effect.fn("PublicApi.updateRoutine")(function* (routineId, body) {
        const publicBody = yield* translate(() => toPublicRoutinePutBody(body))
        yield* request(
          `/v1/routines/${encodeURIComponent(routineId)}`,
          { method: "PUT", body: JSON.stringify(publicBody) },
          Schema.Unknown,
        )
      }),
      updateWorkout: Effect.fn("PublicApi.updateWorkout")(function* (workoutId, body) {
        const path = `/v1/workouts/${encodeURIComponent(workoutId)}`
        const current = yield* request(path, {}, PublicWorkoutSchema)
        const publicBody = yield* translate(() => toPublicWorkoutUpdateBody(current, body))
        yield* request(path, { method: "PUT", body: JSON.stringify(publicBody) }, Schema.Unknown)
      }),
      createWorkout: Effect.fn("PublicApi.createWorkout")(function* (body) {
        const publicBody = yield* translate(() => toPublicWorkoutCreateBody(body))
        const created = yield* request(
          "/v1/workouts",
          { method: "POST", body: JSON.stringify(publicBody) },
          PublicWorkoutSchema,
        )
        return yield* mapResponse(() => toCompletedWorkout(created))
      }),
      deleteWorkout: Effect.fn("PublicApi.deleteWorkout")(function* () {
        return yield* new ApiError({
          status: 501,
          code: "operation_unavailable",
          message: "Deleting workouts is not supported by the public Hevy API",
        })
      }),
    } satisfies Api
  })
}
