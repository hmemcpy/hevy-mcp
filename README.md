# hevy-mcp

Talk to your Hevy workouts through ChatGPT — and train with it. This server
hosts one live workout session at a time: ChatGPT logs your sets as you go,
shows you the exact finished workout before saving, and writes it to Hevy
only after you approve. One deployment serves one Hevy account.

<!-- Screenshot placeholder: save the session screenshot as docs/session-screenshot.png (same name as below) and it will render here. -->
![A workout session finishing in ChatGPT: summary, sets table, and an Approve & save button](docs/session-screenshot.png)

## What it does

- **Train live.** "Start my Pull routine" — every set is confirmed as you log
  it, with next-set recommendations.
- **Save safely.** Finishing always previews first; nothing reaches Hevy
  until you approve that exact preview, and stale previews are rejected.
- **Read everything.** Workouts, routines, exercise history, body
  measurements, account.
- **See progress.** "How's my volume trending?" — a 1–12 week training
  summary with per-workout rows and a weight trend.
- **Fix and adjust.** Correct saved workouts, insert missed exercises, update
  routine targets, save a body measurement — every write is preview-first.
- **Find exercises.** Standard and custom exercise search from Hevy's own
  catalog, optionally enriched with your own metadata.
- **Get notified.** A webhook endpoint records the moment any workout is
  saved, from the phone or from ChatGPT.

Two guided prompts, `start_workout_from_routine` and
`analyze_workout_progress`, run the session and analysis flows end to end.

## Set it up

You need a Hevy Pro developer key, a Cloudflare account, and a ChatGPT plan
with custom MCP apps.

| Guide | What's in it |
| --- | --- |
| [Deploy your own Worker](docs/deployment.md) | Cloudflare setup, secrets, verification |
| [Connect ChatGPT](docs/chatgpt.md) | OAuth, the access model, safe first checks |
| [Other clients](docs/clients.md) | Codex plugin and more |
| [Development](docs/development.md) | Run locally, repository layout, limits |
| [Exercise catalog](docs/catalog.md) | The optional owner-supplied overlay |
| [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) | Data handling · how to contribute |

Version check once deployed:

```sh
curl https://YOUR-WORKER.workers.dev/health
# {"status":"ok","name":"hevy-mcp","version":"0.2.0"}
```

## License

Apache-2.0. Copyright 2026 Igal Tabachnik. This project is not affiliated
with Hevy; the license covers this code and documentation only.
