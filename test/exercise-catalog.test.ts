import { Effect } from "effect"
import { beforeEach, describe, expect, it } from "vitest"
import {
  type ExerciseCatalogEntry,
  mergeExerciseSources,
  resetTemplateCacheForTests,
  searchExercises,
  searchExercisesWithTemplates,
} from "../src/catalog"
import { ApiError } from "../src/errors"
import { ExerciseTemplate } from "../src/types"

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

function template(input: Partial<{ id: string; title: string; is_custom: boolean }> = {}) {
  return ExerciseTemplate.make({
    id: input.id ?? "hevy-a",
    title: input.title ?? "Hevy A",
    ...(input.is_custom === undefined ? {} : { is_custom: input.is_custom }),
  })
}

describe("merged exercise search", () => {
  beforeEach(() => {
    resetTemplateCacheForTests()
  })

  it("merges Hevy templates with the owner catalog and lets the owner entry win on collisions", () => {
    const owner: ExerciseCatalogEntry[] = [
      {
        id: "hevy-a",
        title: "Owner A (annotated)",
        type: "weight_reps",
        equipmentCategory: "machine",
        muscleGroup: "chest",
        otherMuscles: [],
      },
      {
        id: "owner-only",
        title: "Owner Only",
        type: "reps_only",
        equipmentCategory: "none",
        muscleGroup: "abdominals",
        otherMuscles: [],
      },
    ]
    const merged = mergeExerciseSources(owner, [
      template(),
      template({ id: "hevy-b", title: "Hevy B", is_custom: true }),
    ])
    expect(merged).toHaveLength(3)
    expect(merged.find(entry => entry.id === "hevy-a")).toMatchObject({
      title: "Owner A (annotated)",
      source: "owner-supplied",
      isCustom: false,
    })
    expect(merged.find(entry => entry.id === "hevy-b")).toMatchObject({
      source: "hevy",
      isCustom: true,
    })
    expect(merged.find(entry => entry.id === "owner-only")?.source).toBe("owner-supplied")
  })

  it("caches a successful template fetch for the TTL and refetches afterwards", async () => {
    let fetches = 0
    const fetchTemplates = Effect.suspend(() => {
      fetches += 1
      return Effect.succeed([template({ id: "hevy-c" })])
    })
    let clock = 1_000
    const now = () => clock
    const first = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams("query=hevy"), fetchTemplates, [], now),
    )
    expect(first.sources.hevyTemplates).toBe(1)
    const second = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), fetchTemplates, [], now),
    )
    expect(second.sources.hevyTemplates).toBe(1)
    expect(fetches).toBe(1)
    clock += 5 * 60_000 + 1
    await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), fetchTemplates, [], now),
    )
    expect(fetches).toBe(2)
  })

  it("degrades to the owner catalog when Hevy fails and there is something to fall back to", async () => {
    const owner: ExerciseCatalogEntry[] = [
      {
        id: "owner-only",
        title: "Owner Only",
        type: "reps_only",
        equipmentCategory: "none",
        muscleGroup: "abdominals",
        otherMuscles: [],
      },
    ]
    const failing = new ApiError({ status: 502, code: "hevy_api_error", message: "upstream down" })
    const result = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), Effect.fail(failing), owner, () => 1_000),
    )
    expect(result.degraded?.hevySearch).toContain("hevy_api_error")
    expect(result.source).toBe("owner-supplied")
    expect(result.exercises).toHaveLength(1)
  })

  it("prefers the stale cache over nothing when a refresh fails", async () => {
    let clock = 1_000
    const failing = new ApiError({ status: 502, code: "hevy_api_error", message: "upstream down" })
    let fetchTemplates: Effect.Effect<
      ReadonlyArray<ReturnType<typeof template>>,
      ApiError
    > = Effect.succeed([template({ id: "hevy-stale" })])
    const owner: ExerciseCatalogEntry[] = []
    const first = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), fetchTemplates, owner, () => clock),
    )
    expect(first.sources.hevyTemplates).toBe(1)
    clock += 5 * 60_000 + 1
    fetchTemplates = Effect.fail(failing)
    const second = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), fetchTemplates, owner, () => clock),
    )
    expect(second.degraded?.hevySearch).toContain("stale")
    expect(second.sources.hevyTemplates).toBe(1)
  })

  it("surfaces the upstream failure when no fallback exists", async () => {
    const failing = new ApiError({ status: 502, code: "hevy_api_error", message: "upstream down" })
    const error = await Effect.runPromise(
      searchExercisesWithTemplates(
        new URLSearchParams(),
        Effect.fail(failing),
        [],
        () => 1_000,
      ).pipe(Effect.flip),
    )
    expect(error).toBe(failing)
  })

  it("reports catalog_not_configured only when both sources resolve empty", async () => {
    const error = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), Effect.succeed([]), [], () => 1_000).pipe(
        Effect.flip,
      ),
    )
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe("catalog_not_configured")
  })

  it("does not match queries against source metadata", async () => {
    const result = await Effect.runPromise(
      searchExercisesWithTemplates(
        new URLSearchParams("query=hevy"),
        Effect.succeed([template({ id: "x1", title: "Bench Press" })]),
        [],
        () => 1_000,
      ),
    )
    expect(result.count).toBe(0)
  })
})

describe("merged exercise search hardening", () => {
  beforeEach(() => {
    resetTemplateCacheForTests()
  })

  it("does not treat an empty stale cache as a fallback after a refresh fails", async () => {
    let clock = 1_000
    const failing = new ApiError({ status: 502, code: "hevy_api_error", message: "upstream down" })
    const first = await Effect.runPromise(
      searchExercisesWithTemplates(new URLSearchParams(), Effect.succeed([]), [], () => clock).pipe(
        Effect.flip,
      ),
    )
    expect((first as ApiError).code).toBe("catalog_not_configured")
    clock += 5 * 60_000 + 1
    const second = await Effect.runPromise(
      searchExercisesWithTemplates(
        new URLSearchParams(),
        Effect.fail(failing),
        [],
        () => clock,
      ).pipe(Effect.flip),
    )
    expect(second).toBe(failing)
  })

  it("preserves the Hevy custom flag when an owner entry overlays it", () => {
    const owner: ExerciseCatalogEntry[] = [
      {
        id: "custom-9",
        title: "Annotated custom move",
        type: "weight_reps",
        equipmentCategory: "machine",
        muscleGroup: "chest",
        otherMuscles: [],
      },
    ]
    const merged = mergeExerciseSources(owner, [
      template({ id: "custom-9", title: "Custom Move", is_custom: true }),
    ])
    expect(merged[0]).toMatchObject({
      title: "Annotated custom move",
      source: "owner-supplied",
      isCustom: true,
    })
  })
})
