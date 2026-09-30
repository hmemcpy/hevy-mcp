import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CompletedWorkout, UpstreamSet } from "../src/types"
import {
  applyWorkoutEditPreview,
  createWorkoutEditPreview,
  decodeWorkoutSetChanges,
  toWorkoutUpdateBody,
  verifyWorkoutEditPreview,
} from "../src/workout-edit"

function workout(): CompletedWorkout {
  return CompletedWorkout.make({
    id: "workout-1",
    name: "Pull",
    description: null,
    routine_id: "routine-1",
    start_time: 1_788_000_000,
    end_time: 1_788_003_600,
    created_at: "2026-08-20T19:00:00.000Z",
    updated_at: "2026-08-20T19:20:48.206Z",
    is_private: true,
    exercises: [
      {
        id: "row-1",
        exercise_template_id: "ROW001",
        title: "Seated Row (Machine)",
        notes: null,
        rest_seconds: 120,
        superset_id: null,
        volume_doubling_enabled: false,
        sets: [
          {
            index: 0,
            indicator: "normal",
            weight_kg: 61,
            reps: 12,
            rpe: null,
            distance_meters: null,
            duration_seconds: null,
            custom_metric: null,
            completed_at: "2026-08-20T18:10:00.000Z",
          },
          {
            index: 1,
            indicator: "normal",
            weight_kg: 61,
            reps: 11,
            rpe: null,
            distance_meters: null,
            duration_seconds: null,
            custom_metric: null,
            completed_at: "2026-08-20T18:14:00.000Z",
          },
        ],
      },
    ],
  })
}

function workoutWithThirdSet(): CompletedWorkout {
  const base = workout()
  return CompletedWorkout.make({
    ...base,
    exercises: base.exercises.map(exercise => ({
      ...exercise,
      sets: [
        ...exercise.sets,
        UpstreamSet.make({
          index: 2,
          indicator: "normal",
          weight_kg: 15,
          reps: 12,
          rpe: null,
          distance_meters: null,
          duration_seconds: null,
          custom_metric: null,
          completed_at: "2026-08-20T18:18:00.000Z",
        }),
      ],
    })),
  })
}

const UpdateBodySchema = Schema.Struct({
  workoutUpdate: Schema.Struct({
    exercises: Schema.Array(
      Schema.Struct({
        exercise_template_id: Schema.String,
        rest_timer_seconds: Schema.Number,
        sets: Schema.Array(
          Schema.Struct({
            index: Schema.Number,
            type: Schema.String,
            weight_kg: Schema.NullOr(Schema.Number),
            reps: Schema.NullOr(Schema.Number),
          }),
        ),
      }),
    ),
  }),
})

