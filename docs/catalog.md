# Supplying an exercise catalog

The earlier private integration bundled exercise metadata extracted from the
Hevy Android app. That dataset is not distributed or licensed by this project.
Without a catalog, `search_exercises` returns an MCP tool error with
`catalog_not_configured`; `GET /v1/exercises` returns that error with HTTP 503. Other tools, including custom exercise lookup, still
work. This is deliberate: an empty success would make it look like an exercise
didn't exist.

If you have a catalog you have permission to use, put it in
`exercise-catalog.local.json` at the repository root. The file is ignored by Git.
Each entry must have these fields (the ID below is illustrative, not a Hevy ID):

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
fields and duplicate IDs, and drops extra fields. Do not put credentials, profile
data, media URLs, or personal workout records in this file.

`bun run catalog:prepare` produces the ignored
`src/exercise-catalog.generated.json` consumed by the Worker. Install, tests, type
checks, local development, and deployment prepare it automatically. With no input
file, preparation writes an empty array and prints a warning. If a previous build contains exercises but the input file disappears, preparation
fails instead of silently erasing it. To disable standard search deliberately,
replace the local input with `[]` and rebuild.

The generated catalog is bundled into the deployed Worker and made available to
authorized clients. Deploy locally if you need that catalog included. The GitHub
Actions deployment does not have your ignored file, so deploying from there will
disable standard exercise search. Do not commit third-party data just to make CI
pick it up.

The public API exposes account-specific custom exercises and exercise
templates. This extraction keeps the catalog boundary: standard exercise
search uses the owner-supplied catalog, not an undocumented endpoint.
