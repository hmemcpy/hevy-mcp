import { describe, expect, it } from "vitest"
import { buildTrainingSummary } from "../src/training-summary"
import { BodyMeasurement, CompletedWorkout } from "../src/types"

const NOW = "2026-10-08T18:00:00.000Z"
const NOW_MS = Date.parse(NOW)

function set(values: { weight?: number | null; reps?: number | null }) {
  return {
    index: 0,
    indicator: "normal",
    weight_kg: values.weight ?? null,
    reps: values.reps ?? null,
    rpe: null,
    distance_meters: null,
    duration_seconds: null,
    custom_metric: null,
  }
}

function workout(input: {
  id: string
  start: string | number
  end?: string
  name?: string
  templateId?: string
  sets?: Array<{ weight?: number | null; reps?: number | null }>
}) {
  return CompletedWorkout.make({
    id: input.id,
    ...(input.name === undefined ? {} : { name: input.name }),
    start_time: input.start,
    ...(input.end === undefined ? {} : { end_time: input.end }),
    exercises: [
      {
        exercise_template_id: input.templateId ?? input.id,
        title: `Exercise ${input.templateId ?? input.id}`,
        sets: (input.sets ?? [{ weight: 100, reps: 5 }]).map(set),
      },
    ],
  })
}

function measurement(date: string, weightKg: number | null) {
  return BodyMeasurement.make({
    date,
    ...(weightKg === null ? {} : { weight_kg: weightKg }),
  })
}

describe("training summary", () => {
  it("includes workouts whose start falls inside the window and orders them", async () => {
    const edge = new Date(NOW_MS - 28 * 24 * 3600 * 1000).toISOString()
    const before = new Date(NOW_MS - 28 * 24 * 3600 * 1000 - 1).toISOString()
    const future = new Date(NOW_MS + 60_000).toISOString()
    const summary = buildTrainingSummary(
      [
        workout({ id: "late", start: NOW }),
        workout({ id: "future", start: future }),
        workout({ id: "edge", start: edge }),
        workout({ id: "outside", start: before }),
      ],
      [],
      4,
      NOW,
    )
    expect(summary.workouts.map(row => row.workoutId)).toEqual(["edge", "late"])
    expect(summary.workoutCount).toBe(2)
    expect(summary.averageWorkoutsPerWeek).toBe(0.5)
    expect(summary.rangeStart).toBe(edge)
  })

  it("computes volume from sets that have both weight and reps", () => {
    const summary = buildTrainingSummary(
      [
        workout({
          id: "w1",
          start: NOW,
          end: new Date(NOW_MS + 48 * 60_000).toISOString(),
          sets: [
            { weight: 100, reps: 5 },
            { weight: null, reps: 12 },
            { weight: 60, reps: null },
          ],
        }),
      ],
      [],
      1,
      NOW,
    )
    expect(summary.totalVolumeKg).toBe(500)
    expect(summary.totalSets).toBe(3)
    expect(summary.workouts[0]?.setCount).toBe(3)
    expect(summary.workouts[0]?.durationMinutes).toBe(48)
    expect(summary.workouts[0]?.volumeKg).toBe(500)
  })

  it("groups top exercises by template id across workouts", () => {
    const summary = buildTrainingSummary(
      [
        workout({ id: "a", start: NOW, templateId: "SQUAT", sets: [{ weight: 100, reps: 5 }] }),
        workout({
          id: "b",
          start: new Date(NOW_MS - 86_400_000).toISOString(),
          templateId: "SQUAT",
          sets: [{ weight: 100, reps: 3 }],
        }),
        workout({ id: "c", start: NOW, templateId: "BENCH", sets: [{ weight: 60, reps: 10 }] }),
      ],
      [],
      1,
      NOW,
    )
    expect(summary.topExercisesByVolume[0]).toMatchObject({
      exerciseTemplateId: "SQUAT",
      setCount: 2,
      volumeKg: 800,
    })
    expect(summary.topExercisesByVolume).toHaveLength(2)
  })

  it("reports a weight trend only with two or more observations", () => {
    const trend = buildTrainingSummary(
      [],
      [measurement("2026-10-01", 80), measurement("2026-10-08", 82.5)],
      4,
      NOW,
    )
    expect(trend.weightTrend).toEqual({
      first: { date: "2026-10-01", weightKg: 80 },
      last: { date: "2026-10-08", weightKg: 82.5 },
      deltaKg: 2.5,
    })
    const single = buildTrainingSummary([], [measurement("2026-10-01", 80)], 4, NOW)
    expect(single.weightTrend).toBeNull()
    const noneNumeric = buildTrainingSummary(
      [],
      [measurement("2026-10-01", null), measurement("2026-10-08", 82)],
      4,
      NOW,
    )
    expect(noneNumeric.weightTrend).toBeNull()
    const outside = buildTrainingSummary(
      [],
      [measurement("2026-01-01", 70), measurement("2026-10-08", 82)],
      4,
      NOW,
    )
    expect(outside.weightTrend).toBeNull()
  })

  it("accepts epoch-seconds start times and skips workouts without placement", () => {
    const epochSeconds = Math.floor(NOW_MS / 1000)
    const summary = buildTrainingSummary(
      [workout({ id: "unplaced", start: "" }), workout({ id: "placed", start: epochSeconds })],
      [],
      1,
      NOW,
    )
    expect(summary.workouts.map(row => row.workoutId)).toEqual(["placed"])
  })
})

describe("training summary weight-trend bounds", () => {
  it("includes today and excludes tomorrow regardless of the hour", () => {
    const summary = buildTrainingSummary(
      [],
      [measurement("2026-10-01", 80), measurement("2026-10-08", 81), measurement("2026-10-09", 99)],
      4,
      NOW,
    )
    expect(summary.weightTrend).toEqual({
      first: { date: "2026-10-01", weightKg: 80 },
      last: { date: "2026-10-08", weightKg: 81 },
      deltaKg: 1,
    })
  })
})
