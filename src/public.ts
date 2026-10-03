import type { ApiSet, CompletedWorkout } from "./types"

export function publicWorkout(workout: CompletedWorkout): object {
  return {
    id: workout.id,
    title: workout.name,
    description: workout.description,
    routineId: workout.routine_id,
    startTime: publicWorkoutTimestamp(workout.start_time),
    endTime: publicWorkoutTimestamp(workout.end_time),
    createdAt: workout.created_at,
    updatedAt: workout.updated_at,
    isPrivate: workout.is_private,
    estimatedVolumeKg: workout.estimated_volume_kg,
    exercises: workout.exercises.map((exercise, index) => ({
      index,
      id: exercise.id,
      exerciseTemplateId: exercise.exercise_template_id,
      title: exercise.title,
      notes: exercise.notes,
      restSeconds: exercise.rest_seconds,
      supersetId: exercise.superset_id,
      sets: exercise.sets.map(publicCompletedSet),
    })),
  }
}

function publicWorkoutTimestamp(value: string | number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1_000).toISOString() : value
}

export function publicCompletedSet(set: ApiSet): object {
  return {
    index: set.index,
    indicator: set.indicator,
    weightKg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    distanceMeters: set.distance_meters,
    durationSeconds: set.duration_seconds,
    customMetric: set.custom_metric,
    completedAt: set.completed_at,
    prs: set.prs,
    personalRecords: set.personalRecords,
  }
}
