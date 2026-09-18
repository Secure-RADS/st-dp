// Build-phase events this service emits. The log-service validates against its own copy; keep in sync.
export const RegistryEvent = {
  AlgorithmRegistered: "algorithm-registered",
} as const;

export type RegistryEvent = (typeof RegistryEvent)[keyof typeof RegistryEvent];
