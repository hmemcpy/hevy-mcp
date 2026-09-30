import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  CompletedWorkout,
  RequestedWorkoutExerciseInsertion,
  RequestedWorkoutInsertionSet,
  WorkoutExerciseInsertPreview,
} from "../src/types"
import { toWorkoutUpdateBody } from "../src/workout-edit"
import {
  applyWorkoutExerciseInsertPreview,
  createWorkoutExerciseInsertPreview,
  verifyWorkoutExerciseInsertPreview,
} from "../src/workout-insert"

function benchOnlyWorkout(): CompletedWorkout {
  return CompletedWorkout.make({
    id: "workout-1",
    name: "Push",
    start_time: 1_787_594_101,
    end_time: 1_787_598_897,
    created_at: "2026-08-24T19:14:57.524Z",
    updated_at: "2026-08-24T19:14:57.524Z",
    exercises: [
      {
        id: "bench-row",
        exercise_template_id: "79D0BB3A",
        title: "Bench Press (Barbell)",
        notes: "",
        rest_seconds: 180,
        superset_id: null,
        volume_doubling_enabled: false,
        sets: [0, 1, 2].map(index => ({
          index,
          indicator: "normal",
          weight_kg: 90,
          reps: 5,
          rpe: null,
          distance_meters: null,
          duration_seconds: null,
          custom_metric: null,
          completed_at: "2026-08-24T19:10:00.000Z",
        })),
      },
    ],
  })
}

function insertion(
  exerciseTemplateId: string,
  title: string,
  sets: ReadonlyArray<readonly [number, number]>,
) {
  return RequestedWorkoutExerciseInsertion.make({
    exerciseTemplateId,
    title,
    restSeconds: 120,
    sets: sets.map(([weightKg, reps]) => RequestedWorkoutInsertionSet.make({ weightKg, reps })),
  })
}

describe("completed workout exercise insertion previews", () => {
  it("previews, applies, serializes, and verifies multiple missing exercise rows", async () => {
    const base = benchOnlyWorkout()
    const preview = await Effect.runPromise(
      createWorkoutExerciseInsertPreview(base, [
        insertion("INCLINE", "Incline Chest Press (Machine)", [
          [60, 10],
          [60, 10],
        ]),
        insertion("LATERAL", "Machine lateral raise", [
          [20, 15],
          [25, 12],
          [25, 12],
        ]),
        insertion("REARDELT", "Rear Delt Reverse Fly (Machine)", [
          [50, 12],
          [50, 11],
          [50, 10],
        ]),
      ]),
    )

    expect(preview).toEqual(
      expect.objectContaining({ exerciseCountBefore: 1, exerciseCountAfter: 4 }),
    )
    expect(preview.insertions[0]?.sets).toEqual([
      expect.objectContaining({ index: 0, weightKg: 60, reps: 10 }),
      expect.objectContaining({ index: 1, weightKg: 60, reps: 10 }),
    ])
    expect(preview.insertions[0]?.sets[0]?.completedAt).toBe("2026-08-24T19:14:57.000Z")

    const updated = await Effect.runPromise(applyWorkoutExerciseInsertPreview(base, preview))
    expect(updated.exercises).toHaveLength(4)
    expect(updated.exercises[1]?.sets.map(set => [set.weight_kg, set.reps])).toEqual([
      [60, 10],
      [60, 10],
    ])

    const body = toWorkoutUpdateBody(updated)
    expect(body).toEqual(
      expect.objectContaining({
        workoutUpdate: expect.objectContaining({
          exercises: expect.arrayContaining([
            expect.objectContaining({
              exercise_template_id: "REARDELT",
              rest_timer_seconds: 120,
              sets: [
                expect.objectContaining({ index: 0, weight_kg: 50, reps: 12 }),
                expect.objectContaining({ index: 1, weight_kg: 50, reps: 11 }),
                expect.objectContaining({ index: 2, weight_kg: 50, reps: 10 }),
              ],
            }),
          ]),
        }),
      }),
    )

    const refetched = CompletedWorkout.make({
      ...updated,
      updated_at: "2026-08-24T19:20:00.000Z",
      exercises: updated.exercises.map((exercise, index) => ({
        ...exercise,
        id: exercise.id ?? `inserted-row-${index}`,
      })),
    })
    await Effect.runPromise(verifyWorkoutExerciseInsertPreview(refetched, preview))
  })

  it("rejects stale, duplicate, and already-present insertions", async () => {
    const base = benchOnlyWorkout()
    const request = insertion("INCLINE", "Incline Chest Press (Machine)", [[60, 10]])
    const preview = await Effect.runPromise(createWorkoutExerciseInsertPreview(base, [request]))

    const stale = CompletedWorkout.make({
      ...base,
      updated_at: "2026-08-24T19:20:00.000Z",
    })
    const staleError = await Effect.runPromise(
      Effect.flip(applyWorkoutExerciseInsertPreview(stale, preview)),
    )
    expect(staleError.code).toBe("workout_changed")

    const duplicateError = await Effect.runPromise(
      Effect.flip(createWorkoutExerciseInsertPreview(base, [request, request])),
    )
    expect(duplicateError.code).toBe("duplicate_insertion")

    const updated = await Effect.runPromise(applyWorkoutExerciseInsertPreview(base, preview))
    const alreadyPresent = CompletedWorkout.make({
      ...updated,
      updated_at: "2026-08-24T19:14:57.524Z",
    })
    const existingError = await Effect.runPromise(
      Effect.flip(createWorkoutExerciseInsertPreview(alreadyPresent, [request])),
    )
    expect(existingError.code).toBe("exercise_already_exists")
  })

  it("rejects an altered exercise-count boundary", async () => {
    const base = benchOnlyWorkout()
    const preview = await Effect.runPromise(
      createWorkoutExerciseInsertPreview(base, [
        insertion("INCLINE", "Incline Chest Press (Machine)", [[60, 10]]),
      ]),
    )
    const altered = WorkoutExerciseInsertPreview.make({
      ...preview,
      exerciseCountAfter: preview.exerciseCountAfter + 1,
    })
    const error = await Effect.runPromise(
      Effect.flip(applyWorkoutExerciseInsertPreview(base, altered)),
    )
    expect(error.code).toBe("exercise_count_changed")
  })
})
