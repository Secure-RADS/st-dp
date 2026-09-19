# record-summary-python

Sample rads Data Controller app (Python stdlib only). Reads the records file the runner
downloaded at `RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`:

```json
{"algorithmId": "662fa378-dc53-425d-9225-a187b11ea7dc", "recordCount": 250, "pageCount": 1, "recordsWithAge": 250, "averageAge": 51.33}
```

The numeric aggregation is average `age`, which every canonical dataset record carries (see
`seeding/generate.ts`). If a dataset has no `age` field the `recordsWithAge`/`averageAge` keys
are omitted and the result is a plain record/page count, so the app stays valid for any
`algorithmId`. The page count is carried in the records file the runner wrote. Progress lines go
to stderr so the result holds exactly one JSON object.

Build and run (writing the same `{"algorithmId", "pages", "records"}` file the runner produces):

```
docker build -t record-summary-python .
docker run --rm -v /tmp/rads-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 record-summary-python
```
