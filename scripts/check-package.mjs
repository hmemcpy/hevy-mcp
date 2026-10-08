import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const json = async path =>
  JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"))
const packageJson = await json("package.json")
const plugin = await json("packaging/codex/plugin.json")
const marketplace = await json("packaging/codex/marketplace.json")
const wrangler = await json("wrangler.jsonc")
assert.equal(packageJson.private, true, "This Worker is distributed as source, not an npm package")
assert.equal(plugin.name, packageJson.name)
assert.equal(plugin.version, packageJson.version)
assert.equal(plugin.license, "Apache-2.0")
assert.equal(plugin.mcpServers, "./.mcp.json")
assert.equal(marketplace.name, "hevy-self-hosted")
assert.equal(marketplace.plugins[0].source.path, "./plugins/hevy-mcp")
assert.deepEqual(marketplace.plugins[0].policy, {
  installation: "AVAILABLE",
  authentication: "ON_INSTALL",
})
assert.equal(wrangler.name, "hevy-mcp")
assert.equal(wrangler.account_id, undefined, "Do not package account-specific configuration")
assert.equal(wrangler.kv_namespaces[0].id, undefined, "Do not package a production OAuth namespace")
for (const name of [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "README.md",
  "docs/clients.md",
]) {
  assert.ok(
    (await readFile(new URL(`../${name}`, import.meta.url), "utf8")).trim(),
    `Missing ${name}`,
  )
}
const versionSource = await readFile(new URL("../src/version.ts", import.meta.url), "utf8")
assert.ok(
  versionSource.includes(`from "../package.json"`),
  "src/version.ts must read the version from package.json",
)
const mcpSource = await readFile(new URL("../src/mcp.ts", import.meta.url), "utf8")
assert.ok(
  mcpSource.includes("version: SERVER_VERSION"),
  "MCP initialization must use the shared server version from src/version.ts",
)
let files = []
try {
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
  if (gitRoot === root.replace(/\/$/, "")) {
    files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  }
} catch {
  // Downloaded source archives have no Git metadata. Static metadata checks
  // still apply; the archive was built from a checked committed tree in CI.
}
const forbidden = files.filter(
  path =>
    /(^|\/)(node_modules|captures|artifacts|\.wrangler|dist)\//.test(path) ||
    (/(^|\/)(\.env|\.dev\.vars)(\.|$)/.test(path) && !path.endsWith(".example")) ||
    path.endsWith(".local.json") ||
    path === "src/exercise-catalog.json" ||
    path.includes("exercise-catalog.generated") ||
    /\.(apk|apks|aab|har|flows|pcap|pcapng)$/.test(path),
)
assert.deepEqual(forbidden, [], "Private or generated files are tracked")
console.log(
  `Package metadata and generic deployment configuration passed${files.length ? "; tracked-file exclusions passed" : " (no Git index to inspect)"}`,
)
