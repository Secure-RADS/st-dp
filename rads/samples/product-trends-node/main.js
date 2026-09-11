const AGE_BANDS = ["18-29", "30-44", "45-59", "60+"];

function ageBand(age) {
  if (age < 30) return "18-29";
  if (age < 45) return "30-44";
  if (age < 60) return "45-59";
  return "60+";
}

function analyze(algorithmId, records) {
  const byBand = {};
  for (const band of AGE_BANDS) byBand[band] = new Map();
  let totalRevenueCents = 0;
  let totalOrders = 0;

  for (const record of records) {
    const revenues = byBand[ageBand(record.data.age)];
    for (const order of record.data.orders) {
      totalOrders++;
      for (const item of order.items) {
        const revenue = item.qty * item.priceCents;
        totalRevenueCents += revenue;
        revenues.set(item.category, (revenues.get(item.category) ?? 0) + revenue);
      }
    }
  }

  const topCategoriesByAgeBand = {};
  for (const band of AGE_BANDS) {
    topCategoriesByAgeBand[band] = [...byBand[band].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, revenueCents]) => ({ category, revenueCents }));
  }

  return {
    algorithmId,
    userCount: records.length,
    totalRevenueCents,
    totalOrders,
    topCategoriesByAgeBand,
  };
}

function recordsUrl(base, algorithmId, cursor) {
  const params = new URLSearchParams({ algorithmId });
  if (cursor) params.set("cursor", cursor);
  return `${base.replace(/\/$/, "")}/records?${params}`;
}

async function fetchAll(base, algorithmId) {
  const records = [];
  let cursor = "";
  let page = 0;
  for (;;) {
    page++;
    const res = await fetch(recordsUrl(base, algorithmId, cursor));
    if (!res.ok) throw new Error(`PDM returned HTTP ${res.status} for ${recordsUrl(base, algorithmId, cursor)}`);
    const body = await res.json();
    records.push(...body.records);
    console.error(`page ${page}: fetched ${body.records.length} records, cumulative ${records.length}`);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return records;
}

async function main() {
  const base = process.env.PDM_URL;
  const algorithmId = process.env.ALGORITHM_ID;
  if (!base || !algorithmId) {
    throw new Error("missing required env var; run with PDM_URL and ALGORITHM_ID set");
  }
  const records = await fetchAll(base, algorithmId);
  console.error(`received ${records.length} records`);
  console.log(JSON.stringify(analyze(algorithmId, records)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});