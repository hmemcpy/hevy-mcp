import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider"
import { Schema } from "effect"

export interface UpstreamConfig {
  UPSTREAM_API_KEY: string
  UPSTREAM_BASE_URL: string
  UPSTREAM_APP_VERSION: string
  UPSTREAM_APP_BUILD: string
  UPSTREAM_PLATFORM: string
  UPSTREAM_USER_AGENT: string
}

export interface Env extends UpstreamConfig {
  SESSION_COORDINATOR: DurableObjectNamespace
  OAUTH_KV: KVNamespace
  OAUTH_PROVIDER: OAuthHelpers
  AUTOMATION_API_TOKEN: string
  BOOTSTRAP_SESSION_JSON: string
}

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const RepetitionCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const RateOfPerceivedExertion = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 10 }))

export class MobileSession extends Schema.Class<MobileSession>("MobileSession")({
  accessToken: Schema.NonEmptyString,
  authToken: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  expiresAt: Schema.NonEmptyString,
}) {}

export const SnakeCaseMobileSessionSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  auth_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_at: Schema.NonEmptyString,
})

export class UpstreamSet extends Schema.Class<UpstreamSet>("UpstreamSet")({
  index: Schema.Int,
  indicator: Schema.String,
  weight_kg: Schema.NullOr(Schema.Finite),
  reps: Schema.NullOr(Schema.Int),
  rpe: Schema.NullOr(Schema.Finite),
  distance_meters: Schema.NullOr(Schema.Finite),
  duration_seconds: Schema.NullOr(Schema.Finite),
  custom_metric: Schema.NullOr(Schema.Finite),
  completed_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  prs: Schema.optionalKey(Schema.Unknown),
  personalRecords: Schema.optionalKey(Schema.Unknown),
}) {}

export class UpstreamRoutineExercise extends Schema.Class<UpstreamRoutineExercise>(
  "UpstreamRoutineExercise",
)({
  id: Schema.optionalKey(Schema.String),
  exercise_template_id: Schema.NonEmptyString,
  title: Schema.String,
  exercise_type: Schema.optionalKey(Schema.String),
  equipment_category: Schema.optionalKey(Schema.String),
  muscle_group: Schema.optionalKey(Schema.String),
  other_muscles: Schema.optionalKey(Schema.Array(Schema.String)),
  notes: Schema.NullOr(Schema.String),
  rest_seconds: Schema.Finite,
  sets: Schema.Array(UpstreamSet),
}) {}

export class UpstreamRoutine extends Schema.Class<UpstreamRoutine>("UpstreamRoutine")({
  id: Schema.NonEmptyString,
  title: Schema.String,
  index: Schema.Int,
  updated_at: Schema.NonEmptyString,
  parent_routine_id: Schema.NullOr(Schema.String),
  folder_id: Schema.NullOr(Schema.String),
  program_id: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  coach_force_rpe_enabled: Schema.Boolean,
  exercises: Schema.Array(UpstreamRoutineExercise),
}) {}

export class RoutineSyncResponse extends Schema.Class<RoutineSyncResponse>("RoutineSyncResponse")({
  updated: Schema.Array(UpstreamRoutine),
  deleted: Schema.Array(Schema.String),
  isMore: Schema.Boolean,
  updated_at: Schema.String,
}) {}

export class RefreshResponse extends Schema.Class<RefreshResponse>("RefreshResponse")({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_at: Schema.NonEmptyString,
}) {}

export class CustomExercise extends Schema.Class<CustomExercise>("CustomExercise")({
  id: Schema.NonEmptyString,
  title: Schema.String,
  exercise_type: Schema.optionalKey(Schema.String),
  equipment_category: Schema.optionalKey(Schema.String),
  muscle_group: Schema.optionalKey(Schema.String),
  other_muscles: Schema.optionalKey(Schema.Array(Schema.String)),
  is_archived: Schema.optionalKey(Schema.Boolean),
}) {}

export class CompletedWorkoutExercise extends Schema.Class<CompletedWorkoutExercise>(
  "CompletedWorkoutExercise",
)({
  id: Schema.optionalKey(Schema.String),
  exercise_template_id: Schema.NonEmptyString,
  title: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rest_seconds: Schema.optionalKey(Schema.Finite),
  superset_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  volume_doubling_enabled: Schema.optionalKey(Schema.Boolean),
  sets: Schema.Array(UpstreamSet),
}) {}

