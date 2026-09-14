import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { retryAsync } from "ts-retry";
import { requiredEnv } from "../lib/env.js";
import { parseSubjectAccessBody, toItem } from "../lib/subjectAccess.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("SUBJECT_ACCESS_TABLE");

// DynamoDB BatchWriteWriteItem accepts at most 25 items per request, so oversized batches are chunked.
const CHUNK = 25;
const MAX_TRY = 4;

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Retries only when DynamoDB throttles (partial writes surface as UnprocessedItems, not a rejection). Each
// item's nonce is fixed for the whole chunk, so re-sending a partially-written chunk is idempotent.
async function writeItems(items: Record<string, unknown>[]): Promise<void> {
  await retryAsync(
    async () => {
      const out = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: items } }));
      const unprocessed = out.UnprocessedItems?.[table] ?? [];
      if (unprocessed.length > 0) {
        throw new Error(`${unprocessed.length} unprocessed subject-access items`);
      }
    },
    { maxTry: MAX_TRY },
  );
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

  // A DS-keyed subject-access row per data subject, on its own stable nonce so DynamoDB retries are idempotent.
  const items = [...new Set(parsed.dataSubjectIds)].map((dataSubjectId) =>
    toItem(
      {
        dataSubjectId,
        algorithmId: parsed.algorithmId,
        runId: parsed.runId,
        timestamp: parsed.timestamp,
        receivedAt: parsed.receivedAt,
      },
      randomUUID(),
    ),
  );

  // Write every 25-item chunk concurrently (DynamoDB caps one BatchWrite request at 25).
  await Promise.all(chunk(items, CHUNK).map(writeItems));
  return jsonResponse(202, { ok: true, subjects: items.length });
};
