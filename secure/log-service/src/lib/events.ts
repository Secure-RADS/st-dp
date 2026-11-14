// Keep producer event enums in sync with this ingest allowlist.
// Emitted before attestation, so no token exists yet. Accepted unauthenticated and tagged auth=none.
export const PRE_ATTESTATION_EVENTS = ["enclave-started", "unit-ready"] as const;

// Emitted after attestation. The access token is required and the event is tagged auth=attested.
export const ENCLAVE_EVENTS = [
  "attested",
  "records-fetched",
  "records-decrypted",
  "records-stored-locally",
  "dc-app-completed",
  "output-sent",
  "run-failed",
] as const;

// Host-reported events. The EC2 host posts them directly without a token, so they are tagged auth=none
// and origin=host instead of being presented as enclave claims.
export const HOST_EVENTS = ["executor-ready", "artifact-retrieved", "enclave-launched", "executor-finished"] as const;

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

export const RUN_EVENTS = [
  ...new Set<string>([...PRE_ATTESTATION_EVENTS, ...ENCLAVE_EVENTS, ...HOST_EVENTS, ...INTERNAL_EVENTS]),
];

export type RunEvent = (typeof RUN_EVENTS)[number];

export function isRunEvent(value: unknown): value is RunEvent {
  return typeof value === "string" && RUN_EVENTS.includes(value);
}

export function isEnclaveEvent(value: unknown): value is (typeof ENCLAVE_EVENTS)[number] {
  return typeof value === "string" && (ENCLAVE_EVENTS as readonly string[]).includes(value);
}

export function isPreAttestationEvent(value: unknown): value is (typeof PRE_ATTESTATION_EVENTS)[number] {
  return typeof value === "string" && (PRE_ATTESTATION_EVENTS as readonly string[]).includes(value);
}

export function isHostEvent(value: unknown): value is (typeof HOST_EVENTS)[number] {
  return typeof value === "string" && (HOST_EVENTS as readonly string[]).includes(value);
}

export function isInternalEvent(value: unknown): value is (typeof INTERNAL_EVENTS)[number] {
  return typeof value === "string" && (INTERNAL_EVENTS as readonly string[]).includes(value);
}
