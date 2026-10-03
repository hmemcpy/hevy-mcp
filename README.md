# hevy-mcp

Talk to your Hevy workout log through ChatGPT. This is a self-hosted MCP
server on Cloudflare Workers that connects ChatGPT to your Hevy account with
Hevy's official developer API. Ask it to show your recent workouts, plan your
next session, log sets while you train, and save the workout to Hevy when
you're done.

One deployment serves one Hevy account. Anyone you authorize gets access to
that account, including workout history, profile, and body measurements.

## What it does

The server exposes 25 MCP tools:

- **Read your training data.** Recent workouts, a single workout, workout
  count, routines, routine folders, exercise history for any template, your
  account, and body measurements.
- **Find exercises.** Search custom exercises and standard exercises
  (standard search uses an exercise catalog you supply — see below).
- **Log a workout while you train.** Keep one active draft in the server:
  start it from a routine or empty, add exercises and sets as you go, preview
  the finished workout, then save it to Hevy. Until you save, the draft only
  exists in this server — it does not appear in the Hevy app.
- **Change saved data safely.** Adjust routine targets, correct a saved
  workout, insert a missed exercise. Every write first produces a preview,
  then applies exactly that preview, with revision checks so an outdated
  preview cannot overwrite newer data.
- **Get notifications.** An endpoint receives Hevy's new-workout webhook so
  external tools can react the moment a workout is saved.

Deleting a saved workout is the one thing the server cannot do yet: Hevy's
public API has no delete endpoint. The two delete tools exist and report this
when called; we've asked Hevy to add the endpoint
([proposal](docs/delete-workout-proposal.md)).

Writes lose some detail the Hevy app itself keeps: per-set completion times,
rest timers, volume-doubling flags, and routine linkage. RPE is limited to
0.5 steps between 6 and 10. See
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

Standard exercise search needs an exercise catalog file that you supply;
without it, search returns `catalog_not_configured` and everything else
works. [Catalog setup](docs/catalog.md) explains the format.

## Working on it

```sh
bun run test             # Vitest
bun run typecheck        # TypeScript
bun run lint             # Biome
bun run deploy:dry-run   # Build the Worker without deploying it
```

`src/index.ts` contains the REST routes and the single-owner Durable Object.
`src/mcp.ts` maps those routes to MCP tools. `src/public-api.ts` talks to
Hevy's API; `src/api.ts` defines the shared service. The remaining modules
implement previews and workout state. Effect handles orchestration and schema
validation.

GitHub Actions runs checks on pushes and pull requests. Deployment is a
separate, manual workflow. Pushing to this repository does not deploy a
Worker. See [CONTRIBUTING](CONTRIBUTING.md).

## Limits

- A Durable Object stores the active workout draft, webhook events, and OAuth
  connection approvals. OAuth grants are stored separately in Workers KV.
- Rotating the automation token does not revoke existing OAuth grants.
- `finish_workout_session` saves one completed workout. Check the result
  before retrying a failed write.
- Only the final set in a completed exercise can be deleted, and an exercise
  with a single set cannot lose it.
- New drafts default to public workouts and public biometrics. Set
  `isPrivate: true` and `isBiometricsPublic: false` if you don't want that.

See [security and data handling](SECURITY.md) before giving a client access.

## License

[Apache-2.0](LICENSE). Copyright 2026 Igal Tabachnik.

The license covers this project's code and documentation, not Hevy's
application, service, branding, or any exercise catalog you supply. This
project is not affiliated with Hevy.
