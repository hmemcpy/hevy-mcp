import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { packagePlugin, validateEndpoint } from "../scripts/package-plugin.mjs"
import { writeArchive } from "../scripts/package-source.mjs"

const endpoint = "https://my-hevy.example/mcp"
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "hevy-plugin-test-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
const json = async path => JSON.parse(await readFile(path, "utf8"))

test("generates a concrete OAuth-capable remote MCP package and local marketplace", () =>
  fixture(async root => {
    const result = await packagePlugin({ url: endpoint, output: join(root, "output") })
    const manifest = await json(join(result.plugin, ".codex-plugin", "plugin.json"))
    const mcp = await json(join(result.plugin, ".mcp.json"))
    const marketplace = await json(join(result.target, ".agents", "plugins", "marketplace.json"))
    assert.equal(manifest.name, "hevy-mcp")
    assert.equal(manifest.mcpServers, "./.mcp.json")
    assert.deepEqual(mcp, { mcpServers: { hevy: { type: "http", url: endpoint } } })
    assert.equal(marketplace.plugins[0].source.path, "./plugins/hevy-mcp")
    assert.equal(marketplace.plugins[0].policy.authentication, "ON_INSTALL")
    assert.ok((await readFile(join(result.plugin, "LICENSE"), "utf8")).includes("Apache License"))
  }))

test("output cannot overwrite an existing package", () =>
  fixture(async root => {
    const output = join(root, "existing")
    await mkdir(output)
    await writeFile(join(output, "keep.txt"), "keep me")
    await assert.rejects(packagePlugin({ url: endpoint, output }), { code: "EEXIST" })
    assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "keep me")
  }))

test("output cannot follow a preexisting package-root symlink", () =>
  fixture(async root => {
    const outside = join(root, "outside")
    const output = join(root, "output")
    await mkdir(outside)
    await symlink(outside, output, "dir")
    await assert.rejects(packagePlugin({ url: endpoint, output }), { code: "EEXIST" })
    await assert.rejects(readFile(join(outside, "README.md")), { code: "ENOENT" })
  }))

for (const url of [
  "http://my-hevy.example/mcp",
  "https://token:secret@my-hevy.example/mcp",
  "https://my-hevy.example/mcp?token=secret",
  "https://my-hevy.example/mcp#secret",
  "https://my-hevy.example/",
  "https://my-hevy.example/mcp/",
  "https://localhost/mcp",
  "https://localhost./mcp",
  "https://host.localhost/mcp",
  "https://my-hevy.example/mcp\n",
  "https://127.0.0.1/mcp",
  "https://[::1]/mcp",
  "https://server.local/mcp",
  "not a URL",
]) {
  test(`rejects an unsafe or unsupported endpoint (${url.split(":")[0]})`, () => {
    assert.throws(() => validateEndpoint(url))
  })
}

test("CLI requires an explicit deployment URL and never echoes credential-bearing input", () => {
  const script = new URL("../scripts/package-plugin.mjs", import.meta.url).pathname
  assert.throws(() => execFileSync(process.execPath, [script], { stdio: "pipe" }))
  try {
    execFileSync(
      process.execPath,
      [script, "--url", "https://secret-user:secret-password@my-hevy.example/mcp"],
      { stdio: "pipe" },
    )
    assert.fail("Expected URL rejection")
  } catch (error) {
    assert.ok(!String(error.stderr).includes("secret-password"))
    assert.ok(!String(error.stderr).includes("secret-user"))
  }
})

test("source archives and checksums are written without overwriting files", () =>
  fixture(async root => {
    const directory = join(root, "archives")
    const path = await writeArchive(directory, "source.zip", Buffer.from("synthetic archive"))
    assert.equal(await readFile(path, "utf8"), "synthetic archive")
    assert.match(await readFile(`${path}.sha256`, "utf8"), /^[a-f0-9]{64} {2}source\.zip\n$/)
    await assert.rejects(writeArchive(directory, "source.zip", Buffer.from("replacement")))
    assert.equal(await readFile(path, "utf8"), "synthetic archive")
  }))

test("archive outputs never follow a preexisting symlink", () =>
  fixture(async root => {
    const directory = join(root, "archives")
    await mkdir(directory)
    const outside = join(root, "outside.txt")
    await writeFile(outside, "keep me")
    await symlink(outside, join(directory, "source.zip"))
    await assert.rejects(writeArchive(directory, "source.zip", Buffer.from("replacement")))
    assert.equal(await readFile(outside, "utf8"), "keep me")
  }))

test("checksum outputs and archive directories cannot be symlinks", () =>
  fixture(async root => {
    const directory = join(root, "archives")
    await mkdir(directory)
    const outside = join(root, "outside.txt")
    await writeFile(outside, "keep me")
    await symlink(outside, join(directory, "source.zip.sha256"))
    await assert.rejects(writeArchive(directory, "source.zip", Buffer.from("replacement")))
    await assert.rejects(readFile(join(directory, "source.zip")), { code: "ENOENT" })
    const linkedDirectory = join(root, "linked")
    await symlink(directory, linkedDirectory, "dir")
    await assert.rejects(writeArchive(linkedDirectory, "different.zip", Buffer.from("replacement")))
    assert.equal(await readFile(outside, "utf8"), "keep me")
  }))
