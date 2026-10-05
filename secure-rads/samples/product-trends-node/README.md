# product-trends-node

Sample Data Controller app (Node `node:fs`, no deps). Reads the records file at
`RECORDS_PATH`, aggregates every record for that algorithm, and writes a single
JSON summary to `RESULT_PATH`. Progress lines go to stderr so the result holds
exactly one JSON object.

```json
{"algorithmId": "3b8bba4a-8106-4309-9446-7bce99a1453a", "userCount": 2500, "totalRevenueCents": 2004647586, "totalOrders": 26264, "topCategoriesByAgeBand": {}}
```

Build and run (same `{"algorithmId", "records"}` file sce-unit writes):

```
docker build --platform linux/arm64 -t product-trends-node .
docker run --rm -v /tmp/sce-run:/data \
                 -e RECORDS_PATH=/data/records.json \
                 -e RESULT_PATH=/data/result.json \
                 product-trends-node
```
