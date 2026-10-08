import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  BodyMeasurementSavePreview,
  createBodyMeasurementSavePreview,
  MeasurementValuesRequest,
  measurementRevision,
  normalizeMeasurement,
  RequestedBodyMeasurementSave,
  toCreateBodyMeasurementBody,
  toUpdateBodyMeasurementBody,
  validateBodyMeasurementSavePreview,
  verifyBodyMeasurementAfterWrite,
  verifyBodyMeasurementSave,
} from "../src/body-measurement"
import { ApiError } from "../src/errors"
import { BodyMeasurement } from "../src/types"

function existingMeasurement(overrides: Partial<Record<string, number | null>> = {}) {
  return BodyMeasurement.make({
    date: "2026-10-08",
    weight_kg: 80,
    lean_mass_kg: null,
    fat_percent: 18.5,
    neck_cm: null,
    shoulder_cm: null,
    chest_cm: null,
    left_bicep_cm: null,
    right_bicep_cm: null,
    left_forearm_cm: null,
    right_forearm_cm: null,
    abdomen: null,
    waist: 80,
    hips: null,
    left_thigh: null,
    right_thigh: null,
    left_calf: null,
    right_calf: null,
    ...overrides,
  } as Parameters<typeof BodyMeasurement.make>[0])
}

function request(date: string, values: Record<string, number | null> = {}) {
  return RequestedBodyMeasurementSave.make({ date, values: MeasurementValuesRequest.make(values) })
}

async function failureOf<A>(program: Effect.Effect<A, unknown>): Promise<ApiError> {
  const error = await Effect.runPromise(program.pipe(Effect.flip))
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe("body-measurement save preview", () => {
  it("materializes omitted values as null on create", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(request("2026-10-08", { weightKg: 80 }), null),
    )
    expect(preview.operation).toBe("create")
    expect(preview.before).toBeNull()
    expect(preview.after.weightKg).toBe(80)
    expect(preview.after.fatPercent).toBeNull()
    expect(preview.revision).toBe("absent:2026-10-08")
  })

  it("preserves omitted values, clears explicit nulls, and replaces changed values on update", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 82, fatPercent: null, waistCm: 79 }),
        existingMeasurement(),
      ),
    )
    expect(preview.operation).toBe("update")
    expect(preview.before?.weightKg).toBe(80)
    expect(preview.after.weightKg).toBe(82)
    expect(preview.after.fatPercent).toBeNull()
    expect(preview.after.waistCm).toBe(79)
    // Omitted fields keep the existing value.
    expect(preview.after.leanMassKg).toBeNull()
  })

  it("rejects a preview that changes nothing", async () => {
    const error = await failureOf(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 80 }),
        existingMeasurement(),
      ),
    )
    expect(error.code).toBe("no_measurement_change")
  })

  it("rejects dates that are not YYYY-MM-DD", async () => {
    const error = await failureOf(
      createBodyMeasurementSavePreview(request("October 8", { weightKg: 80 }), null),
    )
    expect(error.code).toBe("invalid_date")
  })

  it("anchors the revision on the exact before-state", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 82 }),
        existingMeasurement(),
      ),
    )
    const untouched = await Effect.runPromise(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 82 }),
        existingMeasurement({ waist: 81 }),
      ),
    )
    expect(preview.revision).not.toBe(untouched.revision)
    expect(preview.revision).toBe(
      measurementRevision({ ...normalizeMeasurement(existingMeasurement()), date: "2026-10-08" }),
    )
  })
})

