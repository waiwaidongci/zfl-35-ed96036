import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLocationRoutes } from "./routes/locations.js";
import { handleLabelRoutes } from "./routes/labels.js";
import { handleReservationRoutes } from "./routes/reservations.js";
import { handleAnomalyRoutes } from "./routes/anomalies.js";
import { handleViabilityRoutes } from "./routes/viability.js";
import { handleImportRoutes } from "./routes/imports.js";
import { handleAuditRoutes } from "./routes/audit.js";
import { getInventoryWithFrozen } from "./lib/reservation-store.js";
import { scanAndDetectAnomalies } from "./lib/temperature-anomaly.js";
import { splitBatch, mergeBatches, ensureLineageFields } from "./lib/batch-lineage.js";
import { getBatchTrendSummary, filterBatchesByRisk, analyzeBatchViability, filterBatchesByRetestPriority } from "./lib/viability-trend.js";
import {
  loadDb,
  mutate,
  OPERATION,
  clone,
  getRequestContext,
  filterBatchesBySite,
  getDefaultSiteId,
  listSites,
  getSite,
  getDefaultSite,
  createSite,
  updateSite,
  isSiteDisabled,
  DEFAULT_SITE_ID
} from "./lib/data-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3035);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function extractOperator(req, input) {
  if (input && input.operator) return input.operator;
  const headers = (req && req.headers) || {};
  return headers["x-operator"] || headers["x-user"] || undefined;
}

