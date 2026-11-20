# health-risk-python

Sample Data Controller app (Python, pydantic). Calls sce-unit over the gRPC socket at
`SCE_RPC_SOCKET`, streams the algorithm's records with `FetchRecords`, aggregates
them, and submits a single result message with `SubmitResult`. Progress lines go
to stderr.

```json
{"algorithmId": "662fa378-dc53-425d-9225-a187b11ea7dc", "userCount": 250, "avgRestingHeartRate": 66.79, "avgDailySteps": 7620.37, "avgSleepHours": 7.26, "riskFlaggedCount": 28, "riskFlaggedPct": 11.2, "byActivityLevel": {"sedentary": 52, "moderate": 138, "active": 60}}
```

Build:

```sh
docker build --platform linux/arm64 -t health-risk-python .
```

Inside the enclave nsjail sets `SCE_RPC_SOCKET=/data/sce.sock` and `ALGORITHM_ID`;
sce-unit serves the gRPC API on that socket.