describe("body-measurement apply validation", () => {
  const updatePreview = () =>
    createBodyMeasurementSavePreview(request("2026-10-08", { weightKg: 82 }), existingMeasurement())

  it("accepts an update when the date is unchanged", async () => {
    const preview = await Effect.runPromise(updatePreview())
    await Effect.runPromise(validateBodyMeasurementSavePreview(preview, existingMeasurement()))
  })

  it("rejects an update when any field changed after the preview", async () => {
    const preview = await Effect.runPromise(updatePreview())
    const error = await failureOf(
      validateBodyMeasurementSavePreview(preview, existingMeasurement({ fat_percent: 20 })),
    )
    expect(error.code).toBe("measurement_changed")
    expect(error.status).toBe(409)
  })

  it("rejects an update when the date was removed", async () => {
    const preview = await Effect.runPromise(updatePreview())
    const error = await failureOf(validateBodyMeasurementSavePreview(preview, null))
    expect(error.code).toBe("measurement_changed")
  })

  it("rejects a create when the date appeared after the preview", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(request("2026-10-08", { weightKg: 80 }), null),
    )
    const error = await failureOf(
      validateBodyMeasurementSavePreview(preview, existingMeasurement()),
    )
    expect(error.code).toBe("measurement_changed")
  })

  it("rejects tampered previews", async () => {
    const create = await Effect.runPromise(
      createBodyMeasurementSavePreview(request("2026-10-08", { weightKg: 80 }), null),
    )
    const tampered = BodyMeasurementSavePreview.make({
      ...create,
      before: { ...create.after },
    })
    const error = await failureOf(validateBodyMeasurementSavePreview(tampered, null))
    expect(error.code).toBe("invalid_preview")
  })

  it("builds wire bodies with the date only on create", async () => {
    const create = await Effect.runPromise(
      createBodyMeasurementSavePreview(request("2026-10-08", { weightKg: 80, waistCm: 79 }), null),
    )
    const update = await Effect.runPromise(updatePreview())
    expect(toCreateBodyMeasurementBody(create)).toEqual({
      date: "2026-10-08",
      weight_kg: 80,
      lean_mass_kg: null,
      fat_percent: null,
      neck_cm: null,
      shoulder_cm: null,
      chest_cm: null,
      left_bicep_cm: null,
      right_bicep_cm: null,
      left_forearm_cm: null,
      right_forearm_cm: null,
      abdomen: null,
      waist: 79,
      hips: null,
      left_thigh: null,
      right_thigh: null,
      left_calf: null,
      right_calf: null,
    })
    const updateBody = toUpdateBodyMeasurementBody(update) as Record<string, unknown>
    expect(updateBody.date).toBeUndefined()
    expect(updateBody.weight_kg).toBe(82)
    expect(updateBody.waist).toBe(80)
  })

  it("verifies the saved row against the approved after-state", async () => {
    const preview = await Effect.runPromise(updatePreview())
    await Effect.runPromise(
      verifyBodyMeasurementSave(preview, existingMeasurement({ weight_kg: 82 })),
    )
    const missing = await failureOf(verifyBodyMeasurementSave(preview, null))
    expect(missing.code).toBe("verification_failed")
    const mismatch = await failureOf(verifyBodyMeasurementSave(preview, existingMeasurement()))
    expect(mismatch.status).toBe(502)
  })
})

describe("body-measurement apply hardening", () => {
  it("rejects an update whose revision does not match its own before snapshot", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 82 }),
        existingMeasurement(),
      ),
    )
    const tampered = BodyMeasurementSavePreview.make({
      ...preview,
      revision: JSON.stringify(["2026-10-08", "different state"]),
    })
    const error = await failureOf(
      validateBodyMeasurementSavePreview(tampered, existingMeasurement()),
    )
    expect(error.code).toBe("measurement_changed")
  })

  it("rejects a create with a fabricated revision", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(request("2026-10-08", { weightKg: 80 }), null),
    )
    const tampered = BodyMeasurementSavePreview.make({ ...preview, revision: "absent:2099-01-01" })
    const error = await failureOf(validateBodyMeasurementSavePreview(tampered, null))
    expect(error.code).toBe("invalid_preview")
  })

  it("reports a failed read-back after a successful write as verification_failed", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 82 }),
        existingMeasurement(),
      ),
    )
    const readFailure = new ApiError({
      status: 502,
      code: "invalid_api_response",
      message: "bad json",
    })
    const error = await failureOf(
      verifyBodyMeasurementAfterWrite(preview, Effect.fail(readFailure)),
    )
    expect(error.code).toBe("verification_failed")
    expect(error.status).toBe(502)
    expect(error.message).toContain("may have been saved")
  })

  it("returns the saved row when the read-back verifies", async () => {
    const preview = await Effect.runPromise(
      createBodyMeasurementSavePreview(
        request("2026-10-08", { weightKg: 82 }),
        existingMeasurement(),
      ),
    )
    const saved = await Effect.runPromise(
      verifyBodyMeasurementAfterWrite(
        preview,
        Effect.succeed(existingMeasurement({ weight_kg: 82 })),
      ),
    )
    expect(saved?.weight_kg).toBe(82)
  })
})
