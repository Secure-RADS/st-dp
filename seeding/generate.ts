import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dir, "datasets");

type Rng = () => number;

// mulberry32: deterministic 32-bit seeded PRNG
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

const END_DAY_UTC = Date.UTC(2026, 7, 25);
const DAY_MS = 86400000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoTs(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isoWeek(ms: number): string {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((t.getTime() - jan4.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function recordId(i: number): string {
  return `user-${String(i).padStart(6, "0")}`;
}

const FIRST_NAMES = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "David",
  "Elizabeth",
  "William",
  "Barbara",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Daniel",
  "Karen",
  "Matthew",
  "Lisa",
  "Anthony",
  "Nancy",
] as const;
const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
] as const;
const EMAIL_DOMAINS = ["example.com", "mailbox.test", "inbox.example", "post.example"] as const;
const STREETS = [
  "Oak Street",
  "Maple Avenue",
  "Cedar Lane",
  "Elm Drive",
  "Pine Road",
  "Birch Boulevard",
  "Willow Way",
  "Chestnut Court",
  "Ash Grove",
  "Juniper Terrace",
] as const;
const CITIES: readonly { city: string; country: string }[] = [
  { city: "Amsterdam", country: "NL" },
  { city: "Berlin", country: "DE" },
  { city: "Paris", country: "FR" },
  { city: "London", country: "GB" },
  { city: "Madrid", country: "ES" },
  { city: "Rome", country: "IT" },
  { city: "Vienna", country: "AT" },
  { city: "Dublin", country: "IE" },
  { city: "Lisbon", country: "PT" },
  { city: "Stockholm", country: "SE" },
];

interface Pii {
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  address: { street: string; city: string; country: string };
}

// dateOfBirth is uniform within the window that makes the person exactly `age` on 2026-08-25
function pii(rng: Rng, age: number): Pii {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const dobStart = Date.UTC(2026 - age - 1, 7, 26);
  const dobEnd = Date.UTC(2026 - age, 7, 25);
  const dob = dobStart + Math.floor(rng() * (dobEnd - dobStart + DAY_MS));
  const loc = pick(rng, CITIES);
  return {
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${randInt(rng, 1, 999)}@${pick(rng, EMAIL_DOMAINS)}`,
    phone: `+${randInt(rng, 1, 49)} ${randInt(rng, 100, 999)} ${randInt(rng, 100, 999)} ${randInt(rng, 1000, 9999)}`,
    dateOfBirth: isoDate(dob),
    address: { street: `${randInt(rng, 1, 250)} ${pick(rng, STREETS)}`, city: loc.city, country: loc.country },
  };
}

interface Dataset {
  algorithmId: string;
  name: string;
  records: { recordId: string; data: Record<string, unknown> }[];
}

function build(
  name: string,
  algorithmId: string,
  count: number,
  seed: number,
  gen: (rng: Rng, index: number, count: number) => Record<string, unknown>,
): Dataset {
  const rng = mulberry32(seed);
  const records = [];
  for (let i = 1; i <= count; i++) {
    records.push({ recordId: recordId(i), data: gen(rng, i, count) });
  }
  return { algorithmId, name, records };
}

function healthData(rng: Rng): Record<string, unknown> {
  const age = randInt(rng, 18, 90);
  const sex = pick(rng, ["male", "female"] as const);
  const heightCm = sex === "male" ? randInt(rng, 160, 195) : randInt(rng, 148, 182);
  const bmi = 18 + rng() * 14;
  const fitness = rng();
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const steps = Math.max(500, Math.round(3000 + fitness * 9000 + (rng() - 0.5) * 4000));
    const rhr = Math.round(72 - fitness * 18 + rng() * 8);
    days.push({
      date: isoDate(END_DAY_UTC - d * DAY_MS),
      steps,
      restingHeartRate: rhr,
      avgHeartRate: rhr + randInt(rng, 15, 35),
      sleepHours: round(5.5 + rng() * 3.5, 1),
    });
  }
  return {
    ...pii(rng, age),
    age,
    sex,
    heightCm,
    weightKg: Math.round(bmi * (heightCm / 100) ** 2),
    days,
  };
}

const FIN_CATEGORIES = [
  "groceries",
  "dining",
  "transport",
  "utilities",
  "entertainment",
  "health",
  "shopping",
] as const;
const MERCHANTS: Record<string, readonly string[]> = {
  groceries: ["FreshMart", "GreenGrocer", "DailyBasket"],
  dining: ["Cafe Uno", "Spice Route", "Burger Hub"],
  transport: ["MetroCard", "CityCabs", "FuelPoint"],
  utilities: ["PowerGrid Co", "AquaWorks", "NetLink"],
  entertainment: ["StreamFlix", "CinePlex", "GameZone"],
  health: ["MediPlus", "CityPharma", "FitClub"],
  shopping: ["ShopSphere", "StyleStore", "TechBay"],
  salary: ["Employer Inc"],
};

function financeData(rng: Rng): Record<string, unknown> {
  const age = randInt(rng, 18, 80);
  const n = randInt(rng, 50, 70);
  const income = 2000 + rng() * 6000;
  const transactions = [];
  for (let i = 0; i < n; i++) {
    const ms = END_DAY_UTC - Math.floor(rng() * 90 * DAY_MS) - Math.floor(rng() * DAY_MS);
    const isDeposit = rng() < 0.06;
    const category = isDeposit ? "salary" : pick(rng, FIN_CATEGORIES);
    const amount = isDeposit ? round(income * (0.8 + rng() * 0.4), 2) : round(-(3 + rng() * 180), 2);
    transactions.push({ ts: isoTs(ms), amount, category, merchant: pick(rng, MERCHANTS[category]) });
  }
  transactions.sort((a, b) => a.ts.localeCompare(b.ts));
  return {
    ...pii(rng, age),
    age,
    accountType: pick(rng, ["checking", "savings", "premium"] as const),
    transactions,
  };
}

const ECOM_CATEGORIES = ["electronics", "home", "fashion", "sports", "books", "beauty", "toys"] as const;
const ITEM_NAMES: Record<string, readonly string[]> = {
  electronics: ["Wireless Earbuds", "USB-C Hub", "Smart Bulb", "Bluetooth Speaker"],
  home: ["Ceramic Vase", "Throw Blanket", "Desk Lamp", "Storage Bin"],
  fashion: ["Cotton Tee", "Denim Jacket", "Canvas Sneakers", "Wool Scarf"],
  sports: ["Yoga Mat", "Water Bottle", "Resistance Bands", "Running Socks"],
  books: ["Mystery Novel", "Cookbook", "Sci-Fi Anthology", "Travel Guide"],
  beauty: ["Face Serum", "Hand Cream", "Shampoo Bar", "Lip Balm"],
  toys: ["Puzzle Set", "Building Blocks", "Plush Bear", "RC Car"],
};

function ecommerceData(rng: Rng): Record<string, unknown> {
  const age = randInt(rng, 18, 75);
  const p = pii(rng, age);
  const nOrders = randInt(rng, 8, 16);
  const orders = [];
  for (let o = 0; o < nOrders; o++) {
    const ms = END_DAY_UTC - Math.floor(rng() * 180 * DAY_MS) - Math.floor(rng() * DAY_MS);
    const nItems = randInt(rng, 1, 5);
    const items = [];
    for (let i = 0; i < nItems; i++) {
      const category = pick(rng, ECOM_CATEGORIES);
      items.push({
        sku: `${category.slice(0, 3).toUpperCase()}-${randInt(rng, 10000, 99999)}`,
        name: pick(rng, ITEM_NAMES[category]),
        category,
        qty: randInt(rng, 1, 3),
        priceCents: randInt(rng, 299, 29999),
      });
    }
    orders.push({ ts: isoTs(ms), items });
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
] as const;
const WEEK_END_MONDAY_UTC = Date.UTC(2026, 7, 17);

function pickDistinct<T>(rng: Rng, pool: readonly T[], n: number, exclude?: T): T[] {
  const out = new Set<T>();
  while (out.size < n) {
    const v = pick(rng, pool);
    if (v !== exclude) {
      out.add(v);
    }
  }
  return [...out];
}

function socialData(rng: Rng, index: number, count: number): Record<string, unknown> {
  const age = randInt(rng, 16, 70);
  const p = pii(rng, age);
  const nConn = randInt(rng, 5, 50);
  const connections = new Set<string>();
  while (connections.size < nConn) {
    const other = randInt(rng, 1, count);
    if (other !== index) {
      connections.add(recordId(other));
    }
  }
  const activity = 0.2 + rng() * 0.8;
  const engagement = [];
  for (let w = 11; w >= 0; w--) {
    const ms = WEEK_END_MONDAY_UTC - w * 7 * DAY_MS;
    engagement.push({
      week: isoWeek(ms),
      posts: Math.round(activity * randInt(rng, 0, 15)),
      likesGiven: Math.round(activity * randInt(rng, 5, 120)),
      likesReceived: Math.round(activity * randInt(rng, 0, 90)),
      comments: Math.round(activity * randInt(rng, 0, 40)),
      minutesActive: Math.round(activity * randInt(rng, 30, 900)),
    });
  }
  return {
    ...p,
    handle: `@${p.name.toLowerCase().replace(" ", "_")}${randInt(rng, 1, 999)}`,
    interests: pickDistinct(rng, INTERESTS, randInt(rng, 3, 8)),
    connections: [...connections].sort(),
    engagement,
  };
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
] as const;
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
] as const;

function ehealthData(rng: Rng): Record<string, unknown> {
  const age = randInt(rng, 18, 90);
  const sex = pick(rng, ["male", "female"] as const);
  const heightCm = sex === "male" ? randInt(rng, 160, 195) : randInt(rng, 148, 182);
  const bmi = 17 + rng() * 18;
  const weightKg = Math.round(bmi * (heightCm / 100) ** 2);
  const conditions = pickDistinct(rng, CONDITIONS, randInt(rng, 0, 4));
  const diabetic = conditions.includes("type2diabetes");
  const ckd = conditions.includes("ckd");
  return {
    ...pii(rng, age),
    age,
    sex,
    heightCm,
    weightKg,
    smoker: rng() < 0.2,
    conditions,
    medications: pickDistinct(rng, MEDICATIONS, randInt(rng, 0, 5)),
    labs: {
      hba1c: round(diabetic ? 6.5 + rng() * 5.5 : 4.5 + rng() * 1.8, 1),
      egfr: round(ckd ? 20 + rng() * 40 : 60 + rng() * 60, 1),
      systolicBp: randInt(rng, 100, 175),
      diastolicBp: randInt(rng, 60, 105),
      ldl: round(1.5 + rng() * 3.5, 1),
      bmi: round(weightKg / (heightCm / 100) ** 2, 1),
    },
  };
}

const DATASETS: [
  string,
  string,
  number,
  number,
  (rng: Rng, index: number, count: number) => Record<string, unknown>,
][] = [
  ["health", "662fa378-dc53-425d-9225-a187b11ea7dc", 250, 101, healthData],
  ["finance", "c7cc14fa-e962-4548-aff4-a54148798cd8", 1000, 202, financeData],
  ["ecommerce", "3b8bba4a-8106-4309-9446-7bce99a1453a", 2500, 303, ecommerceData],
  ["social", "e4082659-08d6-4f0a-9e60-327e9410c710", 5000, 404, socialData],
  ["ehealth", "e587067e-47dc-4835-8f87-5e66fc979adf", 10000, 505, ehealthData],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, algorithmId, count, seed, gen] of DATASETS) {
  const ds = build(name, algorithmId, count, seed, gen);
  const body = ds.records.map((r) => JSON.stringify(r)).join(",\n");
  const json = `{"algorithmId": ${JSON.stringify(ds.algorithmId)}, "name": ${JSON.stringify(ds.name)}, "records": [\n${body}\n]}\n`;
  const file = join(OUT_DIR, `${name}.json`);
  writeFileSync(file, json);
  let maxItem = 0;
  for (const r of ds.records) {
    maxItem = Math.max(maxItem, JSON.stringify(r).length);
  }
  console.log(
    `${name}: ${count} records, file ${(json.length / 1024).toFixed(1)} KiB, largest record ${maxItem} bytes`,
  );
}
