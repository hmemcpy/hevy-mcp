import { Context, Effect, Layer, Schema } from "effect"
import { ApiError, SessionStorageError } from "./errors"
import type { CompletedWorkout, UpstreamRoutine } from "./types"

const ACTIVE_WORKOUT_KEY = "active-workout"
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Rpe = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 10 }))

export class DraftSetValues extends Schema.Class<DraftSetValues>("DraftSetValues")({
  indicator: Schema.optionalKey(Schema.String),
  weightKg: Schema.optionalKey(Schema.NullOr(NonNegative)),
  reps: Schema.optionalKey(Schema.NullOr(NonNegativeInt)),
  rpe: Schema.optionalKey(Schema.NullOr(Rpe)),
  distanceMeters: Schema.optionalKey(Schema.NullOr(NonNegative)),
  durationSeconds: Schema.optionalKey(Schema.NullOr(NonNegative)),
  customMetric: Schema.optionalKey(Schema.NullOr(NonNegative)),
}) {}

export class ActiveWorkoutSet extends Schema.Class<ActiveWorkoutSet>("ActiveWorkoutSet")({
  index: Schema.Natural,
  indicator: Schema.String,
  weightKg: Schema.NullOr(NonNegative),
  reps: Schema.NullOr(NonNegativeInt),
  rpe: Schema.NullOr(Rpe),
  distanceMeters: Schema.NullOr(NonNegative),
  durationSeconds: Schema.NullOr(NonNegative),
  customMetric: Schema.NullOr(NonNegative),
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  elapsedSeconds: Schema.NullOr(NonNegative),
}) {}

export class ActiveWorkoutExercise extends Schema.Class<ActiveWorkoutExercise>(
  "ActiveWorkoutExercise",
)({
  id: Schema.NonEmptyString,
  exerciseTemplateId: Schema.NonEmptyString,
  title: Schema.String,
  notes: Schema.String,
  restSeconds: NonNegative,
  volumeDoublingEnabled: Schema.Boolean,
  sets: Schema.Array(ActiveWorkoutSet),
}) {}

export class ActiveWorkoutSession extends Schema.Class<ActiveWorkoutSession>(
  "ActiveWorkoutSession",
)({
  id: Schema.NonEmptyString,
  workoutId: Schema.NonEmptyString,
  revision: Schema.NonEmptyString,
  title: Schema.String,
  description: Schema.String,
  routineId: Schema.NullOr(Schema.String),
  startedAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  isPrivate: Schema.Boolean,
  isBiometricsPublic: Schema.Boolean,
  shareToStrava: Schema.Boolean,
  exercises: Schema.Array(ActiveWorkoutExercise),
}) {}

export class StartWorkoutSessionRequest extends Schema.Class<StartWorkoutSessionRequest>(
  "StartWorkoutSessionRequest",
)({
  routineId: Schema.optionalKey(Schema.NonEmptyString),
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  isPrivate: Schema.optionalKey(Schema.Boolean),
  isBiometricsPublic: Schema.optionalKey(Schema.Boolean),
  shareToStrava: Schema.optionalKey(Schema.Boolean),
}) {}

export class AddExerciseOperation extends Schema.TaggedClass<AddExerciseOperation>()(
  "AddExercise",
  {
    exerciseTemplateId: Schema.NonEmptyString,
    title: Schema.String,
    notes: Schema.optionalKey(Schema.String),
    restSeconds: Schema.optionalKey(NonNegative),
    volumeDoublingEnabled: Schema.optionalKey(Schema.Boolean),
  },
) {}

export class EditWorkoutOperation extends Schema.TaggedClass<EditWorkoutOperation>()(
  "EditWorkout",
  {
    title: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    isPrivate: Schema.optionalKey(Schema.Boolean),
    isBiometricsPublic: Schema.optionalKey(Schema.Boolean),
    shareToStrava: Schema.optionalKey(Schema.Boolean),
  },
) {}

export class EditExerciseOperation extends Schema.TaggedClass<EditExerciseOperation>()(
  "EditExercise",
  {
    exerciseId: Schema.NonEmptyString,
    title: Schema.optionalKey(Schema.String),
    notes: Schema.optionalKey(Schema.String),
    restSeconds: Schema.optionalKey(NonNegative),
    volumeDoublingEnabled: Schema.optionalKey(Schema.Boolean),
  },
) {}

