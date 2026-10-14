export interface DatasetConfig {
  name: string;
  // Must match the algorithmId the corresponding EIF is registered under, so the enclave fetches this data.
  algorithmId: string;
  count: number;
  // Fixed faker seed - regeneration is byte-identical.
  seed: number;
}

// One dataset per shared sample app, plus ehealth (trial-eligibility) at the max count the harness seeds once.
export const DATASETS: DatasetConfig[] = [
  { name: "health", algorithmId: "662fa378-dc53-425d-9225-a187b11ea7dc", count: 250, seed: 101 },
  { name: "finance", algorithmId: "c7cc14fa-e962-4548-aff4-a54148798cd8", count: 1000, seed: 202 },
  { name: "ecommerce", algorithmId: "3b8bba4a-8106-4309-9446-7bce99a1453a", count: 2500, seed: 303 },
  { name: "social", algorithmId: "e4082659-08d6-4f0a-9e60-327e9410c710", count: 5000, seed: 404 },
  { name: "ehealth", algorithmId: "e587067e-47dc-4835-8f87-5e66fc979adf", count: 1_000_000, seed: 505 },
];

export const DEFAULT_SEED_NAMES = DATASETS.map((dataset) => dataset.name);
