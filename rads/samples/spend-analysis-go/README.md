# spend-analysis-go

Sample rads Data Controller app (Go stdlib only). Reads `PDM_URL` and `ALGORITHM_ID` from the
environment, GETs every record for that algorithm from the PDM - following the `nextCursor`
pagination returned per page until there is none - and prints a single JSON summary to stdout.
The aggregation is identical to the secure-rads `spend-analysis-go`; only the I/O differs:
it fetches its own records over plain HTTP instead of receiving them from sce-unit over a
Unix socket. Progress lines go to stderr so stdout holds exactly one JSON object.

```json
{"algorithmId": "c7cc14fa-e962-4548-aff4-a54148798cd8", "userCount": 1000, "totalSpendByCategory": {"dining": 697211.38}, "avgMonthlySpendPerUser": 1199.77, "anomalies": [], "anomalyUserCount": 969}
```

Build and run:

```
docker build -t spend-analysis-go .
docker run --rm -e PDM_URL=https://pdm.r.secure-rads.org \
                 -e ALGORITHM_ID=c7cc14fa-e962-4548-aff4-a54148798cd8 \
                 spend-analysis-go
```