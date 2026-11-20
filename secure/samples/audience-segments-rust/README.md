# audience-segments-rust

Sample Data Controller app (Rust; tonic + serde_json). Streams social-media records over
the gRPC socket at `SCE_RPC_SOCKET` (per-user PII, interests, connections, and 12 weeks of
engagement) and submits an ad-audience segmentation: top 10 interests by user count with
mean weekly active minutes, engagement tiers by mean weekly minutes (low < 30, medium
30-120, high > 120), and mean connection count. PII fields are ignored by the computation.

Build:

```sh
docker build --platform linux/arm64 -t audience-segments-rust secure/samples/audience-segments-rust
```

Inside the enclave nsjail sets `SCE_RPC_SOCKET=/data/sce.sock` and `ALGORITHM_ID`;
sce-unit serves the gRPC API on that socket.
