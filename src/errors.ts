import { Schema } from "effect"

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
}) {}

export class UpstreamError extends Schema.TaggedError<UpstreamError>()("UpstreamError", {
  upstreamStatus: Schema.Number,
  upstreamCode: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class SessionStorageError extends Schema.TaggedError<SessionStorageError>()(
  "SessionStorageError",
  {
    operation: Schema.Literals(["get", "put", "delete"]),
    cause: Schema.Defect(),
  },
) {}
