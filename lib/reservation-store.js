import { mutate, OPERATION, clone, loadDb, getDefaultSiteId, filterBatchesBySite } from "./data-store.js";
import { getAffectedBatchesCount } from "./temperature-anomaly.js";
import { ensureLineageFields, isBatchActive } from "./batch-lineage.js";

function ensureReservationFields(batch) {
  ensureLineageFields(batch);
  if (!batch.reservations) batch.reservations = [];
  if (batch.frozenQuantity === undefined || batch.frozenQuantity === null) batch.frozenQuantity = 0;
}

function findReservation(batch, reservationId) {
  return (batch.reservations || []).find(r => r.id === reservationId) || null;
}

export async function createReservation(batchId, input, ctx = {}) {
  return mutate({
    operation: OPERATION.RESERVATION_CREATE,
    entityType: "reservation",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const batch = db.batches.find(b => b.id === batchId);
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

      return {
        details: {
          reservation: clone(reservation)
        },
        batchId: batch.id,
        reservation
      };
    }
  });
}

export async function listReservations(batchId, statusFilter) {
  const db = await loadDb();
  const batch = db.batches.find(b => b.id === batchId);
  if (!batch) return { error: "batch_not_found" };

  ensureReservationFields(batch);

  let reservations = batch.reservations;
  if (statusFilter) {
    reservations = reservations.filter(r => r.status === statusFilter);
  }
  return { batchId: batch.id, reservations };
}

export async function approveReservation(batchId, reservationId, ctx = {}) {
  return mutate({
    operation: OPERATION.RESERVATION_APPROVE,
    entityType: "reservation",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const batch = db.batches.find(b => b.id === batchId);
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

      return {
        details: {
          reservation: clone(reservation),
          frozenQuantityAfter: batch.frozenQuantity
        },
        batchId: batch.id,
        reservation,
        frozenQuantity: batch.frozenQuantity,
        availableQuantity: batch.quantity - batch.frozenQuantity
      };
    }
  });
}

export async function rejectReservation(batchId, reservationId, ctx = {}) {
  return mutate({
    operation: OPERATION.RESERVATION_REJECT,
    entityType: "reservation",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const batch = db.batches.find(b => b.id === batchId);
      if (!batch) return { error: "batch_not_found" };

      ensureReservationFields(batch);

      const reservation = findReservation(batch, reservationId);
      if (!reservation) return { error: "reservation_not_found" };
      if (reservation.status !== "pending") return { error: "invalid_status_transition" };

      reservation.status = "rejected";
      reservation.updatedAt = new Date().toISOString();

      return {
        details: {
          reservation: clone(reservation),
          frozenQuantityAfter: batch.frozenQuantity
        },
        batchId: batch.id,
        reservation,
        frozenQuantity: batch.frozenQuantity,
        availableQuantity: batch.quantity - batch.frozenQuantity
      };
    }
  });
}

export async function cancelReservation(batchId, reservationId, ctx = {}) {
  return mutate({
    operation: OPERATION.RESERVATION_CANCEL,
    entityType: "reservation",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const batch = db.batches.find(b => b.id === batchId);
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

      return {
        details: {
          reservation: clone(reservation),
          frozenQuantityAfter: batch.frozenQuantity
        },
        batchId: batch.id,
        reservation,
        frozenQuantity: batch.frozenQuantity,
        availableQuantity: batch.quantity - batch.frozenQuantity
      };
    }
  });
}

export async function fulfillReservation(batchId, reservationId, ctx = {}) {
  return mutate({
    operation: OPERATION.RESERVATION_FULFILL,
    entityType: "reservation",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const batch = db.batches.find(b => b.id === batchId);
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

      return {
        details: {
          reservation: clone(reservation),
          transaction: clone(tx),
          frozenQuantityAfter: batch.frozenQuantity,
          quantityAfter: batch.quantity
        },
        batchId: batch.id,
        reservation,
        transaction: tx,
        quantity: batch.quantity,
        frozenQuantity: batch.frozenQuantity,
        availableQuantity: batch.quantity - batch.frozenQuantity
      };
    }
  });
}