export class DeleteExerciseOperation extends Schema.TaggedClass<DeleteExerciseOperation>()(
  "DeleteExercise",
  { exerciseId: Schema.NonEmptyString },
) {}

export class AddSetOperation extends Schema.TaggedClass<AddSetOperation>()("AddSet", {
  exerciseId: Schema.NonEmptyString,
  values: DraftSetValues,
}) {}

export class EditSetOperation extends Schema.TaggedClass<EditSetOperation>()("EditSet", {
  exerciseId: Schema.NonEmptyString,
  setIndex: Schema.Natural,
  values: DraftSetValues,
}) {}

export class DeleteSetOperation extends Schema.TaggedClass<DeleteSetOperation>()("DeleteSet", {
  exerciseId: Schema.NonEmptyString,
  setIndex: Schema.Natural,
}) {}

export class StartSetOperation extends Schema.TaggedClass<StartSetOperation>()("StartSet", {
  exerciseId: Schema.NonEmptyString,
  setIndex: Schema.Natural,
}) {}

export class CompleteSetOperation extends Schema.TaggedClass<CompleteSetOperation>()(
  "CompleteSet",
  {
    exerciseId: Schema.NonEmptyString,
    setIndex: Schema.Natural,
    values: DraftSetValues,
  },
) {}

export const WorkoutSessionOperation = Schema.Union([
  EditWorkoutOperation,
  AddExerciseOperation,
  EditExerciseOperation,
  DeleteExerciseOperation,
  AddSetOperation,
  EditSetOperation,
  DeleteSetOperation,
  StartSetOperation,
  CompleteSetOperation,
])

export type WorkoutSessionOperation = typeof WorkoutSessionOperation.Type

export class UpdateWorkoutSessionRequest extends Schema.Class<UpdateWorkoutSessionRequest>(
  "UpdateWorkoutSessionRequest",
)({
  revision: Schema.NonEmptyString,
  operations: Schema.Array(WorkoutSessionOperation).check(Schema.isMinLength(1)),
}) {}

export class PreviewWorkoutFinishRequest extends Schema.Class<PreviewWorkoutFinishRequest>(
  "PreviewWorkoutFinishRequest",
)({
  endTime: Schema.optionalKey(Schema.NonEmptyString),
}) {}

export class DiscardWorkoutSessionRequest extends Schema.Class<DiscardWorkoutSessionRequest>(
  "DiscardWorkoutSessionRequest",
)({
  revision: Schema.NonEmptyString,
}) {}

export class FinishedWorkoutSet extends Schema.Class<FinishedWorkoutSet>("FinishedWorkoutSet")({
  index: Schema.Natural,
  indicator: Schema.String,
  weightKg: Schema.NullOr(NonNegative),
  reps: Schema.NullOr(NonNegativeInt),
  rpe: Schema.NullOr(Rpe),
  distanceMeters: Schema.NullOr(NonNegative),
  durationSeconds: Schema.NullOr(NonNegative),
  customMetric: Schema.NullOr(NonNegative),
  completedAt: Schema.NonEmptyString,
  elapsedSeconds: Schema.NullOr(NonNegative),
}) {}

export class FinishedWorkoutExercise extends Schema.Class<FinishedWorkoutExercise>(
  "FinishedWorkoutExercise",
)({
  exerciseTemplateId: Schema.NonEmptyString,
  title: Schema.String,
  notes: Schema.String,
  restSeconds: NonNegative,
  volumeDoublingEnabled: Schema.Boolean,
  sets: Schema.Array(FinishedWorkoutSet).check(Schema.isMinLength(1)),
}) {}

export class WorkoutFinishPreview extends Schema.Class<WorkoutFinishPreview>(
  "WorkoutFinishPreview",
)({
  sessionId: Schema.NonEmptyString,
  workoutId: Schema.NonEmptyString,
  revision: Schema.NonEmptyString,
  title: Schema.String,
  description: Schema.String,
  routineId: Schema.NullOr(Schema.String),
  startTime: Schema.NonEmptyString,
  endTime: Schema.NonEmptyString,
  durationSeconds: NonNegative,
  isPrivate: Schema.Boolean,
  isBiometricsPublic: Schema.Boolean,
  shareToStrava: Schema.Boolean,
  exercises: Schema.Array(FinishedWorkoutExercise).check(Schema.isMinLength(1)),
}) {}

