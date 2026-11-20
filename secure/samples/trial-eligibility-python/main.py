import os
import sys

import grpc
from google.protobuf import json_format, struct_pb2
from pydantic import BaseModel

from sce.v1 import records_pb2, records_pb2_grpc


class Labs(BaseModel):
    hba1c: float
    egfr: float
    bmi: float


class RecordData(BaseModel):
    age: int
    conditions: list[str]
    labs: Labs


class Record(BaseModel):
    recordId: str
    data: RecordData


class Analysis(BaseModel):
    algorithmId: str | None
    userCount: int
    eligibleCount: int
    eligiblePct: float
    exclusionBreakdown: dict[str, int]
    eligibleRecordIds: list[str]


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def analyze(algorithm_id: str | None, records: list[Record]) -> Analysis:
    eligible_ids: list[str] = []
    exclusions: dict[str, int] = {"age": 0, "hba1c": 0, "egfr": 0, "ckd": 0, "bmi": 0}

    for record in records:
        data = record.data
        labs = data.labs
        failed: list[str] = []
        if not 40 <= data.age <= 75:
            failed.append("age")
        if not 7.0 <= labs.hba1c <= 10.0:
            failed.append("hba1c")
        if labs.egfr < 45:
            failed.append("egfr")
        if "ckd" in data.conditions:
            failed.append("ckd")
        if not 25 <= labs.bmi <= 40:
            failed.append("bmi")

        if failed:
            for criterion in failed:
                exclusions[criterion] += 1
        else:
            eligible_ids.append(record.recordId)

    n = len(records)
    return Analysis(
        algorithmId=algorithm_id,
        userCount=n,
        eligibleCount=len(eligible_ids),
        eligiblePct=round(100 * len(eligible_ids) / n, 2),
        exclusionBreakdown=exclusions,
        eligibleRecordIds=eligible_ids[:50],
    )


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"missing required env var {name}")
    return value


def main() -> None:
    algorithm_id = required_env("ALGORITHM_ID")
    socket_path = required_env("SCE_RPC_SOCKET")
    channel = grpc.insecure_channel(f"unix://{socket_path}")
    try:
        stub = records_pb2_grpc.DataAccessStub(channel)
        records = [
            Record(
                recordId=record.record_id,
                data=RecordData.model_validate(json_format.MessageToDict(record.data)),
            )
            for record in stub.FetchRecords(records_pb2.FetchRecordsRequest())
        ]
        log(f"loaded {len(records)} records over {socket_path}")
        result = analyze(algorithm_id, records)
        payload = struct_pb2.Struct()
        json_format.ParseDict(result.model_dump(), payload)
        stub.SubmitResult(records_pb2.SubmitResultRequest(result=payload))
    finally:
        channel.close()


if __name__ == "__main__":
    main()
