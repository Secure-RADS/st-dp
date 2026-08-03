"""POST an algorithm source file to the Build Service /build endpoint."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--algorithm-id", required=True)
    p.add_argument("--dc-id",        required=True)
    p.add_argument("--file",         required=True, help="Algorithm source file (Python).")
    p.add_argument("--build-url",    required=True, help="Build Service /build endpoint URL.")
    args = p.parse_args()

    with open(args.file, "rb") as f:
        source = f.read()

    body = json.dumps({
        "algorithm_id":   args.algorithm_id,
        "dc_id":          args.dc_id,
        "algorithm_code": base64.b64encode(source).decode("ascii"),
    }).encode("utf-8")

    req = urllib.request.Request(
        args.build_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(json.dumps(json.loads(r.read()), indent=2))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