export class WorkoutDeletePreview extends Schema.Class<WorkoutDeletePreview>(
  "WorkoutDeletePreview",
)({
  workoutId: Schema.NonEmptyString,
  workoutTitle: Schema.String,
  revision: Schema.NonEmptyString,
  exerciseCount: Schema.Natural,
  setCount: Schema.Natural,
}) {}

export interface ActiveWorkoutStoreApi {
  readonly load: () => Effect.Effect<
    ActiveWorkoutSession | undefined,
    SessionStorageError | ApiError
  >
  readonly save: (session: ActiveWorkoutSession) => Effect.Effect<void, SessionStorageError>
  readonly clear: () => Effect.Effect<void, SessionStorageError>
}

export const ActiveWorkoutStore = Context.Service<ActiveWorkoutStoreApi>("ActiveWorkoutStore")

export function makeActiveWorkoutStoreLayer(
  state: DurableObjectState,
): Layer.Layer<ActiveWorkoutStoreApi> {
  const load: ActiveWorkoutStoreApi["load"] = Effect.fn("ActiveWorkoutStore.load")(function* () {
    const stored = yield* Effect.tryPromise({
      try: () => state.storage.get<unknown>(ACTIVE_WORKOUT_KEY),
      catch: cause => new SessionStorageError({ operation: "get", cause }),
    })
    if (stored === undefined) return undefined
    return yield* Schema.decodeUnknownEffect(ActiveWorkoutSession)(stored).pipe(
      Effect.mapError(
        cause =>
          new ApiError({
            status: 500,
            code: "active_workout_corrupt",
            message: "Stored active workout is invalid",
            details: cause.message,
          }),
      ),
    )
  })
  const save: ActiveWorkoutStoreApi["save"] = Effect.fn("ActiveWorkoutStore.save")(
    function* (session) {
      const encoded = yield* Schema.encodeUnknownEffect(ActiveWorkoutSession)(session).pipe(
        Effect.mapError(cause => new SessionStorageError({ operation: "put", cause })),
      )
      yield* Effect.tryPromise({
        try: () => state.storage.put(ACTIVE_WORKOUT_KEY, encoded),
        catch: cause => new SessionStorageError({ operation: "put", cause }),
      })
    },
  )
  const clear: ActiveWorkoutStoreApi["clear"] = Effect.fn("ActiveWorkoutStore.clear")(() =>
    Effect.tryPromise({
      try: () => state.storage.delete(ACTIVE_WORKOUT_KEY).then(() => undefined),
      catch: cause => new SessionStorageError({ operation: "delete", cause }),
    }),
  )
  return Layer.succeed(ActiveWorkoutStore, ActiveWorkoutStore.of({ load, save, clear }))
}

function invalid(code: string, message: string, status = 400) {
  return new ApiError({ status, code, message })
}

function parseTimestamp(value: string, field: string) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds)
    ? Effect.succeed(milliseconds)
    : Effect.fail(invalid("invalid_timestamp", `${field} is not a valid timestamp`))
}

function makeSet(index: number, values: DraftSetValues): ActiveWorkoutSet {
  return ActiveWorkoutSet.make({
    index,
    indicator: values.indicator ?? "normal",
    weightKg: values.weightKg ?? null,
    reps: values.reps ?? null,
    rpe: values.rpe ?? null,
    distanceMeters: values.distanceMeters ?? null,
    durationSeconds: values.durationSeconds ?? null,
    customMetric: values.customMetric ?? null,
    startedAt: null,
    completedAt: null,
    elapsedSeconds: null,
  })
}

function updateSet(set: ActiveWorkoutSet, values: DraftSetValues): ActiveWorkoutSet {
  return ActiveWorkoutSet.make({
    ...set,
    indicator: values.indicator ?? set.indicator,
    weightKg: Object.hasOwn(values, "weightKg") ? (values.weightKg ?? null) : set.weightKg,
    reps: Object.hasOwn(values, "reps") ? (values.reps ?? null) : set.reps,
    rpe: Object.hasOwn(values, "rpe") ? (values.rpe ?? null) : set.rpe,
    distanceMeters: Object.hasOwn(values, "distanceMeters")
      ? (values.distanceMeters ?? null)
      : set.distanceMeters,
    durationSeconds: Object.hasOwn(values, "durationSeconds")
      ? (values.durationSeconds ?? null)
      : set.durationSeconds,
    customMetric: Object.hasOwn(values, "customMetric")
      ? (values.customMetric ?? null)
      : set.customMetric,
  })
}

