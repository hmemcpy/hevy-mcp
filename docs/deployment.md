# Deploy your own Worker

This is a single-owner service. Deploy it into your own Cloudflare account and supply your own credentials. A checkout contains no working credentials, production resource IDs, or deployed endpoint.

## Prerequisites

- Bun **1.3.14**, matching `package.json` and CI. Use the checked-in lockfile and local Wrangler **4.125.0** rather than a global or latest Wrangler.
- Node.js **22 or newer**, used by the catalog preparation script and required by `package.json`.
- A Cloudflare account with Workers, KV, and SQLite Durable Objects available.
- A **public developer API key** from `https://hevy.com/settings?developer` (requires Hevy Pro) for your own Hevy account. This project neither signs you into Hevy nor obtains credentials for you. Without the key the integration answers `503 api_key_not_configured`.
- GitHub Actions access only if you want manual CI deployment.

This server integrates only with Hevy's documented public developer API (https://api.hevyapp.com/docs/). What the documented API cannot express is listed under [Hevy API capabilities](#hevy-api-capabilities); the adapter fails closed rather than degrading silently.

## 1. Install and check

From the repository root:

```sh
bun --version
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run lint
bun run deploy:dry-run
```

Tests use synthetic data; passing them does not verify your credentials or live compatibility. A dry run checks bundling, not production authentication. If a pinned package cannot be resolved by your registry, stop and resolve that dependency problem instead of silently downgrading or regenerating the lockfile.

The optional standard-exercise catalog is deliberately not distributed. Standard exercise search now reads your account's exercise templates from Hevy's public API (cached for five minutes), so it works without any bundled file. If you have a catalog you are authorized to use, place it in `exercise-catalog.local.json` and follow the format and import instructions in the [catalog guide](catalog.md); its entries are merged with Hevy's templates and take precedence on ID collisions, adding metadata Hevy's listing does not return. `bun run catalog:prepare` validates it and writes the ignored `src/exercise-catalog.generated.json`. The normal test, typecheck, development, and deployment scripts prepare this build input automatically. `catalog_not_configured` now only occurs when Hevy returns no templates and no catalog is bundled.

## 2. Prepare runtime secrets

Create a private local file:

```sh
umask 077
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Edit `.dev.vars` locally and replace every placeholder:

- `AUTOMATION_API_TOKEN`: your own long, random access token. Generate one with a password manager or `openssl rand -hex 32`. This authorizes REST administration and approval of new OAuth connections.
- `HEVY_API_KEY`: your public developer API key from `https://hevy.com/settings?developer` (requires Hevy Pro).

Keep `.dev.vars`, local catalog data, and `.wrangler` state out of Git, tickets, chat, screenshots, and CI logs. Never paste a credential into a command that will be saved in shell history. Do not enable shell tracing when handling secrets.

### Hevy API capabilities

The server uses only the documented public API, which is weaker than Hevy's mobile app. The adapter fails closed rather than degrading silently. Known limitations:

- Workouts cannot be deleted: `preview_completed_workout_delete` and `delete_completed_workout` return `501 operation_unavailable`. A delete endpoint has been requested from Hevy; see [docs/delete-workout-proposal.md](delete-workout-proposal.md).
- The public API assigns workout IDs, so `finish_workout_session` returns the server-assigned workout ID instead of the previewed session ID.
- Workout writes lose per-set completion times, rest timers, volume-doubling flags, and routine linkage. RPE must be one of 6, 7, 7.5, 8, 8.5, 9, 9.5, 10; set types must be `warmup`, `normal`, `failure`, or `dropset`; superset IDs must be integers.
- Routine writes lose ordering, parent and program links, and the coach RPE flag, and the public target rep ranges are not written.
- Account info is reduced to ID, username, display name, and unit preferences; body measurements lose their ID and creation timestamp; custom exercises lose their archived flag.
- Reads are paginated page by page, so full-list reads cost one request per page of ten workouts. Exercise-template reads page at 100 per request and are cached for five minutes; a full training summary additionally reads all body measurements.

