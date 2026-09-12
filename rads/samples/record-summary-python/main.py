import json
import os
import sys


def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"missing required env var {name}; run with RECORDS_PATH set")
    return value


def log(message):
    print(message, file=sys.stderr, flush=True)


def load_records(path):
    with open(path, "r", encoding="utf-8") as handle:
        body = json.load(handle)
    records = body["records"] if isinstance(body, dict) else body
    algorithm_id = body.get("algorithmId") if isinstance(body, dict) else None
    pages = body.get("pages", 1) if isinstance(body, dict) else 1
    return algorithm_id, records, pages


def write_result(result):
    payload = json.dumps(result)
    path = os.environ.get("RESULT_PATH")
    if path:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(payload)
    else:
        print(payload)


def main():
    records_path = required_env("RECORDS_PATH")
    algorithm_id, records, pages = load_records(records_path)
    log(f"loaded {len(records)} records from {records_path}")

    result = {"algorithmId": algorithm_id, "recordCount": len(records), "pageCount": pages}
    # age is present on every canonical dataset record (see seeding/generate.ts), so it is a
    # dataset-agnostic numeric metric; if absent the result degrades to a plain record count.
    ages = [
        record.get("data", {}).get("age")
        for record in records
        if isinstance(record, dict)
    ]
    ages = [age for age in ages if isinstance(age, (int, float))]
    if ages:
        result["recordsWithAge"] = len(ages)
        result["averageAge"] = round(sum(ages) / len(ages), 2)

    write_result(result)


if __name__ == "__main__":
    main()
