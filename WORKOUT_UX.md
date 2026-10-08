# Workout session UX contract

This document codifies the preferred workout interaction and finish/approval
UX so it survives changes of client (ChatGPT, Claude, Codex) or MCP server.
Issue #2 tracks it. It has two tiers:

- **Tier 1 — portable presentation contract.** Client- and server-agnostic.
  Paste this tier into your client's custom or project instructions (or a
  skill) for whichever MCP integration is active.
- **Tier 2 — server-specific bindings.** The tool names and server-side
  guarantees of *this* server (`hmemcpy/hevy-mcp`). Swap this tier when you
  swap providers; keep Tier 1.

The backend stays UI-agnostic: the server validates revision-checked
previews and timestamps; the client is responsible for obtaining the
explicit approval. The server cannot prove a human saw a preview — treat
connected clients as trusted.

## Tier 1 — portable presentation contract

**During a session** (Push / Pull / Legs alike):

- Confirm each logged set succinctly: exercise, actual load, reps, RPE/RIR
  when supplied, and one actionable next-set recommendation.
- Keep machine-specific baselines and setup notes distinct from set data.

**Finishing — mandatory order:**

1. Always produce a finish preview first. Never save without one.
2. Present the exact preview: duration, exercise count, completed-set count,
   start/end timing, and a readable table of exercises and sets (weights,
   reps, RPE, useful setup notes). Make omissions explicit — incomplete sets
   and untouched exercises must be called out, not silently dropped.
3. Prefer an interactive **Approve & save workout** control when the client
   supports one. The button must submit a new user turn that explicitly
   approves the exact preview shown. It **must not invoke the MCP write
   tool directly**. Always provide a plain-text approval fallback
   ("reply: approve").
4. Only after explicit approval of that exact preview in the current
   conversation, save using the unchanged preview payload/revision. If the
   draft changed or the preview became stale, regenerate the preview and
   request approval again. Never edit a stale preview to fit.
5. After the server confirms saving, show a clear success state with the
   actual saved duration/exercise/set totals from the save response, plus
   1–2 evidence-based performance highlights. Do not claim success before
   confirmation. Surface any mismatch between preview and saved result.

**Visual design:** compact and restrained — legible summary metrics, one
table, one primary CTA. No needless forms, decorative badges, or repeated
data.

Interactive controls (buttons, cards) are client-dependent enhancements: use
them when available, and always keep the text fallback sufficient on its own.

## Tier 2 — bindings for this server (hevy-mcp)

The finish flow maps to these tools:

| Step | Tool | Note |
| --- | --- | --- |
| Start | `start_workout_session` | One active hosted draft; check `get_active_workout_session` first. |
| Log | `update_workout_session` | Send the latest revision. |
| Preview | `preview_finish_workout_session` | Incomplete sets and untouched exercises are omitted by the server; compare with `get_active_workout_session` to make omissions explicit. |
| Approve | (user turn) | The approval is a chat message from the user, not a tool call. |
| Save | `finish_workout_session` | Sends the unchanged preview; the server rejects a stale revision with `active_workout_changed`. |
| Confirm | (save response) | Ground saved totals in the returned `workout` object, not the echoed timing preview. |

Server-side guarantees this tier relies on:

- One active draft at a time, hosted in the server, invisible to the Hevy
  app until saved.
- Revision checks: an outdated preview cannot save or overwrite newer data.
- Explicit save only — nothing is written to Hevy without an apply call, and
  discards are explicit (`discard_workout_session`).
- `get_training_summary`, `get_recent_workouts`, and `get_exercise_history`
  supply the evidence for post-save highlights; routine target changes go
  through `preview_routine_progression` / `apply_routine_progression` with
  the same approval rule.

The server also ships these MCP prompts that embed this contract:
`start_workout_from_routine` and `analyze_workout_progress`.

## Migrating to another server

Keep Tier 1 verbatim. Rewrite Tier 2's table to the new server's tools. If
the replacement server has no hosted draft or revision-checked previews, the
approval ritual still works client-side, but staleness detection and
no-silent-save become client discipline instead of server guarantees — say
so in your instructions, and re-verify the saved result after every write.
