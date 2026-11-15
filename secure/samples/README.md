# Sample Data Controller apps

Reference Data Controller (DC) images for the demo. Each is a self-contained app in a different language that reads the records file at `RECORDS_PATH` (JSON written by sce-unit after decrypt), aggregates, and writes one JSON result to `RESULT_PATH`. Same file contract as rads. All ignore the PII block on each record; the computation only touches the context fields.

Each app is pinned to the fixed `algorithmId` its dataset is seeded under (see `seeding/config.ts`), so the whole demo - seed, build, run - lines up and is repeatable. The root `Makefile` drives all five (`make secure-rads-all`).

| App | Language | Context | Dataset | algorithmId |
| --- | --- | --- | --- | --- |
| `health-risk-python` | Python (pydantic) | health / wearable | health | `662fa378-dc53-425d-9225-a187b11ea7dc` |
| `spend-analysis-go` | Go (stdlib) | finance / banking | finance | `c7cc14fa-e962-4548-aff4-a54148798cd8` |
| `product-trends-node` | Node (`node:fs`) | e-commerce | ecommerce | `3b8bba4a-8106-4309-9446-7bce99a1453a` |
| `audience-segments-rust` | Rust (serde_json) | social media | social | `e4082659-08d6-4f0a-9e60-327e9410c710` |
| `trial-eligibility-python` | Python (pydantic) | e-health / records | ehealth | `e587067e-47dc-4835-8f87-5e66fc979adf` |

Each app's own README documents its exact input shape and the report it returns.

## Build one

```sh
docker build --platform linux/arm64 -t <app>:local secure/samples/<app>
```

The images are arm64 to match the Graviton enclave hosts. Inside the enclave, nsjail sets `RECORDS_PATH=/data/records.json` and `RESULT_PATH=/data/result.json`.
