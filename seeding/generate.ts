import { once } from "node:events";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { faker } from "@faker-js/faker";
import { v5 as uuidv5 } from "uuid";
import { DATASETS, type DatasetConfig } from "./config";

const OUT_DIR = join(import.meta.dir, "datasets");

// Reference "today" for all relative dates, so regeneration is stable regardless of the wall clock.
const TODAY = new Date("2026-08-25T00:00:00Z");
const DAY_MS = 86400000;

function daysAgo(n: number): string {
  return new Date(TODAY.getTime() - n * DAY_MS).toISOString().slice(0, 10);
}

function tsWithinDays(n: number): string {
  const ms =
    TODAY.getTime() - faker.number.int({ min: 0, max: n }) * DAY_MS - faker.number.int({ min: 0, max: DAY_MS });
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function recordId(i: number): string {
  return `user-${String(i).padStart(6, "0")}`;
}

// Deterministic UUIDv5 over the shared record index, so the same data subject appears in every dataset that
// has at least i records. Keyed by index, not per-algorithm PII (dataset-local), and reproducible.
const SUBJECT_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function dataSubjectId(i: number): string {
  return uuidv5(`secure-rads:data-subject:${i}`, SUBJECT_NAMESPACE);
}

// A birthday that makes someone exactly `age` on TODAY. Computed against the fixed reference date (not
// faker.date.birthdate, which reads the wall clock and so isn't reproducible).
function birthDate(age: number): string {
  const latest = Date.UTC(TODAY.getUTCFullYear() - age, TODAY.getUTCMonth(), TODAY.getUTCDate());
  const earliest = Date.UTC(TODAY.getUTCFullYear() - age - 1, TODAY.getUTCMonth(), TODAY.getUTCDate() + 1);
  return new Date(earliest + faker.number.int({ min: 0, max: latest - earliest })).toISOString().slice(0, 10);
}

// Synthetic PII shared by every record. dateOfBirth is consistent with `age`.
function pii(age: number) {
  const sex = faker.person.sexType();
  const first = faker.person.firstName(sex);
  const last = faker.person.lastName();
  return {
    name: `${first} ${last}`,
    email: faker.internet.email({ firstName: first, lastName: last }).toLowerCase(),
    phone: faker.phone.number(),
    dateOfBirth: birthDate(age),
    address: {
      street: faker.location.streetAddress(),
      city: faker.location.city(),
      country: faker.location.countryCode(),
    },
  };
}

// Each generator returns one record's `data` object.

function healthData() {
  const age = faker.number.int({ min: 18, max: 90 });
  const sex = faker.helpers.arrayElement(["male", "female"] as const);
  const heightCm = sex === "male" ? faker.number.int({ min: 160, max: 195 }) : faker.number.int({ min: 148, max: 182 });
  const bmi = faker.number.float({ min: 18, max: 32 });
  const fitness = faker.number.float({ min: 0, max: 1 });
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const rhr = Math.round(72 - fitness * 18 + faker.number.float({ min: 0, max: 8 }));
    days.push({
      date: daysAgo(d),
      steps: Math.max(500, Math.round(3000 + fitness * 9000 + faker.number.float({ min: -2000, max: 2000 }))),
      restingHeartRate: rhr,
      avgHeartRate: rhr + faker.number.int({ min: 15, max: 35 }),
      sleepHours: faker.number.float({ min: 5.5, max: 9, fractionDigits: 1 }),
    });
  }
  return { ...pii(age), age, sex, heightCm, weightKg: Math.round(bmi * (heightCm / 100) ** 2), days };
}

const FIN_CATEGORIES = ["groceries", "dining", "transport", "utilities", "entertainment", "health", "shopping"];

function financeData() {
  const age = faker.number.int({ min: 18, max: 80 });
  const income = faker.number.float({ min: 2000, max: 8000 });
  const transactions = [];
  for (let i = 0; i < faker.number.int({ min: 50, max: 70 }); i++) {
    const isDeposit = faker.datatype.boolean(0.06);
    const category = isDeposit ? "salary" : faker.helpers.arrayElement(FIN_CATEGORIES);
    transactions.push({
      ts: tsWithinDays(90),
      amount: isDeposit
        ? faker.number.float({ min: income * 0.8, max: income * 1.2, fractionDigits: 2 })
        : -faker.number.float({ min: 3, max: 183, fractionDigits: 2 }),
      category,
      merchant: faker.company.name(),
    });
  }
  transactions.sort((a, b) => a.ts.localeCompare(b.ts));
  return {
    ...pii(age),
    age,
    accountType: faker.helpers.arrayElement(["checking", "savings", "premium"]),
    transactions,
  };
}

const ECOM_CATEGORIES = ["electronics", "home", "fashion", "sports", "books", "beauty", "toys"];

function ecommerceData() {
  const age = faker.number.int({ min: 18, max: 75 });
  const p = pii(age);
  const orders = [];
  for (let o = 0; o < faker.number.int({ min: 8, max: 16 }); o++) {
    const items = [];
    for (let i = 0; i < faker.number.int({ min: 1, max: 5 }); i++) {
      const category = faker.helpers.arrayElement(ECOM_CATEGORIES);
      items.push({
        sku: `${category.slice(0, 3).toUpperCase()}-${faker.number.int({ min: 10000, max: 99999 })}`,
        name: faker.commerce.productName(),
        category,
        qty: faker.number.int({ min: 1, max: 3 }),
        priceCents: faker.number.int({ min: 299, max: 29999 }),
      });
    }
    orders.push({ ts: tsWithinDays(180), items });
  }
  orders.sort((a, b) => a.ts.localeCompare(b.ts));
  return { ...p, age, country: p.address.country, orders };
}

