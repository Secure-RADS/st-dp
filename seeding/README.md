# Seeding

Seed-data platform for the PDM DynamoDB table. Standalone bun + TypeScript, not part of any service.

`generate.ts` deterministically produces the JSON datasets in `datasets/` (seeded PRNG, fixed seeds; regeneration is byte-identical). `seed.ts` batch-writes every dataset record into the PDM table as `{AlgorithmId, RecordId, Data}` using local AWS credentials.

## Usage

```
bun install
bun run generate
PDM_TABLE=<table-name> bun run seed
```

Region comes from `AWS_REGION` (default `ap-south-1`).

## Datasets

The five datasets mirror the service contexts framed in the source paper (social media, e-commerce, financial, health/well-being platforms, e-health). Every record carries a synthetic PII block (name, email, phone, dateOfBirth, address) alongside the context-specific data, since the framework's purpose is protecting PII while processing it.

| Dataset | Context | AlgorithmId | Records |
| --- | --- | --- | --- |
| health | health/well-being platform | 662fa378-dc53-425d-9225-a187b11ea7dc | 250 |
| finance | financial | c7cc14fa-e962-4548-aff4-a54148798cd8 | 1000 |
| ecommerce | e-commerce | 3b8bba4a-8106-4309-9446-7bce99a1453a | 2500 |
| social | social media | e4082659-08d6-4f0a-9e60-327e9410c710 | 5000 |
| ehealth | e-health | e587067e-47dc-4835-8f87-5e66fc979adf | 10000 |
