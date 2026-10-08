import type { BodyMeasurement, CompletedWorkout } from "./types"

// Pure aggregation over already-fetched workouts and body measurements.
// Semantics: a rolling UTC window of weeks * 7 days ending at "now"; a workout
// belongs to the window when its start_time falls inside it; every recorded
// set counts (including warmups); volume is recorded weight * reps for sets
// that have both, other set types contribute their set count only; exercises
// are grouped by template ID; the weight trend needs at least two non-null
// weight observations inside the window.

const DAY_MS = 24 * 60 * 60 * 1000

export interface TrainingWorkoutSummary {
  readonly workoutId: string
  readonly title: string | null
  readonly startTime: string
  readonly durationMinutes: number | null
  readonly setCount: number
  readonly volumeKg: number
}

export interface TrainingExerciseSummary {
  readonly exerciseTemplateId: string
  readonly title: string
  readonly setCount: number
  readonly volumeKg: number
}

export interface TrainingWeightTrend {
  readonly first: { readonly date: string; readonly weightKg: number }
  readonly last: { readonly date: string; readonly weightKg: number }
  readonly deltaKg: number
}

export interface TrainingSummary {
  readonly weeks: number
  readonly rangeStart: string
  readonly rangeEnd: string
  readonly workoutCount: number
  readonly averageWorkoutsPerWeek: number
  readonly totalSets: number
  readonly totalVolumeKg: number
  readonly averageVolumeKgPerWorkout: number
  readonly workouts: ReadonlyArray<TrainingWorkoutSummary>
  readonly topExercisesByVolume: ReadonlyArray<TrainingExerciseSummary>
  readonly weightTrend: TrainingWeightTrend | null
}

function timestampMs(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return value * 1000
  if (typeof value === "string") {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function setVolume(weightKg: number | null, reps: number | null): number {
  return weightKg !== null && reps !== null ? weightKg * reps : 0
}

export function buildTrainingSummary(
  workouts: ReadonlyArray<CompletedWorkout>,
  measurements: ReadonlyArray<BodyMeasurement>,
  weeks: number,
  nowIso: string,
): TrainingSummary {
  const nowMs = Date.parse(nowIso)
  const rangeStartMs = nowMs - weeks * 7 * DAY_MS

  const withStart = workouts.flatMap(workout => {
    const startMs = timestampMs(workout.start_time)
    return startMs === null || startMs < rangeStartMs || startMs > nowMs
      ? []
      : [{ workout, startMs }]
  })
  withStart.sort((a, b) => a.startMs - b.startMs || a.workout.id.localeCompare(b.workout.id))

  const rows: TrainingWorkoutSummary[] = withStart.map(({ workout, startMs }) => {
    const endMs = timestampMs(workout.end_time)
    const setCount = workout.exercises.reduce((count, exercise) => count + exercise.sets.length, 0)
    const volumeKg = workout.exercises.reduce(
      (total, exercise) =>
        total + exercise.sets.reduce((sum, set) => sum + setVolume(set.weight_kg, set.reps), 0),
      0,
    )
    return {
      workoutId: workout.id,
      title: workout.name ?? null,
      startTime: new Date(startMs).toISOString(),
      durationMinutes:
        endMs !== null && endMs >= startMs ? Math.round((endMs - startMs) / 60000) : null,
      setCount,
      volumeKg: round1(volumeKg),
    }
  })

  const totalSets = rows.reduce((count, row) => count + row.setCount, 0)
  const totalVolumeKg = round1(rows.reduce((total, row) => total + row.volumeKg, 0))

  const byTemplate = new Map<string, TrainingExerciseSummary>()
  for (const { workout } of withStart) {
    for (const exercise of workout.exercises) {
      const volumeKg = exercise.sets.reduce(
        (sum, set) => sum + setVolume(set.weight_kg, set.reps),
        0,
      )
      const existing = byTemplate.get(exercise.exercise_template_id)
      if (existing === undefined) {
        byTemplate.set(exercise.exercise_template_id, {
          exerciseTemplateId: exercise.exercise_template_id,
          title: exercise.title ?? exercise.exercise_template_id,
          setCount: exercise.sets.length,
          volumeKg,
        })
      } else {
        byTemplate.set(exercise.exercise_template_id, {
          ...existing,
          setCount: existing.setCount + exercise.sets.length,
          volumeKg: existing.volumeKg + volumeKg,
        })
      }
    }
  }
  const topExercisesByVolume = Array.from(byTemplate.values())
    .map(exercise => ({ ...exercise, volumeKg: round1(exercise.volumeKg) }))
    .sort(
      (a, b) =>
        b.volumeKg - a.volumeKg ||
        b.setCount - a.setCount ||
        a.exerciseTemplateId.localeCompare(b.exerciseTemplateId),
    )
    .slice(0, 5)

  // Measurement dates are calendar days parsed at UTC midnight, so a plain
  // nowMs bound already includes today's entry wherever "now" falls within
  // the day, and excludes tomorrow's.
  const weights = measurements
    .flatMap(measurement => {
      const ms = Date.parse(measurement.date)
      if (!Number.isFinite(ms) || ms < rangeStartMs || ms > nowMs) return []
      if (measurement.weight_kg === null || measurement.weight_kg === undefined) return []
      return [{ date: measurement.date, weightKg: measurement.weight_kg }]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  const firstWeight = weights[0]
  const lastWeight = weights[weights.length - 1]
  const weightTrend =
    firstWeight === undefined || lastWeight === undefined || firstWeight === lastWeight
      ? null
      : {
          first: firstWeight,
          last: lastWeight,
          deltaKg: round1(lastWeight.weightKg - firstWeight.weightKg),
        }

  return {
    weeks,
    rangeStart: new Date(rangeStartMs).toISOString(),
    rangeEnd: new Date(nowMs).toISOString(),
    workoutCount: rows.length,
    averageWorkoutsPerWeek: round1(rows.length / weeks),
    totalSets,
    totalVolumeKg,
    averageVolumeKgPerWorkout: rows.length === 0 ? 0 : round1(totalVolumeKg / rows.length),
    workouts: rows,
    topExercisesByVolume,
    weightTrend,
  }
}
