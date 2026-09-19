import json
import sys
import urllib.parse
import urllib.request


def fetch_records(base: str, algorithm_id: str, run_id: str) -> tuple[list[dict], int]:
    records: list[dict] = []
    cursor: str | None = None
    pages = 0
    while True:
        params = {"algorithmId": algorithm_id}
        if cursor:
            params["cursor"] = cursor
        url = base.rstrip("/") + "/records?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"X-Run-Id": run_id})
        with urllib.request.urlopen(request) as response:
            body = json.load(response)
        pages += 1
        records.extend(body.get("records", []))
        cursor = body.get("nextCursor")
        if not cursor:
            return records, pages


def main() -> None:
    base, algorithm_id, dest, run_id = sys.argv[1:5]
    records, pages = fetch_records(base, algorithm_id, run_id)
    with open(dest, "w", encoding="utf-8") as handle:
        json.dump({"algorithmId": algorithm_id, "pages": pages, "records": records}, handle)
    print(f"pdm: downloaded {len(records)} records in {pages} page(s) to {dest}", file=sys.stderr)


if __name__ == "__main__":
    main()
