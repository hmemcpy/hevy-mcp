import { Effect } from "effect"
import { ApiError } from "./errors"
import {
  CompletedWorkout,
  CompletedWorkoutExercise,
  type RequestedWorkoutExerciseInsertion,
  UpstreamSet,
  WorkoutExerciseInsertion,
  WorkoutExerciseInsertPreview,
  WorkoutInsertionSet,
} from "./types"

function invalid(code: string, message: string, status = 400) {
  return new ApiError({ status, code, message })
}

function workoutCompletionTime(workout: CompletedWorkout): string | null {
  const candidates = [workout.end_time, workout.updated_at, workout.created_at]
  for (const candidate of candidates) {
    if (typeof candidate === "number") return new Date(candidate * 1_000).toISOString()
    if (typeof candidate === "string") {
      const parsed = Date.parse(candidate)
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
    }
  }
  return null
}

function matchesSet(current: UpstreamSet, expected: WorkoutInsertionSet): boolean {
  return (
    current.index === expected.index &&
    current.indicator === expected.indicator &&
    current.weight_kg === expected.weightKg &&
    current.reps === expected.reps &&
    current.rpe === expected.rpe &&
    current.distance_meters === expected.distanceMeters &&
    current.duration_seconds === expected.durationSeconds &&
    current.custom_metric === expected.customMetric &&
    (current.completed_at ?? null) === expected.completedAt
  )
}

function matchesInsertion(
  current: CompletedWorkoutExercise,
  expected: WorkoutExerciseInsertion,
): boolean {
  return (
    current.exercise_template_id === expected.exerciseTemplateId &&
    (current.title ?? expected.title) === expected.title &&
    (current.notes ?? "") === expected.notes &&
    (current.rest_seconds ?? 0) === expected.restSeconds &&
    (current.superset_id ?? null) === expected.supersetId &&
    (current.volume_doubling_enabled ?? false) === expected.volumeDoublingEnabled &&
    current.sets.length === expected.sets.length &&
    expected.sets.every(set => {
      const candidate = current.sets.find(currentSet => currentSet.index === set.index)
      return candidate !== undefined && matchesSet(candidate, set)
    })
  )
}

function materializeInsertion(
  request: RequestedWorkoutExerciseInsertion,
  defaultCompletedAt: string | null,
) {
  return Effect.gen(function* () {
    if (request.title.trim() === "") {
      return yield* invalid("exercise_title_required", "Inserted exercise title is required")
    }
    const sets = yield* Effect.forEach(request.sets, (set, index) => {
      const completedAt = Object.hasOwn(set, "completedAt")
        ? (set.completedAt ?? null)
        : defaultCompletedAt
      if (completedAt !== null && !Number.isFinite(Date.parse(completedAt))) {
        return Effect.fail(
          invalid("invalid_completed_at", `Inserted set ${index} has an invalid completion time`),
        )
      }
      return Effect.succeed(
        WorkoutInsertionSet.make({
          index,
          indicator: set.indicator ?? "normal",
          weightKg: set.weightKg ?? null,
          reps: set.reps ?? null,
          rpe: set.rpe ?? null,
          distanceMeters: set.distanceMeters ?? null,
          durationSeconds: set.durationSeconds ?? null,
          customMetric: set.customMetric ?? null,
          completedAt,
        }),
      )
    })
    return WorkoutExerciseInsertion.make({
      exerciseTemplateId: request.exerciseTemplateId,
      title: request.title.trim(),
      notes: request.notes?.trim() ?? "",
      restSeconds: request.restSeconds ?? 0,
      supersetId: request.supersetId ?? null,
      volumeDoublingEnabled: request.volumeDoublingEnabled ?? false,
      sets,
    })
  })
}

