import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { publicWorkout } from "../src/public"
import { CompletedWorkout } from "../src/types"

describe("public workouts", () => {
  it("decodes and maps a complete workout without exposing api field names", async () => {
    const workout = await Effect.runPromise(
      Schema.decodeUnknownEffect(CompletedWorkout)({
        id: "workout-1",
        name: "Push",
        description: "Chest session",
        routine_id: "routine-1",
        start_time: Date.parse("2026-08-22T18:00:00.000Z") / 1_000,
        end_time: Date.parse("2026-08-22T19:00:00.000Z") / 1_000,
        created_at: "2026-08-22T19:01:00.000Z",
        updated_at: "2026-08-22T19:02:00.000Z",
        is_private: true,
        estimated_volume_kg: 364,
        exercises: [
          {
            id: "exercise-1",
            exercise_template_id: "BENCH001",
            title: "Bench Press",
            notes: "Controlled eccentric",
            rest_seconds: 120,
            superset_id: null,
            sets: [
              {
                index: 0,
                indicator: "normal",
                weight_kg: 91,
                reps: 4,
                rpe: 8,
                distance_meters: null,
                duration_seconds: null,
                custom_metric: null,
                completed_at: "2026-08-22T18:15:00.000Z",
                prs: ["weight"],
              },
            ],
          },
        ],
      }),
    )

    expect(publicWorkout(workout)).toEqual({
      id: "workout-1",
      title: "Push",
      description: "Chest session",
      routineId: "routine-1",
      startTime: "2026-08-22T18:00:00.000Z",
      endTime: "2026-08-22T19:00:00.000Z",
      createdAt: "2026-08-22T19:01:00.000Z",
      updatedAt: "2026-08-22T19:02:00.000Z",
      isPrivate: true,
      estimatedVolumeKg: 364,
      exercises: [
        {
          index: 0,
          id: "exercise-1",
          exerciseTemplateId: "BENCH001",
          title: "Bench Press",
          notes: "Controlled eccentric",
          restSeconds: 120,
          supersetId: null,
          sets: [
            {
              index: 0,
              indicator: "normal",
              weightKg: 91,
              reps: 4,
              rpe: 8,
              distanceMeters: null,
              durationSeconds: null,
              customMetric: null,
              completedAt: "2026-08-22T18:15:00.000Z",
              prs: ["weight"],
              personalRecords: undefined,
            },
          ],
        },
      ],
    })
  })
})
