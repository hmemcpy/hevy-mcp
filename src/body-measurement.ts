import { Effect, Schema } from "effect"
import { ApiError, type HevyApiError } from "./errors"
import type { BodyMeasurement } from "./types"

// Hevy stores one body-measurement row per calendar date. The public API
// creates rows with POST /v1/body_measurements (409 when the date already
// exists) and replaces the whole row with PUT /v1/body_measurements/{date};
// fields omitted from the PUT body become null. A save preview therefore
// materializes the complete after-state: omitted values keep the existing
// entry's value on update, explicit nulls clear values, and omitted values on
// create become null. Hevy reports no updated_at for measurements, so the
// normalized before-state is the revision: apply re-reads the date and
// refuses to write when that state changed. This is best-effort concurrency
// protection against other clients; it cannot make Hevy's write atomic.

const MeasurementValue = Schema.NullOr(Schema.Finite)

export class MeasurementValuesRequest extends Schema.Class<MeasurementValuesRequest>(
  "MeasurementValuesRequest",
)({
  weightKg: Schema.optionalKey(MeasurementValue),
  leanMassKg: Schema.optionalKey(MeasurementValue),
  fatPercent: Schema.optionalKey(MeasurementValue),
  neckCm: Schema.optionalKey(MeasurementValue),
  shoulderCm: Schema.optionalKey(MeasurementValue),
  chestCm: Schema.optionalKey(MeasurementValue),
  leftBicepCm: Schema.optionalKey(MeasurementValue),
  rightBicepCm: Schema.optionalKey(MeasurementValue),
  leftForearmCm: Schema.optionalKey(MeasurementValue),
  rightForearmCm: Schema.optionalKey(MeasurementValue),
  abdomenCm: Schema.optionalKey(MeasurementValue),
  waistCm: Schema.optionalKey(MeasurementValue),
  hipsCm: Schema.optionalKey(MeasurementValue),
  leftThighCm: Schema.optionalKey(MeasurementValue),
  rightThighCm: Schema.optionalKey(MeasurementValue),
  leftCalfCm: Schema.optionalKey(MeasurementValue),
  rightCalfCm: Schema.optionalKey(MeasurementValue),
}) {}

export class RequestedBodyMeasurementSave extends Schema.Class<RequestedBodyMeasurementSave>(
  "RequestedBodyMeasurementSave",
)({
  date: Schema.String,
  values: MeasurementValuesRequest,
}) {}

export class MeasurementSnapshot extends Schema.Class<MeasurementSnapshot>("MeasurementSnapshot")({
  date: Schema.String,
  weightKg: MeasurementValue,
  leanMassKg: MeasurementValue,
  fatPercent: MeasurementValue,
  neckCm: MeasurementValue,
  shoulderCm: MeasurementValue,
  chestCm: MeasurementValue,
  leftBicepCm: MeasurementValue,
  rightBicepCm: MeasurementValue,
  leftForearmCm: MeasurementValue,
  rightForearmCm: MeasurementValue,
  abdomenCm: MeasurementValue,
  waistCm: MeasurementValue,
  hipsCm: MeasurementValue,
  leftThighCm: MeasurementValue,
  rightThighCm: MeasurementValue,
  leftCalfCm: MeasurementValue,
  rightCalfCm: MeasurementValue,
}) {}

export class BodyMeasurementSavePreview extends Schema.Class<BodyMeasurementSavePreview>(
  "BodyMeasurementSavePreview",
)({
  date: Schema.String,
  operation: Schema.Literals(["create", "update"]),
  revision: Schema.NonEmptyString,
  before: Schema.NullOr(MeasurementSnapshot),
  after: MeasurementSnapshot,
}) {}

// Public (camelCase) field name paired with the Hevy wire (snake_case) name.
export const MEASUREMENT_FIELDS = [
  ["weightKg", "weight_kg"],
  ["leanMassKg", "lean_mass_kg"],
  ["fatPercent", "fat_percent"],
  ["neckCm", "neck_cm"],
  ["shoulderCm", "shoulder_cm"],
  ["chestCm", "chest_cm"],
  ["leftBicepCm", "left_bicep_cm"],
  ["rightBicepCm", "right_bicep_cm"],
  ["leftForearmCm", "left_forearm_cm"],
  ["rightForearmCm", "right_forearm_cm"],
  ["abdomenCm", "abdomen"],
  ["waistCm", "waist"],
  ["hipsCm", "hips"],
  ["leftThighCm", "left_thigh"],
  ["rightThighCm", "right_thigh"],
  ["leftCalfCm", "left_calf"],
  ["rightCalfCm", "right_calf"],
] as const

