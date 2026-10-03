import { Cause, Effect, Exit, Option } from "effect"
import { describe, expect, it, vi } from "vitest"
import type { ApiError } from "../src/errors"
import { makePublicApi } from "../src/public-api"

const config = {
  API_BASE_URL: "https://api.example.test",
  HEVY_API_KEY: "public-key",
}

function recordingFetcher(respond: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: Array<{ url: string; method: string; headers: Headers; body?: string }> = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const response = respond(url, init)
    if (response === undefined) throw new Error(`Unexpected request: ${url}`)
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    })
    return response
  })
  return { calls, fetcher }
}

const baseWorkout = {
  id: "w1",
  title: "Morning Workout",
  description: null,
  routine_id: "r-9",
  start_time: "2024-08-14T12:00:00Z",
  end_time: "2024-08-14T12:30:00Z",
  created_at: "2024-08-14T12:31:00Z",
  updated_at: "2024-08-14T13:00:00Z",
  exercises: [
    {
      index: 0,
      title: "Bench Press (Barbell)",
      notes: "Felt good",
      exercise_template_id: "D04AC939",
      superset_id: null,
      sets: [
        {
          index: 0,
          type: "warmup",
          weight_kg: 40,
          reps: 10,
          distance_meters: null,
          duration_seconds: null,
          rpe: null,
          custom_metric: null,
        },
        {
          index: 1,
          type: "normal",
          weight_kg: 100,
          reps: 8,
          distance_meters: null,
          duration_seconds: null,
          rpe: 8.5,
          custom_metric: null,
        },
      ],
    },
  ],
}

async function failureOf<A>(program: Effect.Effect<A, unknown>): Promise<ApiError> {
  const exit = await Effect.runPromiseExit(program)
  if (Exit.isSuccess(exit)) throw new Error("Expected the program to fail")
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isNone(failure)) throw new Error("Expected a typed failure")
  return failure.value as ApiError
}

describe("public API reads", () => {
  it("paginates workouts and maps them into the Api domain", async () => {
    const { calls, fetcher } = recordingFetcher(url => {
      if (url.includes("page=1"))
        return Response.json({ page: 1, page_count: 2, workouts: [baseWorkout] })
      if (url.includes("page=2"))
        return Response.json({ page: 2, page_count: 2, workouts: [{ ...baseWorkout, id: "w2" }] })
      return undefined
    })
    const workouts = await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.workouts()),
    )

    expect(calls.map(call => call.url)).toEqual([
      "https://api.example.test/v1/workouts?page=1&pageSize=10",
      "https://api.example.test/v1/workouts?page=2&pageSize=10",
    ])
    expect(calls[0]?.headers.get("api-key")).toBe("public-key")
    expect(calls[0]?.headers.get("authorization")).toBeNull()
    expect(workouts.map(workout => workout.id)).toEqual(["w1", "w2"])
    const first = workouts[0]
    expect(first?.name).toBe("Morning Workout")
    expect(first?.routine_id).toBe("r-9")
    expect(first?.exercises[0]?.exercise_template_id).toBe("D04AC939")
    expect(first?.exercises[0]?.sets.map(set => set.indicator)).toEqual(["warmup", "normal"])
    expect(first?.exercises[0]?.sets[1]?.rpe).toBe(8.5)
    expect(first?.exercises[0]?.sets[0]?.completed_at).toBeUndefined()
  })

  it("maps workout events into the sync response", async () => {
    const { calls, fetcher } = recordingFetcher(_url =>
      Response.json({
        page: 1,
        page_count: 1,
        events: [
          { type: "updated", workout: baseWorkout },
          { type: "deleted", id: "w9" },
        ],
      }),
    )
    const sync = await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api =>
        api.workoutSync({
          w1: "2024-08-01T00:00:00Z",
          w2: "2024-07-01T00:00:00Z",
        }),
      ),
    )

    expect(calls[0]?.url).toBe(
      "https://api.example.test/v1/workouts/events?since=2024-07-01T00%3A00%3A00.000Z&page=1&pageSize=10",
    )
    expect(sync.updated.map(workout => workout.id)).toEqual(["w1"])
    expect(sync.deleted).toEqual(["w9"])
    expect(sync.isMore).toBe(false)
  })

  it("fills missing routine fields with safe defaults", async () => {
    const { fetcher } = recordingFetcher(_url =>
      Response.json({
        page: 1,
        page_count: 1,
        routines: [
          {
            id: "r1",
            title: "Push",
            folder_id: 42,
            updated_at: "2024-08-14T13:00:00Z",
            exercises: [
              {
                exercise_template_id: "A1",
                title: "Squat",
                rest_seconds: "90",
                notes: "deep",
                sets: [{ index: 0, type: "normal", weight_kg: 100, reps: 10 }],
              },
            ],
          },
        ],
      }),
    )
    const sync = await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.routineSync()),
    )

    const routine = sync.updated[0]
    expect(routine?.index).toBe(0)
    expect(routine?.folder_id).toBe("42")
    expect(routine?.parent_routine_id).toBeNull()
    expect(routine?.coach_force_rpe_enabled).toBe(false)
    expect(routine?.exercises[0]?.rest_seconds).toBe(90)
    expect(routine?.exercises[0]?.sets[0]?.indicator).toBe("normal")
  })

  it("filters custom exercise templates and renames their fields", async () => {
    const { fetcher } = recordingFetcher(_url =>
      Response.json({
        page: 1,
        page_count: 1,
        exercise_templates: [
          {
            id: "1",
            title: "Custom Curl",
            type: "weight_reps",
            primary_muscle_group: "biceps",
            secondary_muscle_groups: ["forearms"],
            equipment: "dumbbell",
            is_custom: true,
          },
          { id: "2", title: "Bench Press", is_custom: false },
        ],
      }),
    )
    const exercises = await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.customExercises()),
    )

    expect(exercises).toHaveLength(1)
    expect(exercises[0]?.id).toBe("1")
    expect(exercises[0]?.equipment_category).toBe("dumbbell")
    expect(exercises[0]?.muscle_group).toBe("biceps")
    expect(exercises[0]?.other_muscles).toEqual(["forearms"])
  })

  it("maps the public user info envelope onto the account profile", async () => {
    const { fetcher } = recordingFetcher(_url =>
      Response.json({ data: { id: "u1", username: "jhon", name: "John Doe" } }),
    )
    const account = await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.userAccount()),
    )

    expect(account.id).toBe("u1")
    expect(account.username).toBe("jhon")
    expect(account.full_name).toBe("John Doe")
    expect(account.birthday).toBeUndefined()
  })
})

