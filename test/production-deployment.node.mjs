import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("../scripts/production-deployment.mjs", import.meta.url))
const beforeVersion = "11111111-1111-1111-1111-111111111111"
const afterVersion = "22222222-2222-2222-2222-222222222222"
const sha = "a".repeat(40)
const preload = `
const before = '${beforeVersion}'
const after = '${afterVersion}'
globalThis.fetch = async (url) => {
  const u = new URL(url)
  if (u.host.endsWith('workers.dev')) {
    if (u.pathname === '/health') return Response.json({status:'ok'})
    if (u.pathname.startsWith('/.well-known/')) return Response.json({authorization_endpoint:u.origin+'/authorize',token_endpoint:u.origin+'/oauth/token'})
    return new Response('',{status:401})
  }
  if (u.host !== 'api.cloudflare.com') throw new Error('Unexpected external request')
  const id = process.env.TEST_AFTER ? after : before
  let result
  if (u.pathname.endsWith('/accounts')) result=process.env.TEST_MANY_ACCOUNTS?[{id:'one'},{id:'two'}]:[{id:'synthetic-account'}]
  else if (u.pathname.endsWith('/deployments')) result={deployments:[{id:'deployment',versions:[{version_id:id,percentage:100}]}]}
  else if (u.pathname.endsWith('/settings')) result={bindings:[
    {name:'OAUTH_KV',type:'kv_namespace',namespace_id:process.env.TEST_BAD_KV?'wrong':'b26ab34edc6242af84b0acfa3fb1fa34'},
    {name:'SESSION_COORDINATOR',type:'durable_object_namespace',namespace_id:process.env.TEST_BAD_DO?'wrong':'original-do',class_name:'SessionCoordinator'},
    ...['AUTOMATION_API_TOKEN','HEVY_API_KEY'].map(name=>({name,type:'secret_text'}))]}
  else if (u.pathname.includes('/versions/')) result={id:u.pathname.split('/').at(-1),annotations:{'workers/message':process.env.TEST_AFTER?'hevy-mcp '+process.env.DEPLOY_SOURCE_SHA:'original'},resources:{bindings:[
    {name:'OAUTH_KV',type:'kv_namespace',namespace_id:process.env.TEST_BAD_ROLLBACK?'wrong':'b26ab34edc6242af84b0acfa3fb1fa34'},
    {name:'SESSION_COORDINATOR',type:'durable_object_namespace',namespace_id:'original-do',class_name:'SessionCoordinator'},
    ...['AUTOMATION_API_TOKEN','HEVY_API_KEY'].map(name=>({name,type:'secret_text'}))]}}
  else throw new Error('Unexpected API endpoint')
  return Response.json({success:true,result})
}
`
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "hevy-deploy-test-"))
  const source = join(root, "source")
  mkdirSync(source)
  writeFileSync(join(root, "preload.mjs"), preload)
  writeFileSync(
    join(source, "wrangler.jsonc"),
    JSON.stringify({
      name: "hevy-mcp",
      durable_objects: {
        bindings: [{ name: "SESSION_COORDINATOR", class_name: "SessionCoordinator" }],
      },
      exports: { SessionCoordinator: { storage: "sqlite" } },
    }),
  )
  writeFileSync(
    join(source, "exercise-catalog.local.json"),
    JSON.stringify(Array.from({ length: 451 }, () => ({ synthetic: true }))),
  )
  const execute = (mode, extra = {}) =>
    execFileSync(process.execPath, ["--import", join(root, "preload.mjs"), script, mode], {
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        SOURCE_DIR: source,
        DEPLOY_SOURCE_SHA: sha,
        CLOUDFLARE_ACCOUNT_ID: "synthetic-account",
        CLOUDFLARE_API_TOKEN: "synthetic-token",
        EXPECTED_VERSION: beforeVersion,
        ...extra,
      },
      stdio: "pipe",
    })
  try {
    run(root, source, execute)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("inspection records rollback metadata without contacting production", () =>
  fixture((root, _, execute) => {
    execute("inspect")
    const content = readFileSync(join(root, "hevy-cutover/before.json"), "utf8")
    assert.equal(JSON.parse(content).versionId, beforeVersion)
    assert.ok(!content.includes("synthetic-token"))
    assert.ok(readFileSync(join(root, "hevy-cutover/ROLLBACK.txt"), "utf8").includes(beforeVersion))
  }))

test("inspection refuses an ambiguous account when no account id is pinned", () =>
  fixture((_, __, execute) =>
    assert.throws(() =>
      execute("inspect", { TEST_MANY_ACCOUNTS: "1", CLOUDFLARE_ACCOUNT_ID: undefined }),
    ),
  ))

test("preparation preserves existing Worker and OAuth namespace", () =>
  fixture((_, source, execute) => {
    execute("prepare")
    const config = JSON.parse(readFileSync(join(source, "wrangler.production.local.json"), "utf8"))
    assert.equal(config.name, "workout-progress-api")
    assert.equal(config.kv_namespaces[0].id, "b26ab34edc6242af84b0acfa3fb1fa34")
  }))

test("preparation refuses version drift", () =>
  fixture((_, __, execute) =>
    assert.throws(() => execute("prepare", { EXPECTED_VERSION: afterVersion })),
  ))

test("inspection refuses an unexpected OAuth namespace", () =>
  fixture((_, __, execute) => assert.throws(() => execute("inspect", { TEST_BAD_KV: "1" }))))

test("verification matches deployed source and preserved state identity", () =>
  fixture((root, _, execute) => {
    execute("prepare")
    execute("verify", { TEST_AFTER: "1" })
    assert.equal(
      JSON.parse(readFileSync(join(root, "hevy-cutover/after.json"), "utf8")).versionId,
      afterVersion,
    )
  }))

test("verification rejects changed Durable Object namespace", () =>
  fixture((_, __, execute) => {
    execute("prepare")
    assert.throws(() => execute("verify", { TEST_AFTER: "1", TEST_BAD_DO: "1" }))
  }))

test("public smoke verifies auth boundaries without signing in", () =>
  fixture((root, _, execute) => {
    execute("smoke")
    assert.equal(
      JSON.parse(readFileSync(join(root, "hevy-cutover/smoke.json"), "utf8")).unauthenticatedMcp,
      401,
    )
  }))

test("last-minute version check rejects concurrent deployment", () =>
  fixture((_, __, execute) => {
    execute("prepare")
    assert.throws(() => execute("confirm", { TEST_AFTER: "1", EXPECTED_VERSION: beforeVersion }))
  }))

test("rollback verification checks exact selected version and state identity", () =>
  fixture((root, _, execute) => {
    execute("prepare-rollback", { ROLLBACK_VERSION: afterVersion })
    execute("verify-rollback", { TEST_AFTER: "1", ROLLBACK_VERSION: afterVersion })
    assert.equal(
      JSON.parse(readFileSync(join(root, "hevy-cutover/after.json"), "utf8")).versionId,
      afterVersion,
    )
  }))

test("rollback preparation rejects a target with different state bindings", () =>
  fixture((_, __, execute) =>
    assert.throws(() =>
      execute("prepare-rollback", { ROLLBACK_VERSION: afterVersion, TEST_BAD_ROLLBACK: "1" }),
    ),
  ))
