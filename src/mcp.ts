import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import type { Env } from "./types"
import { SERVER_NAME, SERVER_VERSION } from "./version"

const changeValues = z.object({
  weightKg: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
})

const requestedChange = z.object({
  exerciseTemplateId: z.string().min(1),
  setIndex: z.number().int().nonnegative(),
  values: changeValues,
})

const previewChange = z.object({
  exerciseTemplateId: z.string().min(1),
  exerciseTitle: z.string(),
  setIndex: z.number().int().nonnegative(),
  before: changeValues,
  after: changeValues,
})

const progressionPreview = z.object({
  routineId: z.string().min(1),
  routineTitle: z.string(),
  revision: z.string().min(1),
  changes: z.array(previewChange).min(1),
})

const workoutSetValues = z.object({
  weightKg: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  distanceMeters: z.number().nonnegative().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  customMetric: z.number().nonnegative().nullable().optional(),
})

const requestedWorkoutSetChange = z.object({
  exerciseId: z.string().min(1),
  setIndex: z.number().int().nonnegative(),
  values: workoutSetValues,
})

const workoutSetPreviewChange = z.object({
  exerciseId: z.string().min(1),
  exerciseTemplateId: z.string().min(1),
  exerciseTitle: z.string(),
  setIndex: z.number().int().nonnegative(),
  before: workoutSetValues,
  after: workoutSetValues,
})

const workoutEditPreview = z.object({
  workoutId: z.string().min(1),
  workoutTitle: z.string(),
  revision: z.string().min(1),
  changes: z.array(workoutSetPreviewChange).min(1),
})

const requestedWorkoutInsertionSet = z.object({
  indicator: z.string().optional(),
  weightKg: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  distanceMeters: z.number().nonnegative().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  customMetric: z.number().nonnegative().nullable().optional(),
  completedAt: z.string().nullable().optional(),
})

const requestedWorkoutExerciseInsertion = z.object({
  exerciseTemplateId: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().optional(),
  restSeconds: z.number().nonnegative().optional(),
  supersetId: z.union([z.string(), z.number()]).nullable().optional(),
  volumeDoublingEnabled: z.boolean().optional(),
  sets: z.array(requestedWorkoutInsertionSet).min(1),
})

const workoutInsertionSet = z.object({
  index: z.number().int().nonnegative(),
  indicator: z.string(),
  weightKg: z.number().nonnegative().nullable(),
  reps: z.number().int().nonnegative().nullable(),
  rpe: z.number().min(0).max(10).nullable(),
  distanceMeters: z.number().nonnegative().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  customMetric: z.number().nonnegative().nullable(),
  completedAt: z.string().nullable(),
})

const workoutExerciseInsertion = z.object({
  exerciseTemplateId: z.string().min(1),
  title: z.string().min(1),
  notes: z.string(),
  restSeconds: z.number().nonnegative(),
  supersetId: z.union([z.string(), z.number()]).nullable(),
  volumeDoublingEnabled: z.boolean(),
  sets: z.array(workoutInsertionSet).min(1),
})

const workoutExerciseInsertPreview = z.object({
  workoutId: z.string().min(1),
  workoutTitle: z.string(),
  revision: z.string().min(1),
  exerciseCountBefore: z.number().int().nonnegative(),
  exerciseCountAfter: z.number().int().nonnegative(),
  insertions: z.array(workoutExerciseInsertion).min(1),
})

const draftSetValues = z.object({
  indicator: z.string().optional(),
  weightKg: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  distanceMeters: z.number().nonnegative().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  customMetric: z.number().nonnegative().nullable().optional(),
})

