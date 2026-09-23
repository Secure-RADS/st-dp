import json
import os
import socket
import sys

from pydantic import BaseModel


SOCKET_PATH = os.environ.get("SCE_SOCKET_PATH", "/run/sce/dc.sock")


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


def read_line(conn: socket.socket) -> bytes:
    chunks = []
    while True:
        chunk = conn.recv(1 << 16)
        if not chunk:
            break
        chunks.append(chunk)
        if b"\n" in chunk:
            break
    return b"".join(chunks).split(b"\n", 1)[0]


def main() -> None:
    log("trial-eligibility-python starting")
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(1)
    log(f"listening on {SOCKET_PATH}")

    conn, _ = server.accept()
    log("sce-unit connected")
    with conn:
        request = json.loads(read_line(conn))
        records = [Record.model_validate(record) for record in request["records"]]
        log(f"received {len(records)} records")
        result = analyze(request.get("algorithmId"), records)
        conn.sendall((result.model_dump_json() + "\n").encode())
        log("result sent")


if __name__ == "__main__":
    main()