export function normalizeMeasurement(measurement: BodyMeasurement): MeasurementSnapshot {
  return MeasurementSnapshot.make({
    date: measurement.date,
    weightKg: measurement.weight_kg ?? null,
    leanMassKg: measurement.lean_mass_kg ?? null,
    fatPercent: measurement.fat_percent ?? null,
    neckCm: measurement.neck_cm ?? null,
    shoulderCm: measurement.shoulder_cm ?? null,
    chestCm: measurement.chest_cm ?? null,
    leftBicepCm: measurement.left_bicep_cm ?? null,
    rightBicepCm: measurement.right_bicep_cm ?? null,
    leftForearmCm: measurement.left_forearm_cm ?? null,
    rightForearmCm: measurement.right_forearm_cm ?? null,
    abdomenCm: measurement.abdomen ?? null,
    waistCm: measurement.waist ?? null,
    hipsCm: measurement.hips ?? null,
    leftThighCm: measurement.left_thigh ?? null,
    rightThighCm: measurement.right_thigh ?? null,
    leftCalfCm: measurement.left_calf ?? null,
    rightCalfCm: measurement.right_calf ?? null,
  })
}

// Deterministic canonical form of a snapshot: date plus every field in a
// fixed order. Serves as the revision anchor because Hevy exposes no
// updated_at for measurements.
export function measurementRevision(snapshot: MeasurementSnapshot): string {
  return JSON.stringify([snapshot.date, ...MEASUREMENT_FIELDS.map(([field]) => snapshot[field])])
}

function emptySnapshot(date: string): MeasurementSnapshot {
  return MeasurementSnapshot.make({
    date,
    weightKg: null,
    leanMassKg: null,
    fatPercent: null,
    neckCm: null,
    shoulderCm: null,
    chestCm: null,
    leftBicepCm: null,
    rightBicepCm: null,
    leftForearmCm: null,
    rightForearmCm: null,
    abdomenCm: null,
    waistCm: null,
    hipsCm: null,
    leftThighCm: null,
    rightThighCm: null,
    leftCalfCm: null,
    rightCalfCm: null,
  })
}

function resolveField(value: number | null | undefined, existing: number | null): number | null {
  return value === undefined ? existing : value
}

function applyValues(
  date: string,
  values: MeasurementValuesRequest,
  base: MeasurementSnapshot | null,
): MeasurementSnapshot {
  const current = base ?? emptySnapshot(date)
  return MeasurementSnapshot.make({
    date: current.date,
    weightKg: resolveField(values.weightKg, current.weightKg),
    leanMassKg: resolveField(values.leanMassKg, current.leanMassKg),
    fatPercent: resolveField(values.fatPercent, current.fatPercent),
    neckCm: resolveField(values.neckCm, current.neckCm),
    shoulderCm: resolveField(values.shoulderCm, current.shoulderCm),
    chestCm: resolveField(values.chestCm, current.chestCm),
    leftBicepCm: resolveField(values.leftBicepCm, current.leftBicepCm),
    rightBicepCm: resolveField(values.rightBicepCm, current.rightBicepCm),
    leftForearmCm: resolveField(values.leftForearmCm, current.leftForearmCm),
    rightForearmCm: resolveField(values.rightForearmCm, current.rightForearmCm),
    abdomenCm: resolveField(values.abdomenCm, current.abdomenCm),
    waistCm: resolveField(values.waistCm, current.waistCm),
    hipsCm: resolveField(values.hipsCm, current.hipsCm),
    leftThighCm: resolveField(values.leftThighCm, current.leftThighCm),
    rightThighCm: resolveField(values.rightThighCm, current.rightThighCm),
    leftCalfCm: resolveField(values.leftCalfCm, current.leftCalfCm),
    rightCalfCm: resolveField(values.rightCalfCm, current.rightCalfCm),
  })
}

