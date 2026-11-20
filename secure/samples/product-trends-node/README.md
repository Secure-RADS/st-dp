# product-trends-node

Sample Data Controller app (Node, @grpc/grpc-js). Calls sce-unit over the gRPC socket at
`SCE_RPC_SOCKET`, streams the algorithm's records with `FetchRecords`, aggregates
them, and submits a single result message with `SubmitResult`. Progress lines go
to stderr.

```json
{"algorithmId": "3b8bba4a-8106-4309-9446-7bce99a1453a", "userCount": 2500, "totalRevenueCents": 2004647586, "totalOrders": 26264, "topCategoriesByAgeBand": {}}
```

Build:

```sh
docker build --platform linux/arm64 -t product-trends-node .
```

Inside the enclave nsjail sets `SCE_RPC_SOCKET=/data/sce.sock` and `ALGORITHM_ID`;
sce-unit serves the gRPC API on that socket.
