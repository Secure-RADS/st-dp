// Keep these build events in sync with log-service/src/lib/events.ts, which validates them at ingest.
export const RegistryEvent = {
  ImageUploaded: "image-uploaded",
  AlgorithmRegistered: "algorithm-registered",
} as const;

export type RegistryEvent = (typeof RegistryEvent)[keyof typeof RegistryEvent];

export type RegistryEventName = RegistryEvent;
