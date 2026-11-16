const LOG_SERVICE_URL = import.meta.env.VITE_LOG_SERVICE_URL ?? "https://log.r.secure-rads.org";
const TELEMETRY_SERVICE_URL =
  import.meta.env.VITE_TELEMETRY_SERVICE_URL ?? "https://telemetry.r.secure-rads.org";
const PDM_URL = import.meta.env.VITE_PDM_URL ?? "https://pdm.r.secure-rads.org";

export interface RunEvent {
  algorithmId: string;
  runId: string;
  event: string;
  timestamp: string;
  receivedAt: string;
  detail: unknown;
}

export interface SubjectAccess {
  dataSubjectId: string;
  algorithmId: string;
  runId: string;
  timestamp: string;
  receivedAt: string;
}

export interface SubjectAccessResponse {
  dataSubjectId: string | null;
  accesses: SubjectAccess[];
  nextCursor: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const getRunEvents = () => getJson<RunEvent[]>(`${TELEMETRY_SERVICE_URL}/logs`);

export const getAllSubjectAccess = (cursor?: string) =>
  getJson<SubjectAccessResponse>(
    `${LOG_SERVICE_URL}/subject-access?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );

export const getSubjectAccess = (dataSubjectId: string) =>
  getJson<SubjectAccessResponse>(`${PDM_URL}/subject/${encodeURIComponent(dataSubjectId)}`);

export const exportUrl = (algorithmId?: string) =>
  `${
    algorithmId ? `${TELEMETRY_SERVICE_URL}/logs/${encodeURIComponent(algorithmId)}` : `${TELEMETRY_SERVICE_URL}/logs`
  }?format=csv`;

export const exportJsonUrl = (algorithmId?: string) =>
  algorithmId ? `${TELEMETRY_SERVICE_URL}/logs/${encodeURIComponent(algorithmId)}` : `${TELEMETRY_SERVICE_URL}/logs`;

