import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLocationRoutes } from "./routes/locations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "rare-seeds.json");
const port = Number(process.env.PORT || 3035);

const seed = {
  batches: [
    {
      id: "RS-001",
      species: "独叶草",
      collectionPlace: "西岭北坡",
      motherPlant: "MP-17",
      container: "C-冷盒-08",
      section: "A2",
      viability: "high",
      quantity: 1800,
      temperatures: [{ at: "2026-06-01T08:00:00.000Z", value: -18.4 }],
      transactions: [
        { id: "TX-1", at: "2026-05-20", type: "collect", quantity: 1800, balance: 1800, note: "采集入库" }
      ],
      germinations: [{ at: "2026-06-12", sampled: 100, sprouted: 72, rate: 0.72 }]
    }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function applyTransaction(batch, input) {
  const qty = Number(input.quantity || 0);
  const negative = ["sample", "lend", "destroy"].includes(input.type);
  const positive = ["collect", "return", "split_in"].includes(input.type);
  const next = batch.quantity + (positive ? qty : negative ? -qty : 0);
  if (next < 0) return { error: "negative_inventory_blocked" };
  batch.quantity = next;
  const tx = { id: `TX-${Date.now()}`, at: input.at || new Date().toISOString(), type: input.type, quantity: qty, balance: batch.quantity, note: input.note || "" };
  batch.transactions.push(tx);
  return { tx };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    const locationHandled = await handleLocationRoutes(req, res, send, body);
    if (locationHandled) return;

    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, { service: "稀有种子冷库库存和活性追踪API", endpoints: ["GET /batches?species=&collectionPlace=&section=&viability=", "POST /batches", "GET /batches/:id", "POST /batches/:id/transactions", "POST /batches/:id/temperatures", "POST /batches/:id/germinations", "GET /reports/inventory", "GET /locations/sections", "POST /locations/sections", "GET /locations/sections/:id", "GET /locations/sections/:id/free-slots", "POST /locations/sections/:id/boxes", "GET /locations/boxes/:id", "PATCH /locations/boxes/:id/slots/:index", "GET /locations/batches/:id/slots"] });
    if (req.method === "GET" && url.pathname === "/batches") {
      let rows = db.batches;
      for (const key of ["species", "collectionPlace", "section", "viability"]) {
        const value = url.searchParams.get(key);
        if (value) rows = rows.filter(batch => String(batch[key]).includes(value));
      }
      return send(res, 200, rows);
    }
    if (req.method === "POST" && url.pathname === "/batches") {
      const input = await body(req);
      const batch = { id: input.id || `RS-${Date.now()}`, species: input.species, collectionPlace: input.collectionPlace, motherPlant: input.motherPlant, container: input.container, section: input.section, viability: input.viability || "unknown", quantity: Number(input.quantity || 0), temperatures: [], transactions: [], germinations: [] };
      batch.transactions.push({ id: `TX-${Date.now()}`, at: new Date().toISOString(), type: "collect", quantity: batch.quantity, balance: batch.quantity, note: "新批次入库" });
      db.batches.push(batch);
      await saveDb(db);
      return send(res, 201, batch);
    }
    const match = url.pathname.match(/^\/batches\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      const batch = db.batches.find(b => b.id === match[1]);
      if (!batch) return send(res, 404, { error: "batch_not_found" });
      const action = match[2];
      if (req.method === "GET" && !action) return send(res, 200, batch);
      const input = await body(req);
      if (req.method === "POST" && action === "transactions") {
        const result = applyTransaction(batch, input);
        if (result.error) return send(res, 409, result);
        await saveDb(db);
        return send(res, 201, { batchId: batch.id, transaction: result.tx, quantity: batch.quantity });
      }
      if (req.method === "POST" && action === "temperatures") {
        batch.temperatures.push({ at: input.at || new Date().toISOString(), value: Number(input.value) });
        await saveDb(db);
        return send(res, 201, batch);
      }
      if (req.method === "POST" && action === "germinations") {
        const sampled = Number(input.sampled || 0);
        const sprouted = Number(input.sprouted || 0);
        batch.germinations.push({ at: input.at || new Date().toISOString().slice(0,10), sampled, sprouted, rate: sampled ? Number((sprouted / sampled).toFixed(3)) : 0 });
        if (sampled) {
          const result = applyTransaction(batch, { type: "sample", quantity: sampled, note: "萌发实验取样" });
          if (result.error) return send(res, 409, result);
        }
        await saveDb(db);
        return send(res, 201, batch);
      }
    }
    if (req.method === "GET" && url.pathname === "/reports/inventory") {
      const total = db.batches.reduce((sum, b) => sum + b.quantity, 0);
      const bySpecies = {};
      const bySection = {};
      for (const b of db.batches) {
        bySpecies[b.species] = (bySpecies[b.species] || 0) + b.quantity;
        bySection[b.section] = (bySection[b.section] || 0) + b.quantity;
      }
      return send(res, 200, { total, bySpecies, bySection, lowStock: db.batches.filter(b => b.quantity < 200).map(b => ({ id: b.id, species: b.species, quantity: b.quantity })) });
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Rare seed cold storage API listening on http://localhost:${port}`));
