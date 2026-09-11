# product-trends-node

Sample rads Data Controller app (Node 20 built-in `fetch`, no deps). Reads `PDM_URL` and
`ALGORITHM_ID` from the environment, GETs every record for that algorithm from the PDM -
following the `nextCursor` pagination returned per page until there is none - and prints a
single JSON summary to stdout. The aggregation is identical to the secure-rads
`product-trends-node`; only the I/O differs: it fetches its own records over plain HTTP
instead of receiving them from sce-unit over a Unix socket. Progress lines go to stderr so
stdout holds exactly one JSON object.

```json
{"algorithmId": "3b8bba4a-8106-4309-9446-7bce99a1453a", "userCount": 2500, "totalRevenueCents": 2004647586, "totalOrders": 26264, "topCategoriesByAgeBand": {}}
```

Build and run:

```
docker build -t product-trends-node .
docker run --rm -e PDM_URL=https://pdm.r.secure-rads.org \
                 -e ALGORITHM_ID=3b8bba4a-8106-4309-9446-7bce99a1453a \
                 product-trends-node
```