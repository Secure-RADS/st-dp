# rads Sample Data Controller apps

Reference Data Controller (DC) images for the fully-trusted rads baseline. rads is the
no-enclave, no-KMS sibling of secure-rads: the DC's docker image is stored raw by the
registry-service and later executed on an EC2 runner, which gives it direct, unauthenticated
access to the records for its `algorithmId`. There is no attestation, encryption, or sandbox,
so these apps are plain batch programs: the runner downloads the records to a fixed path, the
app reads that file and writes one JSON result file, and the runner ships the result to the
result queue.

Each app is self-contained in its own subdirectory (Dockerfile + entrypoint). Apps are
data-set agnostic: they read the records file at `RECORDS_PATH` (a JSON file the runner wrote)
and write their result to `RESULT_PATH`, falling back to stdout when `RESULT_PATH` is unset so
they can still be run by hand.

| App | Language | Aggregation |
| --- | --- | --- |
| `record-summary-python` | Python (pydantic) | record count, page count, average `age` |
| `health-risk-python` | Python (pydantic) | resting HR / steps / sleep means, risk-flagged share, activity levels |
| `spend-analysis-go` | Go (stdlib) | spend by category, avg monthly spend, anomaly users |
| `product-trends-node` | Node (`node:fs`) | revenue and orders, top categories by age band |
| `audience-segments-rust` | Rust (serde) | interest segments, engagement tiers, avg connections |
| `trial-eligibility-ruby` | Ruby (stdlib) | trial-eligible share, exclusion breakdown |

## The rads sample model

1. **Upload (build phase).** The registry-service stores the DC's docker image tarball raw in
   S3 as `{algorithmId}/image.tar` and records `algorithmId -> (bucket, key)` in DynamoDB (see
   `rads/csav/registry-service`). `POST /upload` with a JSON `algorithmId` (UUID) returns a
   presigned S3 PUT URL; the client uploads the tarball directly and an S3 `ObjectCreated`
   notification records the mapping, so `/upload` is the only call the client makes. No EIF
   build, KMS, or attestation happens here.
2. **Run (execution phase).** The runner owns the PDM call: it downloads every record for the
   `algorithmId` from `PDM_URL/records?algorithmId=<id>` (open, no auth), following the
   `nextCursor` returned by each page, and writes `{"algorithmId", "pages", "records"}` to
   `/opt/rads/run/records.json`. It then runs the image with that directory bind-mounted at
   `/data` and `RECORDS_PATH=/data/records.json` / `RESULT_PATH=/data/result.json` set. The app
   reads the records file, aggregates, and writes one JSON object to the result file; the runner
   ships that file as the run result.

The PDM response shape the runner (and the local test fixtures below) code against (see
`rads/pdm-service/src/handlers/records.ts`, 500 records per page):

```json
{
  "algorithmId": "<uuid>",
  "records": [{ "recordId": "user-000001", "data": { ... } }],
  "nextCursor": null
}
```

`nextCursor` is `null` when the last page has been read; otherwise it is a base64url-encoded
cursor to pass back as the `cursor` query parameter on the next request. `data` carries the
per-dataset record body (PII plus context fields - see `seeding/generate.ts`).

## Run one locally

Hand-run an app against a local records file. Write the same `{"algorithmId", "records"}`
shape the runner produces, then mount it at `/data` and point `RECORDS_PATH` at it:

```
mkdir -p /tmp/rads-run
curl -sS 'https://<pdm-host>/records?algorithmId=662fa378-dc53-425d-9225-a187b11ea7dc' \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' \
  > /tmp/rads-run/records.json

docker build -t record-summary-python rads/samples/record-summary-python
docker run --rm -v /tmp/rads-run:/data \
  -e RECORDS_PATH=/data/records.json \
  -e RESULT_PATH=/data/result.json \
  record-summary-python
cat /tmp/rads-run/result.json
```

Each app follows the same pattern - only the image name differs. Progress logs go to stderr; the
result file (or stdout when `RESULT_PATH` is unset) holds exactly one JSON object.