describe("completed workout edit previews", () => {
  it("edits one row/set and serializes the full exercise update contract", async () => {
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([
        { exerciseId: "row-1", setIndex: 1, values: { weightKg: 62.5, reps: 10 } },
      ]),
    )
    const preview = await Effect.runPromise(createWorkoutEditPreview(workout(), changes))
    expect(preview.changes[0]?.before).toEqual({ weightKg: 61, reps: 11 })
    expect(preview.changes[0]?.after).toEqual({ weightKg: 62.5, reps: 10 })

    const updated = await Effect.runPromise(applyWorkoutEditPreview(workout(), preview))
    await Effect.runPromise(verifyWorkoutEditPreview(updated, preview))
    expect(updated.exercises[0]?.sets[0]?.weight_kg).toBe(61)
    expect(updated.exercises[0]?.sets[1]?.weight_kg).toBe(62.5)

    const body = await Effect.runPromise(
      Schema.decodeUnknownEffect(UpdateBodySchema)(toWorkoutUpdateBody(updated)),
    )
    expect(body.workoutUpdate.exercises[0]?.sets).toEqual([
      expect.objectContaining({ index: 0, type: "normal", weight_kg: 61, reps: 12 }),
      expect.objectContaining({ index: 1, type: "normal", weight_kg: 62.5, reps: 10 }),
    ])
  })

  it("rejects a stale workout revision", async () => {
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([{ exerciseId: "row-1", setIndex: 0, values: { reps: 13 } }]),
    )
    const preview = await Effect.runPromise(createWorkoutEditPreview(workout(), changes))
    const changed = CompletedWorkout.make({
      ...workout(),
      updated_at: "2026-08-20T19:21:00.000Z",
    })
    const error = await Effect.runPromise(Effect.flip(applyWorkoutEditPreview(changed, preview)))
    expect(error.code).toBe("workout_changed")
  })

  it("applies a preview when the upstream exercise row ID changes between reads", async () => {
    const base = workout()
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([
        { exerciseId: "row-1", setIndex: 1, values: { weightKg: 62.5, reps: 10 } },
      ]),
    )
    const preview = await Effect.runPromise(createWorkoutEditPreview(base, changes))
    const refetched = CompletedWorkout.make({
      ...base,
      exercises: base.exercises.map(exercise => ({ ...exercise, id: "row-2" })),
    })

    const updated = await Effect.runPromise(applyWorkoutEditPreview(refetched, preview))

    expect(updated.exercises[0]?.id).toBe("row-2")
    expect(updated.exercises[0]?.sets[1]).toEqual(
      expect.objectContaining({ weight_kg: 62.5, reps: 10 }),
    )
    const verified = CompletedWorkout.make({
      ...updated,
      exercises: updated.exercises.map(exercise => ({ ...exercise, id: "row-3" })),
    })
    await Effect.runPromise(verifyWorkoutEditPreview(verified, preview))
  })

  it("rejects an ambiguous fallback after an exercise row ID changes", async () => {
    const base = workout()
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([{ exerciseId: "row-1", setIndex: 1, values: { reps: 10 } }]),
    )
    const preview = await Effect.runPromise(createWorkoutEditPreview(base, changes))
    const original = base.exercises.at(0)
    if (original === undefined) throw new Error("Workout fixture has no exercise")
    const refetched = CompletedWorkout.make({
      ...base,
      exercises: [
        { ...original, id: "row-2" },
        { ...original, id: "row-3" },
      ],
    })

    const error = await Effect.runPromise(Effect.flip(applyWorkoutEditPreview(refetched, preview)))

    expect(error.code).toBe("exercise_identity_ambiguous")
  })

  it("deletes the final set using an empty values object", async () => {
    const base = workoutWithThirdSet()
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([
        { exerciseId: "row-1", setIndex: 0, values: { weightKg: 15, reps: 12 } },
        { exerciseId: "row-1", setIndex: 2, values: {} },
      ]),
    )
    const preview = await Effect.runPromise(createWorkoutEditPreview(base, changes))
    expect(preview.changes[1]?.before).toEqual({
      weightKg: 15,
      reps: 12,
      rpe: null,
      distanceMeters: null,
      durationSeconds: null,
      customMetric: null,
    })
    expect(preview.changes[1]?.after).toEqual({})

    const refetched = CompletedWorkout.make({
      ...base,
      exercises: base.exercises.map(exercise => ({ ...exercise, id: "row-2" })),
    })
    const updated = await Effect.runPromise(applyWorkoutEditPreview(refetched, preview))
    expect(updated.exercises[0]?.sets.map(set => set.index)).toEqual([0, 1])
    expect(updated.exercises[0]?.sets[0]).toEqual(
      expect.objectContaining({ index: 0, weight_kg: 15, reps: 12 }),
    )

    const body = await Effect.runPromise(
      Schema.decodeUnknownEffect(UpdateBodySchema)(toWorkoutUpdateBody(updated)),
    )
    expect(body.workoutUpdate.exercises[0]?.sets.map(set => set.index)).toEqual([0, 1])
    const verified = CompletedWorkout.make({
      ...updated,
      exercises: updated.exercises.map(exercise => ({ ...exercise, id: "row-3" })),
    })
    await Effect.runPromise(verifyWorkoutEditPreview(verified, preview))
  })

  it("rejects deleting a non-final set until reindexing is verified", async () => {
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([{ exerciseId: "row-1", setIndex: 1, values: {} }]),
    )
    const error = await Effect.runPromise(
      Effect.flip(createWorkoutEditPreview(workoutWithThirdSet(), changes)),
    )
    expect(error.code).toBe("cannot_delete_middle_set")
  })

  it("rejects a value changed after preview", async () => {
    const base = workout()
    const changes = await Effect.runPromise(
      decodeWorkoutSetChanges([{ exerciseId: "row-1", setIndex: 0, values: { reps: 13 } }]),
    )
    const preview = await Effect.runPromise(createWorkoutEditPreview(base, changes))
    const changed = CompletedWorkout.make({
      ...base,
      exercises: base.exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map(set => (set.index === 0 ? { ...set, reps: 10 } : set)),
      })),
    })
    const error = await Effect.runPromise(Effect.flip(applyWorkoutEditPreview(changed, preview)))
    expect(error.code).toBe("value_changed")
  })
})
