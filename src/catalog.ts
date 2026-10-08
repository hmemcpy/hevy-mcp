import { Effect } from "effect"
import { ApiError, type HevyApiError } from "./errors"
import catalog from "./exercise-catalog.generated.json"
import type { ExerciseTemplate } from "./types"

// Exercise search merges two sources: the account's own exercise templates
// from Hevy's public API and an optional owner-supplied catalog bundled at
// build time (docs/catalog.md). Hevy templates are fetched through all pages
// once per cache lifetime; a module-level cache serves the coordinator's
// isolate, so one account's searches share it. The cache only stores complete
// successful fetches, and a failed refresh falls back to the stale entries
// (or the owner catalog alone) instead of disabling search. Custom exercises
// created moments ago may be missing until the cache expires.

export interface ExerciseCatalogEntry {
  id: string
  title: string
  type: string
  equipmentCategory: string
  muscleGroup: string
  otherMuscles: ReadonlyArray<string>
}

export interface ExerciseSearchEntry extends ExerciseCatalogEntry {
  source: "hevy" | "owner-supplied"
  isCustom: boolean
}

export interface ExerciseSearchResult {
  source: string
  sources: { hevyTemplates: number; ownerCatalog: number }
  count: number
  total: number
  exercises: ReadonlyArray<ExerciseSearchEntry>
  degraded?: { hevySearch: string }
}

export const TEMPLATE_CACHE_TTL_MS = 5 * 60_000

interface TemplateCache {
  entries: ReadonlyArray<ExerciseTemplate>
  fetchedAt: number
}

let templateCache: TemplateCache | undefined

export function resetTemplateCacheForTests(): void {
  templateCache = undefined
}

function readSearchParams(params: URLSearchParams) {
  const hasSearch = params.has("query") || params.has("limit")
  const query = (params.get("query") ?? "").trim().toLocaleLowerCase()
  const requestedLimit = Number(params.get("limit") ?? 25)
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : 25
  return { hasSearch, query, limit }
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
  const { hasSearch, query, limit } = readSearchParams(params)
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

function toSearchEntry(template: ExerciseTemplate): ExerciseSearchEntry {
  return {
    id: template.id,
    title: template.title,
    type: template.exercise_type ?? "unknown",
    equipmentCategory: template.equipment_category ?? "",
    muscleGroup: template.muscle_group ?? "",
    otherMuscles: template.other_muscles ?? [],
    source: "hevy",
    isCustom: template.is_custom ?? false,
  }
}

// Owner entries win on ID collisions: they can carry vetted metadata beyond
// what Hevy's template listing returns. The Hevy-side custom flag survives
// the overlay because owner entries cannot express it.
export function mergeExerciseSources(
  owner: ReadonlyArray<ExerciseCatalogEntry>,
  hevy: ReadonlyArray<ExerciseTemplate>,
): ExerciseSearchEntry[] {
  const merged = new Map<string, ExerciseSearchEntry>()
  for (const template of hevy) {
    if (!merged.has(template.id)) merged.set(template.id, toSearchEntry(template))
  }
  for (const entry of owner) {
    const existing = merged.get(entry.id)
    merged.set(entry.id, {
      ...entry,
      source: "owner-supplied",
      isCustom: existing?.isCustom ?? false,
    })
  }
  return Array.from(merged.values())
}

function searchMerged(
  params: URLSearchParams,
  entries: ReadonlyArray<ExerciseSearchEntry>,
): { matches: ReadonlyArray<ExerciseSearchEntry>; hasSearch: boolean } {
  const { hasSearch, query, limit } = readSearchParams(params)
  // Match against the owner-catalog field set only; metadata about the source
  // must not make every exercise match queries like "hevy".
  const matches = hasSearch
    ? entries
        .filter(entry => {
          if (query === "") return true
          const fields = JSON.stringify([
            entry.id,
            entry.title,
            entry.type,
            entry.equipmentCategory,
            entry.muscleGroup,
            entry.otherMuscles,
          ])
          return fields.toLocaleLowerCase().includes(query)
        })
        .slice(0, limit)
    : entries
  return { matches, hasSearch }
}

export const searchExercisesWithTemplates = Effect.fn("Catalog.searchWithTemplates")(function* (
  params: URLSearchParams,
  fetchTemplates: Effect.Effect<ReadonlyArray<ExerciseTemplate>, ApiError | HevyApiError>,
  owner: ReadonlyArray<ExerciseCatalogEntry> = catalog,
  now: () => number = Date.now,
) {
  let hevy: ReadonlyArray<ExerciseTemplate>
  let degraded: string | undefined
  const cached = templateCache
  if (cached !== undefined && now() - cached.fetchedAt < TEMPLATE_CACHE_TTL_MS) {
    hevy = cached.entries
  } else {
    const outcome = yield* fetchTemplates.pipe(
      Effect.match({
        onFailure: (error): { ok: false; error: ApiError | HevyApiError; reason: string } => ({
          ok: false,
          error,
          reason:
            error._tag === "ApiError"
              ? error.code
              : `hevy_api_error_${error.apiStatus}${error.apiCode === undefined ? "" : `_${error.apiCode}`}`,
        }),
        onSuccess: (entries): { ok: true; entries: ReadonlyArray<ExerciseTemplate> } => ({
          ok: true,
          entries,
        }),
      }),
    )
    if (outcome.ok) {
      hevy = outcome.entries
      templateCache = { entries: hevy, fetchedAt: now() }
    } else if (owner.length > 0 || (cached !== undefined && cached.entries.length > 0)) {
      degraded =
        cached === undefined
          ? `hevy_templates_unavailable:${outcome.reason}`
          : `hevy_templates_stale:${outcome.reason}`
      hevy = cached === undefined ? [] : cached.entries
    } else {
      // No fallback is usable; surface the upstream failure instead of
      // reporting the search as unconfigured.
      return yield* outcome.error
    }
  }

  const entries = mergeExerciseSources(owner, hevy)
  if (entries.length === 0 && degraded === undefined) {
    return yield* new ApiError({
      status: 503,
      code: "catalog_not_configured",
      message:
        "Standard exercise search found no sources: Hevy returned no exercise templates and no owner catalog is bundled. See docs/catalog.md.",
    })
  }
  const { matches } = searchMerged(params, entries)
  const result: ExerciseSearchResult = {
    source:
      hevy.length === 0 ? "owner-supplied" : owner.length === 0 ? "hevy" : "hevy+owner-supplied",
    sources: { hevyTemplates: hevy.length, ownerCatalog: owner.length },
    count: matches.length,
    total: entries.length,
    exercises: matches,
  }
  return degraded === undefined ? result : { ...result, degraded: { hevySearch: degraded } }
})
