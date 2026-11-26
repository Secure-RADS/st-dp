import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EC2Client, RunInstancesCommand, type RunInstancesCommandInput } from "@aws-sdk/client-ec2";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CostPhase, costEvent, recordRequest } from "@srads/common/cost";
import { requiredEnv } from "@srads/common/env";
import { emitEvent } from "@srads/common/log";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { countAlgorithmRecords, isThrottlingError } from "../lib/pdmCount.js";
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
const kmsServiceHost = requiredEnv("KMS_SERVICE_HOST");
const pdmTable = requiredEnv("PDM_TABLE");
const logHost = requiredEnv("LOG_HOST");
const telemetryHost = requiredEnv("TELEMETRY_HOST");
const costHost = requiredEnv("COST_HOST");
const region = requiredEnv("AWS_REGION");

interface RunRequest {
  algorithmId: string;
  size?: number;
  webhookUrl?: string;
}

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|172\.(1[6-9]|2\d|3[01])\.)/i;

// Webhooks run from the host network, so reject obvious internal targets. DNS resolving to a private
// address after this check is still possible; see docs for the remaining SSRF caveat.
function parseWebhookUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  if (url.hostname.includes(":") || PRIVATE_HOST.test(url.hostname)) return null;
  return url.toString();
}

interface AlgorithmRecord {
  S3Bucket?: string;
  S3Key?: string;
  RecordCount?: number;
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
    const { algorithmId, size, webhookUrl } = parsed as Record<string, unknown>;
    if (typeof algorithmId !== "string" || algorithmId.length === 0) return undefined;
    if (size !== undefined && (typeof size !== "number" || !Number.isInteger(size) || size <= 0)) {
      return undefined;
    }
    const webhook = parseWebhookUrl(webhookUrl);
    if (webhook === null) return undefined;
    return {
      algorithmId,
      ...(size === undefined ? {} : { size }),
      ...(webhook === undefined ? {} : { webhookUrl: webhook }),
    };
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
      new GetCommand({
        TableName: algorithmTable,
        Key: { AlgorithmId: request.algorithmId },
        ReturnConsumedCapacity: "TOTAL",
      }),
    );
    const record = algorithm.Item as AlgorithmRecord | undefined;
    await costEvent(
      request.algorithmId,
      runId,
      CostPhase.Execution,
      "dynamodb",
      "read-capacity",
      algorithm.ConsumedCapacity?.CapacityUnits ?? 0,
    );
    if (!record?.S3Bucket || !record.S3Key) {
      await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
      return jsonResponse(404, { error: "algorithm not found" });
    }

    if (request.size !== undefined) {
      if (record.RecordCount !== undefined) {
        if (request.size > record.RecordCount) {
          await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
          return jsonResponse(400, {
            error: `size ${request.size} exceeds seeded dataset (${record.RecordCount} records)`,
          });
        }
      } else {
        try {
          const { count: available, readCapacityUnits } = await countAlgorithmRecords(
            ddb,
            pdmTable,
            request.algorithmId,
            request.size,
          );
          await costEvent(
            request.algorithmId,
            runId,
            CostPhase.Execution,
            "dynamodb",
            "read-capacity",
            readCapacityUnits,
          );
          if (request.size > available) {
            await recordRequest(request.algorithmId, runId, CostPhase.Execution, startedAt);
            return jsonResponse(400, {
              error: `size ${request.size} exceeds seeded dataset (${available} records)`,
            });
          }
        } catch (error) {
          // A concurrent sweep can throttle the fallback count; the executor caps at size anyway.
          if (!isThrottlingError(error)) throw error;
          console.warn("record count throttled; skipping size validation");
        }
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
            kmsHost: kmsServiceHost,
            launchEpoch: Math.floor(Date.now() / 1000),
            logHost,
            telemetryHost,
            pdmHost,
            region,
            queueUrl: runResultsQueueUrl,
            runId,
            s3Bucket: record.S3Bucket,
            s3Key: record.S3Key,
            size: request.size,
            verifierHost,
            webhookUrl: request.webhookUrl,
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
  const algorithmId = event.queryStringParameters?.algorithmId;
  if (!algorithmId) return jsonResponse(400, { error: "algorithmId is required" });

  try {
    const response = await ddb.send(
      new GetCommand({ TableName: runResultsTable, Key: { RunId: runId }, ReturnConsumedCapacity: "TOTAL" }),
    );
    const item = response.Item as RunResult | undefined;
    const costAlgorithmId = item?.AlgorithmId ?? algorithmId;
    await costEvent(
      costAlgorithmId,
      runId,
      CostPhase.Execution,
      "dynamodb",
      "read-capacity",
      response.ConsumedCapacity?.CapacityUnits ?? 0,
    );
    await recordRequest(costAlgorithmId, runId, CostPhase.Execution, startedAt);
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
