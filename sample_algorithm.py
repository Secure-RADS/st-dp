"""Sample BMI algorithm. The Build Service bakes this file into the
enclave image at /app/algorithm.py; the enclave server imports it and
calls run(records) where each record is a decrypted JSON dict.

Returns a dict the enclave will encrypt under the DC public key.
"""

from __future__ import annotations


def run(records: list[dict]) -> dict:
    bmis = []
    for r in records:
        h_m = r["height_cm"] / 100.0
        bmis.append(r["weight_kg"] / (h_m * h_m))
    avg = sum(bmis) / len(bmis) if bmis else 0.0
    return {"count": len(bmis), "avg_bmi": round(avg, 2)}