describe("public API writes", () => {
  const createBody = {
    workout: {
      workout_id: "session-1",
      title: "Friday Leg Day",
      description: null,
      media: [],
      exercises: [
        {
          title: "Squat",
          exercise_template_id: "A1",
          rest_timer_seconds: 90,
          notes: "deep",
          volume_doubling_enabled: true,
          sets: [
            {
              index: 0,
              type: "normal",
              weight_kg: 140,
              reps: 5,
              distance_meters: null,
              duration_seconds: null,
              custom_metric: null,
              rpe: 9,
              completed_at: "2024-08-14T12:05:00Z",
            },
          ],
        },
      ],
      start_time: 1723636800,
      end_time: 1723638600,
      routine_id: "r-9",
      apple_watch: false,
      wearos_watch: false,
      is_private: true,
      is_biometrics_public: false,
      gym: null,
    },
    share_to_strava: true,
  }

  it("translates the create body and drops unrepresentable fields", async () => {
    const { calls, fetcher } = recordingFetcher(url => {
      if (url.endsWith("/v1/workouts")) {
        return Response.json({ ...baseWorkout, id: "server-1", title: "Friday Leg Day" })
      }
      return undefined
    })
    const created = await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.createWorkout(createBody)),
    )

    const body = JSON.parse(calls[0]?.body ?? "{}") as {
      workout: Record<string, unknown> & { sets?: unknown }
    }
    const exercise = ((body.workout.exercises as Array<Record<string, unknown>>).at(0) ??
      {}) as Record<string, unknown> & { sets?: Array<Record<string, unknown>> }
    const set = exercise.sets ?? []
    expect(body.workout.title).toBe("Friday Leg Day")
    expect(body.workout.start_time).toBe("2024-08-14T12:00:00.000Z")
    expect(body.workout.end_time).toBe("2024-08-14T12:30:00.000Z")
    expect(body.workout.is_private).toBe(true)
    expect(body.workout.workout_id).toBeUndefined()
    expect(body.workout.routine_id).toBeUndefined()
    expect(exercise.exercise_template_id).toBe("A1")
    expect(exercise.rest_timer_seconds).toBeUndefined()
    expect(exercise.volume_doubling_enabled).toBeUndefined()
    expect(set[0]?.type).toBe("normal")
    expect(set[0]?.rpe).toBe(9)
    expect(set[0]?.completed_at).toBeUndefined()
    expect(set[0]?.index).toBeUndefined()
    expect(created.id).toBe("server-1")
  })

  it("rejects set values the public API cannot represent", async () => {
    const { fetcher } = recordingFetcher(() => {
      throw new Error("Must not send a request")
    })
    const baseExercise = createBody.workout.exercises[0]
    const baseSet = baseExercise?.sets[0]
    const body = {
      workout: {
        ...createBody.workout,
        exercises: [
          {
            ...(baseExercise ?? {}),
            sets: [{ ...(baseSet ?? {}), rpe: 6.5 }],
          },
        ],
      },
    }
    const error = await failureOf(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.createWorkout(body)),
    )
    expect(error._tag).toBe("ApiError")
    expect(error.code).toBe("value_not_representable")
  })

  it("merges the current workout into the full-body update", async () => {
    const { calls, fetcher } = recordingFetcher((url, init) => {
      if (init?.method === "PUT") return Response.json({ ...baseWorkout })
      if (url.endsWith("/v1/workouts/w1")) return Response.json(baseWorkout)
      return undefined
    })
    const updateBody = {
      workoutUpdate: {
        exercises: [
          {
            exercise_template_id: "D04AC939",
            superset_id: null,
            notes: "corrected",
            sets: [{ index: 0, type: "normal", weight_kg: 102.5, reps: 8, rpe: null }],
          },
        ],
      },
    }
    await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.updateWorkout("w1", updateBody)),
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.method).toBe("GET")
    expect(calls[1]?.method).toBe("PUT")
    const body = JSON.parse(calls[1]?.body ?? "{}") as { workout: Record<string, unknown> }
    expect(body.workout.title).toBe("Morning Workout")
    expect(body.workout.start_time).toBe("2024-08-14T12:00:00Z")
    expect(body.workout.end_time).toBe("2024-08-14T12:30:00Z")
    const exercise = (body.workout.exercises as Array<Record<string, unknown>>).at(0) ?? {}
    expect(exercise.notes).toBe("corrected")
  })

  it("writes routines with public folder ids and set types", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json({ id: "r1" }))
    const routineBody = {
      routine: {
        _unsyncedObjectId: "r1",
        title: "Push",
        parent_routine_id: null,
        folder_id: "42",
        index: 0,
        program_id: null,
        notes: "focus",
        coach_force_rpe_enabled: false,
        exercises: [
          {
            exercise_template_id: "A1",
            rest_seconds: 60,
            notes: null,
            sets: [
              {
                index: 0,
                indicator: "dropset",
                weight_kg: null,
                reps: 12,
                distance_meters: null,
                duration_seconds: null,
                custom_metric: null,
                rpe: 7,
              },
            ],
          },
        ],
      },
    }
    await Effect.runPromise(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.updateRoutine("r1", routineBody)),
    )

    const body = JSON.parse(calls[0]?.body ?? "{}") as { routine: Record<string, unknown> }
    expect(calls[0]?.url).toBe("https://api.example.test/v1/routines/r1")
    expect(body.routine.title).toBe("Push")
    expect(body.routine.folder_id).toBe(42)
    expect(body.routine.coach_force_rpe_enabled).toBeUndefined()
    const exercise = (body.routine.exercises as Array<Record<string, unknown>>).at(0) ?? {}
    const set = ((exercise.sets as Array<Record<string, unknown>>) ?? []).at(0) ?? {}
    expect(exercise.rest_seconds).toBe(60)
    expect(set.type).toBe("dropset")
    expect(set.indicator).toBeUndefined()
    expect(set.rpe).toBe(7)
  })

  it("fails workout deletion because the public API cannot delete", async () => {
    const { fetcher } = recordingFetcher(() => {
      throw new Error("Must not send a request")
    })
    const error = await failureOf(
      Effect.flatMap(makePublicApi(config, fetcher), api => api.deleteWorkout("w1")),
    )
    expect(error.code).toBe("operation_unavailable")
    expect(error.status).toBe(501)
  })
})
