# Connect to ChatGPT

Deploy and verify the Worker first using the [deployment guide](deployment.md). You need its public HTTPS endpoint and your own automation token. The endpoint is:

```text
https://hevy-mcp.YOUR_SUBDOMAIN.workers.dev/mcp
```

Replace the placeholder with the URL printed by your deployment. This is a remote HTTP MCP server, not a local stdio process.

## Understand the access model

This implementation has one owner, one mobile session, and one shared hosted active workout. Every successful OAuth authorization is recorded as `owner` and reaches the same `primary` Durable Object. OAuth is a connection boundary, not multi-user account isolation or per-tool permission enforcement.

Keep the app private to yourself. Do not publish it for a team, lend out the automation token, or connect other people's ChatGPT accounts: those clients would access your account data and write capabilities.

Available reads include workouts, routines, exercise history, custom exercises, account details, and body measurements. `get_account` can return your full name, city, birthday, sex, and height. Body measurements and workout history can be sensitive. Connecting the app allows tool results to be sent to ChatGPT; consider this before enabling it in a conversation.

Write tools can modify routines, create or correct completed workouts, insert exercises, and delete completed workouts. These consequential operations use preview/apply flows, but the server does not independently establish that a human reviewed a preview. Treat the connected client as trusted and review the proposed changes before authorizing them.

**Hosted workout defaults are not private:** new drafts default to `isPrivate: false` and `isBiometricsPublic: true`. When privacy is intended, explicitly set `isPrivate: true` and `isBiometricsPublic: false`, and inspect those flags in the final preview before saving. Also inspect `shareToStrava`. The hosted draft is not a live Hevy phone workout; saving it creates a completed workout upstream.

## Create the connection

ChatGPT feature availability, workspace policy, and UI labels vary. Follow the current [OpenAI developer-mode and MCP app instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) for your plan and role. Do not assume that write tools are available just because read access works.

1. Enable developer/custom MCP app access if your account and workspace permit it.
2. Add a custom MCP app with your deployed `/mcp` URL and choose OAuth authentication.
3. Start the connection or tool scan. The Worker supports OAuth client registration at `/oauth/register` and client-ID metadata documents; you do not need to invent a static client secret.
4. The browser should open an authorization page on **your Worker origin**, at `/authorize`. Verify the hostname before entering anything.
5. Enter your `AUTOMATION_API_TOKEN` into that page's password field and approve the connection. Do not paste mobile credentials or the automation token into the chat. This is the Worker owner's authorization screen, not a Hevy login.
6. Allow the OAuth redirect and tool discovery to finish. Select the app in a new chat and begin with a read-only request, such as “List my routines without changing anything.”

The authorization page uses an HTTPS-only CSRF cookie. Restart the connection flow if the page expires or authorization fails; do not bypass the check. The OAuth library handles protocol discovery and token exchange at `/oauth/token`. REST calls under `/v1` instead use the automation bearer token and are not the MCP connection URL.

## Safe first checks

Start with `list_routines` or `get_workout_count`, then compare a returned result with your Hevy app. Avoid account and body-measurement tools when they are irrelevant to the task.

For a write, ask for a preview first and inspect the exact target, exercise, set, units, privacy flags, and before/after values. Save or apply only after reviewing that preview. Re-read the affected workout or routine afterward. A stale preview must be regenerated, not edited to bypass the revision check.

Only one hosted draft can be active at a time. Use `get_active_workout_session` before starting another. Draft changes stay in the Worker until the finish/apply step saves a completed workout. Discarding the draft and deleting a completed workout are different actions.

If standard exercise search reports `catalog_not_configured`, the deployment lacks the optional local catalog. `list_custom_exercises` returns your custom templates only. It does not recover the missing standard catalog.

## OAuth access and revocation

The automation token approves new OAuth grants and separately protects REST endpoints. The OAuth provider stores connection state in `OAUTH_KV`. Once a client has a grant, it uses OAuth tokens rather than resubmitting the automation token on every call.

**Changing `AUTOMATION_API_TOKEN` does not revoke existing OAuth grants, access tokens, or refresh tokens.** Updating the mobile bootstrap secret does not revoke them either. Disconnect the app in ChatGPT when you no longer want to use it, but do not assume that disconnecting proves all server-side credentials have been invalidated.

This repository does not expose an owner-facing grant-management or revocation endpoint. If a grant is compromised, stop exposing the service while you investigate and explicitly revoke/reset the relevant OAuth provider state using a reviewed administrative procedure. A deliberate fresh OAuth namespace invalidates access to the old connection state for the new deployment, but affects every connected client and requires reauthorization. Do not casually delete a namespace or the session Durable Object as a troubleshooting step; the latter also contains mobile-session and hosted-workout state.

## Connection troubleshooting

- **No custom app or write support:** check the current OpenAI plan/workspace requirements with your administrator. Do not disable server authentication as a workaround.
- **Unauthorized MCP request:** restart OAuth in ChatGPT. Passing the automation token directly to `/mcp` is not the same flow as REST bearer authentication.
- **Authorization page rejects the token:** confirm the Worker hostname and current automation token, and begin a new authorization flow so the CSRF cookie matches.
- **Tools appear but upstream calls fail:** follow the mobile-session replacement steps in [deployment](deployment.md#session-refresh-and-replacement). A completed OAuth connection does not validate Hevy credentials.
- **Connection stops renewing:** inspect the provider discovery metadata and token flow using the current OpenAI guidance. Diagnose the OAuth connection separately from the upstream mobile session; they have distinct refresh tokens.
- **Tool definitions are stale after a release:** refresh/review the app's tools using your current ChatGPT app controls. OpenAI may retain a previously approved tool snapshot rather than automatically accepting changed definitions.

Keep error reports free of bearer tokens, authorization codes, mobile sessions, personal account records, and real workout identifiers. A minimal report can include the affected tool, HTTP/error code, package versions, and a synthetic reproduction.
