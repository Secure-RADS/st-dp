interface ImportMetaEnv {
  readonly VITE_LOG_SERVICE_URL?: string;
  readonly VITE_TELEMETRY_SERVICE_URL?: string;
  readonly VITE_PDM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
