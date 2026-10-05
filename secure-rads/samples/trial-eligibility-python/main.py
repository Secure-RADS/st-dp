import json
import os
import sys

from pydantic import BaseModel


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
        raise ValueError(f"missing required env var {name}; run with RECORDS_PATH set")
    return value


def load_records(path: str) -> tuple[str | None, list[Record]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            body = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read records file {path}: {error}") from error
    records = body["records"] if isinstance(body, dict) else body
    algorithm_id = body.get("algorithmId") if isinstance(body, dict) else None
    return algorithm_id, [Record.model_validate(record) for record in records]


def write_result(result: Analysis) -> None:
    payload = result.model_dump_json()
    path = os.environ.get("RESULT_PATH")
    if path:
        try:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(payload)
        except OSError as error:
            raise ValueError(f"could not write result to {path}: {error}") from error
    else:
        print(payload)


def main() -> None:
    records_path = required_env("RECORDS_PATH")
    algorithm_id, records = load_records(records_path)
    log(f"loaded {len(records)} records from {records_path}")
    write_result(analyze(algorithm_id, records))


if __name__ == "__main__":
    main()
