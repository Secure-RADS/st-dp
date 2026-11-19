import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { requiredEnv } from "@srads/common/env";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = requiredEnv("RUN_LOG_TABLE");

export async function runEventExists(algorithmId: string, runId: string, event: string): Promise<boolean> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "AlgorithmId = :a AND begins_with(Sk, :s)",
        ExpressionAttributeValues: { ":a": algorithmId, ":s": `${runId}#` },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    if ((result.Items ?? []).some((item) => item.Event === event)) return true;
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return false;
}