const INTERESTS = [
  "fitness",
  "gaming",
  "cooking",
  "travel",
  "politics",
  "fashion",
  "music",
  "movies",
  "sports",
  "tech",
  "art",
  "books",
  "pets",
  "parenting",
  "finance",
  "food",
  "photography",
  "diy",
  "science",
  "news",
];

function socialData(index: number, count: number) {
  const age = faker.number.int({ min: 16, max: 70 });
  const p = pii(age);
  const connections = new Set<string>();
  const nConn = faker.number.int({ min: 5, max: 50 });
  while (connections.size < nConn) {
    const other = faker.number.int({ min: 1, max: count });
    if (other !== index) {
      connections.add(recordId(other));
    }
  }
  const activity = faker.number.float({ min: 0.2, max: 1 });
  const engagement = [];
  for (let w = 11; w >= 0; w--) {
    const weekEnd = new Date(TODAY.getTime() - w * 7 * DAY_MS);
    engagement.push({
      week: isoWeek(weekEnd),
      posts: Math.round(activity * faker.number.int({ min: 0, max: 15 })),
      likesGiven: Math.round(activity * faker.number.int({ min: 5, max: 120 })),
      likesReceived: Math.round(activity * faker.number.int({ min: 0, max: 90 })),
      comments: Math.round(activity * faker.number.int({ min: 0, max: 40 })),
      minutesActive: Math.round(activity * faker.number.int({ min: 30, max: 900 })),
    });
  }
  return {
    ...p,
    handle: `@${faker.internet.username({ firstName: p.name.split(" ")[0] }).toLowerCase()}`,
    interests: faker.helpers.arrayElements(INTERESTS, { min: 3, max: 8 }),
    connections: [...connections].sort(),
    engagement,
  };
}

// ISO-8601 week label (YYYY-Www) for the week containing d.
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((t.getTime() - jan4.getTime()) / (7 * DAY_MS));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const CONDITIONS = [
  "type2diabetes",
  "hypertension",
  "asthma",
  "copd",
  "ckd",
  "coronaryarterydisease",
  "depression",
  "osteoarthritis",
];
const MEDICATIONS = [
  "metformin",
  "lisinopril",
  "amlodipine",
  "atorvastatin",
  "salbutamol",
  "omeprazole",
  "sertraline",
  "ibuprofen",
  "levothyroxine",
  "aspirin",
  "insulin glargine",
  "losartan",
];

function ehealthData() {
  const age = faker.number.int({ min: 18, max: 90 });
  const sex = faker.helpers.arrayElement(["male", "female"] as const);
  const heightCm = sex === "male" ? faker.number.int({ min: 160, max: 195 }) : faker.number.int({ min: 148, max: 182 });
  const weightKg = Math.round(faker.number.float({ min: 17, max: 35 }) * (heightCm / 100) ** 2);
  const conditions = faker.helpers.arrayElements(CONDITIONS, { min: 0, max: 4 });
  const diabetic = conditions.includes("type2diabetes");
  const ckd = conditions.includes("ckd");
  return {
    ...pii(age),
    age,
    sex,
    heightCm,
    weightKg,
    smoker: faker.datatype.boolean(0.2),
    conditions,
    medications: faker.helpers.arrayElements(MEDICATIONS, { min: 0, max: 5 }),
    labs: {
      hba1c: diabetic
        ? faker.number.float({ min: 6.5, max: 12, fractionDigits: 1 })
        : faker.number.float({ min: 4.5, max: 6.3, fractionDigits: 1 }),
      egfr: ckd
        ? faker.number.float({ min: 20, max: 60, fractionDigits: 1 })
        : faker.number.float({ min: 60, max: 120, fractionDigits: 1 }),
      systolicBp: faker.number.int({ min: 100, max: 175 }),
      diastolicBp: faker.number.int({ min: 60, max: 105 }),
      ldl: faker.number.float({ min: 1.5, max: 5, fractionDigits: 1 }),
      bmi: Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10,
    },
  };
}

// Generators keyed by dataset name; the dataset registry (name/id/count/seed) lives in config.ts.
const GENERATORS: Record<string, (index: number, count: number) => object> = {
  health: () => healthData(),
  finance: () => financeData(),
  ecommerce: () => ecommerceData(),
  social: (i, n) => socialData(i, n),
  ehealth: () => ehealthData(),
};

// Streams one record per write so memory stays flat regardless of dataset size (a 10M dataset is ~5 GiB).
async function writeDataset({ name, algorithmId, count, seed }: DatasetConfig): Promise<void> {
  const generate = GENERATORS[name];
  faker.seed(seed);

  const path = join(OUT_DIR, `${name}.json`);
  const stream = createWriteStream(path);
  const write = async (chunk: string): Promise<void> => {
    if (!stream.write(chunk)) await once(stream, "drain");
  };

  await write(`{"algorithmId": ${JSON.stringify(algorithmId)}, "name": ${JSON.stringify(name)}, "records": [\n`);

  let maxItem = 0;
  for (let i = 1; i <= count; i++) {
    const line = JSON.stringify({ recordId: recordId(i), dataSubjectId: dataSubjectId(i), data: generate(i, count) });
    maxItem = Math.max(maxItem, line.length);
    await write(i === 1 ? line : `,\n${line}`);
  }

  await write("\n]}\n");
  stream.end();
  await once(stream, "finish");

  const bytes = statSync(path).size;
  console.log(`${name}: ${count} records, file ${(bytes / 1024).toFixed(1)} KiB, largest record ${maxItem} bytes`);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const dataset of DATASETS) {
  await writeDataset(dataset);
}
