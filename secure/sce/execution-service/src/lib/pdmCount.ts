import { type DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export async function countAlgorithmRecords(
  ddb: DynamoDBDocumentClient,
  table: string,
  algorithmId: string,
  // Stop once we know at least this many rows exist (size checks only need a lower bound).
  atLeast?: number,
): Promise<{ count: number; readCapacityUnits: number }> {
  let total = 0;
  let readCapacityUnits = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "AlgorithmId = :a",
        ExpressionAttributeValues: { ":a": algorithmId },
        Select: "COUNT",
        ReturnConsumedCapacity: "TOTAL",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    total += page.Count ?? 0;
    readCapacityUnits += page.ConsumedCapacity?.CapacityUnits ?? 0;
    if (atLeast !== undefined && total >= atLeast) return { count: total, readCapacityUnits };
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return { count: total, readCapacityUnits };
}

const THROTTLING_ERRORS = new Set([
  "ThrottlingException",
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "TooManyRequestsException",
]);

export function isThrottlingError(error: unknown): boolean {
  return error instanceof Error && THROTTLING_ERRORS.has(error.name);
}
