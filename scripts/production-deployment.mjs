import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const mode = process.argv[2]
assert.ok(
  [
    "inspect",
    "prepare",
    "confirm",
    "verify",
    "verify-rollback",
    "smoke",
    "prepare-rollback",
  ].includes(mode),
  "Unknown mode",
)
const worker = "workout-progress-api"
const origin = "https://workout-progress-api.hmemcpy.workers.dev"
const expectedKv = "b26ab34edc6242af84b0acfa3fb1fa34"
const directory = join(process.env.RUNNER_TEMP, "hevy-cutover")
const source = process.env.SOURCE_DIR ?? "."
const sourceSha = process.env.DEPLOY_SOURCE_SHA
assert.match(sourceSha, /^[a-f0-9]{40}$/)
await mkdir(directory, { recursive: true })

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID

async function api(suffix) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  assert.ok(token, "Cloudflare deployment credentials are missing")
  if (!accountId) {
    const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok)
      throw new Error(`Cloudflare account listing failed with HTTP ${response.status}`)
    const payload = await response.json()
    if (!payload.success || !Array.isArray(payload.result))
      throw new Error("Cloudflare account listing was not successful")
    assert.equal(
      payload.result.length,
      1,
      "The token can access multiple Cloudflare accounts; set the CLOUDFLARE_ACCOUNT_ID secret to pick one",
    )
    accountId = payload.result[0].id
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker}${suffix}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    },
  )
  if (!response.ok) throw new Error(`Cloudflare read failed with HTTP ${response.status}`)
  const payload = await response.json()
  if (!payload.success) throw new Error("Cloudflare read was not successful")
  return payload.result
}

async function snapshot() {
  const [{ deployments }, settings] = await Promise.all([api("/deployments"), api("/settings")])
  const deployment = deployments?.[0]
  assert.equal(deployment?.versions?.length, 1, "Expected a single active Worker version")
  assert.equal(deployment.versions[0].percentage, 100, "Refusing to replace a gradual deployment")
  const versionId = deployment.versions[0].version_id
  assert.match(versionId, /^[a-f0-9-]{36}$/)
  const version = await api(`/versions/${versionId}`)
  assert.equal(version.id, versionId, "Current version could not be verified for rollback")
  const bindings = settings.bindings
  assert.ok(Array.isArray(bindings), "No live Worker bindings returned")
  const kv = bindings.find(x => x.name === "OAUTH_KV")
  const durable = bindings.find(x => x.name === "SESSION_COORDINATOR")
  assert.equal(kv?.type, "kv_namespace")
  assert.equal(
    kv.namespace_id,
    expectedKv,
    "OAuth namespace differs from the verified production identity",
  )
  assert.equal(durable?.type, "durable_object_namespace")
  assert.equal(durable.class_name, "SessionCoordinator")
  assert.ok(durable.namespace_id, "Durable Object namespace ID is unavailable")
  assert.ok(
    !durable.script_name || durable.script_name === worker,
    "Unexpected external Durable Object binding",
  )
  const secretNames = bindings
    .filter(x => x.type === "secret_text")
    .map(x => x.name)
    .sort()
  for (const name of ["AUTOMATION_API_TOKEN", "HEVY_API_KEY"]) {
    assert.ok(secretNames.includes(name), `Required runtime secret ${name} is absent`)
  }
  return {
    worker,
    deploymentId: deployment.id,
    versionId,
    kvNamespaceId: kv.namespace_id,
    durableObjectNamespaceId: durable.namespace_id,
    durableObjectClass: durable.class_name,
    secretNames,
    versionMessage: version.annotations?.["workers/message"] ?? null,
    targetSourceSha: sourceSha,
    capturedAt: new Date().toISOString(),
  }
}