export async function getInventoryWithFrozen(siteIdParam = null) {
  const db = await loadDb();
  const defaultSiteId = getDefaultSiteId(db);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";
  const appliedFilter = siteIdParam ? (isGlobal ? "all" : "specified") : "default";

  const allActiveBatches = db.batches.filter(b => {
    ensureReservationFields(b);
    return b.status === "active" || b.status === "split_closed";
  });

  let activeBatches = allActiveBatches;
  if (!isGlobal) {
    activeBatches = filterBatchesBySite(allActiveBatches, effectiveSiteId, defaultSiteId);
  }

  const total = activeBatches.reduce((sum, b) => sum + b.quantity, 0);
  const totalFrozen = activeBatches.reduce((sum, b) => sum + (b.frozenQuantity || 0), 0);
  const bySpecies = {};
  const bySection = {};
  const bySite = {};
  const frozenBySpecies = {};
  const frozenBySection = {};
  const frozenBySite = {};

  for (const b of activeBatches) {
    const frozen = b.frozenQuantity || 0;
    const bid = b.siteId || defaultSiteId;
    bySpecies[b.species] = (bySpecies[b.species] || 0) + b.quantity;
    bySection[b.section] = (bySection[b.section] || 0) + b.quantity;
    bySite[bid] = (bySite[bid] || 0) + b.quantity;
    frozenBySpecies[b.species] = (frozenBySpecies[b.species] || 0) + frozen;
    frozenBySection[b.section] = (frozenBySection[b.section] || 0) + frozen;
    frozenBySite[bid] = (frozenBySite[bid] || 0) + frozen;
  }

  const anomalyStats = isGlobal
    ? await getAffectedBatchesCount()
    : await getAffectedBatchesCount(effectiveSiteId);

  const allMergedClosed = db.batches.filter(b => {
    ensureLineageFields(b);
    return b.status === "merged_closed";
  });
  let mergedClosedCount = allMergedClosed.length;
  if (!isGlobal) {
    mergedClosedCount = allMergedClosed.filter(b => (b.siteId || defaultSiteId) === effectiveSiteId).length;
  }

  const siteDetails = {};
  if (isGlobal) {
    for (const site of db.sites || []) {
      const siteBatches = allActiveBatches.filter(b => (b.siteId || defaultSiteId) === site.id);
      const sTotal = siteBatches.reduce((sum, b) => sum + b.quantity, 0);
      const sFrozen = siteBatches.reduce((sum, b) => sum + (b.frozenQuantity || 0), 0);
      siteDetails[site.id] = {
        id: site.id,
        name: site.name,
        code: site.code,
        totalBatches: siteBatches.length,
        total: sTotal,
        totalFrozen: sFrozen,
        totalAvailable: sTotal - sFrozen
      };
    }
  }

  return {
    siteFilter: {
      siteId: isGlobal ? null : effectiveSiteId,
      applied: appliedFilter,
      note: isGlobal
        ? "全局汇总报告（所有站点）"
        : siteIdParam
          ? `指定站点 ${effectiveSiteId}`
          : `未传 siteId，使用默认站点 ${effectiveSiteId}`
    },
    total,
    totalFrozen,
    totalAvailable: total - totalFrozen,
    bySpecies,
    bySection,
    bySite,
    frozenBySpecies,
    frozenBySection,
    frozenBySite,
    totalBatches: activeBatches.length,
    totalBatchesAll: isGlobal ? db.batches.length : activeBatches.length + mergedClosedCount,
    mergedClosedBatches: mergedClosedCount,
    batchesWithAnomalies: anomalyStats.totalAffected,
    batchesWithPendingAnomalies: anomalyStats.pendingAffected,
    siteDetails: isGlobal ? siteDetails : undefined,
    lowStock: activeBatches.filter(b => (b.quantity - (b.frozenQuantity || 0)) < 200).map(b => ({
      id: b.id,
      siteId: b.siteId || defaultSiteId,
      species: b.species,
      quantity: b.quantity,
      frozenQuantity: b.frozenQuantity || 0,
      availableQuantity: b.quantity - (b.frozenQuantity || 0),
      status: b.status
    }))
  };
}
