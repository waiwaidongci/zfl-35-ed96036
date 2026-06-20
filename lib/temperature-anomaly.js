import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLineageFields } from "./batch-lineage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");

const DEFAULT_THRESHOLD = -18;
const SEVERITY_THRESHOLDS = {
  warning: -15,
  critical: -10
};

async function loadDb() {
  if (!existsSync(dbPath)) return { batches: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

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

function detectAnomaliesInAllBatches(db, threshold = DEFAULT_THRESHOLD) {
  const allNewAnomalies = [];
  for (const batch of db.batches) {
    const newAnomalies = detectAnomaliesInBatch(batch, threshold);
    allNewAnomalies.push(...newAnomalies);
  }
  return allNewAnomalies;
}

export async function scanAndDetectAnomalies(batchId = null, threshold = DEFAULT_THRESHOLD) {
  const db = await loadDb();
  let newAnomalies = [];

  if (batchId) {
    const batch = db.batches.find(b => b.id === batchId);
    if (!batch) return { error: "batch_not_found" };
    newAnomalies = detectAnomaliesInBatch(batch, threshold);
  } else {
    newAnomalies = detectAnomaliesInAllBatches(db, threshold);
  }

  if (newAnomalies.length > 0) {
    await saveDb(db);
  }

  return {
    detected: newAnomalies.length,
    anomalies: newAnomalies
  };
}

export async function listPendingAnomalies() {
  const db = await loadDb();
  const pending = [];

  for (const batch of db.batches) {
    ensureAnomalyFields(batch);
    for (const anomaly of batch.anomalies) {
      if (anomaly.status === "pending") {
        pending.push({
          ...anomaly,
          batchSpecies: batch.species,
          batchSection: batch.section
        });
      }
    }
  }

  pending.sort((a, b) => new Date(a.detectedAt) - new Date(b.detectedAt));
  return pending;
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

export async function handleAnomaly(batchId, anomalyId, input) {
  const db = await loadDb();
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

  await saveDb(db);

  return {
    batchId: batch.id,
    anomaly
  };
}

export async function getAffectedBatchesCount() {
  const db = await loadDb();
  const affectedBatchIds = new Set();

  for (const batch of db.batches) {
    ensureAnomalyFields(batch);
    if (batch.anomalies.length > 0) {
      affectedBatchIds.add(batch.id);
    }
  }

  const pendingAffectedBatchIds = new Set();
  for (const batch of db.batches) {
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