function findExercise(session: ActiveWorkoutSession, exerciseId: string) {
  const exercise = session.exercises.find(candidate => candidate.id === exerciseId)
  return exercise === undefined
    ? Effect.fail(invalid("exercise_not_found", `Active exercise ${exerciseId} was not found`, 404))
    : Effect.succeed(exercise)
}

function findSet(exercise: ActiveWorkoutExercise, setIndex: number) {
  const set = exercise.sets.find(candidate => candidate.index === setIndex)
  return set === undefined
    ? Effect.fail(invalid("set_not_found", `Set ${setIndex} was not found`, 404))
    : Effect.succeed(set)
}

function replaceExercise(
  session: ActiveWorkoutSession,
  exercise: ActiveWorkoutExercise,
  replacement: ActiveWorkoutExercise,
) {
  return ActiveWorkoutSession.make({
    ...session,
    exercises: session.exercises.map(candidate =>
      candidate === exercise ? replacement : candidate,
    ),
  })
}

export const startWorkoutSession = Effect.fn("WorkoutLifecycle.start")(function* (
  input: StartWorkoutSessionRequest,
  routine: UpstreamRoutine | undefined,
  now: string,
  makeId: () => string,
) {
  yield* parseTimestamp(now, "now")
  const title = input.title ?? routine?.title
  if (title === undefined || title.trim() === "") {
    return yield* invalid("title_required", "A title is required for an empty workout")
  }
  const exercises = (routine?.exercises ?? []).map(exercise =>
    ActiveWorkoutExercise.make({
      id: makeId(),
      exerciseTemplateId: exercise.exercise_template_id,
      title: exercise.title,
      notes: exercise.notes ?? "",
      restSeconds: exercise.rest_seconds,
      volumeDoublingEnabled: false,
      sets: exercise.sets.map((set, index) =>
        makeSet(
          index,
          DraftSetValues.make({
            indicator: set.indicator,
            weightKg: set.weight_kg,
            reps: set.reps,
            rpe: set.rpe,
            distanceMeters: set.distance_meters,
            durationSeconds: set.duration_seconds,
            customMetric: set.custom_metric,
          }),
        ),
      ),
    }),
  )
  return ActiveWorkoutSession.make({
    id: makeId(),
    workoutId: makeId(),
    revision: makeId(),
    title,
    description: input.description ?? "",
    routineId: input.routineId ?? null,
    startedAt: now,
    updatedAt: now,
    isPrivate: input.isPrivate ?? false,
    isBiometricsPublic: input.isBiometricsPublic ?? true,
    shareToStrava: input.shareToStrava ?? false,
    exercises,
  })
})

