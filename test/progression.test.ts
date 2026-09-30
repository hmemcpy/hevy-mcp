import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  applyPreview,
  createPreview,
  decodeRequestedChanges,
  toRoutinePutBody,
  verifyPreview,
} from "../src/progression"
import { UpstreamRoutine } from "../src/types"

function routine(): UpstreamRoutine {
  return UpstreamRoutine.make({
    id: "routine-1",
    title: "Push",
    index: 0,
    updated_at: "2026-08-22T18:00:00.000Z",
    parent_routine_id: "parent-1",
    folder_id: null,
    program_id: null,
    notes: null,
    coach_force_rpe_enabled: false,
    exercises: [
      {
        id: "routine-exercise-1",
        exercise_template_id: "BENCH001",
        title: "Bench Press",
        notes: null,
        rest_seconds: 120,
        sets: [
          {
            index: 0,
            indicator: "normal",
            weight_kg: 90,
            reps: 8,
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

const PutBodySchema = Schema.Struct({
  routine: Schema.Struct({
    exercises: Schema.Array(
      Schema.Struct({ sets: Schema.Array(Schema.Struct({ weight_kg: Schema.Number })) }),
    ),
  }),
})

const request = [
  { exerciseTemplateId: "BENCH001", setIndex: 0, values: { weightKg: 92.5, reps: 8 } },
]

describe("progression previews", () => {
  it("creates, applies, serializes, and verifies a scoped update", async () => {
    const requested = await Effect.runPromise(decodeRequestedChanges(request))
    const preview = await Effect.runPromise(createPreview(routine(), requested))
    expect(preview.changes[0]?.before).toEqual({ weightKg: 90, reps: 8 })
    expect(preview.changes[0]?.after).toEqual({ weightKg: 92.5, reps: 8 })

    const updated = await Effect.runPromise(applyPreview(routine(), preview))
    expect(updated.exercises[0]?.sets[0]?.weight_kg).toBe(92.5)
    await Effect.runPromise(verifyPreview(updated, preview))

    const body = await Effect.runPromise(
      Schema.decodeUnknownEffect(PutBodySchema)(toRoutinePutBody(updated)),
    )
    expect(body.routine.exercises[0]?.sets[0]?.weight_kg).toBe(92.5)
  })

  it("rejects stale previews", async () => {
    const base = routine()
    const requested = await Effect.runPromise(
      decodeRequestedChanges([
        { exerciseTemplateId: "BENCH001", setIndex: 0, values: { reps: 9 } },
      ]),
    )
    const preview = await Effect.runPromise(createPreview(base, requested))
    const changed = UpstreamRoutine.make({ ...base, updated_at: "2026-08-22T18:01:00.000Z" })
    const error = await Effect.runPromise(Effect.flip(applyPreview(changed, preview)))
    expect(error.code).toBe("routine_changed")
  })

  it("rejects a value changed after preview even with the same revision", async () => {
    const base = routine()
    const requested = await Effect.runPromise(
      decodeRequestedChanges([
        { exerciseTemplateId: "BENCH001", setIndex: 0, values: { reps: 9 } },
      ]),
    )
    const preview = await Effect.runPromise(createPreview(base, requested))
    const changed = UpstreamRoutine.make({
      ...base,
      exercises: base.exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map(set => ({ ...set, reps: 7 })),
      })),
    })
    const error = await Effect.runPromise(Effect.flip(applyPreview(changed, preview)))
    expect(error.code).toBe("value_changed")
  })
})
