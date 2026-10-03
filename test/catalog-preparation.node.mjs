import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const entry = {
  id: "synthetic-example",
  title: "Example",
  type: "reps_only",
  equipmentCategory: "none",
  muscleGroup: "chest",
  otherMuscles: [],
}
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "hevy-catalog-test-"))
  mkdirSync(join(root, "scripts"))
  mkdirSync(join(root, "src"))
  copyFileSync(
    new URL("../scripts/prepare-catalog.mjs", import.meta.url),
    join(root, "scripts/prepare-catalog.mjs"),
  )
  try {
    run(root, () =>
      execFileSync(process.execPath, [join(root, "scripts/prepare-catalog.mjs")], {
        stdio: "pipe",
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
function result(root) {
  return JSON.parse(readFileSync(join(root, "src/exercise-catalog.generated.json"), "utf8"))
}

test("fresh checkout prepares an empty catalog", () =>
  fixture((root, prepare) => {
    prepare()
    assert.deepEqual(result(root), [])
  }))
test("preparation strips unrelated data", () =>
  fixture((root, prepare) => {
    writeFileSync(
      join(root, "exercise-catalog.local.json"),
      JSON.stringify([
        { ...entry, accessToken: "synthetic-secret", mediaUrl: "https://example.test" },
      ]),
    )
    prepare()
    assert.deepEqual(result(root), [entry])
  }))
test("missing input does not erase a previously generated catalog", () =>
  fixture((root, prepare) => {
    const input = join(root, "exercise-catalog.local.json")
    writeFileSync(input, JSON.stringify([entry]))
    prepare()
    rmSync(input)
    assert.throws(prepare)
    assert.deepEqual(result(root), [entry])
  }))
for (const [name, input] of [
  ["invalid JSON", "{"],
  ["non-array", "{}"],
  ["missing fields", "[{}]"],
  ["duplicate IDs", JSON.stringify([entry, entry])],
]) {
  test(`rejects ${name}`, () =>
    fixture((root, prepare) => {
      writeFileSync(join(root, "exercise-catalog.local.json"), input)
      assert.throws(prepare)
    }))
}

test("lint excludes private input and generated catalog data", () => {
  const config = JSON.parse(readFileSync(new URL("../biome.json", import.meta.url), "utf8"))
  assert.ok(config.files.includes.includes("!**/*.local.json"))
  assert.ok(config.files.includes.includes("!src/exercise-catalog.generated.json"))
})
