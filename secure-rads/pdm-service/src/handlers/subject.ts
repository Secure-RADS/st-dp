import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requiredEnv } from "../lib/env.js";

const logHost = requiredEnv("LOG_HOST");

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Public DSAR lookup: the data subject presents only an opaque UUID, PDM relays the query to log-service.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const dataSubjectId = event.pathParameters?.dataSubjectId;
  if (!dataSubjectId) return jsonResponse(400, { error: "missing dataSubjectId" });

  let response: Response;
  try {
    response = await fetch(`https://${logHost}/subject-access/${encodeURIComponent(dataSubjectId)}`);
  } catch (error) {
    console.error("log-service lookup failed", error);
    return jsonResponse(502, { error: "log-service lookup failed" });
  }
  if (!response.ok) {
    return jsonResponse(502, { error: "log-service lookup failed" });
  }
  return jsonResponse(200, await response.json());
};
