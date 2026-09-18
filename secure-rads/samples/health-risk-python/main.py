import json
import os
import socket
import sys

from pydantic import BaseModel


SOCKET_PATH = os.environ.get("SCE_SOCKET_PATH", "/run/sce/dc.sock")


class Day(BaseModel):
    restingHeartRate: float
    steps: float
    sleepHours: float


class RecordData(BaseModel):
    weightKg: float
    heightCm: float
    days: list[Day]


class Record(BaseModel):
    data: RecordData


class Analysis(BaseModel):
    algorithmId: str | None
    userCount: int
    avgRestingHeartRate: float
    avgDailySteps: float
    avgSleepHours: float
    riskFlaggedCount: int
    riskFlaggedPct: float
    byActivityLevel: dict[str, int]


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def activity_level(mean_steps: float) -> str:
    if mean_steps < 5000:
        return "sedentary"
    if mean_steps < 10000:
        return "moderate"
    return "active"


def analyze(algorithm_id: str | None, records: list[Record]) -> Analysis:
    resting: list[float] = []
    steps: list[float] = []
    sleep: list[float] = []
    flagged = 0
    levels: dict[str, int] = {"sedentary": 0, "moderate": 0, "active": 0}

    for record in records:
        data = record.data
        days = data.days
        mean_resting = sum(d.restingHeartRate for d in days) / len(days)
        mean_steps = sum(d.steps for d in days) / len(days)
        mean_sleep = sum(d.sleepHours for d in days) / len(days)
        resting.append(mean_resting)
        steps.append(mean_steps)
        sleep.append(mean_sleep)
        levels[activity_level(mean_steps)] += 1
        bmi = data.weightKg / (data.heightCm / 100) ** 2
        if bmi >= 30 or mean_resting >= 80 or mean_sleep < 6:
            flagged += 1

    n = len(records)
    return Analysis(
        algorithmId=algorithm_id,
        userCount=n,
        avgRestingHeartRate=round(sum(resting) / n, 2),
        avgDailySteps=round(sum(steps) / n, 2),
        avgSleepHours=round(sum(sleep) / n, 2),
        riskFlaggedCount=flagged,
        riskFlaggedPct=round(100 * flagged / n, 2),
        byActivityLevel=levels,
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
    log("health-risk-python starting")
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
