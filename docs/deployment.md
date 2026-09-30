# Deploy your own Worker

This is a single-owner service. Deploy it into your own Cloudflare account and supply your own credentials. A checkout contains no working account session, production resource IDs, or deployed endpoint.

## Prerequisites

- Bun **1.3.14**, matching `package.json` and CI. Use the checked-in lockfile and local Wrangler **4.125.0** rather than a global or latest Wrangler.
- Node.js **22 or newer**, used by the catalog preparation script and required by `package.json`.
- A Cloudflare account with Workers, KV, and SQLite Durable Objects available.
- An authorized **private mobile API application key and mobile session** for your own Hevy account. A public Hevy developer API key is not interchangeable with these credentials. This project neither signs you into Hevy nor obtains credentials for you. If you do not have them, deployment alone will not make the integration functional.
- GitHub Actions access only if you want manual CI deployment.

The upstream integration is unofficial and version-sensitive. Hevy can change these endpoints, session rules, and request headers without notice. Keep the non-secret upstream settings in `wrangler.jsonc` under review; do not guess replacements when authentication fails.

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

The optional standard-exercise catalog is deliberately not distributed. If you have a catalog you are authorized to use, place it in `exercise-catalog.local.json` and follow the format and import instructions in the [catalog guide](catalog.md). `bun run catalog:prepare` validates it and writes the ignored `src/exercise-catalog.generated.json`. The normal test, typecheck, development, and deployment scripts prepare this build input automatically. Without a catalog, standard-exercise search returns `503 catalog_not_configured`; other API functions remain available. Custom exercises are a separate upstream feature, not a complete standard-catalog replacement.

## 2. Prepare runtime secrets

Create a private local file:

```sh
umask 077
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Edit `.dev.vars` locally and replace every placeholder:

- `AUTOMATION_API_TOKEN`: your own long, random access token. Generate one with a password manager or `openssl rand -hex 32`. This authorizes REST administration and approval of new OAuth connections. It is separate from the upstream credentials.
- `UPSTREAM_API_KEY`: the authorized application key used by the private mobile API.
- `BOOTSTRAP_SESSION_JSON`: a single JSON object containing `accessToken`, `authToken`, `refreshToken`, and `expiresAt`. Every token must be nonempty; the expiration must be a valid ISO timestamp from your actual session. Snake-case names `access_token`, `auth_token`, `refresh_token`, and `expires_at` are also accepted as a complete alternative shape.

Use the quoting shown in `.dev.vars.example`: the session JSON is on one line inside single quotes. Keep `.dev.vars`, session files, local catalog data, and `.wrangler` state out of Git, tickets, chat, screenshots, and CI logs. Never paste a credential into a command that will be saved in shell history. Do not enable shell tracing when handling secrets.

For local development, run `bun run dev`. Local Durable Object state persists between runs and is separate from production. Local execution can still call the real upstream API when you provide real credentials, so treat write requests as real writes. The OAuth authorization cookie requires HTTPS; use the deployed HTTPS endpoint for the ChatGPT connection.

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

The ID-less `OAUTH_KV` binding uses Wrangler automatic provisioning. The `SessionCoordinator` export declares a SQLite Durable Object; one named instance, `primary`, coordinates the mobile session and hosted workout state. Inspect Wrangler's resource reconciliation output before continuing. See [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) for automatic provisioning and export declarations.

Wrangler may write newly provisioned resource IDs back to `wrangler.jsonc`. Keep account-specific configuration in your deployment checkout and review the diff before committing anything to the public repository. Subsequent deploys must use the same OAuth KV namespace and Worker identity if you want existing connections and stored state to remain available. If you choose a different Worker name or account, provision independent resources deliberately; do not copy another person's IDs.

Save the HTTPS URL printed by Wrangler. The following is only a placeholder:

```sh
export WORKER_URL='https://hevy-mcp.YOUR_SUBDOMAIN.workers.dev'
curl --fail-with-body --silent --show-error "$WORKER_URL/health"
```

Expected response: `{"status":"ok"}`. This endpoint is public and only proves the Worker is serving requests.

## 4. Verify authentication and upstream access

For the examples below, use Bash and read the automation token without echoing it or putting it into shell history:

```sh
read -r -s -p 'Automation access token: ' AUTOMATION_API_TOKEN
printf '\n'
hevy_request() {
  printf 'Authorization: Bearer %s\n' "$AUTOMATION_API_TOKEN" |
    curl --fail-with-body --silent --show-error --header @- "$@"
}
hevy_request "$WORKER_URL/v1/session"
hevy_request "$WORKER_URL/v1/routines"
unset AUTOMATION_API_TOKEN
unset -f hevy_request
```

The header is passed through stdin rather than the process arguments. Use a trusted machine and keep shell tracing off. The session response is redacted. It can initialize storage from the bootstrap secret, but it does not prove that the upstream accepts the session. The routines request is the separate read-only upstream check and may refresh the stored session. Its response contains your personal workout information; do not paste it into public logs.

Then follow [ChatGPT setup](chatgpt.md).

## Session refresh and replacement

The Worker refreshes near-expiry access tokens automatically and persists the returned access token, rotated refresh token, and expiration in its Durable Object. It also retries once after the upstream specifically reports `AccessTokenExpired`. The original `authToken` is retained during refresh.

**Stored session data takes precedence over `BOOTSTRAP_SESSION_JSON`.** Updating that secret or redeploying does not overwrite an existing stored session. Do not delete the Durable Object to force a refresh: it also owns hosted workout state.

To replace a stale or revoked session, save a fresh authorized session JSON object in a private file outside the checkout, such as `$HOME/.config/hevy-mcp/session.json`. Restrict its permissions to your user. In a trusted Bash shell:

```sh
read -r -s -p 'Automation access token: ' AUTOMATION_API_TOKEN
printf '\n'
hevy_request() {
  printf 'Authorization: Bearer %s\n' "$AUTOMATION_API_TOKEN" |
    curl --fail-with-body --silent --show-error --header @- "$@"
}
hevy_request -X PUT -H 'Content-Type: application/json' \
  --data-binary @"$HOME/.config/hevy-mcp/session.json" \
  "$WORKER_URL/v1/session"
