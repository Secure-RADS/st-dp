// Keep producer event enums in sync with this ingest allowlist.
export const RUN_EVENTS = [
  "build-started",
  "build-completed",
  "image-uploaded",
  "pcrs-registered",
  "kms-key-provisioned",
  "algorithm-registered",
  "build-failed",
  "run-requested",
  "executor-launched",
  "executor-ready",
  "artifact-retrieved",
  "enclave-launched",
  "launch-failed",
  "executor-finished",
  "enclave-started",
  "unit-ready",
  "attested",
  "records-fetched",
  "records-decrypted",
  "records-stored-locally",
  "dc-app-completed",
  "output-sent",
  "run-failed",
  "result-persisted",
] as const;

export type RunEvent = (typeof RUN_EVENTS)[number];

export function isRunEvent(value: unknown): value is RunEvent {
  return typeof value === "string" && (RUN_EVENTS as readonly string[]).includes(value);
}

// Events only the attested sce-unit emits. Everything else (build-phase registry-service, host-side
// execution-service and result-consumer) cannot attest, so those names stay unauthenticated.
const ENCLAVE_EVENTS = [
  "enclave-started",
  "unit-ready",
  "attested",
  "records-fetched",
  "records-decrypted",
  "records-stored-locally",
  "dc-app-completed",
  "output-sent",
  "run-failed",
] as const;

export function isEnclaveEvent(value: string): boolean {
  return (ENCLAVE_EVENTS as readonly string[]).includes(value);
}
