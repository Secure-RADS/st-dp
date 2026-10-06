# spend-analysis-go

Sample Data Controller app (Go stdlib only). Reads the records file at
`RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. Progress lines go to stderr so the result holds
exactly one JSON object.

```json
{"algorithmId": "c7cc14fa-e962-4548-aff4-a54148798cd8", "userCount": 1000, "totalSpendByCategory": {"dining": 697211.38}, "avgMonthlySpendPerUser": 1199.77, "anomalies": [], "anomalyUserCount": 969}
```

Build and run (same `{"algorithmId", "records"}` file sce-unit writes):

```
docker build --platform linux/arm64 -t spend-analysis-go .
docker run --rm -v /tmp/sce-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 spend-analysis-go
```
