# hevy-mcp

Use Hevy from ChatGPT: read your workouts, adjust routines, log a workout as you go,
and save it when you're done.

This is a self-hosted MCP server running on Cloudflare Workers. It talks to Hevy's
private mobile API, not the public developer API. You'll need a valid mobile
session and application key for your own account. A Hevy developer API key is
not a substitute. There is no login scraper or credential extraction tool here.

**One deployment, one Hevy account.** Anyone you authorize gets access to that
account, including its workout history, profile, and body measurements. This is
not a service for connecting multiple people's accounts.

## What it does

The server exposes 25 MCP tools:

- Read workouts, routines, folders, exercise history, account details, and body measurements
- Look up custom exercises and, if you supply a catalog, standard exercises
- Preview changes to routine targets, then apply the exact preview
- Keep one active workout draft, record sets, and save the completed workout
- Preview and apply corrections, missing exercise rows, or deletion of a completed workout

Writes use revision checks so an old preview cannot overwrite newer data. The
client should show you the preview and ask before applying it. These checks are
not a separate human-approval system: a client with write access can call both
steps.

An active draft lives in this server. It does not appear as an in-progress workout
in the Hevy app; the completed workout is sent when you finish it. New drafts
default to public workouts and public biometrics. Set
`isPrivate: true` and `isBiometricsPublic: false` when starting or updating a draft
if you don't want that.

## Run it

Install [Bun](https://bun.sh/) 1.3.14 and Node.js 22 or newer, then:

```sh
git clone https://github.com/hmemcpy/hevy-mcp.git
cd hevy-mcp
bun install --frozen-lockfile
bun run check
cp .dev.vars.example .dev.vars
# Fill in .dev.vars locally. Do not paste credentials into chat.
bun run dev
```

The tests use synthetic data and mocked upstream responses. They don't need a
Hevy account. A local server starts without credentials, but authenticated calls
need the values described in [deployment](docs/deployment.md).

For a hosted instance, follow [the Cloudflare setup](docs/deployment.md), then
[connect ChatGPT](docs/chatgpt.md) to `https://YOUR-WORKER.workers.dev/mcp` using
OAuth. The owner authorizes the connection with a separate automation token;
ChatGPT does not receive the Hevy session tokens.

For Codex, [generate a plugin](docs/clients.md#codex-plugin) with your own Worker
URL. The generator creates a ready-to-add local marketplace; it does not install
anything or include credentials.

The original APK-derived exercise catalog is intentionally not included. Standard
exercise search returns `catalog_not_configured` until you supply a catalog you
have permission to use. [Catalog setup](docs/catalog.md) explains the format and
deployment implications. Existing routines, workout history, and custom exercises
don't depend on it.

## Working on it

```sh
bun run test             # Vitest
bun run typecheck        # TypeScript
bun run lint             # Biome
bun run deploy:dry-run   # Build the Worker without deploying it
```

`src/index.ts` contains the REST routes and the single-owner Durable Object.
`src/mcp.ts` maps those routes to MCP tools. `src/upstream.ts` handles Hevy calls
and session refresh. The remaining modules implement previews and workout state.
Effect handles the request orchestration and schema validation.

GitHub Actions runs checks on pushes and pull requests. Deployment is a separate,
manual workflow. Pushing to this repository does not deploy a Worker.
See [CONTRIBUTING](CONTRIBUTING.md) for package checks and clean source archives.

## Limits worth knowing

- This is an unofficial integration. Hevy can change its private API without notice
- A Durable Object stores the latest rotated session and the active workout draft. OAuth grants are stored separately in Workers KV
- Rotating the automation token does not revoke existing OAuth grants
- The finish operation saves one completed workout. Check the result before retrying a failed write
- Only the final set in a completed exercise can be deleted, and its only set cannot be deleted
- There is no automated migration of an existing deployment. Use a separate Worker name while testing this extraction

See [security and data handling](SECURITY.md) before giving a client access.

## License

[Apache-2.0](LICENSE). Copyright 2026 Igal Tabachnik.

The license covers this project's code and documentation, not Hevy's application,
service, branding, or any exercise catalog you supply. This project is not
affiliated with Hevy.
