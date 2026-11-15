# product-trends-node

Sample rads Data Controller app (Node `node:fs`, no deps). Reads the records file the runner
downloaded at `RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. Same file contract as secure-rads (`RECORDS_PATH` /
`RESULT_PATH`); the runner fetches plaintext from PDM instead of sce-unit decrypting inside
the enclave. Progress lines go to stderr so the result holds exactly one JSON object.

```json
{"algorithmId": "3b8bba4a-8106-4309-9446-7bce99a1453a", "userCount": 2500, "totalRevenueCents": 2004647586, "totalOrders": 26264, "topCategoriesByAgeBand": {}}
```

Build and run (writing the same `{"algorithmId", "records"}` file the runner produces):

```sh
docker build -t product-trends-node .
docker run --rm -v /tmp/rads-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 product-trends-node
```
