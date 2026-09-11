# health-risk-python

Sample rads Data Controller app (Python stdlib only). Reads `PDM_URL` and `ALGORITHM_ID` from
the environment, GETs every record for that algorithm from the PDM - following the `nextCursor`
pagination returned per page until there is none - and prints a single JSON summary to stdout.
The aggregation is identical to the secure-rads `health-risk-python`; only the I/O differs:
it fetches its own records over plain HTTP instead of receiving them from sce-unit over a
Unix socket. Progress lines go to stderr so stdout holds exactly one JSON object.

```json
{"algorithmId": "662fa378-dc53-425d-9225-a187b11ea7dc", "userCount": 250, "avgRestingHeartRate": 66.79, "avgDailySteps": 7620.37, "avgSleepHours": 7.26, "riskFlaggedCount": 28, "riskFlaggedPct": 11.2, "byActivityLevel": {"sedentary": 52, "moderate": 138, "active": 60}}
```

Build and run:

```
docker build -t health-risk-python .
docker run --rm -e PDM_URL=https://pdm.r.secure-rads.org \
                 -e ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc \
                 health-risk-python
```