const workoutSessionOperation = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("EditWorkout"),
    title: z.string().optional(),
    description: z.string().optional(),
    isPrivate: z.boolean().optional(),
    isBiometricsPublic: z.boolean().optional(),
    shareToStrava: z.boolean().optional(),
  }),
  z.object({
    _tag: z.literal("AddExercise"),
    exerciseTemplateId: z.string().min(1),
    title: z.string(),
    notes: z.string().optional(),
    restSeconds: z.number().nonnegative().optional(),
    volumeDoublingEnabled: z.boolean().optional(),
  }),
  z.object({
    _tag: z.literal("EditExercise"),
    exerciseId: z.string().min(1),
    title: z.string().optional(),
    notes: z.string().optional(),
    restSeconds: z.number().nonnegative().optional(),
    volumeDoublingEnabled: z.boolean().optional(),
  }),
  z.object({ _tag: z.literal("DeleteExercise"), exerciseId: z.string().min(1) }),
  z.object({
    _tag: z.literal("AddSet"),
    exerciseId: z.string().min(1),
    values: draftSetValues,
  }),
  z.object({
    _tag: z.literal("EditSet"),
    exerciseId: z.string().min(1),
    setIndex: z.number().int().nonnegative(),
    values: draftSetValues,
  }),
  z.object({
    _tag: z.literal("DeleteSet"),
    exerciseId: z.string().min(1),
    setIndex: z.number().int().nonnegative(),
  }),
  z.object({
    _tag: z.literal("StartSet"),
    exerciseId: z.string().min(1),
    setIndex: z.number().int().nonnegative(),
  }),
  z.object({
    _tag: z.literal("CompleteSet"),
    exerciseId: z.string().min(1),
    setIndex: z.number().int().nonnegative(),
    values: draftSetValues,
  }),
])

const finishedWorkoutSet = z.object({
  index: z.number().int().nonnegative(),
  indicator: z.string(),
  weightKg: z.number().nonnegative().nullable(),
  reps: z.number().int().nonnegative().nullable(),
  rpe: z.number().min(0).max(10).nullable(),
  distanceMeters: z.number().nonnegative().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  customMetric: z.number().nonnegative().nullable(),
  completedAt: z.string().min(1),
  elapsedSeconds: z.number().nonnegative().nullable(),
})

const finishedWorkoutExercise = z.object({
  exerciseTemplateId: z.string().min(1),
  title: z.string(),
  notes: z.string(),
  restSeconds: z.number().nonnegative(),
  volumeDoublingEnabled: z.boolean(),
  sets: z.array(finishedWorkoutSet).min(1),
})

