import { Schema } from "effect"

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
}) {}

export class HevyApiError extends Schema.TaggedError<HevyApiError>()("HevyApiError", {
  apiStatus: Schema.Number,
  apiCode: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class SessionStorageError extends Schema.TaggedError<SessionStorageError>()(
  "SessionStorageError",
  {
    operation: Schema.Literals(["get", "put", "delete"]),
    cause: Schema.Defect(),
  },
) {}
