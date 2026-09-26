import { marshall } from "@aws-sdk/util-dynamodb";

export function toDynamoDbJsonLine(item: Record<string, unknown>): string {
  return JSON.stringify({ Item: marshall(item, { removeUndefinedValues: true }) });
}
