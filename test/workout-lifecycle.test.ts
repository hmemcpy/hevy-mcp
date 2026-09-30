import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { CompletedWorkout, UpstreamRoutine } from "../src/types"
import {
  AddExerciseOperation,
  AddSetOperation,
  CompleteSetOperation,
  createWorkoutDeletePreview,
  DeleteExerciseOperation,
  DeleteSetOperation,
  DraftSetValues,
  EditExerciseOperation,
  EditSetOperation,
  previewWorkoutFinish,
  StartSetOperation,
  StartWorkoutSessionRequest,
  startWorkoutSession,
  toCreateWorkoutBody,
  UpdateWorkoutSessionRequest,
  updateWorkoutSession,
  validateWorkoutDeletePreview,
  validateWorkoutFinishPreview,
  WorkoutDeletePreview,
  WorkoutFinishPreview,
} from "../src/workout-lifecycle"

function routine(): UpstreamRoutine {
  return UpstreamRoutine.make({
    id: "routine-1",
    title: "Push",
    index: 0,
    updated_at: "2026-08-23T09:00:00.000Z",
    parent_routine_id: null,
    folder_id: null,
    program_id: null,
    notes: null,
    coach_force_rpe_enabled: false,
    exercises: [
      {
        exercise_template_id: "BENCH001",
        title: "Bench Press",
        notes: "",
        rest_seconds: 180,
        sets: [
          {
            index: 0,
            indicator: "normal",
            weight_kg: 90,
            reps: 5,
            rpe: null,
            distance_meters: null,
            duration_seconds: null,
            custom_metric: null,
          },
          {
            index: 1,
            indicator: "normal",
            weight_kg: 90,
            reps: 5,
            rpe: null,
            distance_meters: null,
            duration_seconds: null,
            custom_metric: null,
          },
        ],
      },
    ],
  })
}

function ids(...values: ReadonlyArray<string>) {
  let index = 0
  return () => values[index++] ?? `generated-${index}`
}

