import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAffectedBatchesCount } from "./temperature-anomaly.js";
import { ensureLineageFields, isBatchActive } from "./batch-lineage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");

async function loadDb() {
  if (!existsSync(dbPath)) return { batches: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function findBatch(db, batchId) {
  return db.batches.find(b => b.id === batchId) || null;
}

function ensureReservationFields(batch) {
  ensureLineageFields(batch);
  if (!batch.reservations) batch.reservations = [];
  if (batch.frozenQuantity === undefined || batch.frozenQuantity === null) batch.frozenQuantity = 0;
}

function findReservation(batch, reservationId) {
  return (batch.reservations || []).find(r => r.id === reservationId) || null;
}

export async function createReservation(batchId, input) {
  const db = await loadDb();
  const batch = findBatch(db, batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  const qty = Number(input.quantity || 0);
  if (qty <= 0) return { error: "invalid_quantity" };

  const reservation = {
    id: `RES-${Date.now()}`,
    applicant: input.applicant || "",
    purpose: input.purpose || "",
    quantity: qty,
    plannedDate: input.plannedDate || "",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  batch.reservations.push(reservation);
  await saveDb(db);
  return { batchId: batch.id, reservation };
}

export async function listReservations(batchId, statusFilter) {
  const db = await loadDb();
  const batch = findBatch(db, batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  let reservations = batch.reservations;
  if (statusFilter) {
    reservations = reservations.filter(r => r.status === statusFilter);
  }
  return { batchId: batch.id, reservations };
}

export async function approveReservation(batchId, reservationId) {
  const db = await loadDb();
  const batch = findBatch(db, batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  const reservation = findReservation(batch, reservationId);
  if (!reservation) return { error: "reservation_not_found" };
  if (reservation.status !== "pending") return { error: "invalid_status_transition" };

  const available = batch.quantity - batch.frozenQuantity;
  if (reservation.quantity > available) return { error: "insufficient_available_quantity", available, requested: reservation.quantity };

  reservation.status = "approved";
  reservation.updatedAt = new Date().toISOString();
  batch.frozenQuantity += reservation.quantity;

  await saveDb(db);
  return { batchId: batch.id, reservation, frozenQuantity: batch.frozenQuantity, availableQuantity: batch.quantity - batch.frozenQuantity };
}

export async function rejectReservation(batchId, reservationId) {
  const db = await loadDb();
  const batch = findBatch(db, batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  const reservation = findReservation(batch, reservationId);
  if (!reservation) return { error: "reservation_not_found" };
  if (reservation.status !== "pending") return { error: "invalid_status_transition" };

  reservation.status = "rejected";
  reservation.updatedAt = new Date().toISOString();

  await saveDb(db);
  return { batchId: batch.id, reservation, frozenQuantity: batch.frozenQuantity, availableQuantity: batch.quantity - batch.frozenQuantity };
}

export async function cancelReservation(batchId, reservationId) {
  const db = await loadDb();
  const batch = findBatch(db, batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  const reservation = findReservation(batch, reservationId);
  if (!reservation) return { error: "reservation_not_found" };
  if (reservation.status !== "pending" && reservation.status !== "approved") return { error: "invalid_status_transition" };

  if (reservation.status === "approved") {
    batch.frozenQuantity -= reservation.quantity;
    if (batch.frozenQuantity < 0) batch.frozenQuantity = 0;
  }

  reservation.status = "cancelled";
  reservation.updatedAt = new Date().toISOString();

  await saveDb(db);
  return { batchId: batch.id, reservation, frozenQuantity: batch.frozenQuantity, availableQuantity: batch.quantity - batch.frozenQuantity };
}

export async function fulfillReservation(batchId, reservationId) {
  const db = await loadDb();
  const batch = findBatch(db, batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  const reservation = findReservation(batch, reservationId);
  if (!reservation) return { error: "reservation_not_found" };
  if (reservation.status !== "approved") return { error: "invalid_status_transition" };

  batch.frozenQuantity -= reservation.quantity;
  if (batch.frozenQuantity < 0) batch.frozenQuantity = 0;

  const next = batch.quantity - reservation.quantity;
  if (next < 0) return { error: "negative_inventory_blocked" };

  batch.quantity = next;
  const tx = {
    id: `TX-${Date.now()}`,
    at: new Date().toISOString(),
    type: "sample",
    quantity: reservation.quantity,
    balance: batch.quantity,
    note: `取样预约 ${reservation.id} 转实际取样，申请人：${reservation.applicant}，用途：${reservation.purpose}`
  };
  batch.transactions.push(tx);

  reservation.status = "fulfilled";
  reservation.fulfilledAt = new Date().toISOString();
  reservation.updatedAt = new Date().toISOString();

  await saveDb(db);
  return { batchId: batch.id, reservation, transaction: tx, quantity: batch.quantity, frozenQuantity: batch.frozenQuantity, availableQuantity: batch.quantity - batch.frozenQuantity };
}

export async function getInventoryWithFrozen() {
  const db = await loadDb();
  const activeBatches = db.batches.filter(b => {
    ensureReservationFields(b);
    return b.status === "active" || b.status === "split_closed";
  });
  const total = activeBatches.reduce((sum, b) => sum + b.quantity, 0);
  const totalFrozen = activeBatches.reduce((sum, b) => sum + (b.frozenQuantity || 0), 0);
  const bySpecies = {};
  const bySection = {};
  const frozenBySpecies = {};
  const frozenBySection = {};

  for (const b of activeBatches) {
    const frozen = b.frozenQuantity || 0;
    bySpecies[b.species] = (bySpecies[b.species] || 0) + b.quantity;
    bySection[b.section] = (bySection[b.section] || 0) + b.quantity;
    frozenBySpecies[b.species] = (frozenBySpecies[b.species] || 0) + frozen;
    frozenBySection[b.section] = (frozenBySection[b.section] || 0) + frozen;
  }

  const anomalyStats = await getAffectedBatchesCount();

  const mergedClosedCount = db.batches.filter(b => {
    ensureLineageFields(b);
    return b.status === "merged_closed";
  }).length;

  return {
    total,
    totalFrozen,
    totalAvailable: total - totalFrozen,
    bySpecies,
    bySection,
    frozenBySpecies,
    frozenBySection,
    totalBatches: activeBatches.length,
    totalBatchesAll: db.batches.length,
    mergedClosedBatches: mergedClosedCount,
    batchesWithAnomalies: anomalyStats.totalAffected,
    batchesWithPendingAnomalies: anomalyStats.pendingAffected,
    lowStock: activeBatches.filter(b => (b.quantity - (b.frozenQuantity || 0)) < 200).map(b => ({
      id: b.id,
      species: b.species,
      quantity: b.quantity,
      frozenQuantity: b.frozenQuantity || 0,
      availableQuantity: b.quantity - (b.frozenQuantity || 0),
      status: b.status
    }))
  };
}