### Hevy new-workout webhook

Hevy's public API can POST a notification when a new workout is saved on the account. Configure the receiver in the Hevy app by giving it this URL (the token is your own secret; Hevy sends no signature, so the unguessable path is the only credential):

```text
https://<your-worker-domain>/webhook/hevy/<HEVY_WEBHOOK_TOKEN>
```

Set `HEVY_WEBHOOK_TOKEN` as a Worker secret (`bunx wrangler secret put HEVY_WEBHOOK_TOKEN`) or in `.dev.vars` locally. Leave it unset or empty to disable the receiver: requests to `/webhook/hevy/*` then answer 404. The receiver answers `200` immediately (Hevy expects a response within 5 seconds) and records `{workoutId, receivedAt}` in the Durable Object in the background, keeping the most recent 100 events. List the recorded notifications with the automation token:

```sh
curl -H "Authorization: Bearer $AUTOMATION_API_TOKEN" https://<your-worker-domain>/v1/webhook-events
```

Follow up with the normal workout reads; the webhook only signals that a new workout exists.

For local development, run `bun run dev`. Local Durable Object state persists between runs and is separate from production. Local execution can still call the real Hevy API when you provide real credentials, so treat write requests as real writes. The OAuth authorization cookie requires HTTPS; use the deployed HTTPS endpoint for the ChatGPT connection.

## 3. First production deployment

Authenticate Wrangler and select your own account:

```sh
bunx wrangler login
bunx wrangler whoami
export CLOUDFLARE_ACCOUNT_ID='YOUR_CLOUDFLARE_ACCOUNT_ID'
bun run deploy --secrets-file .dev.vars
```

Inspect the account and Worker name before deploying. The configured name is `hevy-mcp`. A first deployment creates a new service; it does not migrate a pre-existing Worker's state.

