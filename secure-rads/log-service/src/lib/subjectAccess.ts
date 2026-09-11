export interface SubjectAccessIngest {
  algorithmId: string;
  runId: string;
  dataSubjectIds: string[];
  timestamp: string;
  receivedAt: string;
}

export interface SubjectAccessRow {
  dataSubjectId: string;
  algorithmId: string;
  runId: string;
  timestamp: string;
  receivedAt: string;
}

const MAX_SUBJECTS = 1000;

export function parseSubjectAccessBody(body: unknown): SubjectAccessIngest | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }

  const { algorithmId, runId, dataSubjectIds, timestamp } = body as Record<string, unknown>;
  if (typeof algorithmId !== "string" || algorithmId.length === 0) {
    return { error: "algorithmId must be a non-empty string" };
  }
  if (typeof runId !== "string" || runId.length === 0) {
    return { error: "runId must be a non-empty string" };
  }
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    return { error: "timestamp must be a non-empty string" };
  }
  if (!Array.isArray(dataSubjectIds) || dataSubjectIds.length === 0) {
    return { error: "dataSubjectIds must be a non-empty array" };
  }
  if (dataSubjectIds.length > MAX_SUBJECTS) {
    return { error: `dataSubjectIds must contain at most ${MAX_SUBJECTS} entries` };
  }
  if (!dataSubjectIds.every((id) => typeof id === "string" && id.length > 0)) {
    return { error: "dataSubjectIds must be non-empty strings" };
  }

  return {
    algorithmId,
    runId,
    dataSubjectIds: dataSubjectIds as string[],
    timestamp,
    receivedAt: new Date().toISOString(),
  };
}

export function toItem(row: SubjectAccessRow, nonce: string): Record<string, unknown> {
  return {
    DataSubjectId: row.dataSubjectId,
    Sk: `${row.timestamp}#${row.algorithmId}#${row.runId}#${nonce}`,
    AlgorithmId: row.algorithmId,
    RunId: row.runId,
    Timestamp: row.timestamp,
    ReceivedAt: row.receivedAt,
  };
}

export function toRow(item: Record<string, unknown>): SubjectAccessRow {
  return {
    dataSubjectId: item.DataSubjectId as string,
    algorithmId: item.AlgorithmId as string,
    runId: item.RunId as string,
    timestamp: item.Timestamp as string,
    receivedAt: item.ReceivedAt as string,
  };
}
