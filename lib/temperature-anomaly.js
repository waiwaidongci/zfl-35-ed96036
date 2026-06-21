import { mutate, OPERATION, clone, loadDb, loadLocDb, getDefaultSiteId, filterBatchesBySite } from "./data-store.js";
import { ensureLineageFields } from "./batch-lineage.js";

const DEFAULT_THRESHOLD = -18;
const SEVERITY_THRESHOLDS = {
  warning: -15,
  critical: -10
};

const THRESHOLD_SOURCE = {
  DEFAULT: "default",
  SITE: "site",
  SECTION: "section",
  MANUAL: "manual"
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

async function getEffectiveThresholdForBatch(batch, db, locDb, manualThreshold = undefined) {
  if (manualThreshold !== undefined && manualThreshold !== null) {
    return {
      threshold: Number(manualThreshold),
      source: THRESHOLD_SOURCE.MANUAL,
      sourceId: null,
      sourceName: "手动指定"
    };
  }

  const defaultSiteId = getDefaultSiteId(db);
  const batchSiteId = batch.siteId || defaultSiteId;

  if (batch.section) {
    const section = (locDb.sections || []).find(s =>
      s.id === batch.section && (s.siteId || defaultSiteId) === batchSiteId
    );
    if (section && section.temperatureThreshold !== undefined && section.temperatureThreshold !== null) {
      return {
        threshold: Number(section.temperatureThreshold),
        source: THRESHOLD_SOURCE.SECTION,
        sourceId: section.id,
        sourceName: section.name || section.id
      };
    }
  }

  const site = (db.sites || []).find(s => s.id === batchSiteId);
  if (site && site.temperatureThreshold !== undefined && site.temperatureThreshold !== null) {
    return {
      threshold: Number(site.temperatureThreshold),
      source: THRESHOLD_SOURCE.SITE,
      sourceId: site.id,
      sourceName: site.name || site.id
    };
  }

  return {
    threshold: DEFAULT_THRESHOLD,
    source: THRESHOLD_SOURCE.DEFAULT,
    sourceId: null,
    sourceName: "系统默认"
  };
}

function detectAnomaliesInBatch(batch, thresholdInfo) {
  ensureAnomalyFields(batch);

  const existingAnomalyTimestamps = new Set(
    batch.anomalies.map(a => a.temperatureAt)
  );

  const newAnomalies = [];
  const { threshold, source, sourceId, sourceName } = thresholdInfo;

  for (const temp of batch.temperatures || []) {
    if (existingAnomalyTimestamps.has(temp.at)) continue;
    if (!isTemperatureAnomaly(temp.value, threshold)) continue;

    const anomaly = {
      id: `ANOM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      batchId: batch.id,
      temperatureAt: temp.at,
      temperatureValue: temp.value,
      threshold,
      thresholdSource: source,
      thresholdSourceId: sourceId,
      thresholdSourceName: sourceName,
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

async function detectAnomaliesInBatches(batches, db, locDb, manualThreshold = undefined) {
  const allNewAnomalies = [];
  const affectedBatchIds = [];
  for (const batch of batches) {
    const beforeLen = (batch.anomalies || []).length;
    const thresholdInfo = await getEffectiveThresholdForBatch(batch, db, locDb, manualThreshold);
    const newAnomalies = detectAnomaliesInBatch(batch, thresholdInfo);
    allNewAnomalies.push(...newAnomalies);
    if ((batch.anomalies || []).length > beforeLen) {
      affectedBatchIds.push(batch.id);
    }
  }
  return { allNewAnomalies, affectedBatchIds };
}

export async function scanAndDetectAnomalies(batchId = null, threshold = undefined, ctx = {}, siteIdParam = null) {
  const dbForScan = await loadDb();
  const locDbForScan = await loadLocDb();
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
    const thresholdInfo = await getEffectiveThresholdForBatch(batch, dbForScan, locDbForScan, threshold);
    for (const t of batch.temperatures || []) {
      if (isTemperatureAnomaly(t.value, thresholdInfo.threshold)) {
        const already = (batch.anomalies || []).some(a => a.temperatureAt === t.at);
        if (!already) {
          newAnomalies.push({});
        }
      }
    }
    if (newAnomalies.length === 0) {
      return {
        detected: 0,
        anomalies: [],
        thresholdUsed: thresholdInfo,
        siteFilter: { siteId: batchSiteId, applied: siteIdParam ? "specified" : "batch", note: `批次 ${batchId} 异常扫描` }
      };
    }
  } else {
    let batches = dbForScan.batches;
    if (!isGlobal) {
      batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
    }
    const result = await detectAnomaliesInBatches(batches, dbForScan, locDbForScan, threshold);
    newAnomalies = result.allNewAnomalies;
    affectedBatchIds = result.affectedBatchIds;
    if (newAnomalies.length === 0) {
      return {
        detected: 0,
        anomalies: [],
        thresholdUsed: threshold !== undefined
          ? { threshold, source: THRESHOLD_SOURCE.MANUAL, sourceId: null, sourceName: "手动指定" }
          : null,
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
    mutator: async (db) => {
      const locDb = await loadLocDb();
      let anomalies = [];
      let thresholdUsed = null;
      if (batchId) {
        const batch = db.batches.find(b => b.id === batchId);
        if (!batch) return { error: "batch_not_found" };
        const thresholdInfo = await getEffectiveThresholdForBatch(batch, db, locDb, threshold);
        thresholdUsed = thresholdInfo;
        anomalies = detectAnomaliesInBatch(batch, thresholdInfo);
      } else {
        let batches = db.batches;
        if (!isGlobal) {
          batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
        }
        if (threshold !== undefined) {
          thresholdUsed = { threshold, source: THRESHOLD_SOURCE.MANUAL, sourceId: null, sourceName: "手动指定" };
        }
        const res = await detectAnomaliesInBatches(batches, db, locDb, threshold);
        anomalies = res.allNewAnomalies;
      }

      return {
        details: {
          newAnomalies: anomalies.map(a => clone(a))
        },
        detected: anomalies.length,
        anomalies,
        thresholdUsed,
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
  const thresholdSourceDistribution = {};

  let batches = db.batches;
  if (!isGlobal) {
    batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
  }

  for (const batch of batches) {
    ensureAnomalyFields(batch);
    for (const anomaly of batch.anomalies) {
      if (anomaly.status === "pending") {
        const source = anomaly.thresholdSource || THRESHOLD_SOURCE.DEFAULT;
        thresholdSourceDistribution[source] = (thresholdSourceDistribution[source] || 0) + 1;
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
    thresholdSourceDistribution,
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

  const thresholdSourceDistribution = {};
  for (const a of anomalies) {
    const source = a.thresholdSource || THRESHOLD_SOURCE.DEFAULT;
    thresholdSourceDistribution[source] = (thresholdSourceDistribution[source] || 0) + 1;
  }

  return {
    batchId: batch.id,
    batchSpecies: batch.species,
    thresholdSourceDistribution,
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
  const anomalyThresholdSourceDistribution = {};
  const totalAnomalies = { all: 0, pending: 0, handled: 0 };

  for (const batch of batches) {
    ensureAnomalyFields(batch);
    if (batch.anomalies.length > 0) {
      affectedBatchIds.add(batch.id);
    }
    for (const anomaly of batch.anomalies) {
      totalAnomalies.all++;
      if (anomaly.status === "pending") {
        totalAnomalies.pending++;
      } else if (anomaly.status === "handled") {
        totalAnomalies.handled++;
      }
      const source = anomaly.thresholdSource || THRESHOLD_SOURCE.DEFAULT;
      anomalyThresholdSourceDistribution[source] = (anomalyThresholdSourceDistribution[source] || 0) + 1;
    }
  }

  const pendingAffectedBatchIds = new Set();
  const pendingThresholdSourceDistribution = {};
  for (const batch of batches) {
    ensureAnomalyFields(batch);
    const pendingAnomalies = batch.anomalies.filter(a => a.status === "pending");
    if (pendingAnomalies.length > 0) {
      pendingAffectedBatchIds.add(batch.id);
    }
    for (const anomaly of pendingAnomalies) {
      const source = anomaly.thresholdSource || THRESHOLD_SOURCE.DEFAULT;
      pendingThresholdSourceDistribution[source] = (pendingThresholdSourceDistribution[source] || 0) + 1;
    }
  }

  return {
    totalAffected: affectedBatchIds.size,
    pendingAffected: pendingAffectedBatchIds.size,
    totalAnomalies,
    anomalyThresholdSourceDistribution,
    pendingThresholdSourceDistribution
  };
}

export {
  DEFAULT_THRESHOLD,
  SEVERITY_THRESHOLDS,
  THRESHOLD_SOURCE,
  isTemperatureAnomaly,
  getSeverity,
  getEffectiveThresholdForBatch
};