export const updateWorkoutSession = Effect.fn("WorkoutLifecycle.update")(function* (
  session: ActiveWorkoutSession,
  request: UpdateWorkoutSessionRequest,
  now: string,
  makeId: () => string,
) {
  if (request.revision !== session.revision) {
    return yield* invalid("active_workout_changed", "Active workout changed after it was read", 409)
  }
  yield* parseTimestamp(now, "now")
  let updated = session
  for (const operation of request.operations) {
    switch (operation._tag) {
      case "EditWorkout": {
        updated = ActiveWorkoutSession.make({
          ...updated,
          title: operation.title ?? updated.title,
          description: operation.description ?? updated.description,
          isPrivate: operation.isPrivate ?? updated.isPrivate,
          isBiometricsPublic: operation.isBiometricsPublic ?? updated.isBiometricsPublic,
          shareToStrava: operation.shareToStrava ?? updated.shareToStrava,
        })
        break
      }
      case "AddExercise": {
        const exercise = ActiveWorkoutExercise.make({
          id: makeId(),
          exerciseTemplateId: operation.exerciseTemplateId,
          title: operation.title,
          notes: operation.notes ?? "",
          restSeconds: operation.restSeconds ?? 0,
          volumeDoublingEnabled: operation.volumeDoublingEnabled ?? false,
          sets: [],
        })
        updated = ActiveWorkoutSession.make({
          ...updated,
          exercises: [...updated.exercises, exercise],
        })
        break
      }
      case "EditExercise": {
        const exercise = yield* findExercise(updated, operation.exerciseId)
        updated = replaceExercise(
          updated,
          exercise,
          ActiveWorkoutExercise.make({
            ...exercise,
            title: operation.title ?? exercise.title,
            notes: operation.notes ?? exercise.notes,
            restSeconds: operation.restSeconds ?? exercise.restSeconds,
            volumeDoublingEnabled:
              operation.volumeDoublingEnabled ?? exercise.volumeDoublingEnabled,
          }),
        )
        break
      }
      case "DeleteExercise": {
        yield* findExercise(updated, operation.exerciseId)
        updated = ActiveWorkoutSession.make({
          ...updated,
          exercises: updated.exercises.filter(candidate => candidate.id !== operation.exerciseId),
        })
        break
      }
      case "AddSet": {
        const exercise = yield* findExercise(updated, operation.exerciseId)
        updated = replaceExercise(
          updated,
          exercise,
          ActiveWorkoutExercise.make({
            ...exercise,
            sets: [...exercise.sets, makeSet(exercise.sets.length, operation.values)],
          }),
        )
        break
      }
      case "EditSet": {
        const exercise = yield* findExercise(updated, operation.exerciseId)
        const set = yield* findSet(exercise, operation.setIndex)
        updated = replaceExercise(
          updated,
          exercise,
          ActiveWorkoutExercise.make({
            ...exercise,
            sets: exercise.sets.map(candidate =>
              candidate === set ? updateSet(candidate, operation.values) : candidate,
            ),
          }),
        )
        break
      }
      case "DeleteSet": {
        const exercise = yield* findExercise(updated, operation.exerciseId)
        yield* findSet(exercise, operation.setIndex)
        updated = replaceExercise(
          updated,
          exercise,
          ActiveWorkoutExercise.make({
            ...exercise,
            sets: exercise.sets
              .filter(candidate => candidate.index !== operation.setIndex)
              .map((candidate, index) => ActiveWorkoutSet.make({ ...candidate, index })),
          }),
        )
        break
      }
      case "StartSet": {
        const exercise = yield* findExercise(updated, operation.exerciseId)
        const set = yield* findSet(exercise, operation.setIndex)
        updated = replaceExercise(
          updated,
          exercise,
          ActiveWorkoutExercise.make({
            ...exercise,
            sets: exercise.sets.map(candidate =>
              candidate === set
                ? ActiveWorkoutSet.make({ ...candidate, startedAt: now })
                : candidate,
            ),
          }),
        )
        break
      }
      case "CompleteSet": {
        const exercise = yield* findExercise(updated, operation.exerciseId)
        const set = yield* findSet(exercise, operation.setIndex)
        const withValues = updateSet(set, operation.values)
        const startedAt = withValues.startedAt
        const completedAtMs = yield* parseTimestamp(now, "now")
        const startedAtMs =
          startedAt === null ? undefined : yield* parseTimestamp(startedAt, "startedAt")
        const elapsedSeconds =
          startedAtMs !== undefined
            ? Math.max(0, (completedAtMs - startedAtMs) / 1_000)
            : withValues.elapsedSeconds
        updated = replaceExercise(
          updated,
          exercise,
          ActiveWorkoutExercise.make({
            ...exercise,
            sets: exercise.sets.map(candidate =>
              candidate === set
                ? ActiveWorkoutSet.make({
                    ...withValues,
                    elapsedSeconds,
                    completedAt: now,
                  })
                : candidate,
            ),
          }),
        )
        break
      }
    }
  }
  return ActiveWorkoutSession.make({
    ...updated,
    revision: makeId(),
    updatedAt: now,
  })
})

