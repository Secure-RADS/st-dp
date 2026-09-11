import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { parseSubjectAccessBody, type SubjectAccessRow, toItem } from "../lib/subjectAccess.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");

const CHUNK = 25;
const MAX_ATTEMPTS = 3;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function writeChunk(rows: SubjectAccessRow[]): Promise<void> {
  let requests = rows.map((row) => ({ PutRequest: { Item: toItem(row, randomUUID()) } }));
  for (let attempt = 0; requests.length > 0 && attempt < MAX_ATTEMPTS; attempt++) {
    const out = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
    requests = (out.UnprocessedItems?.[table] ?? []) as typeof requests;
  }
  if (requests.length > 0) {
    throw new Error(`${requests.length} unprocessed subject-access items`);
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const parsed = parseSubjectAccessBody(body);
  if ("error" in parsed) return jsonResponse(400, { error: parsed.error });

  const rows: SubjectAccessRow[] = [...new Set(parsed.dataSubjectIds)].map((dataSubjectId) => ({
    dataSubjectId,
    algorithmId: parsed.algorithmId,
    runId: parsed.runId,
    timestamp: parsed.timestamp,
    receivedAt: parsed.receivedAt,
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    await writeChunk(rows.slice(i, i + CHUNK));
  }
  return jsonResponse(202, { ok: true, subjects: rows.length });
};
