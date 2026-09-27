from __future__ import annotations

import http.client
import json
import sys
import urllib.parse


def fetch_records(base: str, algorithm_id: str, run_id: str, max_records: int | None) -> tuple[list[dict], int]:
    # One connection for every page: pdm-service is paginated, and opening a fresh TCP+TLS
    # connection per page dominated the fetch time for large datasets.
    parsed = urllib.parse.urlsplit(base)
    conn = http.client.HTTPSConnection(parsed.netloc, timeout=60)
    records: list[dict] = []
    cursor: str | None = None
    pages = 0
    try:
        while True:
            params = {"algorithmId": algorithm_id}
            if cursor:
                params["cursor"] = cursor
            path = parsed.path.rstrip("/") + "/records?" + urllib.parse.urlencode(params)
            conn.request("GET", path, headers={"X-Run-Id": run_id})
            response = conn.getresponse()
            payload = response.read()
            if response.status != 200:
                raise RuntimeError(f"pdm-service returned {response.status}: {payload!r}")
            body = json.loads(payload)
            pages += 1
            records.extend(body.get("records", []))
            cursor = body.get("nextCursor")
            if max_records is not None and len(records) >= max_records:
                return records[:max_records], pages
            if not cursor:
                return records, pages
    finally:
        conn.close()


def main() -> None:
    base, algorithm_id, dest, run_id, size = sys.argv[1:6]
    max_records = int(size) if size else None
    records, pages = fetch_records(base, algorithm_id, run_id, max_records)
    with open(dest, "w", encoding="utf-8") as handle:
        json.dump({"algorithmId": algorithm_id, "pages": pages, "records": records}, handle)
    print(f"pdm: downloaded {len(records)} records in {pages} page(s) to {dest}", file=sys.stderr)


if __name__ == "__main__":
    main()
