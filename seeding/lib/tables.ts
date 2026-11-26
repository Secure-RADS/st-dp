import {
  CreateTableCommand,
  type DynamoDBClient,
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

export function pdmTableName(prefix: string, algorithmId: string): string {
  return `${prefix}-${algorithmId}`;
}

export async function ensurePdmTable(
  client: DynamoDBClient,
  table: string,
  kmsKeyArn?: string,
): Promise<void> {
  if (await tableExists(client, table)) return;

  try {
    await client.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "AlgorithmId", AttributeType: "S" },
          { AttributeName: "RecordId", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "AlgorithmId", KeyType: "HASH" },
          { AttributeName: "RecordId", KeyType: "RANGE" },
        ],
        SSESpecification: kmsKeyArn ? { Enabled: true, SSEType: "KMS", KMSMasterKeyId: kmsKeyArn } : undefined,
      }),
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ResourceInUseException") throw error;
  }

  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: table });
}

export async function tableExists(client: DynamoDBClient, table: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: table }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") return false;
    throw error;
  }
}
