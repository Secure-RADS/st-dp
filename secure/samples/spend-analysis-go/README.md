# spend-analysis-go

Sample Data Controller app (Go, grpc-go). Calls sce-unit over the gRPC socket at
`SCE_RPC_SOCKET`, streams the algorithm's records with `FetchRecords`, aggregates
them, and submits a single result message with `SubmitResult`. Progress lines go
to stderr.

```json
{"algorithmId": "c7cc14fa-e962-4548-aff4-a54148798cd8", "userCount": 1000, "totalSpendByCategory": {"dining": 697211.38}, "avgMonthlySpendPerUser": 1199.77, "anomalies": [], "anomalyUserCount": 969}
```

Build:

```sh
docker build --platform linux/arm64 -t spend-analysis-go .
```

Inside the enclave nsjail sets `SCE_RPC_SOCKET=/data/sce.sock` and `ALGORITHM_ID`;
sce-unit serves the gRPC API on that socket.