export class CompletedWorkout extends Schema.Class<CompletedWorkout>("CompletedWorkout")({
  id: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  routine_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  start_time: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  end_time: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  created_at: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
  is_private: Schema.optionalKey(Schema.Boolean),
  estimated_volume_kg: Schema.optionalKey(Schema.Finite),
  exercises: Schema.Array(CompletedWorkoutExercise),
}) {}

export class WorkoutCountResponse extends Schema.Class<WorkoutCountResponse>(
  "WorkoutCountResponse",
)({
  workout_count: Schema.Int,
}) {}

export class WorkoutSyncResponse extends Schema.Class<WorkoutSyncResponse>("WorkoutSyncResponse")({
  updated: Schema.Array(CompletedWorkout),
  deleted: Schema.Array(Schema.String),
  isMore: Schema.Boolean,
  updated_at: Schema.optionalKey(Schema.String),
}) {}

export const WorkoutSyncRequestSchema = Schema.Struct({
  known: Schema.Record(Schema.String, Schema.String),
})

export class BodyMeasurement extends Schema.Class<BodyMeasurement>("BodyMeasurement")({
  id: Schema.optionalKey(Schema.Int),
  date: Schema.String,
  weight_kg: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  lean_mass_kg: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  fat_percent: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  neck_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  shoulder_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  chest_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_bicep_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_bicep_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_forearm_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_forearm_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  abdomen: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  waist: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  hips: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_thigh: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_thigh: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  left_calf: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  right_calf: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  created_at: Schema.optionalKey(Schema.String),
}) {}

export class UserAccount extends Schema.Class<UserAccount>("UserAccount")({
  id: Schema.NonEmptyString,
  username: Schema.NonEmptyString,
  full_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  country_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
  city: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sex: Schema.optionalKey(Schema.NullOr(Schema.String)),
  birthday: Schema.optionalKey(Schema.NullOr(Schema.String)),
  height_cm: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  last_workout_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_coached: Schema.optionalKey(Schema.Boolean),
  is_a_coach: Schema.optionalKey(Schema.Boolean),
}) {}

export class ChangeValues extends Schema.Class<ChangeValues>("ChangeValues")({
  weightKg: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  reps: Schema.optionalKey(Schema.NullOr(RepetitionCount)),
  rpe: Schema.optionalKey(Schema.NullOr(RateOfPerceivedExertion)),
}) {}

export class RequestedChange extends Schema.Class<RequestedChange>("RequestedChange")({
  exerciseTemplateId: Schema.NonEmptyString,
  setIndex: Schema.Natural,
  values: ChangeValues,
}) {}

export const RequestedChangesSchema = Schema.Array(RequestedChange).check(Schema.isMinLength(1))

export class PreviewChange extends Schema.Class<PreviewChange>("PreviewChange")({
  exerciseTemplateId: Schema.NonEmptyString,
  exerciseTitle: Schema.String,
  setIndex: Schema.Natural,
  before: ChangeValues,
  after: ChangeValues,
}) {}

export class ProgressionPreview extends Schema.Class<ProgressionPreview>("ProgressionPreview")({
  routineId: Schema.NonEmptyString,
  routineTitle: Schema.String,
  revision: Schema.NonEmptyString,
  changes: Schema.Array(PreviewChange).check(Schema.isMinLength(1)),
}) {}

export const PreviewRequestSchema = Schema.Struct({ changes: RequestedChangesSchema })

export class WorkoutSetValues extends Schema.Class<WorkoutSetValues>("WorkoutSetValues")({
  weightKg: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  reps: Schema.optionalKey(Schema.NullOr(RepetitionCount)),
  rpe: Schema.optionalKey(Schema.NullOr(RateOfPerceivedExertion)),
  distanceMeters: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  durationSeconds: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  customMetric: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
}) {}

export class RequestedWorkoutSetChange extends Schema.Class<RequestedWorkoutSetChange>(
  "RequestedWorkoutSetChange",
)({
  exerciseId: Schema.NonEmptyString,
  setIndex: Schema.Natural,
  values: WorkoutSetValues,
}) {}

