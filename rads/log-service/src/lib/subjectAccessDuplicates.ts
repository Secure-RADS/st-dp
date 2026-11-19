import { type DynamoDBDocumentClient, paginateQuery } from "@aws-sdk/lib-dynamodb";

const CHUNK = 25;

async function subjectHasAccess(
  ddb: DynamoDBDocumentClient,
  table: string,
  algorithmId: string,
  runId: string,
  dataSubjectId: string,
): Promise<boolean> {
  const pages = paginateQuery(
    { client: ddb },
    {
      TableName: table,
      KeyConditionExpression: "DataSubjectId = :s",
      FilterExpression: "AlgorithmId = :a AND RunId = :r",
      ExpressionAttributeValues: { ":s": dataSubjectId, ":a": algorithmId, ":r": runId },
    },
  );
  for await (const page of pages) {
    if ((page.Items ?? []).length > 0) return true;
  }
  return false;
}

export async function hasExistingAccess(
  ddb: DynamoDBDocumentClient,
  table: string,
  algorithmId: string,
  runId: string,
  dataSubjectIds: string[],
): Promise<boolean> {
  for (let i = 0; i < dataSubjectIds.length; i += CHUNK) {
    const found = await Promise.all(
      dataSubjectIds.slice(i, i + CHUNK).map((id) => subjectHasAccess(ddb, table, algorithmId, runId, id)),
    );
    if (found.includes(true)) return true;
  }
  return false;
}
