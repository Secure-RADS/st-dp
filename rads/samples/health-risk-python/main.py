import json
import os
import sys
from typing import TypedDict


class Day(TypedDict):
    restingHeartRate: float
    steps: float
    sleepHours: float


class RecordData(TypedDict):
    weightKg: float
    heightCm: float
    days: list[Day]


class Record(TypedDict):
    data: RecordData


class Analysis(TypedDict):
    algorithmId: str | None
    userCount: int
    avgRestingHeartRate: float
    avgDailySteps: float
    avgSleepHours: float
    riskFlaggedCount: int
    riskFlaggedPct: float
    byActivityLevel: dict[str, int]


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"missing required env var {name}; run with RECORDS_PATH set")
    return value


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def load_records(path: str) -> tuple[str | None, list[Record]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            body = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read records file {path}: {error}") from error
    records = body["records"] if isinstance(body, dict) else body
    algorithm_id = body.get("algorithmId") if isinstance(body, dict) else None
    return algorithm_id, records


def write_result(result: Analysis) -> None:
    payload = json.dumps(result)
    path = os.environ.get("RESULT_PATH")
    if path:
        try:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(payload)
        except OSError as error:
            raise ValueError(f"could not write result to {path}: {error}") from error
    else:
        print(payload)


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
        data = record["data"]
        days = data["days"]
        mean_resting = sum(d["restingHeartRate"] for d in days) / len(days)
        mean_steps = sum(d["steps"] for d in days) / len(days)
        mean_sleep = sum(d["sleepHours"] for d in days) / len(days)
        resting.append(mean_resting)
        steps.append(mean_steps)
        sleep.append(mean_sleep)
        levels[activity_level(mean_steps)] += 1
        bmi = data["weightKg"] / (data["heightCm"] / 100) ** 2
        if bmi >= 30 or mean_resting >= 80 or mean_sleep < 6:
            flagged += 1

    n = len(records)
    return {
        "algorithmId": algorithm_id,
        "userCount": n,
        "avgRestingHeartRate": round(sum(resting) / n, 2),
        "avgDailySteps": round(sum(steps) / n, 2),
        "avgSleepHours": round(sum(sleep) / n, 2),
        "riskFlaggedCount": flagged,
        "riskFlaggedPct": round(100 * flagged / n, 2),
        "byActivityLevel": levels,
    }


def main() -> None:
    records_path = required_env("RECORDS_PATH")
    algorithm_id, records = load_records(records_path)
    log(f"loaded {len(records)} records from {records_path}")
    write_result(analyze(algorithm_id, records))


if __name__ == "__main__":
    main()