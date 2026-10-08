# hevy-mcp

This server is built for one thing first: **interactive workout session
management**. You train, ChatGPT logs your sets into a hosted draft, and the
workout reaches Hevy only after you approve an exact preview. Around that
core it also offers useful supporting tools: safe corrections to saved
workouts, routine progression previews, a training summary, exercise search,
body-measurement tracking, and a webhook feed.

This is a self-hosted MCP server on Cloudflare Workers that connects ChatGPT
to your Hevy account with Hevy's official developer API. One deployment
serves one Hevy account. Anyone you authorize gets access to that account,
including workout history, profile, and body measurements.

## What it does

The server exposes 29 MCP tools and 2 prompts:

- **Run a workout session.** Keep one active draft in the server: start it
  from a routine or empty, add exercises and sets as you go, preview the
  finished workout, then save it to Hevy. Until you save, the draft only
  exists in this server — it does not appear in the Hevy app. The finish
  flow follows the approval-first contract in [WORKOUT_UX.md](WORKOUT_UX.md):
  preview, explicit approval, save, grounded confirmation.
- **Read your training data.** Recent workouts, a single workout, workout
  count, routines, routine folders, exercise history for any template, your
  account, and body measurements.
- **See the big picture.** `get_training_summary` aggregates 1–12 weeks:
  workout count, sets, volume, per-workout rows, top exercises, and the
  body-weight trend.
- **Find exercises.** `search_exercises` merges your account's Hevy exercise
  templates (standard and custom) with an optional owner-supplied catalog
  you can bundle for richer metadata — see below. No catalog file is
  required for standard search anymore.
- **Change saved data safely.** Adjust routine targets, correct a saved
  workout, insert a missed exercise, save a body measurement for a date.
  Every write first produces a preview, then applies exactly that preview,
  with revision checks so an outdated preview cannot overwrite newer data.
- **Get notifications.** An endpoint receives Hevy's new-workout webhook so
  external tools can react the moment a workout is saved.
- **Know what you're talking to.** `get_server_info` returns the server
  name, version, and feature list; `GET /health` returns the same version,
  so you can confirm a deployment:

  ```sh
  curl https://YOUR-WORKER.workers.dev/health
  # {"status":"ok","name":"hevy-mcp","version":"0.2.0"}
  ```

The two prompts, `start_workout_from_routine` and `analyze_workout_progress`,
carry the session UX and progress-analysis flows for any client that
supports MCP prompts.

Deleting a saved workout is the one thing the server cannot do yet: Hevy's
public API has no delete endpoint. The two delete tools exist and report
this when called; we've asked Hevy to add the endpoint
([proposal](docs/delete-workout-proposal.md)).

Writes lose some detail the Hevy app itself keeps: per-set completion times,
rest timers, volume-doubling flags, and routine linkage. RPE must be one of
6, 7, 7.5, 8, 8.5, 9, 9.5, 10. See
[deployment docs](docs/deployment.md#hevy-api-capabilities) for the full list.

## What you need

- A Hevy account with **Hevy Pro**, and a developer API key from
  [hevy.com/settings?developer](https://hevy.com/settings?developer).
- A Cloudflare account with Workers, KV, and Durable Objects.
- A ChatGPT plan that supports custom MCP apps.

## Run it

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

For a hosted instance, follow [the Cloudflare setup](docs/deployment.md),
then [connect ChatGPT](docs/chatgpt.md) to `https://YOUR-WORKER.workers.dev/mcp`
using OAuth. You approve the connection with your automation token; ChatGPT
never sees your Hevy API key.

For Codex, [generate a plugin](docs/clients.md#codex-plugin) with your own
Worker URL.

Standard exercise search reads your account's exercise templates from
Hevy's API. An owner-supplied catalog is now optional enrichment: bundle one
if you maintain a vetted dataset whose equipment and muscle-group metadata
you prefer over Hevy's. [Catalog setup](docs/catalog.md) explains the format.

## Working on it

```sh
bun run test             # Vitest
bun run typecheck        # TypeScript
bun run lint             # Biome
bun run deploy:dry-run   # Build the Worker without deploying it
```

`src/index.ts` contains the REST routes and the single-owner Durable Object.
`src/mcp.ts` maps those routes to MCP tools and prompts. `src/public-api.ts`
talks to Hevy's API; `src/api.ts` defines the shared service. The remaining
modules implement previews and workout state. `src/version.ts` is the single
source for the version reported by `/health` and MCP initialization. Effect
handles orchestration and schema validation.

GitHub Actions runs checks on pushes and pull requests. Deployment is a
separate, manual workflow. Pushing to this repository does not deploy a
Worker. See [CONTRIBUTING](CONTRIBUTING.md).

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

See [security and data handling](SECURITY.md) before giving a client access.

## License

Apache-2.0. Copyright 2026 Igal Tabachnik.

The license covers this project's code and documentation, not Hevy's
application, service, branding, or any exercise catalog you supply. This
project is not affiliated with Hevy.