describe("active workout lifecycle", () => {
  it("starts from a routine and records set timing through typed operations", async () => {
    const started = await Effect.runPromise(
      startWorkoutSession(
        StartWorkoutSessionRequest.make({ routineId: "routine-1" }),
        routine(),
        "2026-08-23T10:00:00.000Z",
        ids("exercise-1", "session-1", "workout-1", "revision-1"),
      ),
    )
    expect(started.title).toBe("Push")
    expect(started.exercises[0]?.sets).toHaveLength(2)

    const begun = await Effect.runPromise(
      updateWorkoutSession(
        started,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-1",
          operations: [StartSetOperation.make({ exerciseId: "exercise-1", setIndex: 0 })],
        }),
        "2026-08-23T10:05:00.000Z",
        ids("revision-2"),
      ),
    )
    const completed = await Effect.runPromise(
      updateWorkoutSession(
        begun,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-2",
          operations: [
            CompleteSetOperation.make({
              exerciseId: "exercise-1",
              setIndex: 0,
              values: DraftSetValues.make({ weightKg: 92.5, reps: 4, rpe: 8 }),
            }),
            EditSetOperation.make({
              exerciseId: "exercise-1",
              setIndex: 1,
              values: DraftSetValues.make({ weightKg: 92.5, reps: 4 }),
            }),
          ],
        }),
        "2026-08-23T10:06:30.000Z",
        ids("revision-3"),
      ),
    )

    expect(completed.exercises[0]?.sets[0]).toEqual(
      expect.objectContaining({
        weightKg: 92.5,
        reps: 4,
        rpe: 8,
        durationSeconds: null,
        elapsedSeconds: 90,
        completedAt: "2026-08-23T10:06:30.000Z",
      }),
    )
    expect(completed.exercises[0]?.sets[1]?.completedAt).toBeNull()
  })

  it("previews and serializes one atomic finished-workout POST", async () => {
    const started = await Effect.runPromise(
      startWorkoutSession(
        StartWorkoutSessionRequest.make({ routineId: "routine-1" }),
        routine(),
        "2026-08-23T10:00:00.000Z",
        ids("exercise-1", "session-1", "workout-1", "revision-1"),
      ),
    )
    const completed = await Effect.runPromise(
      updateWorkoutSession(
        started,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-1",
          operations: [
            CompleteSetOperation.make({
              exerciseId: "exercise-1",
              setIndex: 0,
              values: DraftSetValues.make({ weightKg: 92.5, reps: 4 }),
            }),
          ],
        }),
        "2026-08-23T10:06:30.000Z",
        ids("revision-2"),
      ),
    )
    const preview = await Effect.runPromise(
      previewWorkoutFinish(completed, "2026-08-23T11:00:00.000Z"),
    )

    expect(preview.durationSeconds).toBe(3_600)
    expect(preview.exercises[0]?.sets).toHaveLength(1)
    expect(toCreateWorkoutBody(preview)).toEqual({
      workout: {
        workout_id: "workout-1",
        title: "Push",
        description: "",
        media: [],
        exercises: [
          {
            title: "Bench Press",
            exercise_template_id: "BENCH001",
            rest_timer_seconds: 180,
            notes: "",
            volume_doubling_enabled: false,
            sets: [
              {
                index: 0,
                type: "normal",
                weight_kg: 92.5,
                reps: 4,
                distance_meters: null,
                duration_seconds: null,
                custom_metric: null,
                rpe: null,
                completed_at: "2026-08-23T10:06:30.000Z",
              },
            ],
          },
        ],
        start_time: 1_787_479_200,
        end_time: 1_787_482_800,
        routine_id: "routine-1",
        apple_watch: false,
        wearos_watch: false,
        is_private: false,
        is_biometrics_public: true,
        gym: null,
      },
      share_to_strava: false,
    })
  })

  it("adds, edits, and deletes exercises and sets while preserving set indexes", async () => {
    const started = await Effect.runPromise(
      startWorkoutSession(
        StartWorkoutSessionRequest.make({ title: "Custom workout" }),
        undefined,
        "2026-08-23T10:00:00.000Z",
        ids("session-1", "workout-1", "revision-1"),
      ),
    )
    const withExercise = await Effect.runPromise(
      updateWorkoutSession(
        started,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-1",
          operations: [
            AddExerciseOperation.make({
              exerciseTemplateId: "DEADLIFT001",
              title: "Deadlift",
              restSeconds: 180,
            }),
          ],
        }),
        "2026-08-23T10:01:00.000Z",
        ids("exercise-1", "revision-2"),
      ),
    )
    const withSets = await Effect.runPromise(
      updateWorkoutSession(
        withExercise,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-2",
          operations: [
            EditExerciseOperation.make({
              exerciseId: "exercise-1",
              notes: "Top sets",
              restSeconds: 240,
            }),
            AddSetOperation.make({
              exerciseId: "exercise-1",
              values: DraftSetValues.make({ weightKg: 140, reps: 5 }),
            }),
            AddSetOperation.make({
              exerciseId: "exercise-1",
              values: DraftSetValues.make({ weightKg: 150, reps: 3 }),
            }),
            AddSetOperation.make({
              exerciseId: "exercise-1",
              values: DraftSetValues.make({ weightKg: 160, reps: 1 }),
            }),
          ],
        }),
        "2026-08-23T10:02:00.000Z",
        ids("revision-3"),
      ),
    )
    const withoutMiddleSet = await Effect.runPromise(
      updateWorkoutSession(
        withSets,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-3",
          operations: [DeleteSetOperation.make({ exerciseId: "exercise-1", setIndex: 1 })],
        }),
        "2026-08-23T10:03:00.000Z",
        ids("revision-4"),
      ),
    )

    expect(withoutMiddleSet.exercises[0]).toEqual(
      expect.objectContaining({
        title: "Deadlift",
        notes: "Top sets",
        restSeconds: 240,
      }),
    )
    expect(withoutMiddleSet.exercises[0]?.sets.map(set => [set.index, set.weightKg])).toEqual([
      [0, 140],
      [1, 160],
    ])

    const withoutExercise = await Effect.runPromise(
      updateWorkoutSession(
        withoutMiddleSet,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-4",
          operations: [DeleteExerciseOperation.make({ exerciseId: "exercise-1" })],
        }),
        "2026-08-23T10:04:00.000Z",
        ids("revision-5"),
      ),
    )
    expect(withoutExercise.exercises).toEqual([])
  })

  it("rejects a stale completed-workout delete preview", async () => {
    const workout = CompletedWorkout.make({
      id: "workout-1",
      name: "Push",
      updated_at: "2026-08-23T11:00:00.000Z",
      exercises: [],
    })
    const preview = await Effect.runPromise(createWorkoutDeletePreview(workout))
    const changed = CompletedWorkout.make({
      ...workout,
      updated_at: "2026-08-23T11:01:00.000Z",
    })
    const error = await Effect.runPromise(
      Effect.flip(validateWorkoutDeletePreview(changed, preview)),
    )
    expect(error.code).toBe("workout_changed")
  })

  it("rejects altered finish and delete previews", async () => {
    const started = await Effect.runPromise(
      startWorkoutSession(
        StartWorkoutSessionRequest.make({ routineId: "routine-1" }),
        routine(),
        "2026-08-23T10:00:00.000Z",
        ids("exercise-1", "session-1", "workout-1", "revision-1"),
      ),
    )
    const completed = await Effect.runPromise(
      updateWorkoutSession(
        started,
        UpdateWorkoutSessionRequest.make({
          revision: "revision-1",
          operations: [
            CompleteSetOperation.make({
              exerciseId: "exercise-1",
              setIndex: 0,
              values: DraftSetValues.make({ weightKg: 92.5, reps: 4 }),
            }),
          ],
        }),
        "2026-08-23T10:06:30.000Z",
        ids("revision-2"),
      ),
    )
    const preview = await Effect.runPromise(
      previewWorkoutFinish(completed, "2026-08-23T11:00:00.000Z"),
    )
    const finishError = await Effect.runPromise(
      Effect.flip(
        validateWorkoutFinishPreview(
          completed,
          WorkoutFinishPreview.make({ ...preview, title: "Changed after preview" }),
        ),
      ),
    )
    expect(finishError.code).toBe("finish_preview_changed")

    const workout = CompletedWorkout.make({
      id: "workout-1",
      name: "Push",
      updated_at: "2026-08-23T11:00:00.000Z",
      exercises: [],
    })
    const deletePreview = await Effect.runPromise(createWorkoutDeletePreview(workout))
    const deleteError = await Effect.runPromise(
      Effect.flip(
        validateWorkoutDeletePreview(
          workout,
          WorkoutDeletePreview.make({ ...deletePreview, workoutTitle: "Another workout" }),
        ),
      ),
    )
    expect(deleteError.code).toBe("delete_preview_changed")
  })
})
