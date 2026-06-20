import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLocationRoutes } from "./routes/locations.js";
import { handleLabelRoutes } from "./routes/labels.js";
import { handleReservationRoutes } from "./routes/reservations.js";
import { handleAnomalyRoutes } from "./routes/anomalies.js";
import { handleViabilityRoutes } from "./routes/viability.js";
import { getInventoryWithFrozen } from "./lib/reservation-store.js";
import { scanAndDetectAnomalies } from "./lib/temperature-anomaly.js";
import { splitBatch, mergeBatches, ensureLineageFields } from "./lib/batch-lineage.js";
import { getBatchTrendSummary, filterBatchesByRisk, analyzeBatchViability } from "./lib/viability-trend.js";

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
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18.4 },
        { at: "2026-06-02T08:00:00.000Z", value: -17.2 },
        { at: "2026-06-03T08:00:00.000Z", value: -12.5 },
        { at: "2026-06-04T08:00:00.000Z", value: -19.1 },
        { at: "2026-06-05T08:00:00.000Z", value: -8.3 }
      ],
      transactions: [
        { id: "TX-1", at: "2026-05-20", type: "collect", quantity: 1800, balance: 1800, note: "采集入库" }
      ],
      germinations: [{ at: "2026-06-12", sampled: 100, sprouted: 72, rate: 0.72 }],
      frozenQuantity: 0,
      reservations: [],
      remark: "初始入库批次，待质量复核",
      reviews: [
        { id: "RV-1", at: "2026-05-25T10:30:00.000Z", reviewer: "李管理员", conclusion: "pending", note: "初步检查种子外观完整，等待萌发实验结果后最终确认" }
      ],
      anomalies: []
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
  ensureLineageFields(batch);
  const qty = Number(input.quantity || 0);
  const negative = ["sample", "lend", "destroy", "split_out", "merge_out"].includes(input.type);
  const positive = ["collect", "return", "split_in", "merge_in"].includes(input.type);
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

    const labelHandled = await handleLabelRoutes(req, res, send, body);
    if (labelHandled) return;

    const reservationHandled = await handleReservationRoutes(req, res, send, body);
    if (reservationHandled) return;

    const anomalyHandled = await handleAnomalyRoutes(req, res, send, body);
    if (anomalyHandled) return;

    const viabilityHandled = await handleViabilityRoutes(req, res, send, body);
    if (viabilityHandled) return;

    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, { service: "稀有种子冷库库存和活性追踪API", endpoints: ["GET /batches?species=&collectionPlace=&section=&viability=&hasPendingReview=&status=&riskLevel=", "POST /batches", "GET /batches/:id", "PATCH /batches/:id/remark", "GET /batches/:id/reviews", "POST /batches/:id/reviews", "POST /batches/:id/transactions", "POST /batches/:id/temperatures", "POST /batches/:id/germinations", "POST /batches/:id/reservations", "GET /batches/:id/reservations?status=", "PATCH /batches/:id/reservations/:reservationId/approve", "PATCH /batches/:id/reservations/:reservationId/reject", "PATCH /batches/:id/reservations/:reservationId/cancel", "POST /batches/:id/reservations/:reservationId/fulfill", "POST /batches/:id/split", "POST /batches/merge", "GET /anomalies/pending", "GET /batches/:id/anomalies?status=", "PATCH /batches/:id/anomalies/:anomalyId/handle", "POST /anomalies/scan?batchId=&threshold=", "GET /reports/inventory", "GET /reports/viability-risk?lowRateThreshold=&consecutiveDeclineThreshold=&longTermDays=", "GET /batches/:id/viability", "GET /locations/sections", "POST /locations/sections", "GET /locations/sections/:id", "GET /locations/sections/:id/free-slots", "POST /locations/sections/:id/boxes", "GET /locations/boxes/:id", "PATCH /locations/boxes/:id/slots/:index", "GET /locations/batches/:id/slots", "GET /labels/batches/:id", "GET /labels/batches", "POST /labels/batches/batch"] });

    if (req.method === "POST" && url.pathname === "/batches/merge") {
      const input = await body(req);
      const result = await mergeBatches(input.batchIds, input.target);
      if (result.error) {
        const statusCode = result.error === "batch_not_found" ? 404 : 409;
        return send(res, statusCode, result);
      }
      return send(res, 201, result);
    }

    if (req.method === "GET" && url.pathname === "/batches") {
      let rows = db.batches;
      for (const key of ["species", "collectionPlace", "section", "viability", "status"]) {
        const value = url.searchParams.get(key);
        if (value) rows = rows.filter(batch => String(batch[key]).includes(value));
      }
      const hasPendingReview = url.searchParams.get("hasPendingReview");
      if (hasPendingReview === "true") {
        rows = rows.filter(batch => (batch.reviews || []).some(r => r.conclusion === "pending"));
      } else if (hasPendingReview === "false") {
        rows = rows.filter(batch => !(batch.reviews || []).some(r => r.conclusion === "pending"));
      }
      const riskLevel = url.searchParams.get("riskLevel");
      if (riskLevel) {
        const validLevels = ["normal", "warning", "critical", "unknown"];
        if (validLevels.includes(riskLevel)) {
          rows = filterBatchesByRisk(rows, riskLevel);
        }
      }
      for (const batch of rows) {
        ensureLineageFields(batch);
        batch.trendSummary = getBatchTrendSummary(batch);
      }
      return send(res, 200, rows);
    }
    if (req.method === "POST" && url.pathname === "/batches") {
      const input = await body(req);
      const batch = {
        id: input.id || `RS-${Date.now()}`,
        species: input.species,
        collectionPlace: input.collectionPlace,
        motherPlant: input.motherPlant,
        container: input.container,
        section: input.section,
        viability: input.viability || "unknown",
        quantity: Number(input.quantity || 0),
        status: "active",
        lineage: {
          splitFrom: null,
          splitTo: [],
          mergedFrom: [],
          mergedInto: null
        },
        temperatures: [],
        transactions: [],
        germinations: [],
        frozenQuantity: 0,
        reservations: [],
        remark: input.remark || "",
        reviews: [],
        anomalies: []
      };
      batch.transactions.push({ id: `TX-${Date.now()}`, at: new Date().toISOString(), type: "collect", quantity: batch.quantity, balance: batch.quantity, note: "新批次入库" });
      db.batches.push(batch);
      await saveDb(db);
      return send(res, 201, batch);
    }
    const match = url.pathname.match(/^\/batches\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      const batch = db.batches.find(b => b.id === match[1]);
      if (!batch) return send(res, 404, { error: "batch_not_found" });
      ensureLineageFields(batch);
      const action = match[2];

      if (req.method === "POST" && action === "split") {
        const input = await body(req);
        const result = await splitBatch(batch.id, input.items);
        if (result.error) {
          const statusCode = result.error === "batch_not_found" ? 404 : 409;
          return send(res, statusCode, result);
        }
        return send(res, 201, result);
      }

      if (req.method === "GET" && !action) {
        if (!batch.reviews) batch.reviews = [];
        if (batch.remark === undefined) batch.remark = "";
        if (!batch.reservations) batch.reservations = [];
        if (batch.frozenQuantity === undefined || batch.frozenQuantity === null) batch.frozenQuantity = 0;
        if (!batch.anomalies) batch.anomalies = [];
        batch.trendSummary = getBatchTrendSummary(batch);
        return send(res, 200, batch);
      }
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
        const scanResult = await scanAndDetectAnomalies(batch.id);
        return send(res, 201, {
          batch,
          anomaliesDetected: scanResult.detected || 0,
          newAnomalies: scanResult.anomalies || []
        });
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
      if (req.method === "PATCH" && action === "remark") {
        batch.remark = input.remark || "";
        await saveDb(db);
        return send(res, 200, { batchId: batch.id, remark: batch.remark });
      }
      if (req.method === "GET" && action === "reviews") {
        return send(res, 200, batch.reviews || []);
      }
      if (req.method === "POST" && action === "reviews") {
        if (!batch.reviews) batch.reviews = [];
        const validConclusions = ["pending", "approved", "rejected"];
        const conclusion = validConclusions.includes(input.conclusion) ? input.conclusion : "pending";
        const review = {
          id: `RV-${Date.now()}`,
          at: input.at || new Date().toISOString(),
          reviewer: input.reviewer || "未知管理员",
          conclusion,
          note: input.note || ""
        };
        batch.reviews.push(review);
        await saveDb(db);
        return send(res, 201, { batchId: batch.id, review });
      }
    }
    if (req.method === "GET" && url.pathname === "/reports/inventory") {
      const report = await getInventoryWithFrozen();
      return send(res, 200, report);
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Rare seed cold storage API listening on http://localhost:${port}`));
