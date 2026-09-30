import { Effect, Schema } from "effect"
import { ApiError } from "./errors"
import {
  CompletedWorkout,
  type CompletedWorkoutExercise,
  type RequestedWorkoutSetChange,
  RequestedWorkoutSetChangesSchema,
  UpstreamSet,
  WorkoutEditPreview,
  WorkoutSetPreviewChange,
  WorkoutSetValues,
} from "./types"

function invalidRequest(code: string, message: string) {
  return new ApiError({ status: 400, code, message })
}

export const decodeWorkoutSetChanges = Effect.fn("WorkoutEdit.decodeChanges")((input: unknown) =>
  Schema.decodeUnknownEffect(RequestedWorkoutSetChangesSchema)(input).pipe(
    Effect.mapError(() => invalidRequest("invalid_changes", "Changes are missing or invalid")),
    Effect.flatMap(changes => {
      const seen = new Set<string>()
      for (const change of changes) {
        const key = `${change.exerciseId}:${change.setIndex}`
        if (seen.has(key)) {
          return Effect.fail(invalidRequest("duplicate_change", `Duplicate change for ${key}`))
        }
        seen.add(key)
      }
      return Effect.succeed(changes)
    }),
  ),
)

function findExercise(workout: CompletedWorkout, exerciseId: string) {
  const exercise = workout.exercises.find(candidate => candidate.id === exerciseId)
  return exercise === undefined
    ? Effect.fail(
        new ApiError({
          status: 404,
          code: "exercise_not_found",
          message: `Workout exercise ${exerciseId} was not found`,
        }),
      )
    : Effect.succeed(exercise)
}

function matchesPreviewState(
  exercise: CompletedWorkoutExercise,
  change: WorkoutSetPreviewChange,
  state: "before" | "after",
): boolean {
  if (exercise.exercise_template_id !== change.exerciseTemplateId) return false
  const set = exercise.sets.find(candidate => candidate.index === change.setIndex)
  if (state === "after" && isDeletion(change.after)) return set === undefined
  const expected = state === "before" ? change.before : change.after
  return set !== undefined && !changed(set, expected)
}

function resolvePreviewExercise(
  workout: CompletedWorkout,
  change: WorkoutSetPreviewChange,
  state: "before" | "after",
) {
  const exact = workout.exercises.find(candidate => candidate.id === change.exerciseId)
  if (exact?.exercise_template_id === change.exerciseTemplateId) return Effect.succeed(exact)

  const candidates = workout.exercises.filter(exercise =>
    matchesPreviewState(exercise, change, state),
  )
  const [candidate] = candidates
  if (candidate !== undefined && candidates.length === 1) return Effect.succeed(candidate)
  if (candidate !== undefined) {
    return Effect.fail(
      new ApiError({
        status: 409,
        code: "exercise_identity_ambiguous",
        message: `${change.exerciseTitle} matched multiple exercise rows after its row ID changed`,
      }),
    )
  }
  return Effect.fail(
    new ApiError({
      status: 404,
      code: "exercise_not_found",
      message: `Workout exercise ${change.exerciseId} was not found by row ID or preview values`,
    }),
  )
}

function valuesFromSet(set: UpstreamSet, values: WorkoutSetValues): WorkoutSetValues {
  return WorkoutSetValues.make({
    ...(Object.hasOwn(values, "weightKg") ? { weightKg: set.weight_kg } : {}),
    ...(Object.hasOwn(values, "reps") ? { reps: set.reps } : {}),
    ...(Object.hasOwn(values, "rpe") ? { rpe: set.rpe } : {}),
    ...(Object.hasOwn(values, "distanceMeters") ? { distanceMeters: set.distance_meters } : {}),
    ...(Object.hasOwn(values, "durationSeconds") ? { durationSeconds: set.duration_seconds } : {}),
    ...(Object.hasOwn(values, "customMetric") ? { customMetric: set.custom_metric } : {}),
  })
}

