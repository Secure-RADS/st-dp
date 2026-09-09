# rads Sample Data Controller apps

Reference Data Controller (DC) images for the fully-trusted rads baseline. rads is the
no-enclave, no-KMS sibling of secure-rads: the DC's docker image is stored raw by the
registry-service and later executed on an EC2 runner, which gives it direct, unauthenticated
access to the records for its `algorithmId`. There is no attestation, encryption, or sandbox,
so these apps are plain networked programs - they fetch their own data over HTTP and print a
JSON result to stdout.

Each app is self-contained in its own subdirectory (Dockerfile + entrypoint). Apps are
data-set agnostic: they read `PDM_URL` and `ALGORITHM_ID` from the environment at run time and
follow the PDM's cursor pagination to fetch every record before aggregating.

| App | Language | Aggregation |
| --- | --- | --- |
| `record-summary-python` | Python (stdlib) | record count, page count, average `age` |

## The rads sample model

1. **Upload (build phase).** The registry-service stores the DC's docker image tarball raw in
   S3 as `{algorithmId}/image.tar` and records `algorithmId -> (bucket, key)` in DynamoDB (see
   `rads/csav/registry-service`). Upload is a multipart POST to `/upload` with `algorithmId`
   (UUID) and `image` fields; no EIF build, KMS, or attestation happens here.
2. **Run (execution phase).** An EC2 runner loads the stored image and runs it with two env
   vars - `PDM_URL` (the base origin of the PDM service) and `ALGORITHM_ID` (the records to
   fetch). The app GETs `PDM_URL/records?algorithmId=<id>` (open, no auth), follows the
   `nextCursor` returned by each page until there is none, aggregates, and prints a single JSON
   object to stdout. The runner captures that object as the run result.

The PDM response shape the apps code against (see `rads/pdm-service/src/handlers/records.ts`,
500 records per page):

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

```
docker build -t record-summary-python rads/samples/record-summary-python
docker run --rm -e PDM_URL=https://<api-gateway-host> \
                 -e ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc \
                 record-summary-python
```

Only the final JSON object is written to stdout; progress logs go to stderr.
