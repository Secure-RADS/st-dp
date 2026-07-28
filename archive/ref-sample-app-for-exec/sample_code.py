"""Sample workload that runs inside the enclave.

Contract enforced by enclave_server.py:
  - Define `def main(data: dict) -> jsonable`.
  - `data` is keyed by the data_ids requested. Each value is the JSON parsed
    from the corresponding encrypted blob.
  - Whatever main() returns is the only thing that crosses back over vsock.

This sample computes simple statistics over a list of numeric readings.
"""


def main(data):
    all_readings = []
    for did, blob in data.items():
        readings = blob.get("readings") if isinstance(blob, dict) else None
        if not isinstance(readings, list):
            continue
        all_readings.extend(float(x) for x in readings)

    if not all_readings:
        return {"count": 0, "sum": 0.0, "mean": None}

    total = sum(all_readings)
    return {
        "count": len(all_readings),
        "sum":   round(total, 4),
        "mean":  round(total / len(all_readings), 4),
        "min":   min(all_readings),
        "max":   max(all_readings),
    }
