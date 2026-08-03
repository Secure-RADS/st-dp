"""Receives a POST /build request, stages the algorithm source to S3, and
invokes the SSM document on the enclave host that runs the actual build."""

from __future__ import annotations

import base64
import json
import os
import time
import uuid

import boto3


STAGING_BUCKET        = os.environ["STAGING_BUCKET"]
ENCLAVE_HOST_INSTANCE = os.environ["ENCLAVE_HOST_INSTANCE"]
BUILD_DOCUMENT_NAME   = os.environ["BUILD_DOCUMENT_NAME"]

_S3  = boto3.client("s3")
_SSM = boto3.client("ssm")


def _bad_request(reason: str) -> dict:
    return {"statusCode": 400, "body": json.dumps({"error": reason})}


def _ok(body: dict) -> dict:
    return {"statusCode": 200, "body": json.dumps(body)}


def _accepted(body: dict) -> dict:
    return {"statusCode": 202, "body": json.dumps(body)}


def lambda_handler(event, _context):
    method = (event.get("requestContext", {}).get("http", {}).get("method")
              or event.get("httpMethod", "POST"))
    if method != "POST":
        return _bad_request("POST only")

    try:
        body = json.loads(event.get("body") or "{}")
        algorithm_id = body["algorithm_id"]
        dc_id        = body["dc_id"]
        algorithm_b64 = body["algorithm_code"]
    except (KeyError, TypeError, json.JSONDecodeError) as e:
        return _bad_request(f"required: algorithm_id, dc_id, algorithm_code (base64): {e}")

    try:
        source = base64.b64decode(algorithm_b64)
    except Exception as e:
        return _bad_request(f"algorithm_code not base64: {e}")

    build_id = f"{algorithm_id}-{dc_id}-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    staging_key = f"sources/{build_id}/algorithm.py"

    _S3.put_object(
        Bucket=STAGING_BUCKET,
        Key=staging_key,
        Body=source,
        ContentType="text/x-python",
        Metadata={"algorithm_id": algorithm_id, "dc_id": dc_id},
    )

    resp = _SSM.send_command(
        InstanceIds=[ENCLAVE_HOST_INSTANCE],
        DocumentName=BUILD_DOCUMENT_NAME,
        Parameters={
            "algorithmId": [algorithm_id],
            "dcId":        [dc_id],
            "stagingKey":  [staging_key],
        },
        CloudWatchOutputConfig={"CloudWatchOutputEnabled": True},
        TimeoutSeconds=900,
    )

    command_id = resp["Command"]["CommandId"]
    return _accepted({
        "build_id":     build_id,
        "command_id":   command_id,
        "staging_key":  staging_key,
        "status":       "submitted",
        "follow_up":    f"aws ssm get-command-invocation --command-id {command_id} --instance-id {ENCLAVE_HOST_INSTANCE}",
    })
