# Seeding

Seed-data platform for the PDM DynamoDB tables. Standalone bun + TypeScript, not part of any service.

`generate.ts` produces the JSON datasets in `datasets/` using `@faker-js/faker` with a fixed seed per dataset, so regeneration is byte-identical. Each dataset gets its own PDM table named `<PDM_TABLE_PREFIX>-<algorithmId>`; the seeder creates it if missing. `seed-secure-rads.ts` envelope-encrypts each record, batch-writes `{AlgorithmId, RecordId, Data}` into the algorithm's table, puts the CMK-wrapped DEK in the data-key table, and encrypts the table at rest with a dedicated per-algorithm KMS key (`PdmTableKeyArn` on the registry's algorithm table). `seed-rads.ts` writes plaintext tables.

## Usage

```sh
bun install
bun run generate
PDM_TABLE_PREFIX=<prefix> DATA_KEY_TABLE=<table> ALGORITHM_TABLE=<table> bun run seed-secure-rads
PDM_TABLE_PREFIX=<prefix> bun run seed-rads
```

Region comes from `AWS_REGION` (default `ap-southeast-2`). Creating tables and the secure per-algorithm table key needs `dynamodb:CreateTable`/`DescribeTable` and `kms:CreateKey`, plus `dynamodb:UpdateItem` on the algorithm table.

## Datasets

The five datasets mirror the service contexts framed in the source paper (social media, e-commerce, financial, health/well-being platforms, e-health). Every record carries a synthetic PII block (name, email, phone, dateOfBirth, address) alongside the context-specific data, since the framework's purpose is protecting PII while processing it.

| Dataset | Context | AlgorithmId | Records |
| --- | --- | --- | --- |
| health | health/well-being platform | 662fa378-dc53-425d-9225-a187b11ea7dc | 250 |
| finance | financial | c7cc14fa-e962-4548-aff4-a54148798cd8 | 1000 |
| ecommerce | e-commerce | 3b8bba4a-8106-4309-9446-7bce99a1453a | 2500 |
| social | social media | e4082659-08d6-4f0a-9e60-327e9410c710 | 5000 |
| ehealth | e-health | e587067e-47dc-4835-8f87-5e66fc979adf | 150000 |
