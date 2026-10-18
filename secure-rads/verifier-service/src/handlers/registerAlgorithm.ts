import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { CostPhase, recordRequest } from "../lib/cost.js";
import { requiredEnv } from "../lib/env.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = requiredEnv("ALGORITHM_PCR_TABLE");

interface RegisterAlgorithmBody {
  algorithmId: string;
  pcr0: string;
  pcr1: string;
  pcr2: string;
}

function isRegisterAlgorithmBody(body: unknown): body is RegisterAlgorithmBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return ["algorithmId", "pcr0", "pcr1", "pcr2"].every((k) => typeof b[k] === "string");
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

  if (!isRegisterAlgorithmBody(body)) {
    return { statusCode: 400, body: "expected algorithmId, pcr0, pcr1, pcr2 as strings" };
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        AlgorithmId: body.algorithmId,
        PCR0: body.pcr0,
        PCR1: body.pcr1,
        PCR2: body.pcr2,
        createdAt: new Date().toISOString(),
      },
    }),
  );

  await recordRequest(body.algorithmId, body.algorithmId, CostPhase.Build, startedAt);
  return { statusCode: 201, body: JSON.stringify({ algorithmId: body.algorithmId }) };
};
