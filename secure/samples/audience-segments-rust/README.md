# audience-segments-rust

Sample Data Controller app (Rust, serde_json only). Reads social-media records from
`RECORDS_PATH` (per-user PII, interests, connections, and 12 weeks of engagement) and
writes an ad-audience segmentation to `RESULT_PATH`: top 10 interests by user count with
mean weekly active minutes, engagement tiers by mean weekly minutes (low < 30, medium
30-120, high > 120), and mean connection count. PII fields are ignored by the computation.

Build:

```
docker build --platform linux/arm64 -t audience-segments-rust secure/samples/audience-segments-rust
```