export const createWorkoutExerciseInsertPreview = Effect.fn("WorkoutInsert.createPreview")(
  function* (
    workout: CompletedWorkout,
    requested: ReadonlyArray<RequestedWorkoutExerciseInsertion>,
  ) {
    if (workout.updated_at === undefined || workout.updated_at === "") {
      return yield* invalid(
        "workout_revision_missing",
        "Workout has no revision and cannot be edited safely",
        409,
      )
    }
    const insertions = yield* Effect.forEach(requested, request =>
      materializeInsertion(request, workoutCompletionTime(workout)),
    )
    const fingerprints = new Set<string>()
    for (const insertion of insertions) {
      const fingerprint = JSON.stringify(insertion)
      if (fingerprints.has(fingerprint)) {
        return yield* invalid(
          "duplicate_insertion",
          `${insertion.title} is duplicated in the insertion request`,
        )
      }
      fingerprints.add(fingerprint)
      if (workout.exercises.some(exercise => matchesInsertion(exercise, insertion))) {
        return yield* invalid(
          "exercise_already_exists",
          `${insertion.title} with these sets already exists in the workout`,
          409,
        )
      }
    }
    return WorkoutExerciseInsertPreview.make({
      workoutId: workout.id,
      workoutTitle: workout.name ?? workout.id,
      revision: workout.updated_at,
      exerciseCountBefore: workout.exercises.length,
      exerciseCountAfter: workout.exercises.length + insertions.length,
      insertions,
    })
  },
)

export const applyWorkoutExerciseInsertPreview = Effect.fn("WorkoutInsert.applyPreview")(function* (
  workout: CompletedWorkout,
  preview: WorkoutExerciseInsertPreview,
) {
  if (preview.workoutId !== workout.id) {
    return yield* invalid("workout_mismatch", "Preview targets another workout")
  }
  if (preview.revision !== workout.updated_at) {
    return yield* invalid("workout_changed", "Workout changed after preview", 409)
  }
  if (
    workout.exercises.length !== preview.exerciseCountBefore ||
    preview.exerciseCountAfter !== preview.exerciseCountBefore + preview.insertions.length
  ) {
    return yield* invalid(
      "exercise_count_changed",
      "Workout exercise count changed after preview",
      409,
    )
  }
  for (const insertion of preview.insertions) {
    if (workout.exercises.some(exercise => matchesInsertion(exercise, insertion))) {
      return yield* invalid(
        "exercise_already_exists",
        `${insertion.title} with these sets already exists in the workout`,
        409,
      )
    }
  }
  return CompletedWorkout.make({
    ...workout,
    exercises: [
      ...workout.exercises,
      ...preview.insertions.map(insertion =>
        CompletedWorkoutExercise.make({
          exercise_template_id: insertion.exerciseTemplateId,
          title: insertion.title,
          notes: insertion.notes,
          rest_seconds: insertion.restSeconds,
          superset_id: insertion.supersetId,
          volume_doubling_enabled: insertion.volumeDoublingEnabled,
          sets: insertion.sets.map(set =>
            UpstreamSet.make({
              index: set.index,
              indicator: set.indicator,
              weight_kg: set.weightKg,
              reps: set.reps,
              rpe: set.rpe,
              distance_meters: set.distanceMeters,
              duration_seconds: set.durationSeconds,
              custom_metric: set.customMetric,
              completed_at: set.completedAt,
            }),
          ),
        }),
      ),
    ],
  })
})

export const verifyWorkoutExerciseInsertPreview = Effect.fn("WorkoutInsert.verifyPreview")(
  function* (workout: CompletedWorkout, preview: WorkoutExerciseInsertPreview) {
    if (workout.exercises.length !== preview.exerciseCountAfter) {
      return yield* invalid(
        "verification_failed",
        "Saved workout exercise count does not match the insertion preview",
        502,
      )
    }
    for (const insertion of preview.insertions) {
      const matches = workout.exercises.filter(exercise => matchesInsertion(exercise, insertion))
      if (matches.length !== 1) {
        return yield* invalid(
          "verification_failed",
          `${insertion.title} was not persisted exactly once`,
          502,
        )
      }
    }
  },
)
