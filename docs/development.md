# Development guide

Everything technical that does not belong in the README: running the server
locally, the repository layout, and the full list of behavioral limits.
Deployment is covered in [the deployment guide](deployment.md), connecting
clients in [the ChatGPT guide](chatgpt.md) and [the clients guide](clients.md).

## Run it locally

Install [Bun](https://bun.sh/) 1.3.14 and Node.js 22 or newer, then:

```sh
git clone https://github.com/hmemcpy/hevy-mcp.git
cd hevy-mcp
bun install --frozen-lockfile
bun run check
cp .dev.vars.example .dev.vars
# Fill in your API key and automation token. Don't paste them into chat.
bun run dev
```

`.dev.vars` holds three values:

- `AUTOMATION_API_TOKEN` — any long random token; approves OAuth connections
  and authenticates REST calls under `/v1` in local development.
- `HEVY_API_KEY` — your public developer API key from
  [hevy.com/settings?developer](https://hevy.com/settings?developer)
  (requires Hevy Pro). This is the server's only Hevy integration.
- `HEVY_WEBHOOK_TOKEN` — optional; enables the new-workout webhook receiver
  at `/webhook/hevy/<token>`.

## Working on it

```sh
bun run test             # Vitest + node test files
bun run typecheck        # TypeScript
bun run lint             # Biome
bun run deploy:dry-run   # Build the Worker without deploying it
bun run check            # all of the above + package metadata checks
```

Tests use synthetic data; they never contact Hevy or deploy anything. GitHub
Actions runs checks on pushes and pull requests. Deployment is a separate,
manual step — pushing to this repository does not deploy a Worker.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | REST routes and the single-owner Durable Object |
| `src/mcp.ts` | MCP tools and prompts mapped onto those routes |
| `src/public-api.ts` | The only Hevy API adapter |
| `src/api.ts` | Shared service definitions and the coordinator layer |
| `src/workout-lifecycle.ts` | Hosted draft sessions, finish previews |
| `src/workout-edit.ts`, `src/workout-insert.ts` | Saved-workout corrections and insertions |
| `src/progression.ts` | Routine target previews |
| `src/body-measurement.ts` | Body-measurement save previews |
| `src/training-summary.ts` | Rolling training aggregation |
| `src/catalog.ts` | Merged exercise search (Hevy templates + optional owner catalog) |
| `src/webhook.ts` | Webhook event store |
| `src/version.ts` | Single source for the version reported by `/health` and MCP |

Effect handles orchestration and schema validation. The exercise catalog
build input is prepared by `scripts/prepare-catalog.mjs`; see
[the catalog guide](catalog.md).

## Limits

- A Durable Object stores the active workout draft, webhook events, and OAuth
  connection approvals. OAuth grants are stored separately in Workers KV.
- Rotating the automation token does not revoke existing OAuth grants.
- `finish_workout_session` saves one completed workout. Check the result
  before retrying a failed write.
- Body-measurement saves are best-effort concurrency-safe: Hevy reports no
  updated timestamp, so the server re-reads the date and compares the full
  before-state before writing. Another client writing between that check and
  the save can still be overwritten.
- Exercise-template search caches Hevy's template listing for five minutes;
  a brand-new custom exercise may be missing until the cache expires.
- Only the final set in a completed exercise can be deleted, and an exercise
  with a single set cannot lose it.
- New drafts default to public workouts and public biometrics. Set
  `isPrivate: true` and `isBiometricsPublic: false` if you don't want that.

Write behavior is limited by Hevy's public API: per-set completion times,
rest timers, volume-doubling flags, and routine linkage are lost; RPE must be
one of 6, 7, 7.5, 8, 8.5, 9, 9.5, 10. See
[Hevy API capabilities](deployment.md#hevy-api-capabilities) for the full
list, and [security and data handling](../SECURITY.md) before giving a
client access.
