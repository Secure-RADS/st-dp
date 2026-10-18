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
