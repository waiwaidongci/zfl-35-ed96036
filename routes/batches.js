import {
  loadDb,
  loadDbWithVersion,
  getDefaultSiteId,
  filterBatchesBySite,
  isSiteDisabled,
  mutate,
  OPERATION,
  clone
} from "../lib/data-store.js";
import { splitBatch, mergeBatches, ensureLineageFields } from "../lib/batch-lineage.js";
import { scanAndDetectAnomalies } from "../lib/temperature-anomaly.js";
import { getBatchTrendSummary, filterBatchesByRisk, filterBatchesByRetestPriority } from "../lib/viability-trend.js";
import { makeCtx, createRouteHandler, mutationStatus } from "../lib/utils.js";

function applyTransaction(batch, input) {
  ensureLineageFields(batch);
  const qty = Number(input.quantity || 0);
  const negative = ["sample", "lend", "destroy", "split_out", "merge_out", "transfer_out"].includes(input.type);
  const positive = ["collect", "return", "split_in", "merge_in", "transfer_in"].includes(input.type);
  const next = batch.quantity + (positive ? qty : negative ? -qty : 0);
  if (next < 0) return { error: "negative_inventory_blocked" };
  if (negative) {
    const frozen = batch.frozenQuantity || 0;
    const inTransit = batch.inTransitQuantity || 0;
    const available = batch.quantity - frozen - inTransit;
    if (qty > available) return { error: "insufficient_available_quantity", available, requested: qty, frozen, inTransit };
  }
  batch.quantity = next;
  const tx = { id: `TX-${Date.now()}`, at: input.at || new Date().toISOString(), type: input.type, quantity: qty, balance: batch.quantity, note: input.note || "" };
  batch.transactions.push(tx);
  return { tx };
}

