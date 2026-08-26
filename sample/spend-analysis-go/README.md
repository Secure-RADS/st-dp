# spend-analysis-go

Sample Data Controller app (Go, stdlib only). Listens on `/run/sce/dc.sock`,
receives one JSON line of banking records (per-user transactions), and
returns a spend report: total spend per category, mean monthly spend per
user, and per-user anomaly flags for any transaction exceeding 3x that
user's mean absolute transaction amount (first 50 flagged users listed).

`SCE_SOCKET_PATH` overrides the socket path for local testing.

Build:

```
docker build --platform linux/arm64 -t spend-analysis-go sample/spend-analysis-go
```
