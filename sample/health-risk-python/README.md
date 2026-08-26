# health-risk-python

Sample Data Controller app (Python, stdlib only). Listens on
`/run/sce/dc.sock`, receives one JSON line of wearable records (per-user
demographics plus 14 days of steps, heart rate, and sleep), and returns a
cohort health-risk report: mean resting HR, mean daily steps, mean sleep,
activity-level breakdown, and the share of users flagged at risk (BMI >= 30,
mean resting HR >= 80, or mean sleep < 6h).

`SCE_SOCKET_PATH` overrides the socket path for local testing.

Build:

```
docker build --platform linux/arm64 -t health-risk-python sample/health-risk-python
```
