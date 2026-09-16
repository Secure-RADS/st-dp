import { Data, Effect, Schema } from "effect";

const LOG_SERVICE_URL = import.meta.env.VITE_LOG_SERVICE_URL ?? "https://log.secure-rads.org";
const PDM_URL = import.meta.env.VITE_PDM_URL ?? "https://pdm.secure-rads.org";

// Typed domain error for every API failure: transport, HTTP status, or response decode.
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number;
  readonly message: string;
}> {}

const RunEventSchema = Schema.Struct({
  algorithmId: Schema.String,
  runId: Schema.String,
  event: Schema.String,
  timestamp: Schema.String,
  receivedAt: Schema.String,
  detail: Schema.Unknown,
});

const SubjectAccessSchema = Schema.Struct({
  dataSubjectId: Schema.String,
  algorithmId: Schema.String,
  runId: Schema.String,
  timestamp: Schema.String,
  receivedAt: Schema.String,
});

const SubjectAccessResponseSchema = Schema.Struct({
  dataSubjectId: Schema.NullOr(Schema.String),
  accesses: Schema.Array(SubjectAccessSchema),
});

export type RunEvent = Schema.Schema.Type<typeof RunEventSchema>;
export type SubjectAccess = Schema.Schema.Type<typeof SubjectAccessSchema>;
export type SubjectAccessResponse = Schema.Schema.Type<typeof SubjectAccessResponseSchema>;

// One GET + JSON decode as an Effect. Every failure mode is an ApiError, and the response is validated
// against a schema so a shape change surfaces as an error instead of an undefined crashing the render.
function requestJson<A, I>(url: string, schema: Schema.Schema<A, I>): Effect.Effect<A, ApiError> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { headers: { accept: "application/json" } }),
      catch: (cause) => new ApiError({ status: 0, message: `request failed: ${String(cause)}` }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new ApiError({ status: response.status, message: `${response.status} ${response.statusText}` }),
      );
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) => new ApiError({ status: response.status, message: `invalid JSON: ${String(cause)}` }),
    });

    return yield* Schema.decodeUnknown(schema)(body).pipe(
      Effect.mapError((issue) => new ApiError({ status: response.status, message: issue.message })),
    );
  });
}

export const getRunEvents: Effect.Effect<ReadonlyArray<RunEvent>, ApiError> = requestJson(
  `${LOG_SERVICE_URL}/logs`,
  Schema.Array(RunEventSchema),
);

export const getAlgorithmEvents = (algorithmId: string): Effect.Effect<ReadonlyArray<RunEvent>, ApiError> =>
  requestJson(`${LOG_SERVICE_URL}/logs/${encodeURIComponent(algorithmId)}`, Schema.Array(RunEventSchema));

export const getAllSubjectAccess: Effect.Effect<SubjectAccessResponse, ApiError> = requestJson(
  `${LOG_SERVICE_URL}/subject-access`,
  SubjectAccessResponseSchema,
);

export const getSubjectAccess = (dataSubjectId: string): Effect.Effect<SubjectAccessResponse, ApiError> =>
  requestJson(`${PDM_URL}/subject/${encodeURIComponent(dataSubjectId)}`, SubjectAccessResponseSchema);

// The authority dashboard's combined load - both calls in parallel, one Effect.
export const getAuthorityData: Effect.Effect<
  { events: ReadonlyArray<RunEvent>; access: ReadonlyArray<SubjectAccess> },
  ApiError
> = Effect.all({
  events: getRunEvents,
  access: getAllSubjectAccess.pipe(Effect.map((response) => response.accesses)),
});

export const exportUrl = (algorithmId?: string) =>
  `${
    algorithmId ? `${LOG_SERVICE_URL}/logs/${encodeURIComponent(algorithmId)}` : `${LOG_SERVICE_URL}/logs`
  }?format=csv`;

export const exportJsonUrl = (algorithmId?: string) =>
  algorithmId ? `${LOG_SERVICE_URL}/logs/${encodeURIComponent(algorithmId)}` : `${LOG_SERVICE_URL}/logs`;

export const logServiceUrl = LOG_SERVICE_URL;