const workoutFinishPreview = z.object({
  sessionId: z.string().min(1),
  workoutId: z.string().min(1),
  revision: z.string().min(1),
  title: z.string(),
  description: z.string(),
  routineId: z.string().nullable(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  durationSeconds: z.number().nonnegative(),
  isPrivate: z.boolean(),
  isBiometricsPublic: z.boolean(),
  shareToStrava: z.boolean(),
  exercises: z.array(finishedWorkoutExercise).min(1),
})

const workoutDeletePreview = z.object({
  workoutId: z.string().min(1),
  workoutTitle: z.string(),
  revision: z.string().min(1),
  exerciseCount: z.number().int().nonnegative(),
  setCount: z.number().int().nonnegative(),
})

const measurementValue = z.number().nullable().optional()

const measurementValues = z.object({
  weightKg: measurementValue,
  leanMassKg: measurementValue,
  fatPercent: measurementValue,
  neckCm: measurementValue,
  shoulderCm: measurementValue,
  chestCm: measurementValue,
  leftBicepCm: measurementValue,
  rightBicepCm: measurementValue,
  leftForearmCm: measurementValue,
  rightForearmCm: measurementValue,
  abdomenCm: measurementValue,
  waistCm: measurementValue,
  hipsCm: measurementValue,
  leftThighCm: measurementValue,
  rightThighCm: measurementValue,
  leftCalfCm: measurementValue,
  rightCalfCm: measurementValue,
})

const measurementSnapshotValue = z.number().nullable()

const measurementSnapshot = z.object({
  date: z.string().min(1),
  weightKg: measurementSnapshotValue,
  leanMassKg: measurementSnapshotValue,
  fatPercent: measurementSnapshotValue,
  neckCm: measurementSnapshotValue,
  shoulderCm: measurementSnapshotValue,
  chestCm: measurementSnapshotValue,
  leftBicepCm: measurementSnapshotValue,
  rightBicepCm: measurementSnapshotValue,
  leftForearmCm: measurementSnapshotValue,
  rightForearmCm: measurementSnapshotValue,
  abdomenCm: measurementSnapshotValue,
  waistCm: measurementSnapshotValue,
  hipsCm: measurementSnapshotValue,
  leftThighCm: measurementSnapshotValue,
  rightThighCm: measurementSnapshotValue,
  leftCalfCm: measurementSnapshotValue,
  rightCalfCm: measurementSnapshotValue,
})

const bodyMeasurementSavePreview = z.object({
  date: z.string().min(1),
  operation: z.enum(["create", "update"]),
  revision: z.string().min(1),
  before: measurementSnapshot.nullable(),
  after: measurementSnapshot,
})

async function callCoordinator(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const response = await env.SESSION_COORDINATOR.getByName("primary").fetch(
    new Request(new URL(path, "https://coordinator.internal"), init),
  )
  const text = await response.text()
  return {
    content: [{ type: "text", text }],
    ...(response.ok ? {} : { isError: true }),
  }
}

export function createWorkoutMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  })

  server.registerTool(
    "get_recent_workouts",
    {
      title: "Get recent workouts",
      description:
        "Return recent completed workouts with exercises, weights, repetitions, RPE, timestamps, and personal-record indicators. Use this before recommending progression changes.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/workouts"),
  )

  server.registerTool(
    "get_workout",
    {
      title: "Get completed workout",
      description: "Return one completed workout by ID with every exercise and set.",
      inputSchema: z.object({ workoutId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ workoutId }) => callCoordinator(env, `/v1/workouts/${encodeURIComponent(workoutId)}`),
  )

  server.registerTool(
    "get_workout_count",
    {
      title: "Get workout count",
      description: "Return the total completed-workout count.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/workouts/count"),
  )

  server.registerTool(
    "search_exercises",
    {
      title: "Search exercise catalog",
      description:
        "Search available exercises by title or metadata before adding an exercise to an active workout. Sources are this account's Hevy exercise templates (standard and custom) plus the optional owner-supplied catalog overlay.",
      inputSchema: z.object({
        query: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ query, limit }) => {
      const search = new URLSearchParams({ query, limit: String(limit) })
      return callCoordinator(env, `/v1/exercises?${search.toString()}`)
    },
  )

  server.registerTool(
    "list_custom_exercises",
    {
      title: "List custom exercises",
      description: "Return account-specific custom exercise templates.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/custom-exercises"),
  )

  server.registerTool(
    "get_account",
    {
      title: "Get workout account",
      description: "Return the sanitized account profile.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/account"),
  )

  server.registerTool(
    "get_server_info",
    {
      title: "Get server info",
      description:
        "Return the server name, version, and feature list. Use this to confirm which deployment you are talking to.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: SERVER_NAME,
            version: SERVER_VERSION,
            purpose: "Interactive workout session management for a single Hevy account",
            features: [
              "hosted workout sessions",
              "preview-and-apply writes with revision checks",
              "training summary",
              "standard exercise search",
              "body-measurement save previews",
              "workout webhook events",
            ],
          }),
        },
      ],
    }),
  )

  server.registerTool(
    "get_body_measurements",
    {
      title: "Get body measurements",
      description: "Return recorded body measurements.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/body-measurements"),
  )

  server.registerTool(
    "get_training_summary",
    {
      title: "Get training summary",
      description:
        "Return an aggregated view of the last 1-12 weeks (default 4): workout count, sets, volume, per-workout rows, top exercises by volume, and the body-weight trend. Use for progress questions before recommending changes.",
      inputSchema: z.object({
        weeks: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Window length in weeks (1-12, default 4)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ weeks }) => callCoordinator(env, `/v1/training-summary?weeks=${weeks ?? 4}`),
  )

  server.registerTool(
    "preview_body_measurement_save",
    {
      title: "Preview body-measurement save",
      description:
        "Validate saving a body measurement for one date without writing. Omitted values keep the existing entry's value on update; explicit nulls clear values. Always show the returned before/after preview to the user before applying it.",
      inputSchema: z.object({
        date: z.string().min(1).describe("Measurement date formatted YYYY-MM-DD"),
        values: measurementValues,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ date, values }) =>
      callCoordinator(env, "/v1/body-measurements/save/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, values }),
      }),
  )

  server.registerTool(
    "apply_body_measurement_save",
    {
      title: "Apply body-measurement save",
      description:
        "Write a previously returned, unchanged body-measurement preview. Call only after the user explicitly approves the exact preview in the current conversation.",
      inputSchema: z.object({
        preview: bodyMeasurementSavePreview.describe(
          "The complete unchanged result returned by preview_body_measurement_save",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ preview }) =>
      callCoordinator(env, "/v1/body-measurements/save/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      }),
  )

  server.registerTool(
    "list_routine_folders",
    {
      title: "List routine folders",
      description: "Return the account's routine folders.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/routine-folders"),
  )

  server.registerTool(
    "list_routines",
    {
      title: "List workout routines",
      description:
        "Return the user's current routines and their exercise/set targets. Use the returned routine and exercise-template IDs for later tools.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/routines"),
  )

  server.registerTool(
    "get_routine",
    {
      title: "Get one workout routine",
      description: "Return one current routine, including every exercise and target set.",
      inputSchema: z.object({
        routineId: z.string().min(1).describe("Routine ID from list_routines"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ routineId }) => callCoordinator(env, `/v1/routines/${encodeURIComponent(routineId)}`),
  )

  server.registerTool(
    "get_exercise_history",
    {
      title: "Get exercise history",
      description:
        "Return completed sets for one exercise template across recent workouts. Use this to evaluate progress before changing routine targets.",
      inputSchema: z.object({
        exerciseTemplateId: z
          .string()
          .min(1)
          .describe("Exercise-template ID from a workout or routine"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ exerciseTemplateId }) =>
      callCoordinator(env, `/v1/history/${encodeURIComponent(exerciseTemplateId)}`),
  )

  server.registerTool(
    "preview_routine_progression",
    {
      title: "Preview routine progression",
      description:
        "Validate proposed weight, repetition, or RPE changes without writing them. Always show the returned before/after preview to the user before applying it.",
      inputSchema: z.object({
        routineId: z.string().min(1).describe("Routine ID to update"),
        changes: z.array(requestedChange).min(1),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ routineId, changes }) =>
      callCoordinator(env, `/v1/routines/${encodeURIComponent(routineId)}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes }),
      }),
  )

  server.registerTool(
    "apply_routine_progression",
    {
      title: "Apply routine progression",
      description:
        "Write a previously returned, unchanged progression preview. Call only after the user explicitly approves the exact preview in the current conversation.",
      inputSchema: z.object({
        routineId: z.string().min(1).describe("Routine ID from the preview"),
        preview: progressionPreview.describe(
          "The complete unchanged result returned by preview_routine_progression",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ routineId, preview }) =>
      callCoordinator(env, `/v1/routines/${encodeURIComponent(routineId)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      }),
  )

  server.registerTool(
    "preview_completed_workout_edit",
    {
      title: "Preview completed workout edits",
      description:
        "Validate corrections to completed workout sets without writing them. Address each row by exercise ID and set index, and show the exact before/after preview to the user before applying it.",
      inputSchema: z.object({
        workoutId: z.string().min(1).describe("Completed workout ID"),
        changes: z.array(requestedWorkoutSetChange).min(1),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ workoutId, changes }) =>
      callCoordinator(env, `/v1/workouts/${encodeURIComponent(workoutId)}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes }),
      }),
  )

  server.registerTool(
    "apply_completed_workout_edit",
    {
      title: "Apply completed workout edits",
      description:
        "Write a previously returned, unchanged completed-workout preview. Call only after the user explicitly approves the exact preview in the current conversation.",
      inputSchema: z.object({
        workoutId: z.string().min(1).describe("Workout ID from the preview"),
        preview: workoutEditPreview.describe(
          "The complete unchanged result returned by preview_completed_workout_edit",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ workoutId, preview }) =>
      callCoordinator(env, `/v1/workouts/${encodeURIComponent(workoutId)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      }),
  )

  server.registerTool(
    "preview_completed_workout_exercise_insert",
    {
      title: "Preview completed workout exercise insertion",
      description:
        "Validate one or more missing exercise rows and their completed sets without writing. Read exercise-template IDs first, include rest metadata when known, and show the exact insertion preview before applying it.",
      inputSchema: z.object({
        workoutId: z.string().min(1).describe("Completed workout ID"),
        insertions: z.array(requestedWorkoutExerciseInsertion).min(1),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ workoutId, insertions }) =>
      callCoordinator(
        env,
        `/v1/workouts/${encodeURIComponent(workoutId)}/exercise-insert/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ insertions }),
        },
      ),
  )

  server.registerTool(
    "apply_completed_workout_exercise_insert",
    {
      title: "Apply completed workout exercise insertion",
      description:
        "Insert missing exercise rows using a previously returned, unchanged preview. Call only after the user explicitly approves the exact insertion preview in the current conversation.",
      inputSchema: z.object({
        workoutId: z.string().min(1).describe("Workout ID from the preview"),
        preview: workoutExerciseInsertPreview.describe(
          "The complete unchanged result returned by preview_completed_workout_exercise_insert",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ workoutId, preview }) =>
      callCoordinator(env, `/v1/workouts/${encodeURIComponent(workoutId)}/exercise-insert/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      }),
  )

  server.registerTool(
    "get_active_workout_session",
    {
      title: "Get active workout session",
      description:
        "Return the hosted in-progress workout, including its current revision, exercises, sets, and timing metadata.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => callCoordinator(env, "/v1/workout-session"),
  )

  server.registerTool(
    "start_workout_session",
    {
      title: "Start workout session",
      description:
        "Start one hosted workout from a routine or as an empty workout. This records the start time but does not create a completed workout in Hevy.",
      inputSchema: z.object({
        routineId: z.string().min(1).optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        isPrivate: z.boolean().optional(),
        isBiometricsPublic: z.boolean().optional(),
        shareToStrava: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async input =>
      callCoordinator(env, "/v1/workout-session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  )

  server.registerTool(
    "update_workout_session",
    {
      title: "Update active workout session",
      description:
        "Add, edit, or delete active exercises and sets; start a timed set; or complete a set with values. Send the latest revision and use IDs from get_active_workout_session.",
      inputSchema: z.object({
        revision: z.string().min(1),
        operations: z.array(workoutSessionOperation).min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async input =>
      callCoordinator(env, "/v1/workout-session/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  )

  server.registerTool(
    "preview_finish_workout_session",
    {
      title: "Preview finished workout",
      description:
        "Return the exact completed workout that would be saved in one API call. Incomplete sets and exercises with no completed sets are omitted. Show this preview before saving.",
      inputSchema: z.object({ endTime: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async input =>
      callCoordinator(env, "/v1/workout-session/finish/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  )

  server.registerTool(
    "finish_workout_session",
    {
      title: "Finish and save workout",
      description:
        "Save a previously returned, unchanged finish preview as one completed workout. Call only after explicit approval of that exact preview.",
      inputSchema: z.object({ preview: workoutFinishPreview }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ preview }) =>
      callCoordinator(env, "/v1/workout-session/finish/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      }),
  )

  server.registerTool(
    "discard_workout_session",
    {
      title: "Discard active workout",
      description: "Permanently discard the hosted active workout at the supplied revision.",
      inputSchema: z.object({ revision: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async input =>
      callCoordinator(env, "/v1/workout-session/discard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  )

  server.registerTool(
    "preview_completed_workout_delete",
    {
      title: "Preview completed workout deletion",
      description:
        "Return the exact completed workout identity, revision, and counts that would be deleted. Show this preview before deleting.",
      inputSchema: z.object({ workoutId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ workoutId }) =>
      callCoordinator(env, `/v1/workouts/${encodeURIComponent(workoutId)}/delete/preview`, {
        method: "POST",
      }),
  )

  server.registerTool(
    "delete_completed_workout",
    {
      title: "Delete completed workout",
      description:
        "Delete a completed workout using a previously returned, unchanged delete preview. Call only after explicit approval.",
      inputSchema: z.object({
        workoutId: z.string().min(1),
        preview: workoutDeletePreview,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ workoutId, preview }) =>
      callCoordinator(env, `/v1/workouts/${encodeURIComponent(workoutId)}/delete/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preview),
      }),
  )

  // Prompt arguments arrive as strings on the wire, and clients may omit
  // arguments entirely; the schemas accept that. The safety rules live in
  // the prompt text itself so they reach any client that renders prompts.
  server.registerPrompt(
    "start_workout_from_routine",
    {
      title: "Start a workout session",
      description: "Run an interactive workout session with the approval-first finish flow.",
      argsSchema: z.object({ routineId: z.string().min(1) }),
    },
    ({ routineId }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Run an interactive workout session for routine ${routineId} on this Hevy account.`,
              "",
              "During the session:",
              "1. Call get_routine, then start_workout_session with the routine ID.",
              "2. Confirm each logged set succinctly: exercise, actual load, reps, RPE when supplied, and one actionable next-set recommendation. Keep machine-specific baselines and setup notes distinct.",
              "3. Use search_exercises and get_active_workout_session as needed.",
              "",
              "Finishing (mandatory order):",
              "1. Always call preview_finish_workout_session first.",
              "2. Present the exact preview: duration, exercise count, completed-set count, start/end timing, and a readable table of exercises and sets (weights, reps, RPE, useful setup notes). Make omissions explicit (incomplete sets and untouched exercises are dropped from the preview).",
              "3. Offer an interactive approval control only if the client supports one that submits a new user turn approving the exact preview; it must never call the write tool directly. Always provide a plain-text approval fallback.",
              "4. Only after explicit approval of that exact preview in this conversation, call finish_workout_session with the unchanged preview. If the draft changed or the preview is stale, regenerate and request approval again.",
              "5. After saving, report the actual saved workout (duration, exercise and set totals from the response) and 1-2 evidence-based highlights. Never claim success before the save is confirmed, and surface any mismatch between preview and saved result.",
            ].join("\n"),
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    "analyze_workout_progress",
    {
      title: "Analyze workout progress",
      description: "Summarize recent training progress and suggest next steps.",
      argsSchema: z
        .object({
          weeks: z
            .string()
            .regex(/^(?:[1-9]|1[0-2])$/)
            .optional(),
        })
        .prefault({}),
    },
    ({ weeks }) => {
      const window = Number(weeks ?? "4")
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Analyze my training progress over the last ${window} week${window === 1 ? "" : "s"} on this Hevy account.`,
                "",
                "1. Call get_training_summary for the window, then get_recent_workouts and get_exercise_history for the exercises that matter most.",
                "2. Present trends in volume, sets, and workout frequency, plus the body-weight trend, with the actual numbers.",
                "3. Give evidence-based suggestions tied to specific exercises and sets.",
                "4. If you propose routine target changes, validate them with preview_routine_progression, show the before/after preview, and apply only after I explicitly approve the exact preview in this conversation.",
              ].join("\n"),
            },
          },
        ],
      }
    },
  )

  return server
}