async function save(name, value) {
  await writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`)
}

async function config(state) {
  const config = JSON.parse(await readFile(join(source, "wrangler.jsonc"), "utf8"))
  assert.equal(config.durable_objects.bindings.length, 1)
  assert.equal(config.durable_objects.bindings[0].class_name, state.durableObjectClass)
  assert.equal(config.durable_objects.bindings[0].name, "SESSION_COORDINATOR")
  assert.equal(config.exports.SessionCoordinator.storage, "sqlite")
  assert.equal(config.durable_objects.bindings[0].script_name, undefined)
  config.name = worker
  config.kv_namespaces = [{ binding: "OAUTH_KV", id: state.kvNamespaceId }]
  await writeFile(
    join(source, "wrangler.production.local.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}

async function smoke() {
  const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(30000) })
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, "ok")
  const metadata = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(metadata.status, 200)
  const oauth = await metadata.json()
  assert.equal(new URL(oauth.authorization_endpoint).origin, origin)
  assert.equal(new URL(oauth.token_endpoint).origin, origin)
  const mcp = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "cutover-smoke", version: "1" },
      },
    }),
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(mcp.status, 401, "MCP must continue rejecting unauthenticated access")
  const rest = await fetch(`${origin}/v1/workouts`, { signal: AbortSignal.timeout(30000) })
  assert.equal(rest.status, 401, "REST must continue rejecting unauthenticated access")
  await save("smoke.json", {
    health: 200,
    discovery: 200,
    unauthenticatedMcp: 401,
    unauthenticatedRest: 401,
    checkedAt: new Date().toISOString(),
  })
  console.log("Health, OAuth discovery, and unauthenticated access checks passed")
}

if (mode === "smoke") {
  await smoke()
} else if (mode === "confirm") {
  const current = await snapshot()
  const pinned =
    process.env.EXPECTED_VERSION ??
    JSON.parse(await readFile(join(directory, "before.json"), "utf8")).versionId
  assert.equal(
    current.versionId,
    pinned,
    "Production version changed immediately before deployment",
  )
  console.log("Production version still matches the reviewed preflight")
} else if (mode === "verify" || mode === "verify-rollback") {
  const before = JSON.parse(await readFile(join(directory, "before.json"), "utf8"))
  const after = await snapshot()
  assert.equal(after.kvNamespaceId, before.kvNamespaceId)
  assert.equal(after.durableObjectNamespaceId, before.durableObjectNamespaceId)
  assert.deepEqual(after.secretNames, before.secretNames)
  if (mode === "verify") {
    assert.notEqual(after.versionId, before.versionId, "No new version was deployed")
    assert.equal(
      after.versionMessage,
      `hevy-mcp ${sourceSha}`,
      "Deployed version does not identify the deployed commit",
    )
  } else {
    assert.equal(
      after.versionId,
      process.env.ROLLBACK_VERSION,
      "Rollback did not activate the selected version",
    )
  }
  await save("after.json", after)
  console.log(`Verified active version ${after.versionId}; resource identity preserved`)
} else {
  const state = await snapshot()
  await save("before.json", state)
  await writeFile(
    join(directory, "ROLLBACK.txt"),
    `Previous Worker version: ${state.versionId}\nWorker: ${worker}\n\nDispatch the "Deploy production" workflow with operation=rollback and rollback_version=${state.versionId}.\n\nThis rolls back code, not data. Do not delete or recreate the Durable Object or OAuth KV namespace.\n`,
  )
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Hevy production preflight\n\nWorker: ${worker}\n\nCurrent version: ${state.versionId}\n\nDeployed source: ${sourceSha}\n\nOAuth KV and Durable Object identities verified. Runtime secret names verified; values were neither read nor changed.\n`,
    )
  }
  console.log(`Verified current production version ${state.versionId}; rollback record saved`)
  if (mode === "prepare") {
    if (process.env.EXPECTED_VERSION) {
      assert.equal(
        process.env.EXPECTED_VERSION,
        state.versionId,
        "Production version changed since inspection; inspect again before deploying",
      )
    }
    const catalogBytes = await readFile(join(source, "exercise-catalog.local.json"))
    const catalog = JSON.parse(catalogBytes)
    assert.ok(Array.isArray(catalog) && catalog.length > 0, "Expected the retained private catalog")
    await save("catalog.json", {
      count: catalog.length,
      sha256: createHash("sha256").update(catalogBytes).digest("hex"),
    })
    await config(state)
  }
  if (mode === "prepare-rollback") {
    const target = process.env.ROLLBACK_VERSION
    assert.match(target, /^[a-f0-9-]{36}$/)
    const version = await api(`/versions/${target}`)
    assert.equal(version.id, target, "Rollback target is unavailable")
    const targetBindings = version.resources?.bindings
    assert.ok(Array.isArray(targetBindings), "Rollback target binding metadata is unavailable")
    const targetKv = targetBindings.find(x => x.name === "OAUTH_KV")
    const targetDo = targetBindings.find(x => x.name === "SESSION_COORDINATOR")
    assert.equal(targetKv?.namespace_id, state.kvNamespaceId, "Rollback would change OAuth storage")
    assert.equal(
      targetDo?.namespace_id,
      state.durableObjectNamespaceId,
      "Rollback would change Durable Object storage",
    )
    assert.equal(targetDo.class_name, state.durableObjectClass)
    assert.deepEqual(
      targetBindings
        .filter(x => x.type === "secret_text")
        .map(x => x.name)
        .sort(),
      state.secretNames,
      "Rollback secret bindings differ",
    )
    await config(state)
  }
}
