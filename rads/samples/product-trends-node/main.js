const fs = require("node:fs");

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

function loadRecords(path) {
  const body = JSON.parse(fs.readFileSync(path, "utf8"));
  return { algorithmId: body.algorithmId, records: body.records };
}

function writeResult(result) {
  const payload = JSON.stringify(result);
  if (process.env.RESULT_PATH) {
    fs.writeFileSync(process.env.RESULT_PATH, payload);
  } else {
    console.log(payload);
  }
}

function main() {
  const recordsPath = process.env.RECORDS_PATH;
  if (!recordsPath) throw new Error("RECORDS_PATH is required");
  const { algorithmId, records } = loadRecords(recordsPath);
  console.error(`loaded ${records.length} records from ${recordsPath}`);
  writeResult(analyze(algorithmId, records));
}

main();
