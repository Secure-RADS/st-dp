import { emitEvent } from "@sce/sdk/log";
import { RegistryEvent, type RegistryEventName } from "./events.js";

export function emitImageUploaded(algorithmId: string, bucket: string, key: string): Promise<void> {
  return emit(RegistryEvent.ImageUploaded, algorithmId, bucket, key);
}

export function emitAlgorithmRegistered(algorithmId: string, bucket: string, key: string): Promise<void> {
  return emit(RegistryEvent.AlgorithmRegistered, algorithmId, bucket, key);
}

function emit(event: RegistryEventName, algorithmId: string, bucket: string, key: string): Promise<void> {
  return emitEvent(algorithmId, null, event, { bucket, key });
}
