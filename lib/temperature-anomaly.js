import { mutate, OPERATION, clone, loadDb, getDefaultSiteId, filterBatchesBySite } from "./data-store.js";
import { ensureLineageFields } from "./batch-lineage.js";

const DEFAULT_THRESHOLD = -18;
const SEVERITY_THRESHOLDS = {
  warning: -15,
  critical: -10
};

function ensureAnomalyFields(batch) {
  ensureLineageFields(batch);
  if (!batch.anomalies) batch.anomalies = [];
}

function getSeverity(value, threshold) {
  if (value >= SEVERITY_THRESHOLDS.critical) return "critical";
  if (value >= SEVERITY_THRESHOLDS.warning) return "warning";
  return "abnormal";
}

function isTemperatureAnomaly(value, threshold = DEFAULT_THRESHOLD) {
  return value > threshold;
}

function detectAnomaliesInBatch(batch, threshold = DEFAULT_THRESHOLD) {
  ensureAnomalyFields(batch);

  const existingAnomalyTimestamps = new Set(
    batch.anomalies.map(a => a.temperatureAt)
  );

  const newAnomalies = [];

  for (const temp of batch.temperatures || []) {
    if (existingAnomalyTimestamps.has(temp.at)) continue;
    if (!isTemperatureAnomaly(temp.value, threshold)) continue;

    const anomaly = {
      id: `ANOM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      batchId: batch.id,
      temperatureAt: temp.at,
      temperatureValue: temp.value,
      threshold,
      severity: getSeverity(temp.value, threshold),
      status: "pending",
      detectedAt: new Date().toISOString(),
      handledAt: null,
      handler: null,
      handlingResult: null,
      note: null
    };

    batch.anomalies.push(anomaly);
    newAnomalies.push(anomaly);
  }

  return newAnomalies;
}

function detectAnomaliesInBatches(batches, threshold = DEFAULT_THRESHOLD) {
  const allNewAnomalies = [];
  const affectedBatchIds = [];
  for (const batch of batches) {
    const beforeLen = (batch.anomalies || []).length;
    const newAnomalies = detectAnomaliesInBatch(batch, threshold);
    allNewAnomalies.push(...newAnomalies);
    if ((batch.anomalies || []).length > beforeLen) {
      affectedBatchIds.push(batch.id);
    }
  }
  return { allNewAnomalies, affectedBatchIds };
}

export async function scanAndDetectAnomalies(batchId = null, threshold = DEFAULT_THRESHOLD, ctx = {}, siteIdParam = null) {
  const dbForScan = await loadDb();
  const defaultSiteId = getDefaultSiteId(dbForScan);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";
  let affectedBatchIds = [];
  let newAnomalies = [];
  let batchScanSiteId = null;

  if (batchId) {
    const batch = dbForScan.batches.find(b => b.id === batchId);
    if (!batch) return { error: "batch_not_found" };
    const batchSiteId = batch.siteId || defaultSiteId;
    batchScanSiteId = batchSiteId;
    if (siteIdParam && !isGlobal && batchSiteId !== effectiveSiteId) {
      return {
        error: "batch_site_mismatch",
        batchId,
        batchSiteId,
        requestedSiteId: effectiveSiteId,
        siteFilter: {
          siteId: effectiveSiteId,
          applied: "specified",
          note: `批次 ${batchId} 不属于站点 ${effectiveSiteId}`
        }
      };
    }
    affectedBatchIds = [batchId];
    for (const t of batch.temperatures || []) {
      if (isTemperatureAnomaly(t.value, threshold)) {
        const already = (batch.anomalies || []).some(a => a.temperatureAt === t.at);
        if (!already) {
          newAnomalies.push({});
        }
      }
    }
    if (newAnomalies.length === 0) {
      return { detected: 0, anomalies: [], siteFilter: { siteId: batchSiteId, applied: siteIdParam ? "specified" : "batch", note: `批次 ${batchId} 异常扫描` } };
    }
  } else {
    let batches = dbForScan.batches;
    if (!isGlobal) {
      batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
    }
    const result = detectAnomaliesInBatches(batches, threshold);
    newAnomalies = result.allNewAnomalies;
    affectedBatchIds = result.affectedBatchIds;
    if (newAnomalies.length === 0) {
      return {
        detected: 0,
        anomalies: [],
        siteFilter: {
          siteId: isGlobal ? null : effectiveSiteId,
          applied: isGlobal ? "all" : (siteIdParam ? "specified" : "default"),
          note: isGlobal ? "全局异常扫描" : (siteIdParam ? `站点 ${effectiveSiteId} 异常扫描` : `未传 siteId，使用默认站点 ${effectiveSiteId} 异常扫描`)
        }
      };
    }
  }

  return mutate({
    operation: OPERATION.ANOMALY_SCAN,
    entityType: "anomaly",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds,
    details: {},
    mutator: (db) => {
      let anomalies = [];
      if (batchId) {
        const batch = db.batches.find(b => b.id === batchId);
        if (!batch) return { error: "batch_not_found" };
        anomalies = detectAnomaliesInBatch(batch, threshold);
      } else {
        let batches = db.batches;
        if (!isGlobal) {
          batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
        }
        const res = detectAnomaliesInBatches(batches, threshold);
        anomalies = res.allNewAnomalies;
      }

      return {
        details: {
          newAnomalies: anomalies.map(a => clone(a))
        },
        detected: anomalies.length,
        anomalies,
        siteFilter: {
          siteId: batchId ? batchScanSiteId : (isGlobal ? null : effectiveSiteId),
          applied: batchId && !siteIdParam ? "batch" : (isGlobal ? "all" : (siteIdParam ? "specified" : "default")),
          note: batchId
            ? `批次 ${batchId} 异常扫描`
            : isGlobal
              ? "全局异常扫描"
              : (siteIdParam ? `站点 ${effectiveSiteId} 异常扫描` : `未传 siteId，使用默认站点 ${effectiveSiteId} 异常扫描`)
        }
      };
    }
  });
}

export async function listPendingAnomalies(siteIdParam = null) {
  const db = await loadDb();
  const defaultSiteId = getDefaultSiteId(db);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";
  const pending = [];

  let batches = db.batches;
  if (!isGlobal) {
    batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
  }

  for (const batch of batches) {
    ensureAnomalyFields(batch);
    for (const anomaly of batch.anomalies) {
      if (anomaly.status === "pending") {
        pending.push({
          ...anomaly,
          batchSiteId: batch.siteId || defaultSiteId,
          batchSpecies: batch.species,
          batchSection: batch.section
        });
      }
    }
  }

  pending.sort((a, b) => new Date(a.detectedAt) - new Date(b.detectedAt));
  return {
    siteFilter: {
      siteId: isGlobal ? null : effectiveSiteId,
      applied: siteIdParam ? (isGlobal ? "all" : "specified") : "default",
      note: isGlobal
        ? "所有站点未处理异常"
        : siteIdParam
          ? `指定站点 ${effectiveSiteId} 未处理异常`
          : `未传 siteId，使用默认站点 ${effectiveSiteId} 未处理异常`
    },
    total: pending.length,
    anomalies: pending
  };
}

export async function listAnomaliesByBatch(batchId, statusFilter = null) {
  const db = await loadDb();
  const batch = db.batches.find(b => b.id === batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureAnomalyFields(batch);

  let anomalies = [...batch.anomalies];
  if (statusFilter) {
    anomalies = anomalies.filter(a => a.status === statusFilter);
  }

  anomalies.sort((a, b) => new Date(a.temperatureAt) - new Date(b.temperatureAt));

  return {
    batchId: batch.id,
    batchSpecies: batch.species,
    anomalies
  };
}

export async function handleAnomaly(batchId, anomalyId, input, ctx = {}) {
  return mutate({
    operation: OPERATION.ANOMALY_HANDLE,
    entityType: "anomaly",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const batch = db.batches.find(b => b.id === batchId);
      if (!batch) return { error: "batch_not_found" };

      ensureAnomalyFields(batch);

      const anomaly = batch.anomalies.find(a => a.id === anomalyId);
      if (!anomaly) return { error: "anomaly_not_found" };
      if (anomaly.status !== "pending") return { error: "anomaly_already_handled" };

      const validResults = ["resolved", "ignored", "escalated"];
      const handlingResult = validResults.includes(input.handlingResult)
        ? input.handlingResult
        : "resolved";

      anomaly.status = "handled";
      anomaly.handledAt = new Date().toISOString();
      anomaly.handler = input.handler || "未知管理员";
      anomaly.handlingResult = handlingResult;
      anomaly.note = input.note || null;

      return {
        details: {
          anomaly: clone(anomaly)
        },
        batchId: batch.id,
        anomaly
      };
    }
  });
}

export async function getAffectedBatchesCount(siteIdParam = null) {
  const db = await loadDb();
  const defaultSiteId = getDefaultSiteId(db);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";

  let batches = db.batches;
  if (!isGlobal) {
    batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
  }

  const affectedBatchIds = new Set();

  for (const batch of batches) {
    ensureAnomalyFields(batch);
    if (batch.anomalies.length > 0) {
      affectedBatchIds.add(batch.id);
    }
  }

  const pendingAffectedBatchIds = new Set();
  for (const batch of batches) {
    ensureAnomalyFields(batch);
    if (batch.anomalies.some(a => a.status === "pending")) {
      pendingAffectedBatchIds.add(batch.id);
    }
  }

  return {
    totalAffected: affectedBatchIds.size,
    pendingAffected: pendingAffectedBatchIds.size
  };
}

export {
  DEFAULT_THRESHOLD,
  SEVERITY_THRESHOLDS,
  isTemperatureAnomaly,
  getSeverity
};
