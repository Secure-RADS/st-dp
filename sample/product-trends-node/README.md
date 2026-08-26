# product-trends-node

Sample Data Controller app (Node.js + TypeScript, run directly via Node's
native type stripping). Listens on `/run/sce/dc.sock`, receives one JSON
line of e-commerce records (per-user orders with line items), and returns a
product trends report: total revenue, order count, and the top 5 product
categories by revenue for each age band (18-29, 30-44, 45-59, 60+).

`SCE_SOCKET_PATH` overrides the socket path for local testing.

Build:

```
docker build --platform linux/arm64 -t product-trends-node sample/product-trends-node
```
