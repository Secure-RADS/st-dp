import * as net from "node:net";
import * as fs from "node:fs";

const SOCKET_PATH = process.env.SCE_SOCKET_PATH ?? "/run/sce/dc.sock";
const AGE_BANDS = ["18-29", "30-44", "45-59", "60+"];

function ageBand(age) {
  if (age < 30) return "18-29";
  if (age < 45) return "30-44";
  if (age < 60) return "45-59";
  return "60+";
}

function analyze(request) {
  const byBand = {};
  for (const band of AGE_BANDS) byBand[band] = new Map();
  let totalRevenueCents = 0;
  let totalOrders = 0;

  for (const record of request.records) {
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
    algorithmId: request.algorithmId,
    userCount: request.records.length,
    totalRevenueCents,
    totalOrders,
    topCategoriesByAgeBand,
  };
}

function main() {
  console.error("product-trends-node starting");
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

  const server = net.createServer((conn) => {
    console.error("sce-unit connected");
    const chunks = [];
    conn.on("data", (chunk) => {
      chunks.push(chunk);
      if (!chunk.includes(0x0a)) return;
      const line = Buffer.concat(chunks).toString("utf8").split("\n", 1)[0];
      const request = JSON.parse(line);
      console.error(`received ${request.records.length} records`);
      conn.end(JSON.stringify(analyze(request)) + "\n", () => {
        console.error("result sent");
        server.close();
      });
    });
  });

  server.listen(SOCKET_PATH, () => console.error(`listening on ${SOCKET_PATH}`));
}

main();
