# trial-eligibility-python

Sample Data Controller app (Python, pydantic). Reads the records file at
`RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. Progress lines go to stderr so the result holds
exactly one JSON object.

```json
{"algorithmId": "e587067e-47dc-4835-8f87-5e66fc979adf", "userCount": 10000, "eligibleCount": 282, "eligiblePct": 2.82, "exclusionBreakdown": {"age": 5093, "hba1c": 8628, "egfr": 1590, "ckd": 2545, "bmi": 4378}, "eligibleRecordIds": ["user-000019", "user-000023", "..."]}
```

Build and run (same `{"algorithmId", "records"}` file sce-unit writes):

```sh
docker build --platform linux/arm64 -t trial-eligibility-python .
docker run --rm -v /tmp/sce-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 trial-eligibility-python
```
