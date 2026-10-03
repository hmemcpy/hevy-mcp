import { Context, Effect, Layer, Schema } from "effect"
import { SessionStorageError } from "./errors"

// Hevy's public API can push a webhook when a new workout is saved. Hevy
// POSTs {"workoutId": "..."} to a URL configured in the Hevy app and expects
// a 200 OK response within 5 seconds. The receiver records a bounded event
// log in the Durable Object; clients list the events and follow up with
// normal workout reads. The webhook URL carries a secret path token because
// Hevy sends no authenticating signature.

export class HevyWorkoutWebhook extends Schema.Class<HevyWorkoutWebhook>("HevyWorkoutWebhook")({
  workoutId: Schema.String,
}) {}

export interface WebhookEvent {
  readonly workoutId: string
  readonly receivedAt: string
}

export interface WebhookEventStoreApi {
  readonly record: (event: WebhookEvent) => Effect.Effect<void, SessionStorageError>
  readonly list: () => Effect.Effect<ReadonlyArray<WebhookEvent>, SessionStorageError>
}

export const WebhookEventStore = Context.Service<WebhookEventStoreApi>("WebhookEventStore")

const WEBHOOK_EVENTS_KEY = "hevy-webhook-events"
const MAX_WEBHOOK_EVENTS = 100

function readEvents(stored: unknown): Array<WebhookEvent> {
  if (!Array.isArray(stored)) return []
  return stored.flatMap(entry => {
    if (typeof entry !== "object" || entry === null) return []
    const workoutId = (entry as { workoutId?: unknown }).workoutId
    const receivedAt = (entry as { receivedAt?: unknown }).receivedAt
    if (typeof workoutId !== "string" || typeof receivedAt !== "string") return []
    return [{ workoutId, receivedAt }]
  })
}

export function makeWebhookEventStoreLayer(
  state: DurableObjectState,
): Layer.Layer<WebhookEventStoreApi> {
  const record: WebhookEventStoreApi["record"] = Effect.fn("WebhookEventStore.record")(event =>
    Effect.gen(function* () {
      const stored = yield* Effect.tryPromise({
        try: () => state.storage.get<unknown>(WEBHOOK_EVENTS_KEY),
        catch: cause => new SessionStorageError({ operation: "get", cause }),
      })
      const events = [...readEvents(stored), event].slice(-MAX_WEBHOOK_EVENTS)
      yield* Effect.tryPromise({
        try: () => state.storage.put(WEBHOOK_EVENTS_KEY, events),
        catch: cause => new SessionStorageError({ operation: "put", cause }),
      })
    }),
  )

  const list: WebhookEventStoreApi["list"] = Effect.fn("WebhookEventStore.list")(() =>
    Effect.tryPromise({
      try: () => state.storage.get<unknown>(WEBHOOK_EVENTS_KEY),
      catch: cause => new SessionStorageError({ operation: "get", cause }),
    }).pipe(Effect.map(readEvents)),
  )

  return Layer.succeed(WebhookEventStore, WebhookEventStore.of({ record, list }))
}
