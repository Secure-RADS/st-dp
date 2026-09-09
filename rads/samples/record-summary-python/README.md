# record-summary-python

Sample rads Data Controller app (Python stdlib only). Reads `PDM_URL` and `ALGORITHM_ID` from
the environment, GETs every record for that algorithm from the PDM - following the `nextCursor`
pagination returned per page until there is none - and prints a single JSON summary to stdout:

```json
{"algorithmId": "662fa378-dc53-425d-9225-a187b11ea7dc", "recordCount": 250, "pageCount": 1, "recordsWithAge": 250, "averageAge": 51.33}
```

The numeric aggregation is average `age`, which every canonical dataset record carries (see
`seeding/generate.ts`). If a dataset has no `age` field the `recordsWithAge`/`averageAge` keys
are omitted and the result is a plain record/page count, so the app stays valid for any
`algorithmId`. Progress lines go to stderr so stdout holds exactly one JSON object.

Build and run:

```
docker build -t record-summary-python .
docker run --rm -e PDM_URL=https://<api-gateway-host> \
                 -e ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc \
                 record-summary-python
```