export const createBodyMeasurementSavePreview = Effect.fn("BodyMeasurement.createSavePreview")(
  function* (request: RequestedBodyMeasurementSave, existing: BodyMeasurement | null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date)) {
      return yield* new ApiError({
        status: 400,
        code: "invalid_date",
        message: "Measurement date must be formatted YYYY-MM-DD",
      })
    }
    // The fetched row's date is normalized to the requested date so the
    // revision and the no-change comparison cannot diverge on date formatting.
    const before =
      existing === null ? null : { ...normalizeMeasurement(existing), date: request.date }
    const after = applyValues(request.date, request.values, before)
    if (before !== null && measurementRevision(before) === measurementRevision(after)) {
      return yield* new ApiError({
        status: 400,
        code: "no_measurement_change",
        message: "Requested values match the existing measurement",
      })
    }
    return BodyMeasurementSavePreview.make({
      date: request.date,
      operation: before === null ? "create" : "update",
      revision: before === null ? `absent:${request.date}` : measurementRevision(before),
      before,
      after,
    })
  },
)

export const validateBodyMeasurementSavePreview = Effect.fn("BodyMeasurement.validateSavePreview")(
  function* (preview: BodyMeasurementSavePreview, current: BodyMeasurement | null) {
    if (preview.after.date !== preview.date) {
      return yield* new ApiError({
        status: 400,
        code: "date_mismatch",
        message: "Preview payload and measurement date differ",
      })
    }
    if (preview.operation === "create" && preview.before !== null) {
      return yield* new ApiError({
        status: 400,
        code: "invalid_preview",
        message: "Create previews must not carry a before snapshot",
      })
    }
    if (preview.operation === "update" && preview.before === null) {
      return yield* new ApiError({
        status: 400,
        code: "invalid_preview",
        message: "Update previews must carry the before snapshot they were built from",
      })
    }
    if (preview.operation === "create") {
      if (preview.revision !== `absent:${preview.date}`) {
        return yield* new ApiError({
          status: 400,
          code: "invalid_preview",
          message: "Create preview revisions must reference the absent date",
        })
      }
      if (current !== null) {
        return yield* new ApiError({
          status: 409,
          code: "measurement_changed",
          message: "A measurement for this date was created after the preview",
        })
      }
      return
    }
    if (current === null) {
      return yield* new ApiError({
        status: 409,
        code: "measurement_changed",
        message: "The measurement for this date was removed after the preview",
      })
    }
    if (
      preview.before === null ||
      preview.before.date !== preview.date ||
      measurementRevision(preview.before) !== preview.revision ||
      measurementRevision(normalizeMeasurement(current)) !== preview.revision
    ) {
      return yield* new ApiError({
        status: 409,
        code: "measurement_changed",
        message: "The measurement for this date changed after the preview",
      })
    }
  },
)

function toFields(snapshot: MeasurementSnapshot): Record<string, number | null> {
  const fields: Record<string, number | null> = {}
  for (const [publicName, wireName] of MEASUREMENT_FIELDS) {
    fields[wireName] = snapshot[publicName]
  }
  return fields
}

export function toCreateBodyMeasurementBody(preview: BodyMeasurementSavePreview): object {
  return { date: preview.date, ...toFields(preview.after) }
}

export function toUpdateBodyMeasurementBody(preview: BodyMeasurementSavePreview): object {
  return toFields(preview.after)
}

export const verifyBodyMeasurementSave = Effect.fn("BodyMeasurement.verifySave")(function* (
  preview: BodyMeasurementSavePreview,
  saved: BodyMeasurement | null,
) {
  if (
    saved === null ||
    measurementRevision(normalizeMeasurement(saved)) !== measurementRevision(preview.after)
  ) {
    return yield* new ApiError({
      status: 502,
      code: "verification_failed",
      message:
        "The measurement may have been saved, but reading it back did not match the approved preview. Check the date in Hevy before retrying.",
    })
  }
})

// Read-back after a successful write. A failed read must not masquerade as a
// rejected write: the row may exist in Hevy, so report it as a verification
// failure with the may-have-been-saved warning. Returns the saved row on
// success so callers do not read the date twice.
export const verifyBodyMeasurementAfterWrite = Effect.fn("BodyMeasurement.verifyAfterWrite")(
  function* (
    preview: BodyMeasurementSavePreview,
    read: Effect.Effect<BodyMeasurement | null, ApiError | HevyApiError>,
  ): Effect.fn.Return<BodyMeasurement | null, ApiError> {
    const saved = yield* read.pipe(
      Effect.catch(error =>
        Effect.fail(
          new ApiError({
            status: 502,
            code: "verification_failed",
            message: `The measurement may have been saved, but reading it back failed (${
              error._tag === "ApiError" ? error.code : `hevy_api_error_${error.apiStatus}`
            }). Check the date in Hevy before retrying.`,
          }),
        ),
      ),
    )
    yield* verifyBodyMeasurementSave(preview, saved)
    return saved
  },
)
