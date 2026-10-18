import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EC2Client, RunInstancesCommand, type RunInstancesCommandInput } from "@aws-sdk/client-ec2";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import { emitEvent } from "@srads/common/log";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { countAlgorithmRecords } from "../lib/pdmCount.js";
import { userData } from "../lib/userdata.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ec2 = new EC2Client({});
const algorithmTable = requiredEnv("ALGORITHM_TABLE");
const runResultsTable = requiredEnv("RUN_RESULTS_TABLE");
const runResultsQueueUrl = requiredEnv("RUN_RESULTS_QUEUE_URL");
const enclaveAmiId = requiredEnv("ENCLAVE_AMI_ID");
const enclaveInstanceType = requiredEnv("ENCLAVE_INSTANCE_TYPE") as RunInstancesCommandInput["InstanceType"];
const enclaveAz = requiredEnv("ENCLAVE_AZ");
const enclaveSecurityGroupId = requiredEnv("ENCLAVE_SECURITY_GROUP_ID");
const enclaveInstanceProfileArn = requiredEnv("ENCLAVE_INSTANCE_PROFILE_ARN");
const verifierHost = requiredEnv("VERIFIER_HOST");
const pdmHost = requiredEnv("PDM_HOST");
const pdmTable = requiredEnv("PDM_TABLE");
const logHost = requiredEnv("LOG_HOST");
const costHost = requiredEnv("COST_HOST");
const region = requiredEnv("AWS_REGION");

// Size-check reads use a pinned representative item size because DynamoDB exposes page counts, not bytes.
const ESTIMATED_RECORD_BYTES = 1024;

interface RunRequest {
  algorithmId: string;
  size?: number;
}

interface AlgorithmRecord {
  S3Bucket?: string;
  S3Key?: string;
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
  const startedAt = process.hrtime.bigint();
  const request = parseRunRequest(event.body);
  if (!request) return jsonResponse(400, { error: "invalid request" });

  const runId = randomUUID();
  try {
    const algorithm = await ddb.send(
      new GetCommand({ TableName: algorithmTable, Key: { AlgorithmId: request.algorithmId } }),
    );
    const record = algorithm.Item as AlgorithmRecord | undefined;
    await costEvent(
      request.algorithmId,
      runId,
      CostPhase.Execution,
      "dynamodb",
      "read",
      record ? Buffer.byteLength(JSON.stringify(record)) : 1,
    );
    if (!record?.S3Bucket || !record.S3Key) {
      await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
      return jsonResponse(404, { error: "algorithm not found" });
    }

    if (request.size !== undefined) {
      const available = await countAlgorithmRecords(ddb, pdmTable, request.algorithmId, request.size);
      await costEvent(
        request.algorithmId,
        runId,
        CostPhase.Execution,
        "dynamodb",
        "read",
        available * ESTIMATED_RECORD_BYTES,
      );
      if (request.size > available) {
        await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
        return jsonResponse(400, {
          error: `size ${request.size} exceeds seeded dataset (${available} records)`,
        });
      }
    }

    await emitEvent(request.algorithmId, runId, "run-requested");
    const launched = await ec2.send(
      new RunInstancesCommand({
        ImageId: enclaveAmiId,
        InstanceType: enclaveInstanceType,
        Placement: { AvailabilityZone: enclaveAz },
        MinCount: 1,
        MaxCount: 1,
        SecurityGroupIds: [enclaveSecurityGroupId],
        IamInstanceProfile: { Arn: enclaveInstanceProfileArn },
        EnclaveOptions: { Enabled: true },
        UserData: Buffer.from(
          userData({
            algorithmId: request.algorithmId,
            costHost,
            launchEpoch: Math.floor(Date.now() / 1000),
            logHost,
            pdmHost,
            region,
            queueUrl: runResultsQueueUrl,
            runId,
            s3Bucket: record.S3Bucket,
            s3Key: record.S3Key,
            size: request.size,
            verifierHost,
          }),
        ).toString("base64"),
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: [
              { Key: "Name", Value: "secure-rads-execution-service-run" },
              { Key: "ManagedBy", Value: "secure-rads-execution-service" },
            ],
          },
        ],
      }),
    );
    const instanceId = launched.Instances?.[0]?.InstanceId;
    if (!instanceId) throw new Error("RunInstances returned no instance");

    await emitEvent(request.algorithmId, runId, "executor-launched", { instanceId });
    await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
    return jsonResponse(202, { runId, algorithmId: request.algorithmId, instanceId, status: "pending" });
  } catch (error) {
    await emitEvent(request.algorithmId, runId, "launch-failed", { error: String(error) });
    await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
    console.error("launch failed", error);
    return jsonResponse(500, { error: "launch failed" });
  }
};

export const result: APIGatewayProxyHandlerV2 = async (event) => {
  const startedAt = process.hrtime.bigint();
  const runId = event.pathParameters?.runId;
  if (!runId) return jsonResponse(400, { error: "runId is required" });

  try {
    const response = await ddb.send(new GetCommand({ TableName: runResultsTable, Key: { RunId: runId } }));
    const item = response.Item as RunResult | undefined;
    const algorithmId = item?.AlgorithmId ?? event.queryStringParameters?.algorithmId;
    if (algorithmId) {
      await costEvent(
        algorithmId,
        runId,
        CostPhase.Execution,
        "dynamodb",
        "read",
        item ? Buffer.byteLength(JSON.stringify(item)) : 1,
      );
      await recordRequest(algorithmId, runId, CostPhase.Execution, startedAt);
    }
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
