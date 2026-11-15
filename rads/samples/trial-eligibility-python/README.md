# trial-eligibility-python

Sample rads Data Controller app (Python, pydantic models). Reads the records file the runner
downloaded at `RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. Same file contract as secure-rads (`RECORDS_PATH` /
`RESULT_PATH`); the runner fetches plaintext from PDM instead of sce-unit decrypting inside
the enclave. Progress lines go to stderr so the result holds exactly one JSON object.

```json
{"algorithmId": "e587067e-47dc-4835-8f87-5e66fc979adf", "userCount": 10000, "eligibleCount": 282, "eligiblePct": 2.82, "exclusionBreakdown": {"age": 5093, "hba1c": 8628, "egfr": 1590, "ckd": 2545, "bmi": 4378}, "eligibleRecordIds": ["user-000019", "user-000023", "..."]}
```

Build and run (writing the same `{"algorithmId", "records"}` file the runner produces):

```sh
docker build -t trial-eligibility-python .
docker run --rm -v /tmp/rads-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 trial-eligibility-python
```
