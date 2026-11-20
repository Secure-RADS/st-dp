import * as grpc from "@grpc/grpc-js";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  FetchRecordsRequestSchema,
  RecordSchema,
  SubmitResultRequestSchema,
  SubmitResultResponseSchema,
} from "./gen/sce/v1/records_pb.js";

const AGE_BANDS = ["18-29", "30-44", "45-59", "60+"];
const FETCH_RECORDS = "/sce.v1.DataAccess/FetchRecords";
const SUBMIT_RESULT = "/sce.v1.DataAccess/SubmitResult";

function ageBand(age) {
  if (age < 30) return "18-29";
  if (age < 45) return "30-44";
  if (age < 60) return "45-59";
  return "60+";
}

function analyze(algorithmId, records) {
  const byBand = {};
  for (const band of AGE_BANDS) byBand[band] = new Map();
  let totalRevenueCents = 0;
  let totalOrders = 0;

  for (const record of records) {
    const revenues = byBand[ageBand(record.data.age)];
    for (const order of record.data.orders) {
      totalOrders++;
      for (const item of order.items) {
        const revenue = item.qty * item.priceCents;
        totalRevenueCents += revenue;
        revenues.set(item.category, (revenues.get(item.category) ?? 0) + revenue);
      }
    }
  }

  const topCategoriesByAgeBand = {};
  for (const band of AGE_BANDS) {
    topCategoriesByAgeBand[band] = [...byBand[band].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, revenueCents]) => ({ category, revenueCents }));
  }

  return {
    algorithmId,
    userCount: records.length,
    totalRevenueCents,
    totalOrders,
    topCategoriesByAgeBand,
  };
}

function fetchRecords(client) {
  return new Promise((resolve, reject) => {
    const records = [];
    const call = client.makeServerStreamRequest(
      FETCH_RECORDS,
      (message) => Buffer.from(toBinary(FetchRecordsRequestSchema, message)),
      (bytes) => fromBinary(RecordSchema, bytes),
      create(FetchRecordsRequestSchema),
    );
    call.on("data", (record) => records.push(record));
    call.on("error", reject);
    call.on("end", () => resolve(records));
  });
}

function submitResult(client, result) {
  return new Promise((resolve, reject) => {
    const request = create(SubmitResultRequestSchema, { result });
    client.makeUnaryRequest(
      SUBMIT_RESULT,
      (message) => Buffer.from(toBinary(SubmitResultRequestSchema, message)),
      (bytes) => fromBinary(SubmitResultResponseSchema, bytes),
      request,
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function main() {
  const socketPath = process.env.SCE_RPC_SOCKET;
  if (!socketPath) throw new Error("SCE_RPC_SOCKET is required");
  const algorithmId = process.env.ALGORITHM_ID;
  if (!algorithmId) throw new Error("ALGORITHM_ID is required");

  const client = new grpc.Client(`unix:${socketPath}`, grpc.credentials.createInsecure());
  try {
    const records = (await fetchRecords(client)).map((record) => ({
      recordId: record.recordId,
      data: record.data ?? {},
    }));
    console.error(`loaded ${records.length} records over ${socketPath}`);
    await submitResult(client, analyze(algorithmId, records));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
