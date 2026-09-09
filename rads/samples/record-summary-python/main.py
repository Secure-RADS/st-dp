import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"missing required env var {name}; run with PDM_URL and ALGORITHM_ID set")
    return value


def log(message):
    print(message, file=sys.stderr, flush=True)


def records_url(base, algorithm_id, cursor):
    params = {"algorithmId": algorithm_id}
    if cursor:
        params["cursor"] = cursor
    return f"{base.rstrip('/')}/records?{urllib.parse.urlencode(params)}"


def fetch_page(url):
    try:
        with urllib.request.urlopen(url) as response:
            body = json.load(response)
    except urllib.error.HTTPError as err:
        raise ValueError(f"PDM returned HTTP {err.code} for {url}") from err
    return body.get("records", []), body.get("nextCursor")


def main():
    base = required_env("PDM_URL")
    algorithm_id = required_env("ALGORITHM_ID")

    records = []
    cursor = None
    page = 0
    while True:
        page += 1
        batch, cursor = fetch_page(records_url(base, algorithm_id, cursor))
        records.extend(batch)
        log(f"page {page}: fetched {len(batch)} records, cumulative {len(records)}")
        if not cursor:
            break

    result = {"algorithmId": algorithm_id, "recordCount": len(records), "pageCount": page}
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

    print(json.dumps(result))


if __name__ == "__main__":
    main()
