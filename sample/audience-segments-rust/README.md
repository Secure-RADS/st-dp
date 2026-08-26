# audience-segments-rust

Sample Data Controller app (Rust, serde_json only). Listens on
`/run/sce/dc.sock`, receives one JSON line of social-media records (per-user
PII, interests, connections, and 12 weeks of engagement), and returns an
ad-audience segmentation: top 10 interests by user count with mean weekly
active minutes, engagement tiers by mean weekly minutes (low < 30, medium
30-120, high > 120), and mean connection count. PII fields are ignored by
the computation.

`SCE_SOCKET_PATH` overrides the socket path for local testing.

Build:

```
docker build --platform linux/arm64 -t audience-segments-rust sample/audience-segments-rust
```
