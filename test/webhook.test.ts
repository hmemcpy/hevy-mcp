import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  HevyWorkoutWebhook,
  makeWebhookEventStoreLayer,
  WebhookEventStore,
  type WebhookEventStoreApi,
} from "../src/webhook"

function fakeState() {
  const map = new Map<string, unknown>()
  return {
    map,
    state: {
      storage: {
        get: async (key: string) => map.get(key),
        put: async (key: string, value: unknown) => {
          map.set(key, value)
        },
      },
    } as unknown as DurableObjectState,
  }
}

function useStore<A>(
  state: DurableObjectState,
  use: (store: WebhookEventStoreApi) => Effect.Effect<A, unknown>,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* WebhookEventStore
      return yield* use(store)
    }).pipe(Effect.provide(makeWebhookEventStoreLayer(state))),
  )
}

describe("Hevy workout webhook payload", () => {
  it("accepts the documented workoutId payload", () => {
    const decoded = Schema.decodeUnknownSync(HevyWorkoutWebhook)({
      workoutId: "f1085cdb-32b2-4003-967d-53a3af8eaecb",
    })
    expect(decoded.workoutId).toBe("f1085cdb-32b2-4003-967d-53a3af8eaecb")
  })

  it("rejects payloads without a string workoutId", () => {
    expect(() => Schema.decodeUnknownSync(HevyWorkoutWebhook)({})).toThrow()
    expect(() => Schema.decodeUnknownSync(HevyWorkoutWebhook)({ workoutId: 42 })).toThrow()
  })
})

describe("webhook event store", () => {
  it("records and lists events in arrival order", async () => {
    const { state } = fakeState()
    const events = await useStore(state, store =>
      Effect.gen(function* () {
        yield* store.record({ workoutId: "workout-1", receivedAt: "2026-10-02T10:00:00.000Z" })
        yield* store.record({ workoutId: "workout-2", receivedAt: "2026-10-02T10:05:00.000Z" })
        return yield* store.list()
      }),
    )
    expect(events).toEqual([
      { workoutId: "workout-1", receivedAt: "2026-10-02T10:00:00.000Z" },
      { workoutId: "workout-2", receivedAt: "2026-10-02T10:05:00.000Z" },
    ])
  })

  it("keeps only the most recent 100 events", async () => {
    const { state } = fakeState()
    const events = await useStore(state, store =>
      Effect.gen(function* () {
        for (let index = 0; index < 102; index += 1) {
          yield* store.record({
            workoutId: `workout-${index}`,
            receivedAt: "2026-10-02T10:00:00.000Z",
          })
        }
        return yield* store.list()
      }),
    )
    expect(events).toHaveLength(100)
    expect(events[0]?.workoutId).toBe("workout-2")
    expect(events.at(-1)?.workoutId).toBe("workout-101")
  })

  it("tolerates missing or malformed stored events", async () => {
    const { state, map } = fakeState()
    await useStore(state, store =>
      Effect.gen(function* () {
        expect(yield* store.list()).toEqual([])
        map.set("hevy-webhook-events", { not: "an array" })
        expect(yield* store.list()).toEqual([])
        map.set("hevy-webhook-events", [
          { workoutId: "kept", receivedAt: "2026-10-02T10:00:00.000Z" },
          "junk",
          7,
        ])
        expect(yield* store.list()).toEqual([
          { workoutId: "kept", receivedAt: "2026-10-02T10:00:00.000Z" },
        ])
        return undefined
      }),
    )
  })
})
