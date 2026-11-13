import { z } from "zod";

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

const subjectAccessSchema = z.object({
  algorithmId: z.string().min(1),
  runId: z.string().min(1),
  dataSubjectIds: z.array(z.string().min(1)).min(1).max(MAX_SUBJECTS),
  timestamp: z.string().min(1),
});

export function parseSubjectAccessBody(body: unknown): SubjectAccessIngest | { error: string } {
  const result = subjectAccessSchema.safeParse(body);
  if (!result.success) {
    return { error: result.error.issues[0].message };
  }
  return { ...result.data, receivedAt: new Date().toISOString() };
}

// The sort key is (timestamp, algorithmId, runId). That tuple is unique per item: a data subject's record
// lives on exactly one PDM page, so it is read once per run by exactly one algorithm. Dropping the old
// random nonce makes writes idempotent - a redelivered ingest overwrites an identical row instead of
// appending a duplicate.
export function toItem(row: SubjectAccessRow): Record<string, unknown> {
  return {
    DataSubjectId: row.dataSubjectId,
    Sk: `${row.timestamp}#${row.algorithmId}#${row.runId}`,
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
