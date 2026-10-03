import { Effect, Schema } from "effect"
import { ApiError } from "./errors"
import {
  ApiRoutine,
  type ApiRoutineExercise,
  ApiSet,
  ChangeValues,
  PreviewChange,
  ProgressionPreview,
  type RequestedChange,
  RequestedChangesSchema,
} from "./types"

function invalidRequest(code: string, message: string) {
  return new ApiError({ status: 400, code, message })
}

export const decodeRequestedChanges = Effect.fn("Progression.decodeChanges")((input: unknown) =>
  Schema.decodeUnknownEffect(RequestedChangesSchema)(input).pipe(
    Effect.mapError(() => invalidRequest("invalid_changes", "Changes are missing or invalid")),
    Effect.flatMap(changes => {
      const seen = new Set<string>()
      for (const [position, change] of changes.entries()) {
        if (Object.keys(change.values).length === 0) {
          return Effect.fail(
            invalidRequest("invalid_change", `Change ${position} has no supported values`),
          )
        }
        const key = `${change.exerciseTemplateId}:${change.setIndex}`
        if (seen.has(key)) {
          return Effect.fail(invalidRequest("duplicate_change", `Duplicate change for ${key}`))
        }
        seen.add(key)
      }
      return Effect.succeed(changes)
    }),
  ),
)

function findUniqueExercise(routine: ApiRoutine, exerciseTemplateId: string) {
  const matches = routine.exercises.filter(
    exercise => exercise.exercise_template_id === exerciseTemplateId,
  )
  if (matches.length === 0) {
    return Effect.fail(
      new ApiError({
        status: 404,
        code: "exercise_not_found",
        message: `Exercise ${exerciseTemplateId} was not found`,
      }),
    )
  }
  if (matches.length > 1) {
    return Effect.fail(
      new ApiError({
        status: 409,
        code: "ambiguous_exercise",
        message: `Exercise ${exerciseTemplateId} occurs more than once in the routine`,
      }),
    )
  }
  const exercise = matches[0]
  return exercise === undefined
    ? Effect.fail(
        new ApiError({
          status: 500,
          code: "internal_error",
          message: "Exercise lookup failed",
        }),
      )
    : Effect.succeed(exercise)
}

function valuesFromSet(set: ApiSet, values: ChangeValues): ChangeValues {
  return ChangeValues.make({
    ...(Object.hasOwn(values, "weightKg") ? { weightKg: set.weight_kg } : {}),
    ...(Object.hasOwn(values, "reps") ? { reps: set.reps } : {}),
    ...(Object.hasOwn(values, "rpe") ? { rpe: set.rpe } : {}),
  })
}

export const createPreview = Effect.fn("Progression.createPreview")(function* (
  routine: ApiRoutine,
  requested: ReadonlyArray<RequestedChange>,
) {
  const changes = yield* Effect.forEach(requested, change =>
    Effect.gen(function* () {
      const exercise = yield* findUniqueExercise(routine, change.exerciseTemplateId)
      const set = exercise.sets.find(candidate => candidate.index === change.setIndex)
      if (set === undefined) {
        return yield* new ApiError({
          status: 404,
          code: "set_not_found",
          message: `Set ${change.setIndex} was not found`,
        })
      }
      return PreviewChange.make({
        exerciseTemplateId: change.exerciseTemplateId,
        exerciseTitle: exercise.title,
        setIndex: change.setIndex,
        before: valuesFromSet(set, change.values),
        after: change.values,
      })
    }),
  )
  return ProgressionPreview.make({
    routineId: routine.id,
    routineTitle: routine.title,
    revision: routine.updated_at,
    changes,
  })
})

function changed(current: ApiSet, before: ChangeValues): boolean {
  return (
    (Object.hasOwn(before, "weightKg") && current.weight_kg !== before.weightKg) ||
    (Object.hasOwn(before, "reps") && current.reps !== before.reps) ||
    (Object.hasOwn(before, "rpe") && current.rpe !== before.rpe)
  )
}

function updateSet(current: ApiSet, after: ChangeValues): ApiSet {
  return ApiSet.make({
    ...current,
    weight_kg: Object.hasOwn(after, "weightKg") ? (after.weightKg ?? null) : current.weight_kg,
    reps: Object.hasOwn(after, "reps") ? (after.reps ?? null) : current.reps,
    rpe: Object.hasOwn(after, "rpe") ? (after.rpe ?? null) : current.rpe,
  })
}

function replaceSet(
  routine: ApiRoutine,
  exercise: ApiRoutineExercise,
  set: ApiSet,
  after: ChangeValues,
): ApiRoutine {
  return ApiRoutine.make({
    ...routine,
    exercises: routine.exercises.map(candidate =>
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

export const applyPreview = Effect.fn("Progression.applyPreview")(function* (
  routine: ApiRoutine,
  preview: ProgressionPreview,
) {
  if (preview.routineId !== routine.id) {
    return yield* invalidRequest("routine_mismatch", "Preview targets another routine")
  }
  if (preview.revision !== routine.updated_at) {
    return yield* new ApiError({
      status: 409,
      code: "routine_changed",
      message: "Routine changed after preview",
    })
  }
  let updated = routine
  for (const change of preview.changes) {
    const exercise = yield* findUniqueExercise(updated, change.exerciseTemplateId)
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
        message: `${exercise.title} set ${change.setIndex} changed`,
      })
    }
    updated = replaceSet(updated, exercise, set, change.after)
  }
  return updated
})

export const verifyPreview = Effect.fn("Progression.verifyPreview")(function* (
  routine: ApiRoutine,
  preview: ProgressionPreview,
) {
  for (const change of preview.changes) {
    const exercise = yield* findUniqueExercise(routine, change.exerciseTemplateId)
    const set = exercise.sets.find(candidate => candidate.index === change.setIndex)
    if (set === undefined || changed(set, change.after)) {
      return yield* new ApiError({
        status: 502,
        code: "verification_failed",
        message: `${exercise.title} set ${change.setIndex} was not persisted`,
      })
    }
  }
})

export function toRoutinePutBody(routine: ApiRoutine): object {
  return {
    routine: {
      _unsyncedObjectId: routine.id,
      title: routine.title,
      parent_routine_id: routine.parent_routine_id,
      folder_id: routine.folder_id,
      index: routine.index,
      program_id: routine.program_id,
      notes: routine.notes,
      coach_force_rpe_enabled: routine.coach_force_rpe_enabled,
      exercises: routine.exercises.map(exercise => ({
        exercise_template_id: exercise.exercise_template_id,
        rest_seconds: exercise.rest_seconds,
        notes: exercise.notes,
        sets: exercise.sets.map(set => ({
          index: set.index,
          indicator: set.indicator,
          weight_kg: set.weight_kg,
          reps: set.reps,
          distance_meters: set.distance_meters,
          duration_seconds: set.duration_seconds,
          custom_metric: set.custom_metric,
          rpe: set.rpe,
        })),
      })),
    },
  }
}
