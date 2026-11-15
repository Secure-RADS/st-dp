# spend-analysis-go

Sample rads Data Controller app (Go stdlib only). Reads the records file the runner downloaded
at `RECORDS_PATH`, aggregates every record for that algorithm, and writes a single JSON summary
to `RESULT_PATH`. Same file contract as secure-rads (`RECORDS_PATH` / `RESULT_PATH`); the
runner fetches plaintext from PDM instead of sce-unit decrypting inside the enclave. Progress
lines go to stderr so the result holds exactly one JSON object.

```json
{"algorithmId": "c7cc14fa-e962-4548-aff4-a54148798cd8", "userCount": 1000, "totalSpendByCategory": {"dining": 697211.38}, "avgMonthlySpendPerUser": 1199.77, "anomalies": [], "anomalyUserCount": 969}
```

Build and run (writing the same `{"algorithmId", "records"}` file the runner produces):

```sh
docker build -t spend-analysis-go .
docker run --rm -v /tmp/rads-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 spend-analysis-go
```
