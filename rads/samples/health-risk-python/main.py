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
    return algorithm_id, records


def write_result(result):
    payload = json.dumps(result)
    path = os.environ.get("RESULT_PATH")
    if path:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(payload)
    else:
        print(payload)


def activity_level(mean_steps):
    if mean_steps < 5000:
        return "sedentary"
    if mean_steps < 10000:
        return "moderate"
    return "active"


def analyze(algorithm_id, records):
    resting, steps, sleep = [], [], []
    flagged = 0
    levels = {"sedentary": 0, "moderate": 0, "active": 0}

    for record in records:
        data = record["data"]
        days = data["days"]
        mean_resting = sum(d["restingHeartRate"] for d in days) / len(days)
        mean_steps = sum(d["steps"] for d in days) / len(days)
        mean_sleep = sum(d["sleepHours"] for d in days) / len(days)
        resting.append(mean_resting)
        steps.append(mean_steps)
        sleep.append(mean_sleep)
        levels[activity_level(mean_steps)] += 1
        bmi = data["weightKg"] / (data["heightCm"] / 100) ** 2
        if bmi >= 30 or mean_resting >= 80 or mean_sleep < 6:
            flagged += 1

    n = len(records)
    return {
        "algorithmId": algorithm_id,
        "userCount": n,
        "avgRestingHeartRate": round(sum(resting) / n, 2),
        "avgDailySteps": round(sum(steps) / n, 2),
        "avgSleepHours": round(sum(sleep) / n, 2),
        "riskFlaggedCount": flagged,
        "riskFlaggedPct": round(100 * flagged / n, 2),
        "byActivityLevel": levels,
    }


def main():
    records_path = required_env("RECORDS_PATH")
    algorithm_id, records = load_records(records_path)
    log(f"loaded {len(records)} records from {records_path}")
    write_result(analyze(algorithm_id, records))


if __name__ == "__main__":
    main()