function changed(current: UpstreamSet, expected: WorkoutSetValues): boolean {
  return (
    (Object.hasOwn(expected, "weightKg") && current.weight_kg !== expected.weightKg) ||
    (Object.hasOwn(expected, "reps") && current.reps !== expected.reps) ||
    (Object.hasOwn(expected, "rpe") && current.rpe !== expected.rpe) ||
    (Object.hasOwn(expected, "distanceMeters") &&
      current.distance_meters !== expected.distanceMeters) ||
    (Object.hasOwn(expected, "durationSeconds") &&
      current.duration_seconds !== expected.durationSeconds) ||
    (Object.hasOwn(expected, "customMetric") && current.custom_metric !== expected.customMetric)
  )
}

function isDeletion(values: WorkoutSetValues): boolean {
  return Object.keys(values).length === 0
}

function allValuesFromSet(set: UpstreamSet): WorkoutSetValues {
  return WorkoutSetValues.make({
    weightKg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    distanceMeters: set.distance_meters,
    durationSeconds: set.duration_seconds,
    customMetric: set.custom_metric,
  })
}

function updateSet(current: UpstreamSet, after: WorkoutSetValues): UpstreamSet {
  return UpstreamSet.make({
    ...current,
    weight_kg: Object.hasOwn(after, "weightKg") ? (after.weightKg ?? null) : current.weight_kg,
    reps: Object.hasOwn(after, "reps") ? (after.reps ?? null) : current.reps,
    rpe: Object.hasOwn(after, "rpe") ? (after.rpe ?? null) : current.rpe,
    distance_meters: Object.hasOwn(after, "distanceMeters")
      ? (after.distanceMeters ?? null)
      : current.distance_meters,
    duration_seconds: Object.hasOwn(after, "durationSeconds")
      ? (after.durationSeconds ?? null)
      : current.duration_seconds,
    custom_metric: Object.hasOwn(after, "customMetric")
      ? (after.customMetric ?? null)
      : current.custom_metric,
  })
}

function replaceSet(
  workout: CompletedWorkout,
  exercise: CompletedWorkoutExercise,
  set: UpstreamSet,
  after: WorkoutSetValues,
): CompletedWorkout {
  return CompletedWorkout.make({
    ...workout,
    exercises: workout.exercises.map(candidate =>
      candidate === exercise
        ? {
            ...candidate,
            sets: candidate.sets.map(current =>
              current === set ? updateSet(current, after) : current,
            ),
          }
        : candidate,
    ),
  })
}

function deleteSet(
  workout: CompletedWorkout,
  exercise: CompletedWorkoutExercise,
  set: UpstreamSet,
): CompletedWorkout {
  return CompletedWorkout.make({
    ...workout,
    exercises: workout.exercises.map(candidate =>
      candidate === exercise
        ? { ...candidate, sets: candidate.sets.filter(current => current !== set) }
        : candidate,
    ),
  })
}

export const createWorkoutEditPreview = Effect.fn("WorkoutEdit.createPreview")(function* (
  workout: CompletedWorkout,
  requested: ReadonlyArray<RequestedWorkoutSetChange>,
) {
  if (workout.updated_at === undefined || workout.updated_at === "") {
    return yield* new ApiError({
      status: 409,
      code: "workout_revision_missing",
      message: "Workout has no revision and cannot be edited safely",
    })
  }
  const changes = yield* Effect.forEach(requested, change =>
    Effect.gen(function* () {
      const exercise = yield* findExercise(workout, change.exerciseId)
      const set = exercise.sets.find(candidate => candidate.index === change.setIndex)
      if (set === undefined) {
        return yield* new ApiError({
          status: 404,
          code: "set_not_found",
          message: `Set ${change.setIndex} was not found`,
        })
      }
      if (isDeletion(change.values)) {
        if (exercise.sets.length === 1) {
          return yield* invalidRequest(
            "cannot_delete_only_set",
            "Deleting an exercise's only set is not supported",
          )
        }
        const lastSet = exercise.sets.at(-1)
        if (lastSet !== set) {
          return yield* invalidRequest(
            "cannot_delete_middle_set",
            "Only the final set can be deleted until set reindexing is verified",
          )
        }
      }
      return WorkoutSetPreviewChange.make({
        exerciseId: change.exerciseId,
        exerciseTemplateId: exercise.exercise_template_id,
        exerciseTitle: exercise.title ?? exercise.exercise_template_id,
        setIndex: change.setIndex,
        before: isDeletion(change.values)
          ? allValuesFromSet(set)
          : valuesFromSet(set, change.values),
        after: change.values,
      })
    }),
  )
  return WorkoutEditPreview.make({
    workoutId: workout.id,
    workoutTitle: workout.name ?? workout.id,
    revision: workout.updated_at,
    changes,
  })
})

