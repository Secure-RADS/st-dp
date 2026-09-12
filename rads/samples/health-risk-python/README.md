# health-risk-python

Sample rads Data Controller app (Python stdlib only). Reads the records file the runner
downloaded at `RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. The aggregation is identical to the secure-rads
`health-risk-python`; only the I/O differs: the runner fetches the records and hands the app a
local file instead of sce-unit relaying them over a Unix socket. Progress lines go to stderr so
the result holds exactly one JSON object.

```json
{"algorithmId": "662fa378-dc53-425d-9225-a187b11ea7dc", "userCount": 250, "avgRestingHeartRate": 66.79, "avgDailySteps": 7620.37, "avgSleepHours": 7.26, "riskFlaggedCount": 28, "riskFlaggedPct": 11.2, "byActivityLevel": {"sedentary": 52, "moderate": 138, "active": 60}}
```

Build and run (writing the same `{"algorithmId", "records"}` file the runner produces):

```
docker build -t health-risk-python .
docker run --rm -v /tmp/rads-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 health-risk-python
```
