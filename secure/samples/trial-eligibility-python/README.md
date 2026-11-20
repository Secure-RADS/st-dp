# trial-eligibility-python

Sample Data Controller app (Python, pydantic). Calls sce-unit over the gRPC socket at
`SCE_RPC_SOCKET`, streams the algorithm's records with `FetchRecords`, aggregates
them, and submits a single result message with `SubmitResult`. Progress lines go
to stderr.

```json
{"algorithmId": "e587067e-47dc-4835-8f87-5e66fc979adf", "userCount": 10000, "eligibleCount": 282, "eligiblePct": 2.82, "exclusionBreakdown": {"age": 5093, "hba1c": 8628, "egfr": 1590, "ckd": 2545, "bmi": 4378}, "eligibleRecordIds": ["user-000019", "user-000023", "..."]}
```

Build:

```sh
docker build --platform linux/arm64 -t trial-eligibility-python .
```

Inside the enclave nsjail sets `SCE_RPC_SOCKET=/data/sce.sock` and `ALGORITHM_ID`;
sce-unit serves the gRPC API on that socket.
