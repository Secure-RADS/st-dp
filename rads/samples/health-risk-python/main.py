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

    print(json.dumps(analyze(algorithm_id, records)))


if __name__ == "__main__":
    main()