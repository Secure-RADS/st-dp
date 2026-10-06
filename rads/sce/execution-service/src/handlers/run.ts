import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EC2Client, RunInstancesCommand, type RunInstancesCommandInput } from "@aws-sdk/client-ec2";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";
import { logEvent } from "../lib/events.js";
import { countAlgorithmRecords } from "../lib/pdmCount.js";
import { userData } from "../lib/userdata.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ec2 = new EC2Client({});
const algorithmTable = requiredEnv("ALGORITHM_TABLE");
const runResultsTable = requiredEnv("RUN_RESULTS_TABLE");
const runResultsQueueUrl = requiredEnv("RUN_RESULTS_QUEUE_URL");
const pdmUrl = requiredEnv("PDM_URL");
const pdmTable = requiredEnv("PDM_TABLE");
const logHost = requiredEnv("LOG_HOST");
const executorAmiId = requiredEnv("EXECUTOR_AMI_ID");
const executorInstanceType = requiredEnv("EXECUTOR_INSTANCE_TYPE") as RunInstancesCommandInput["InstanceType"];
const executorSecurityGroupId = requiredEnv("EXECUTOR_SECURITY_GROUP_ID");
const executorInstanceProfileArn = requiredEnv("EXECUTOR_INSTANCE_PROFILE_ARN");
const region = requiredEnv("AWS_REGION");

interface RunRequest {
  algorithmId: string;
  size?: number;
}

interface AlgorithmRecord {
  Bucket?: string;
  Key?: string;
}

interface RunResult {
  AlgorithmId?: string;
  Diag?: unknown;
  InstanceId?: string;
  Output?: string;
  ReceivedAt?: string;
  RunId?: string;
  Status?: string;
}

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function parseRunRequest(body: string | undefined): RunRequest | undefined {
  try {
    const parsed: unknown = JSON.parse(body ?? "");
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { algorithmId, size } = parsed as Record<string, unknown>;
    if (typeof algorithmId !== "string" || algorithmId.length === 0) return undefined;
    if (size !== undefined && (typeof size !== "number" || !Number.isInteger(size) || size <= 0)) {
      return undefined;
    }
    return size === undefined ? { algorithmId } : { algorithmId, size };
  } catch {
    return undefined;
  }
}

export const create: APIGatewayProxyHandlerV2 = async (event) => {
  const request = parseRunRequest(event.body);
  if (!request) return jsonResponse(400, { error: "invalid request" });

  let runId: string | undefined;
  try {
    const algorithm = await ddb.send(
      new GetCommand({ TableName: algorithmTable, Key: { AlgorithmId: request.algorithmId } }),
    );
    const record = algorithm.Item as AlgorithmRecord | undefined;
    if (!record?.Bucket || !record.Key) return jsonResponse(404, { error: "algorithm not found" });

    if (request.size !== undefined) {
      const available = await countAlgorithmRecords(ddb, pdmTable, request.algorithmId, request.size);
      if (request.size > available) {
        return jsonResponse(400, {
          error: `size ${request.size} exceeds seeded dataset (${available} records)`,
        });
      }
    }

    runId = randomUUID();
    await logEvent(request.algorithmId, runId, "run-requested");
    const launched = await ec2.send(
      new RunInstancesCommand({
        ImageId: executorAmiId,
        InstanceType: executorInstanceType,
        MinCount: 1,
        MaxCount: 1,
        SecurityGroupIds: [executorSecurityGroupId],
        IamInstanceProfile: { Arn: executorInstanceProfileArn },
        UserData: Buffer.from(
          userData({
            algorithmId: request.algorithmId,
            logHost,
            pdmUrl,
            region,
            runId,
            runResultsQueueUrl,
            s3Bucket: record.Bucket,
            s3Key: record.Key,
            size: request.size,
          }),
        ).toString("base64"),
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: [
              { Key: "Name", Value: "rads-execution-service-run" },
              { Key: "ManagedBy", Value: "rads-execution-service" },
            ],
          },
        ],
      }),
    );
    const instanceId = launched.Instances?.[0]?.InstanceId;
    if (!instanceId) throw new Error("RunInstances returned no instance");

    await logEvent(request.algorithmId, runId, "executor-launched", { instanceId });
    return jsonResponse(202, { runId, algorithmId: request.algorithmId, instanceId, status: "pending" });
  } catch (error) {
    if (runId) await logEvent(request.algorithmId, runId, "launch-failed", { error: String(error) });
    console.error("launch failed", error);
    return jsonResponse(500, { error: "launch failed" });
  }
};

export const result: APIGatewayProxyHandlerV2 = async (event) => {
  const runId = event.pathParameters?.runId;
  if (!runId) return jsonResponse(400, { error: "runId is required" });

  try {
    const response = await ddb.send(new GetCommand({ TableName: runResultsTable, Key: { RunId: runId } }));
    const item = response.Item as RunResult | undefined;
    if (!item) return jsonResponse(200, { runId, status: "pending" });
    return jsonResponse(200, {
      runId: item.RunId,
      instanceId: item.InstanceId,
      algorithmId: item.AlgorithmId,
      status: item.Status,
      output: item.Output,
      diag: item.Diag,
      receivedAt: item.ReceivedAt,
    });
  } catch (error) {
    console.error("result lookup failed", error);
    return jsonResponse(500, { error: "result lookup failed" });
  }
};