const routes = [
  {
    method: "GET",
    pattern: /^\/batches$/,
    handler: async (_req, _res, _body, _params, url) => {
      const dbResult = await loadDbWithVersion();
      const db = dbResult.data;
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
        if (batch.frozenQuantity === undefined || batch.frozenQuantity === null) batch.frozenQuantity = 0;
        if (batch.inTransitQuantity === undefined || batch.inTransitQuantity === null) batch.inTransitQuantity = 0;
        if (!batch.lineage.transferredFrom) batch.lineage.transferredFrom = null;
        if (!batch.lineage.transferredTo) batch.lineage.transferredTo = [];
        batch.trendSummary = getBatchTrendSummary(batch);
      }
      return {
        siteFilter: {
          siteId: effectiveSiteId === "all" ? null : effectiveSiteId,
          applied: appliedSiteFilter,
          note: effectiveSiteId === "all"
            ? "已查询所有站点"
            : siteIdParam
              ? `按指定站点 ${effectiveSiteId} 筛选`
              : `未传 siteId，使用默认站点 ${effectiveSiteId}`
        },
        versions: {
          dataVersion: dbResult.version,
          dataUpdatedAt: dbResult.updatedAt
        },
        total: rows.length,
        batches: rows
      };
    },
    successStatus: 200
  },
  {
    method: "POST",
    pattern: /^\/batches$/,
    handler: async (req, _res, body) => {
      const input = body;
      const ctx = makeCtx(req, input);

      const dbResult = await loadDbWithVersion();
      const db = dbResult.data;
      const defaultId = getDefaultSiteId(db);
      const batchSiteId = input.siteId || defaultId;

      const result = await mutate({
        operation: OPERATION.BATCH_CREATE,
        entityType: "batch",
        entityId: input.id || null,
        operator: ctx.operator,
        source: ctx.source,
        expectedVersions: ctx.expectedVersions,
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

      if (result.error) return result;
      return result.batch || result;
    },
    successStatus: 201
  },
  {
    method: "POST",
    pattern: /^\/batches\/merge$/,
    handler: async (req, _res, body) => {
      const input = body;
      const result = await mergeBatches(input.batchIds, input.target, makeCtx(req, input));
      if (result.error) {
        return result;
      }
      return result;
    },
    successStatus: 201
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)$/,
    handler: async (_req, _res, _body, params) => {
      const batchId = params[1];
      const dbResult = await loadDbWithVersion();
      const db = dbResult.data;
      const batch = db.batches.find(b => b.id === batchId);
      if (!batch) return { error: "batch_not_found" };
      ensureLineageFields(batch);
      if (!batch.reviews) batch.reviews = [];
      if (batch.remark === undefined) batch.remark = "";
      if (!batch.reservations) batch.reservations = [];
      if (batch.frozenQuantity === undefined || batch.frozenQuantity === null) batch.frozenQuantity = 0;
      if (batch.inTransitQuantity === undefined || batch.inTransitQuantity === null) batch.inTransitQuantity = 0;
      if (!batch.anomalies) batch.anomalies = [];
      if (!batch.lineage) batch.lineage = { splitFrom: null, splitTo: [], mergedFrom: [], mergedInto: null };
      if (batch.lineage.transferredFrom === undefined) batch.lineage.transferredFrom = null;
      if (!batch.lineage.transferredTo) batch.lineage.transferredTo = [];
      batch.trendSummary = getBatchTrendSummary(batch);
      return {
        versions: {
          dataVersion: dbResult.version,
          dataUpdatedAt: dbResult.updatedAt
        },
        batch
      };
    },
    successStatus: 200
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/split$/,
    handler: async (req, _res, body, params) => {
      const batchId = params[1];
      const input = body;
      const result = await splitBatch(batchId, input.items, makeCtx(req, input));
      if (result.error) return result;
      return result;
    },
    successStatus: 201
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/transactions$/,
    handler: async (req, _res, body, params) => {
      const batchId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
      const result = await mutate({
        operation: OPERATION.TRANSACTION_ADD,
        entityType: "batch",
        entityId: batchId,
        operator: ctx.operator,
        source: ctx.source,
        expectedVersions: ctx.expectedVersions,
        affectedBatchIds: [batchId],
        details: {},
        mutator: (dbInner) => {
          const b = dbInner.batches.find(x => x.id === batchId);
          if (!b) return { error: "batch_not_found" };
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
      if (result.error) return result;
      return result;
    },
    successStatus: 201
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/temperatures$/,
    handler: async (req, _res, body, params) => {
      const batchId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
      const tempRecord = { at: input.at || new Date().toISOString(), value: Number(input.value) };
      const result = await mutate({
        operation: OPERATION.TEMPERATURE_ADD,
        entityType: "batch",
        entityId: batchId,
        operator: ctx.operator,
        source: ctx.source,
        expectedVersions: ctx.expectedVersions,
        affectedBatchIds: [batchId],
        details: {},
        mutator: (dbInner) => {
          const b = dbInner.batches.find(x => x.id === batchId);
          if (!b) return { error: "batch_not_found" };
          b.temperatures.push(tempRecord);
          return {
            details: {
              temperature: clone(tempRecord)
            },
            batchId: b.id,
            batch: b,
            temperature: tempRecord
          };
        }
      });

      if (result.error) return result;
      const scanResult = await scanAndDetectAnomalies(batchId);
      return {
        batch: result.batch,
        temperature: tempRecord,
        anomaliesDetected: scanResult.detected || 0,
        newAnomalies: scanResult.anomalies || []
      };
    },
    successStatus: 201
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/germinations$/,
    handler: async (req, _res, body, params) => {
      const batchId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
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
        entityId: batchId,
        operator: ctx.operator,
        source: ctx.source,
        expectedVersions: ctx.expectedVersions,
        affectedBatchIds: [batchId],
        details: {},
        mutator: (dbInner) => {
          const b = dbInner.batches.find(x => x.id === batchId);
          if (!b) return { error: "batch_not_found" };
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

      if (result.error) return result;
      return result.batch || result;
    },
    successStatus: 201
  },
  {
    method: "PATCH",
    pattern: /^\/batches\/([^/]+)\/remark$/,
    handler: async (req, _res, body, params) => {
      const batchId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
      const newRemark = input.remark || "";
      const result = await mutate({
        operation: OPERATION.BATCH_UPDATE_REMARK,
        entityType: "batch",
        entityId: batchId,
        operator: ctx.operator,
        source: ctx.source,
        expectedVersions: ctx.expectedVersions,
        affectedBatchIds: [batchId],
        details: {},
        mutator: (dbInner) => {
          const b = dbInner.batches.find(x => x.id === batchId);
          if (!b) return { error: "batch_not_found" };
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
      if (result.error) return result;
      return result;
    },
    successStatus: 200
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)\/reviews$/,
    handler: async (_req, _res, _body, params) => {
      const batchId = params[1];
      const db = await loadDb();
      const batch = db.batches.find(b => b.id === batchId);
      if (!batch) return { error: "batch_not_found" };
      return batch.reviews || [];
    },
    successStatus: 200
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/reviews$/,
    handler: async (req, _res, body, params) => {
      const batchId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
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
        entityId: batchId,
        operator: review.reviewer !== "未知管理员" ? review.reviewer : ctx.operator,
        source: ctx.source,
        expectedVersions: ctx.expectedVersions,
        affectedBatchIds: [batchId],
        details: {},
        mutator: (dbInner) => {
          const b = dbInner.batches.find(x => x.id === batchId);
          if (!b) return { error: "batch_not_found" };
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
      if (result.error) return result;
      return result;
    },
    successStatus: 201
  }
];

export const handleBatchRoutes = createRouteHandler(routes);
