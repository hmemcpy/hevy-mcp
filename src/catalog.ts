import { Effect } from "effect"
import { ApiError } from "./errors"
import catalog from "./exercise-catalog.generated.json"

export interface ExerciseCatalogEntry {
  id: string
  title: string
  type: string
  equipmentCategory: string
  muscleGroup: string
  otherMuscles: string[]
}

export const searchExercises = Effect.fn("Catalog.search")(function* (
  params: URLSearchParams,
  exercises: ExerciseCatalogEntry[] = catalog,
) {
  if (exercises.length === 0) {
    return yield* new ApiError({
      status: 503,
      code: "catalog_not_configured",
      message:
        "Standard exercise search needs an owner-supplied catalog. See docs/catalog.md. Existing routines and custom exercises remain available.",
    })
  }
  const hasSearch = params.has("query") || params.has("limit")
  const query = (params.get("query") ?? "").trim().toLocaleLowerCase()
  const requestedLimit = Number(params.get("limit") ?? 25)
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : 25
  const matches = hasSearch
    ? exercises
        .filter(
          exercise => query === "" || JSON.stringify(exercise).toLocaleLowerCase().includes(query),
        )
        .slice(0, limit)
    : exercises
  return {
    source: "owner-supplied",
    count: matches.length,
    total: exercises.length,
    exercises: matches,
  }
})
