// Keep producer event enums in sync with this ingest allowlist.
export const ENCLAVE_EVENTS = [
  "enclave-started",
  "unit-ready",
  "attested",
  "records-fetched",
  "records-decrypted",
  "records-stored-locally",
  "dc-app-completed",
  "output-sent",
  "run-failed",
  "executor-finished",
] as const;

// Host events relayed by sce-unit over the enclave's authenticated channel. The content is host-supplied,
// so it is tagged with origin=host instead of being presented as an enclave claim.
export const HOST_RELAY_EVENTS = ["executor-ready", "artifact-retrieved", "enclave-launched"] as const;

// Producers on the mTLS domain: registry-service, execution-service, and result-consumer.
export const INTERNAL_EVENTS = [
  "build-started",
  "build-completed",
  "image-uploaded",
  "pcrs-registered",
  "kms-key-provisioned",
  "algorithm-registered",
  "build-failed",
  "run-requested",
  "executor-launched",
  "launch-failed",
  "result-persisted",
] as const;

export const RUN_EVENTS = [...new Set<string>([...ENCLAVE_EVENTS, ...HOST_RELAY_EVENTS, ...INTERNAL_EVENTS])];

export type RunEvent = (typeof RUN_EVENTS)[number];

export function isRunEvent(value: unknown): value is RunEvent {
  return typeof value === "string" && RUN_EVENTS.includes(value);
}

export function isEnclaveEvent(value: unknown): value is (typeof ENCLAVE_EVENTS)[number] {
  return typeof value === "string" && (ENCLAVE_EVENTS as readonly string[]).includes(value);
}

export function isHostRelayEvent(value: unknown): value is (typeof HOST_RELAY_EVENTS)[number] {
  return typeof value === "string" && (HOST_RELAY_EVENTS as readonly string[]).includes(value);
}

export function isInternalEvent(value: unknown): value is (typeof INTERNAL_EVENTS)[number] {
  return typeof value === "string" && (INTERNAL_EVENTS as readonly string[]).includes(value);
}
