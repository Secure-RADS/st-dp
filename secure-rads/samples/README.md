# Sample Data Controller apps

Reference Data Controller (DC) images for the demo. Each is a self-contained app in a different language that listens on the SCE unix socket (`/run/sce/dc.sock`), reads one JSON line of records the enclave fetched from the PDM service, computes an aggregate over it, and writes the result back. All ignore the PII block on each record; the computation only touches the context fields.

Each app is pinned to the fixed `algorithmId` its dataset is seeded under (see `seeding/config.ts`), so the whole demo - seed, build, run - lines up and is repeatable. The root `Makefile` drives all five (`make secure-rads-all`).

| App | Language | Context | Dataset | algorithmId |
| --- | --- | --- | --- | --- |
| `health-risk-python` | Python (stdlib) | health / wearable | health | `662fa378-dc53-425d-9225-a187b11ea7dc` |
| `spend-analysis-go` | Go (stdlib) | finance / banking | finance | `c7cc14fa-e962-4548-aff4-a54148798cd8` |
| `product-trends-bun` | TypeScript (Bun) | e-commerce | ecommerce | `3b8bba4a-8106-4309-9446-7bce99a1453a` |
| `audience-segments-rust` | Rust (serde_json) | social media | social | `e4082659-08d6-4f0a-9e60-327e9410c710` |
| `trial-eligibility-python` | Python (pydantic) | e-health / records | ehealth | `e587067e-47dc-4835-8f87-5e66fc979adf` |

Each app's own README documents its exact input shape and the report it returns.

`registry-oci/` is not part of the fleet: it is a diagnostic image that reports its own runtime permissions inside the jail (used to verify the nsjail sandbox), not bound to any dataset.

## Build one

```
docker build --platform linux/arm64 -t <app>:local sample/<app>
```

The images are arm64 to match the Graviton enclave hosts. `SCE_SOCKET_PATH` overrides the socket path for local testing outside the enclave.
