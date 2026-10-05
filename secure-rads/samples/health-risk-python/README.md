# health-risk-python

Sample Data Controller app (Python, pydantic). Reads the records file at
`RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. Progress lines go to stderr so the result holds
exactly one JSON object.

```json
{"algorithmId": "662fa378-dc53-425d-9225-a187b11ea7dc", "userCount": 250, "avgRestingHeartRate": 66.79, "avgDailySteps": 7620.37, "avgSleepHours": 7.26, "riskFlaggedCount": 28, "riskFlaggedPct": 11.2, "byActivityLevel": {"sedentary": 52, "moderate": 138, "active": 60}}
```

Build and run (same `{"algorithmId", "pages", "records"}` file sce-unit writes):

```
docker build --platform linux/arm64 -t health-risk-python .
docker run --rm -v /tmp/sce-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 health-risk-python
```
