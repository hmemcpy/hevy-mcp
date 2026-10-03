import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { type ExerciseCatalogEntry, searchExercises } from "../src/catalog"

const entries: ExerciseCatalogEntry[] = [
  {
    id: "example-a",
    title: "Example A",
    type: "weight_reps",
    equipmentCategory: "barbell",
    muscleGroup: "chest",
    otherMuscles: [],
  },
  {
    id: "example-b",
    title: "Example B",
    type: "reps_only",
    equipmentCategory: "none",
    muscleGroup: "abdominals",
    otherMuscles: [],
  },
]

describe("owner-supplied exercise catalog", () => {
  it("reports missing configuration instead of an empty success", async () => {
    const result = await Effect.runPromise(
      searchExercises(new URLSearchParams(), []).pipe(Effect.flip),
    )
    expect(result.code).toBe("catalog_not_configured")
    expect(result.status).toBe(503)
  })
  it("searches supplied exercise titles and metadata", async () => {
    const result = await Effect.runPromise(
      searchExercises(new URLSearchParams("query=BARBELL"), entries),
    )
    expect(result.exercises).toEqual([entries[0]])
    expect(result.total).toBe(2)
    expect(result.source).toBe("owner-supplied")
  })
  it("keeps no-match results distinct from missing configuration", async () => {
    const result = await Effect.runPromise(
      searchExercises(new URLSearchParams("query=missing"), entries),
    )
    expect(result.count).toBe(0)
    expect(result.total).toBe(2)
  })
  it("bounds limits and supports listing the whole catalog", async () => {
    const result = await Effect.runPromise(searchExercises(new URLSearchParams("limit=0"), entries))
    expect(result.count).toBe(1)
    const all = await Effect.runPromise(searchExercises(new URLSearchParams(), entries))
    expect(all.exercises).toEqual(entries)
  })
})
