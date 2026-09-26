export interface DatasetConfig {
  name: string;
  // Must match the algorithmId the corresponding EIF is registered under, so the enclave fetches this data.
  algorithmId: string;
  count: number;
  // Fixed faker seed - regeneration is byte-identical.
  seed: number;
}

// The trial-eligibility algorithm is benchmarked across dataset sizes (Exp1/Exp2). One algorithmId is reused
// and reseeded per size, so every size shares the id and differs only in record count.
export const EHEALTH_ALGORITHM_ID = "e587067e-47dc-4835-8f87-5e66fc979adf";
// Exp1/Exp2 sheet sizes (10K through 5M).
export const EHEALTH_SIZES = [
  10_000, 25_000, 50_000, 75_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000,
];

// One dataset per shared sample app, at the size its app is registered under.
export const DATASETS: DatasetConfig[] = [
  { name: "health", algorithmId: "662fa378-dc53-425d-9225-a187b11ea7dc", count: 250, seed: 101 },
  { name: "finance", algorithmId: "c7cc14fa-e962-4548-aff4-a54148798cd8", count: 1000, seed: 202 },
  { name: "ecommerce", algorithmId: "3b8bba4a-8106-4309-9446-7bce99a1453a", count: 2500, seed: 303 },
  { name: "social", algorithmId: "e4082659-08d6-4f0a-9e60-327e9410c710", count: 5000, seed: 404 },
];

// The ehealth size sweep: one file per size, all under EHEALTH_ALGORITHM_ID and sharing one faker seed, so
// each size is a strict prefix of the largest (the first N records are identical). A run asks for N records
// and reads the first N, so only the largest dataset needs seeding.
export const EHEALTH_DATASETS: DatasetConfig[] = EHEALTH_SIZES.map((count) => ({
  name: `ehealth-${count / 1000}k`,
  algorithmId: EHEALTH_ALGORITHM_ID,
  count,
  seed: 505,
}));

// Datasets seeded when no explicit SEED_DATASET is given (the 5-sample fleet, ehealth at its base size).
export const DEFAULT_SEED_NAMES = [...DATASETS.map((dataset) => dataset.name), "ehealth-10k"];
