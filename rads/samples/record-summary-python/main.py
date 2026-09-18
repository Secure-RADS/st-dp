import json
import os
import sys

from pydantic import BaseModel, Field


class RecordData(BaseModel):
    age: float | None = None


class Record(BaseModel):
    data: RecordData = Field(default_factory=RecordData)


class RecordsBody(BaseModel):
    algorithmId: str | None = None
    pages: int = 1
    records: list[Record] = Field(default_factory=list)


class Result(BaseModel):
    algorithmId: str | None
    recordCount: int
    pageCount: int
    recordsWithAge: int | None = None
    averageAge: float | None = None


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"missing required env var {name}; run with RECORDS_PATH set")
    return value


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def load_records(path: str) -> RecordsBody:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read records file {path}: {error}") from error
    if isinstance(raw, list):
        return RecordsBody(records=raw)
    return RecordsBody.model_validate(raw)


def write_result(result: Result) -> None:
    payload = result.model_dump_json(exclude_none=True)
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
    body = load_records(records_path)
    log(f"loaded {len(body.records)} records from {records_path}")

    # age is on every canonical dataset record (seeding/generate.ts), so it is the dataset-agnostic metric.
    ages = [record.data.age for record in body.records if record.data.age is not None]
    write_result(
        Result(
            algorithmId=body.algorithmId,
            recordCount=len(body.records),
            pageCount=body.pages,
            recordsWithAge=len(ages) if ages else None,
            averageAge=round(sum(ages) / len(ages), 2) if ages else None,
        )
    )


if __name__ == "__main__":
    main()
