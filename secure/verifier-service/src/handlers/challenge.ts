import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { issueChallenge } from "../lib/challenge.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const algorithmPcrTable = requiredEnv("ALGORITHM_PCR_TABLE");

interface ChallengeBody {
  algorithmId: string;
  runId: string;
}

function isChallengeBody(body: unknown): body is ChallengeBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.algorithmId === "string" && typeof b.runId === "string";
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  if (!event.body) {
    return { statusCode: 400, body: "missing request body" };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "invalid JSON" };
  }

  if (!isChallengeBody(body)) {
    return { statusCode: 400, body: "expected algorithmId and runId as strings" };
  }

  try {
    // An unauthenticated endpoint must not write challenge rows for algorithms that cannot attest anyway.
    const registered = await ddb.send(
      new GetCommand({
        TableName: algorithmPcrTable,
        Key: { AlgorithmId: body.algorithmId },
        ReturnConsumedCapacity: "TOTAL",
      }),
    );
    await costEvent(
      body.algorithmId,
      body.runId,
      CostPhase.Execution,
      "dynamodb",
      "read-capacity",
      registered.ConsumedCapacity?.CapacityUnits ?? 0,
    );
    if (!registered.Item) {
      return { statusCode: 404, body: "algorithmId not registered" };
    }

    const challenge = await issueChallenge(body.algorithmId, body.runId);
    return { statusCode: 200, body: JSON.stringify(challenge) };
  } finally {
    await recordRequest(body.algorithmId, body.runId, CostPhase.Execution, startedAt);
  }
};
