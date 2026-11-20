import os
import sys

import grpc
from google.protobuf import json_format, struct_pb2
from pydantic import BaseModel

from sce.v1 import records_pb2, records_pb2_grpc


class Day(BaseModel):
    restingHeartRate: float
    steps: float
    sleepHours: float


class RecordData(BaseModel):
    weightKg: float
    heightCm: float
    days: list[Day]


class Record(BaseModel):
    data: RecordData


class Analysis(BaseModel):
    algorithmId: str | None
    userCount: int
    avgRestingHeartRate: float
    avgDailySteps: float
    avgSleepHours: float
    riskFlaggedCount: int
    riskFlaggedPct: float
    byActivityLevel: dict[str, int]


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def activity_level(mean_steps: float) -> str:
    if mean_steps < 5000:
        return "sedentary"
    if mean_steps < 10000:
        return "moderate"
    return "active"


def analyze(algorithm_id: str | None, records: list[Record]) -> Analysis:
    resting: list[float] = []
    steps: list[float] = []
    sleep: list[float] = []
    flagged = 0
    levels: dict[str, int] = {"sedentary": 0, "moderate": 0, "active": 0}

    for record in records:
        data = record.data
        days = data.days
        mean_resting = sum(d.restingHeartRate for d in days) / len(days)
        mean_steps = sum(d.steps for d in days) / len(days)
        mean_sleep = sum(d.sleepHours for d in days) / len(days)
        resting.append(mean_resting)
        steps.append(mean_steps)
        sleep.append(mean_sleep)
        levels[activity_level(mean_steps)] += 1
        bmi = data.weightKg / (data.heightCm / 100) ** 2
        if bmi >= 30 or mean_resting >= 80 or mean_sleep < 6:
            flagged += 1

    n = len(records)
    return Analysis(
        algorithmId=algorithm_id,
        userCount=n,
        avgRestingHeartRate=round(sum(resting) / n, 2),
        avgDailySteps=round(sum(steps) / n, 2),
        avgSleepHours=round(sum(sleep) / n, 2),
        riskFlaggedCount=flagged,
        riskFlaggedPct=round(100 * flagged / n, 2),
        byActivityLevel=levels,
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
            Record.model_validate({"data": json_format.MessageToDict(record.data)})
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