Wrangler supports uploading secrets alongside code with `--secrets-file`. Later plain deployments preserve existing Worker secrets. See [Cloudflare's secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

The ID-less `OAUTH_KV` binding uses Wrangler automatic provisioning. The `SessionCoordinator` export declares a SQLite Durable Object; one named instance, `primary`, coordinates hosted workout state, webhook events, and OAuth connection approvals. Inspect Wrangler's resource reconciliation output before continuing. See [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) for automatic provisioning and export declarations.

Wrangler may write newly provisioned resource IDs back to `wrangler.jsonc`. Keep account-specific configuration in your deployment checkout and review the diff before committing anything to the public repository. Subsequent deploys must use the same OAuth KV namespace and Worker identity if you want existing connections and stored state to remain available. If you choose a different Worker name or account, provision independent resources deliberately; do not copy another person's IDs.

Save the HTTPS URL printed by Wrangler. The following is only a placeholder:

```sh
export WORKER_URL='https://hevy-mcp.YOUR_SUBDOMAIN.workers.dev'
curl --fail-with-body --silent --show-error "$WORKER_URL/health"
```

Expected response: `{"status":"ok","name":"hevy-mcp","version":"0.2.0"}` (the version matches `package.json` and the value reported by the `get_server_info` MCP tool). This endpoint is public and only proves the Worker is serving requests; verify authentication and an MCP read before calling a deployment verified.

## 4. Verify authentication and API access

For the examples below, use Bash and read the automation token without echoing it or putting it into shell history:

```sh
read -r -s -p 'Automation access token: ' AUTOMATION_API_TOKEN
printf '\n'
hevy_request() {
  printf 'Authorization: Bearer %s\n' "$AUTOMATION_API_TOKEN" |
    curl --fail-with-body --silent --show-error --header @- "$@"
}
hevy_request "$WORKER_URL/v1/workouts/count"
hevy_request "$WORKER_URL/v1/routines"
unset AUTOMATION_API_TOKEN
unset -f hevy_request
```

The header is passed through stdin rather than the process arguments. Use a trusted machine and keep shell tracing off. The workout count proves the `HEVY_API_KEY` works; the routines response contains your personal workout information, so do not paste it into public logs.

Then follow [ChatGPT setup](chatgpt.md).

## Rotating secrets

```sh
bunx wrangler secret put HEVY_API_KEY
bunx wrangler secret put AUTOMATION_API_TOKEN
bunx wrangler secret put HEVY_WEBHOOK_TOKEN
```

Update your private local `.dev.vars` too, or a later `--secrets-file .dev.vars` deploy can restore old values. Rotating `AUTOMATION_API_TOKEN` changes REST access and new OAuth approvals; **it does not revoke existing OAuth grants or tokens**. Rotating `HEVY_WEBHOOK_TOKEN` changes the receiver URL that must be configured in the Hevy app. See [OAuth access and revocation](chatgpt.md#oauth-access-and-revocation).

## Manual GitHub Actions deployment

`.github/workflows/ci.yml` runs checks on pushes and pull requests. `.github/workflows/deploy.yml` is manually triggered with `workflow_dispatch`; a push alone does not deploy.

First bootstrap the Worker and its two runtime secrets locally. Then configure these repository secrets in `hmemcpy/hevy-mcp` (or your fork):

- `CLOUDFLARE_ACCOUNT_ID`: the account used for the initial deployment
- `CLOUDFLARE_API_TOKEN`: a dedicated, account-scoped CI deployment token with the Workers and KV permissions needed by this configuration

Create the token in your [Cloudflare API token settings](https://dash.cloudflare.com/profile/api-tokens). Use an appropriately scoped Workers deployment token, not the Global API Key. Review the current [Cloudflare GitHub Actions guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) when choosing permissions.

The workflow uses the already configured runtime secrets on Cloudflare. It does not fetch your `.dev.vars`. Verify it targets the same Worker and OAuth namespace before the first CI deployment. With an ID-less binding, inspect resource resolution in the run; do not accept creation of an unintended replacement namespace.

An ignored local catalog is not present in a fresh CI checkout. A CI deployment therefore ships without your private catalog overlay; standard exercise search still works through Hevy's exercise templates, but your catalog's extra metadata is absent until you deploy locally or arrange an authorized private build input. Never commit the Hevy catalog just to make CI work.

Once the workflow exists on the remote repository's default branch, trigger it from GitHub Actions, or with an authenticated GitHub CLI:

```sh
gh workflow run deploy.yml --repo hmemcpy/hevy-mcp
gh run list --workflow deploy.yml --repo hmemcpy/hevy-mcp --limit 5
gh run watch RUN_ID --repo hmemcpy/hevy-mcp --exit-status
```

Choose the run ID for the deployment you started. After success, repeat the health and authenticated API checks. A successful upload alone is not an end-to-end verification.

## Troubleshooting

- **Public health works, REST returns 401:** verify the automation bearer token and destination. The Hevy API key does not authorize REST requests.
- **`503 api_key_not_configured`:** set the `HEVY_API_KEY` secret with `bunx wrangler secret put HEVY_API_KEY`.
- **`502 hevy_api_error` on every call:** the API key is missing, revoked, or the account lacks Hevy Pro. Check https://hevy.com/settings?developer.
- **OAuth connection breaks after deployment:** verify that the Worker URL and `OAUTH_KV` namespace did not change. A fresh namespace has no prior OAuth state.
- **`catalog_not_configured`:** prepare an authorized local catalog and redeploy from a build environment that contains it.
- **Wrangler rejects configuration:** use the pinned dependency and lockfile. Do not replace the export declaration or add guessed production IDs just to bypass validation.

Observability is enabled in the supplied config. Review access to Cloudflare logs and retained data. Avoid logging request headers, raw sessions, account records, body measurements, or full workout payloads when debugging.