function makeCtx(req, input) {
  return {
    operator: extractOperator(req, input),
    source: getRequestContext(req)
  };
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

    const importHandled = await handleImportRoutes(req, res, send, body);
    if (importHandled) return;

    const auditHandled = await handleAuditRoutes(req, res, send, body);
    if (auditHandled) return;

    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      const endpoints = [
        "GET /sites",
        "GET /sites/:id",
        "POST /sites",
        "PATCH /sites/:id",
        "GET /batches?siteId=&species=&collectionPlace=&section=&viability=&hasPendingReview=&status=&riskLevel=&retestPriority=",
        "POST /batches",
        "GET /batches/:id",
        "PATCH /batches/:id/remark",
        "GET /batches/:id/reviews",
        "POST /batches/:id/reviews",
        "POST /batches/:id/transactions",
        "POST /batches/:id/temperatures",
        "POST /batches/:id/germinations",
        "POST /batches/:id/reservations",
        "GET /batches/:id/reservations?status=",
        "PATCH /batches/:id/reservations/:reservationId/approve",
        "PATCH /batches/:id/reservations/:reservationId/reject",
        "PATCH /batches/:id/reservations/:reservationId/cancel",
        "POST /batches/:id/reservations/:reservationId/fulfill",
        "POST /batches/:id/split",
        "POST /batches/merge",
        "GET /anomalies/pending?siteId=",
        "GET /batches/:id/anomalies?status=",
        "PATCH /batches/:id/anomalies/:anomalyId/handle",
        "POST /anomalies/scan?batchId=&threshold=&siteId=",
        "GET /reservations?status=&applicant=&plannedDateFrom=&plannedDateTo=&siteId=",
        "GET /reports/inventory?siteId=&applicant=&plannedDateFrom=&plannedDateTo=&reservationStatus=",
        "GET /reports/viability-risk?siteId=&lowRateThreshold=&consecutiveDeclineThreshold=&longTermDays=",
        "GET /reports/retest-plan?siteId=&lowRateThreshold=&longTermDays=&standardRetestIntervalDays=",
        "GET /reports/retest-batches?siteId=&lowRateThreshold=",
        "GET /batches/:id/viability",
        "GET /batches/:id/retest-plan",
        "GET /locations/sites",
        "GET /locations/sections?siteId=",
        "POST /locations/sections",
        "GET /locations/sections/:id",
        "GET /locations/sections/:id/free-slots",
        "POST /locations/sections/:id/boxes",
        "GET /locations/boxes/:id",
        "PATCH /locations/boxes/:id/slots/:index",
        "GET /locations/batches/:id/slots",
        "GET /labels/batches/:id",
        "GET /labels/batches?siteId=&species=&collectionPlace=&section=&viability=",
        "POST /labels/batches/batch",
        "POST /imports/preview",
        "POST /imports/confirm",
        "GET /audit-logs?siteId=",
        "GET /audit-logs/stats",
        "GET /batches/:id/history/timeline",
        "GET /batches/:id/history/replay"
      ];
      return send(res, 200, { service: "稀有种子冷库库存和活性追踪API（多站点版）", endpoints });
    }

    if (req.method === "GET" && url.pathname === "/sites") {
      const sites = await listSites();
      const defaultSite = sites.find(s => s.isDefault);
      return send(res, 200, {
        total: sites.length,
        defaultSiteId: defaultSite ? defaultSite.id : null,
        sites
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/sites/")) {
      const siteId = decodeURIComponent(url.pathname.slice("/sites/".length));
      const site = await getSite(siteId);
      if (!site) return send(res, 404, { error: "site_not_found" });
      return send(res, 200, site);
    }

    if (req.method === "POST" && url.pathname === "/sites") {
      const input = await body(req);
      const ctx = makeCtx(req, input);
      if (!input.id) return send(res, 400, { error: "missing_site_id" });
      const result = await createSite(input, ctx);
      if (result.error) {
        return send(res, result.error === "site_already_exists" ? 409 : 400, result);
      }
      return send(res, 201, result.site || result);
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/sites/")) {
      const siteId = decodeURIComponent(url.pathname.slice("/sites/".length));
      const input = await body(req);
      const ctx = makeCtx(req, input);
      const result = await updateSite(siteId, input, ctx);
      if (result.error) {
        const statusMap = {
          site_not_found: 404,
          default_site_cannot_disable: 409
        };
        return send(res, statusMap[result.error] || 400, result);
      }
      return send(res, 200, result.site || result);
    }

    if (req.method === "POST" && url.pathname === "/batches/merge") {
      const input = await body(req);
      const result = await mergeBatches(input.batchIds, input.target, makeCtx(req, input));
      if (result.error) {
        const statusCode = result.error === "batch_not_found" ? 404 : 409;
        return send(res, statusCode, result);
      }
      return send(res, 201, result);
    }

    if (req.method === "GET" && url.pathname === "/batches") {
      const defaultId = getDefaultSiteId(db);
      const siteIdParam = url.searchParams.get("siteId");
      const effectiveSiteId = siteIdParam || defaultId;
      const appliedSiteFilter = siteIdParam ? "specified" : "default";

      let rows = db.batches;
      if (effectiveSiteId !== "all") {
        rows = filterBatchesBySite(rows, effectiveSiteId, defaultId);
      }
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
      const retestPriority = url.searchParams.get("retestPriority");
      if (retestPriority) {
        const validPriorities = ["urgent", "high", "medium", "low", "none", "all_need_retest"];
        if (validPriorities.includes(retestPriority)) {
          rows = filterBatchesByRetestPriority(rows, retestPriority);
        }
      }
      for (const batch of rows) {
        ensureLineageFields(batch);
        batch.trendSummary = getBatchTrendSummary(batch);
      }
      return send(res, 200, {
        siteFilter: {
          siteId: effectiveSiteId === "all" ? null : effectiveSiteId,
          applied: appliedSiteFilter,
          note: effectiveSiteId === "all"
            ? "已查询所有站点"
            : siteIdParam
              ? `按指定站点 ${effectiveSiteId} 筛选`
              : `未传 siteId，使用默认站点 ${effectiveSiteId}`
        },
        total: rows.length,
        batches: rows
      });
    }

    if (req.method === "POST" && url.pathname === "/batches") {
      const input = await body(req);
      const ctx = makeCtx(req, input);

      const defaultId = getDefaultSiteId(db);
      const batchSiteId = input.siteId || defaultId;

      const result = await mutate({
        operation: OPERATION.BATCH_CREATE,
        entityType: "batch",
        entityId: input.id || null,
        operator: ctx.operator,
        source: ctx.source,
        affectedBatchIds: [],
        details: {},
        mutator: (dbInner) => {
          const targetSite = (dbInner.sites || []).find(s => s.id === batchSiteId);
          if (isSiteDisabled(targetSite)) {
            return { error: "site_disabled", message: `站点 ${targetSite ? targetSite.name : batchSiteId} 已停用，无法创建批次`, siteId: batchSiteId };
          }
          const batch = {
            id: input.id || `RS-${Date.now()}`,
            siteId: batchSiteId,
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
          dbInner.batches.push(batch);

          return {
            createdBatchIds: [batch.id],
            details: {
              batch: clone(batch)
            },
            batch
          };
        }
      });

      if (result.error) {
        return send(res, result.error === "site_disabled" ? 409 : 400, result);
      }
      return send(res, 201, result.batch || result);
    }

    const match = url.pathname.match(/^\/batches\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      const batch = db.batches.find(b => b.id === match[1]);
      if (!batch) return send(res, 404, { error: "batch_not_found" });
      ensureLineageFields(batch);
      const action = match[2];

      if (req.method === "POST" && action === "split") {
        const input = await body(req);
        const result = await splitBatch(batch.id, input.items, makeCtx(req, input));
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
      const ctx = makeCtx(req, input);

      if (req.method === "POST" && action === "transactions") {
        const result = await mutate({
          operation: OPERATION.TRANSACTION_ADD,
          entityType: "batch",
          entityId: batch.id,
          operator: ctx.operator,
          source: ctx.source,
          affectedBatchIds: [batch.id],
          details: {},
          mutator: (dbInner) => {
            const b = dbInner.batches.find(x => x.id === batch.id);
            const r = applyTransaction(b, input);
            if (r.error) return r;
            return {
              details: {
                transaction: clone(r.tx),
                quantityAfter: b.quantity
              },
              batchId: b.id,
              transaction: r.tx,
              quantity: b.quantity
            };
          }
        });
        if (result.error) return send(res, 409, result);
        return send(res, 201, result);
      }

      if (req.method === "POST" && action === "temperatures") {
        const tempRecord = { at: input.at || new Date().toISOString(), value: Number(input.value) };
        const result = await mutate({
          operation: OPERATION.TEMPERATURE_ADD,
          entityType: "batch",
          entityId: batch.id,
          operator: ctx.operator,
          source: ctx.source,
          affectedBatchIds: [batch.id],
          details: {},
          mutator: (dbInner) => {
            const b = dbInner.batches.find(x => x.id === batch.id);
            b.temperatures.push(tempRecord);
            return {
              details: {
                temperature: clone(tempRecord)
              },
              batchId: b.id,
              temperature: tempRecord
            };
          }
        });

        const scanResult = await scanAndDetectAnomalies(batch.id);
        return send(res, 201, {
          batch,
          temperature: tempRecord,
          anomaliesDetected: scanResult.detected || 0,
          newAnomalies: scanResult.anomalies || []
        });
      }

      if (req.method === "POST" && action === "germinations") {
        const sampled = Number(input.sampled || 0);
        const sprouted = Number(input.sprouted || 0);
        const germination = {
          at: input.at || new Date().toISOString().slice(0, 10),
          sampled,
          sprouted,
          rate: sampled ? Number((sprouted / sampled).toFixed(3)) : 0
        };

        const result = await mutate({
          operation: OPERATION.GERMINATION_ADD,
          entityType: "batch",
          entityId: batch.id,
          operator: ctx.operator,
          source: ctx.source,
          affectedBatchIds: [batch.id],
          details: {},
          mutator: (dbInner) => {
            const b = dbInner.batches.find(x => x.id === batch.id);
            b.germinations.push(germination);
            let txRecord = null;
            if (sampled) {
              const r = applyTransaction(b, { type: "sample", quantity: sampled, note: "萌发实验取样" });
              if (r.error) return r;
              txRecord = r.tx;
            }
            return {
              details: {
                germination: clone(germination),
                transaction: txRecord ? clone(txRecord) : null,
                quantityAfter: b.quantity
              },
              batchId: b.id,
              batch: b,
              germination,
              transaction: txRecord
            };
          }
        });

        if (result.error) return send(res, 409, result);
        return send(res, 201, result.batch || result);
      }

      if (req.method === "PATCH" && action === "remark") {
        const newRemark = input.remark || "";
        const result = await mutate({
          operation: OPERATION.BATCH_UPDATE_REMARK,
          entityType: "batch",
          entityId: batch.id,
          operator: ctx.operator,
          source: ctx.source,
          affectedBatchIds: [batch.id],
          details: {},
          mutator: (dbInner) => {
            const b = dbInner.batches.find(x => x.id === batch.id);
            b.remark = newRemark;
            return {
              details: {
                remark: newRemark
              },
              batchId: b.id,
              remark: b.remark
            };
          }
        });
        return send(res, 200, result);
      }

      if (req.method === "GET" && action === "reviews") {
        return send(res, 200, batch.reviews || []);
      }

      if (req.method === "POST" && action === "reviews") {
        const validConclusions = ["pending", "approved", "rejected"];
        const conclusion = validConclusions.includes(input.conclusion) ? input.conclusion : "pending";
        const review = {
          id: `RV-${Date.now()}`,
          at: input.at || new Date().toISOString(),
          reviewer: input.reviewer || "未知管理员",
          conclusion,
          note: input.note || ""
        };

        const result = await mutate({
          operation: OPERATION.REVIEW_ADD,
          entityType: "batch",
          entityId: batch.id,
          operator: review.reviewer !== "未知管理员" ? review.reviewer : ctx.operator,
          source: ctx.source,
          affectedBatchIds: [batch.id],
          details: {},
          mutator: (dbInner) => {
            const b = dbInner.batches.find(x => x.id === batch.id);
            if (!b.reviews) b.reviews = [];
            b.reviews.push(review);
            return {
              details: {
                review: clone(review)
              },
              batchId: b.id,
              review
            };
          }
        });
        return send(res, 201, result);
      }
    }

    if (req.method === "GET" && url.pathname === "/reports/inventory") {
      const siteIdParam = url.searchParams.get("siteId");
      const reservationStatus = url.searchParams.get("reservationStatus") || "";
      const reservationFilters = {
        status: reservationStatus,
        applicant: url.searchParams.get("applicant") || "",
        plannedDateFrom: url.searchParams.get("plannedDateFrom") || "",
        plannedDateTo: url.searchParams.get("plannedDateTo") || ""
      };
      const hasFilters = Object.values(reservationFilters).some(v => v);
      const report = await getInventoryWithFrozen(siteIdParam || null, hasFilters ? reservationFilters : null);
      return send(res, 200, report);
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

async function bootstrap() {
  await loadDb();
  server.listen(port, () => console.log(`Rare seed cold storage API listening on http://localhost:${port}`));
}

bootstrap();
