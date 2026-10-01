import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export async function countAlgorithmRecords(
  ddb: DynamoDBDocumentClient,
  table: string,
  algorithmId: string,
): Promise<number> {
  let total = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "AlgorithmId = :a",
        ExpressionAttributeValues: { ":a": algorithmId },
        Select: "COUNT",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    total += page.Count ?? 0;
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return total;
}