export const RequestedWorkoutSetChangesSchema = Schema.Array(RequestedWorkoutSetChange).check(
  Schema.isMinLength(1),
)

export class WorkoutSetPreviewChange extends Schema.Class<WorkoutSetPreviewChange>(
  "WorkoutSetPreviewChange",
)({
  exerciseId: Schema.NonEmptyString,
  exerciseTemplateId: Schema.NonEmptyString,
  exerciseTitle: Schema.String,
  setIndex: Schema.Natural,
  before: WorkoutSetValues,
  after: WorkoutSetValues,
}) {}

export class WorkoutEditPreview extends Schema.Class<WorkoutEditPreview>("WorkoutEditPreview")({
  workoutId: Schema.NonEmptyString,
  workoutTitle: Schema.String,
  revision: Schema.NonEmptyString,
  changes: Schema.Array(WorkoutSetPreviewChange).check(Schema.isMinLength(1)),
}) {}

export const WorkoutEditPreviewRequestSchema = Schema.Struct({
  changes: RequestedWorkoutSetChangesSchema,
})

export class RequestedWorkoutInsertionSet extends Schema.Class<RequestedWorkoutInsertionSet>(
  "RequestedWorkoutInsertionSet",
)({
  indicator: Schema.optionalKey(Schema.String),
  weightKg: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  reps: Schema.optionalKey(Schema.NullOr(RepetitionCount)),
  rpe: Schema.optionalKey(Schema.NullOr(RateOfPerceivedExertion)),
  distanceMeters: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  durationSeconds: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  customMetric: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  completedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

export class RequestedWorkoutExerciseInsertion extends Schema.Class<RequestedWorkoutExerciseInsertion>(
  "RequestedWorkoutExerciseInsertion",
)({
  exerciseTemplateId: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  notes: Schema.optionalKey(Schema.String),
  restSeconds: Schema.optionalKey(NonNegativeNumber),
  supersetId: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  volumeDoublingEnabled: Schema.optionalKey(Schema.Boolean),
  sets: Schema.Array(RequestedWorkoutInsertionSet).check(Schema.isMinLength(1)),
}) {}

export class WorkoutInsertionSet extends Schema.Class<WorkoutInsertionSet>("WorkoutInsertionSet")({
  index: Schema.Natural,
  indicator: Schema.String,
  weightKg: Schema.NullOr(NonNegativeNumber),
  reps: Schema.NullOr(RepetitionCount),
  rpe: Schema.NullOr(RateOfPerceivedExertion),
  distanceMeters: Schema.NullOr(NonNegativeNumber),
  durationSeconds: Schema.NullOr(NonNegativeNumber),
  customMetric: Schema.NullOr(NonNegativeNumber),
  completedAt: Schema.NullOr(Schema.String),
}) {}

export class WorkoutExerciseInsertion extends Schema.Class<WorkoutExerciseInsertion>(
  "WorkoutExerciseInsertion",
)({
  exerciseTemplateId: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  notes: Schema.String,
  restSeconds: NonNegativeNumber,
  supersetId: Schema.NullOr(Schema.Union([Schema.String, Schema.Finite])),
  volumeDoublingEnabled: Schema.Boolean,
  sets: Schema.Array(WorkoutInsertionSet).check(Schema.isMinLength(1)),
}) {}

export class WorkoutExerciseInsertPreview extends Schema.Class<WorkoutExerciseInsertPreview>(
  "WorkoutExerciseInsertPreview",
)({
  workoutId: Schema.NonEmptyString,
  workoutTitle: Schema.String,
  revision: Schema.NonEmptyString,
  exerciseCountBefore: Schema.Natural,
  exerciseCountAfter: Schema.Natural,
  insertions: Schema.Array(WorkoutExerciseInsertion).check(Schema.isMinLength(1)),
}) {}

export const WorkoutExerciseInsertPreviewRequestSchema = Schema.Struct({
  insertions: Schema.Array(RequestedWorkoutExerciseInsertion).check(Schema.isMinLength(1)),
})

export const UpstreamErrorBodySchema = Schema.Struct({
  error: Schema.optionalKey(Schema.String),
})