export const applyWorkoutEditPreview = Effect.fn("WorkoutEdit.applyPreview")(function* (
  workout: CompletedWorkout,
  preview: WorkoutEditPreview,
) {
  if (preview.workoutId !== workout.id) {
    return yield* invalidRequest("workout_mismatch", "Preview targets another workout")
  }
  if (preview.revision !== workout.updated_at) {
    return yield* new ApiError({
      status: 409,
      code: "workout_changed",
      message: "Workout changed after preview",
    })
  }
  let updated = workout
  for (const change of preview.changes) {
    const exercise = yield* resolvePreviewExercise(updated, change, "before")
    if (exercise.exercise_template_id !== change.exerciseTemplateId) {
      return yield* new ApiError({
        status: 409,
        code: "exercise_changed",
        message: `${change.exerciseTitle} no longer matches the preview`,
      })
    }
    const set = exercise.sets.find(candidate => candidate.index === change.setIndex)
    if (set === undefined) {
      return yield* new ApiError({
        status: 409,
        code: "set_changed",
        message: `Set ${change.setIndex} no longer exists`,
      })
    }
    if (changed(set, change.before)) {
      return yield* new ApiError({
        status: 409,
        code: "value_changed",
        message: `${change.exerciseTitle} set ${change.setIndex} changed`,
      })
    }
    updated = isDeletion(change.after)
      ? deleteSet(updated, exercise, set)
      : replaceSet(updated, exercise, set, change.after)
  }
  return updated
})

export const verifyWorkoutEditPreview = Effect.fn("WorkoutEdit.verifyPreview")(function* (
  workout: CompletedWorkout,
  preview: WorkoutEditPreview,
) {
  for (const change of preview.changes) {
    const exercise = yield* resolvePreviewExercise(workout, change, "after")
    const set = exercise.sets.find(candidate => candidate.index === change.setIndex)
    const failed = isDeletion(change.after)
      ? set !== undefined
      : set === undefined || changed(set, change.after)
    if (failed) {
      return yield* new ApiError({
        status: 502,
        code: "verification_failed",
        message: `${change.exerciseTitle} set ${change.setIndex} was not persisted`,
      })
    }
  }
})

export function toWorkoutUpdateBody(workout: CompletedWorkout): object {
  return {
    workoutUpdate: {
      exercises: workout.exercises.map(exercise => ({
        exercise_template_id: exercise.exercise_template_id,
        ...(exercise.title === undefined ? {} : { title: exercise.title }),
        ...(exercise.superset_id === undefined ? {} : { superset_id: exercise.superset_id }),
        ...(exercise.rest_seconds === undefined
          ? {}
          : { rest_timer_seconds: exercise.rest_seconds }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
        ...(exercise.volume_doubling_enabled === undefined
          ? {}
          : { volume_doubling_enabled: exercise.volume_doubling_enabled }),
        sets: exercise.sets.map(set => ({
          index: set.index,
          type: set.indicator,
          weight_kg: set.weight_kg,
          reps: set.reps,
          distance_meters: set.distance_meters,
          duration_seconds: set.duration_seconds,
          custom_metric: set.custom_metric,
          rpe: set.rpe,
          ...(set.completed_at === undefined ? {} : { completed_at: set.completed_at }),
        })),
      })),
    },
  }
}
