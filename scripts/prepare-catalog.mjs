import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const input = new URL("exercise-catalog.local.json", root)
const output = new URL("src/exercise-catalog.generated.json", root)
let catalog = []
try {
  catalog = JSON.parse(await readFile(input, "utf8"))
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error(`Cannot read ${fileURLToPath(input)}`, { cause: error })
  try {
    const previous = JSON.parse(await readFile(output, "utf8"))
    if (Array.isArray(previous) && previous.length > 0) {
      throw new Error(
        "Catalog input is missing but the previous build contains exercises. Restore exercise-catalog.local.json, or explicitly set it to [] to remove the owner overlay.",
      )
    }
  } catch (previousError) {
    if (previousError.code !== "ENOENT") throw previousError
  }
}

// Allowlist fields so importing a larger catalog export cannot bundle account
// data, media URLs, or credentials into a public Worker deployment.
const fields = ["id", "title", "type", "equipmentCategory", "muscleGroup"]
if (!Array.isArray(catalog)) throw new Error("Exercise catalog must be an array")
const ids = new Set()
const clean = catalog.map((exercise, index) => {
  if (exercise === null || typeof exercise !== "object")
    throw new Error(`Invalid exercise ${index}`)
  for (const field of fields) {
    if (typeof exercise[field] !== "string" || exercise[field].trim() === "") {
      throw new Error(`Exercise ${index} needs a non-empty ${field}`)
    }
  }
  if (
    !Array.isArray(exercise.otherMuscles) ||
    !exercise.otherMuscles.every(x => typeof x === "string")
  ) {
    throw new Error(`Exercise ${index} needs an otherMuscles string array`)
  }
  if (ids.has(exercise.id)) throw new Error(`Duplicate exercise ID at index ${index}`)
  ids.add(exercise.id)
  return {
    ...Object.fromEntries(fields.map(field => [field, exercise[field]])),
    otherMuscles: exercise.otherMuscles,
  }
})
await writeFile(output, `${JSON.stringify(clean, null, 2)}\n`)
console.log(
  `Prepared ${clean.length} exercises${clean.length === 0 ? " (no owner overlay; standard search falls back to Hevy templates, see docs/catalog.md)" : " (owner overlay; merged with Hevy templates, see docs/catalog.md)"}`,
)