export const previewWorkoutFinish = Effect.fn("WorkoutLifecycle.previewFinish")(function* (
  session: ActiveWorkoutSession,
  endTime: string,
) {
  const startMs = yield* parseTimestamp(session.startedAt, "startedAt")
  const endMs = yield* parseTimestamp(endTime, "endTime")
  if (endMs < startMs) return yield* invalid("invalid_end_time", "End time precedes start time")
  if (session.title.trim() === "")
    return yield* invalid("title_required", "Workout title is required")
  const exercises = session.exercises.flatMap(exercise => {
    const completed = exercise.sets.flatMap(set =>
      set.completedAt === null
        ? []
        : [
            FinishedWorkoutSet.make({
              index: 0,
              indicator: set.indicator,
              weightKg: set.weightKg,
              reps: set.reps,
              rpe: set.rpe,
              distanceMeters: set.distanceMeters,
              durationSeconds: set.durationSeconds,
              customMetric: set.customMetric,
              completedAt: set.completedAt,
              elapsedSeconds: set.elapsedSeconds,
            }),
          ],
    )
    const sets = completed.map((set, index) => FinishedWorkoutSet.make({ ...set, index }))
    return sets.length === 0
      ? []
      : [
          FinishedWorkoutExercise.make({
            exerciseTemplateId: exercise.exerciseTemplateId,
            title: exercise.title,
            notes: exercise.notes,
            restSeconds: exercise.restSeconds,
            volumeDoublingEnabled: exercise.volumeDoublingEnabled,
            sets,
          }),
        ]
  })
  if (exercises.length === 0) {
    return yield* invalid("no_completed_sets", "At least one completed set is required")
  }
  return WorkoutFinishPreview.make({
    sessionId: session.id,
    workoutId: session.workoutId,
    revision: session.revision,
    title: session.title,
    description: session.description,
    routineId: session.routineId,
    startTime: session.startedAt,
    endTime,
    durationSeconds: (endMs - startMs) / 1_000,
    isPrivate: session.isPrivate,
    isBiometricsPublic: session.isBiometricsPublic,
    shareToStrava: session.shareToStrava,
    exercises,
  })
})

export function toCreateWorkoutBody(preview: WorkoutFinishPreview): object {
  return {
    workout: {
      workout_id: preview.workoutId,
      title: preview.title,
      description: preview.description,
      media: [],
      exercises: preview.exercises.map(exercise => ({
        title: exercise.title,
        exercise_template_id: exercise.exerciseTemplateId,
        rest_timer_seconds: exercise.restSeconds,
        notes: exercise.notes,
        volume_doubling_enabled: exercise.volumeDoublingEnabled,
        sets: exercise.sets.map(set => ({
          index: set.index,
          type: set.indicator,
          weight_kg: set.weightKg,
          reps: set.reps,
          distance_meters: set.distanceMeters,
          duration_seconds: set.durationSeconds,
          custom_metric: set.customMetric,
          rpe: set.rpe,
          completed_at: set.completedAt,
        })),
      })),
      start_time: Math.floor(Date.parse(preview.startTime) / 1_000),
      end_time: Math.floor(Date.parse(preview.endTime) / 1_000),
      routine_id: preview.routineId,
      apple_watch: false,
      wearos_watch: false,
      is_private: preview.isPrivate,
      is_biometrics_public: preview.isBiometricsPublic,
      gym: null,
    },
    share_to_strava: preview.shareToStrava,
  }
}

export const validateWorkoutFinishPreview = Effect.fn("WorkoutLifecycle.validateFinishPreview")(
  function* (session: ActiveWorkoutSession, preview: WorkoutFinishPreview) {
    const expected = yield* previewWorkoutFinish(session, preview.endTime)
    if (JSON.stringify(expected) !== JSON.stringify(preview)) {
      return yield* invalid(
        "finish_preview_changed",
        "Finish preview does not match the active workout",
        409,
      )
    }
  },
)

export const createWorkoutDeletePreview = Effect.fn("WorkoutLifecycle.previewDelete")(function* (
  workout: CompletedWorkout,
) {
  if (workout.updated_at === undefined || workout.updated_at === "") {
    return yield* invalid("workout_revision_missing", "Workout cannot be deleted safely", 409)
  }
  return WorkoutDeletePreview.make({
    workoutId: workout.id,
    workoutTitle: workout.name ?? workout.id,
    revision: workout.updated_at,
    exerciseCount: workout.exercises.length,
    setCount: workout.exercises.reduce((count, exercise) => count + exercise.sets.length, 0),
  })
})

export const validateWorkoutDeletePreview = Effect.fn("WorkoutLifecycle.validateDelete")(function* (
  workout: CompletedWorkout,
  preview: WorkoutDeletePreview,
) {
  if (workout.id !== preview.workoutId) {
    return yield* invalid("workout_mismatch", "Delete preview targets another workout")
  }
  if (workout.updated_at !== preview.revision) {
    return yield* invalid("workout_changed", "Workout changed after delete preview", 409)
  }
  const expected = yield* createWorkoutDeletePreview(workout)
  if (JSON.stringify(expected) !== JSON.stringify(preview)) {
    return yield* invalid(
      "delete_preview_changed",
      "Delete preview does not match the completed workout",
      409,
    )
  }
})