hevy_request "$WORKER_URL/v1/routines"
unset AUTOMATION_API_TOKEN
unset -f hevy_request
```

`PUT /v1/session` validates and saves the supplied credentials; only an upstream request establishes whether they work. `POST /v1/session/refresh` is also available for an explicit refresh using the stored session. A revoked refresh token needs replacement, not repeated refresh attempts. Avoid competing deployments that share the same mobile refresh session: refresh-token rotation can leave one deployment with stale credentials.

To rotate an application key or automation token, Wrangler provides a hidden interactive secret prompt:

```sh
bunx wrangler secret put UPSTREAM_API_KEY
bunx wrangler secret put AUTOMATION_API_TOKEN
```

Update your private local copies too, or a later `--secrets-file .dev.vars` deploy can restore old values. Rotating `AUTOMATION_API_TOKEN` changes REST access and new OAuth approvals; **it does not revoke existing OAuth grants or tokens**. See [OAuth access and revocation](chatgpt.md#oauth-access-and-revocation).

## Manual GitHub Actions deployment

`.github/workflows/ci.yml` runs checks on pushes and pull requests. `.github/workflows/deploy.yml` is manually triggered with `workflow_dispatch`; a push alone does not deploy.

First bootstrap the Worker and its three runtime secrets locally. Then configure these repository secrets in `hmemcpy/hevy-mcp` (or your fork):

- `CLOUDFLARE_ACCOUNT_ID`: the account used for the initial deployment
- `CLOUDFLARE_API_TOKEN`: a dedicated, account-scoped CI deployment token with the Workers and KV permissions needed by this configuration

Create the token in your [Cloudflare API token settings](https://dash.cloudflare.com/profile/api-tokens). Use an appropriately scoped Workers deployment token, not the Global API Key. Review the current [Cloudflare GitHub Actions guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) when choosing permissions.

The workflow uses the already configured runtime secrets on Cloudflare. It does not fetch your `.dev.vars` or initialize a mobile session. Verify it targets the same Worker and OAuth namespace before the first CI deployment. With an ID-less binding, inspect resource resolution in the run; do not accept creation of an unintended replacement namespace.

An ignored local catalog is not present in a fresh CI checkout. Unless you arrange an authorized private build input, a CI deployment ships without the standard catalog, even if your previous local deployment included one. Use local deployment when you need your private catalog preserved, or explicitly design and review a private CI catalog source; never commit the upstream catalog just to make CI work.

The workflow requires explicit acknowledgment that it deploys without standard exercise search.

Once the workflow exists on the remote repository's default branch, trigger it from GitHub Actions, or with an authenticated GitHub CLI:

```sh
gh workflow run deploy.yml --repo hmemcpy/hevy-mcp -f deploy_without_standard_catalog=true
gh run list --workflow deploy.yml --repo hmemcpy/hevy-mcp --limit 5
gh run watch RUN_ID --repo hmemcpy/hevy-mcp --exit-status
```

Choose the run ID for the deployment you started. After success, repeat the health and authenticated upstream checks. A successful upload alone is not an end-to-end verification.

## Troubleshooting

- **Public health works, REST returns 401:** verify the automation bearer token and destination. An upstream access token does not authorize REST requests.
- **`session_not_configured` / `invalid_session`:** supply a correctly shaped authorized session. For an existing stored session, use `PUT /v1/session`.
- **Upstream authentication fails:** inspect the structured error without exposing tokens. Confirm the application key, stored session, upstream settings, and refresh-token validity. Redeploying the same stale bootstrap will not fix stored state.
- **OAuth connection breaks after deployment:** verify that the Worker URL and `OAUTH_KV` namespace did not change. A fresh namespace has no prior OAuth state.
- **`catalog_not_configured`:** prepare an authorized local catalog and redeploy from a build environment that contains it.
- **Wrangler rejects configuration:** use the pinned dependency and lockfile. Do not replace the export declaration or add guessed production IDs just to bypass validation.

Observability is enabled in the supplied config. Review access to Cloudflare logs and retained data. Avoid logging request headers, raw sessions, account records, body measurements, or full workout payloads when debugging.
