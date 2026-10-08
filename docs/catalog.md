# Supplying an exercise catalog (optional enrichment)

Standard exercise search reads your account's exercise templates from Hevy's
public API, so it works with no extra setup. The listing is fetched through
all pages at Hevy's documented maximum page size and cached in the Worker's
coordinator for five minutes; a failed refresh falls back to the cached
entries or your bundled catalog rather than disabling search. Expect a
brand-new custom exercise to be missing until the cache expires.

The optional owner-supplied catalog exists for richer, vetted metadata.
Hevy's template listing can include equipment and muscle-group details, but
you may prefer a curated dataset; bundled entries take precedence over
Hevy's on ID collisions and fill fields Hevy omits. Both sources are
searched together and each result reports where it came from (`source`),
plus `isCustom` for Hevy custom templates.

`search_exercises` returns `catalog_not_configured` only when Hevy returns
no templates **and** no catalog is bundled. If Hevy itself fails and no
fallback is usable, the upstream error is returned instead.

To bundle a catalog, put it in `exercise-catalog.local.json` at the
repository root. The file is ignored by Git. Each entry must have these
fields (the ID below is illustrative, not a Hevy ID):

```json
[
  {
    "id": "YOUR-EXERCISE-ID",
    "title": "Example exercise",
    "type": "weight_reps",
    "equipmentCategory": "barbell",
    "muscleGroup": "chest",
    "otherMuscles": ["triceps"]
  }
]
```

Use real Hevy template IDs for real workouts. Preparation rejects missing
fields and duplicate IDs, and drops extra fields. Do not put credentials,
profile data, media URLs, or personal workout records in this file.

`bun run catalog:prepare` produces the ignored
`src/exercise-catalog.generated.json` consumed by the Worker. Install, tests,
type checks, local development, and deployment prepare it automatically. With
no input file, preparation writes an empty array and prints a warning. If a
previous build contains exercises but the input file disappears, preparation
fails instead of silently erasing it. To bundle an empty catalog
deliberately (search from Hevy only), replace the local input with `[]` and
rebuild.
