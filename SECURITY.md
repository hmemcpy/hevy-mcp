# Security and data handling

This server has one owner and one Hevy account. Every authorized OAuth
client acts on that account. There are no per-user data partitions, read-only
grants, or per-tool permission scopes.

The automation token grants direct REST access and authorizes new OAuth grants.
Keep it separate from your Hevy API key. The Hevy API key is stored as a Worker
secret; OAuth state is stored in KV. Do not put either kind of token in Git, an
issue, a screenshot, command arguments, or a chat message. `.dev.vars` and
`*.local.json` files are ignored, not encrypted.

Account tools expose personal profile fields and body measurements. Authorizing
a client shares those with that client. Workout drafts default to public
workouts and public biometrics; explicitly set `isPrivate: true` and
`isBiometricsPublic: false` when needed.

A preview protects against stale writes, not malicious clients. An authorized
client can generate and apply previews itself. Only connect clients you trust.
API validation errors deliberately omit raw payload diagnostics because
those diagnostics can contain credentials or account data.

Rotating `AUTOMATION_API_TOKEN` prevents its further use, but does not invalidate
OAuth grants already issued. Disconnect affected clients and revoke their grants
separately. For urgent containment, take the Worker offline until you have
revoked access; do not delete the Durable Object as a troubleshooting step.

Do not report vulnerabilities by posting live credentials or private workout
data in a public issue. Use GitHub's private vulnerability reporting if enabled,
or contact the maintainer privately with a synthetic reproduction.
