import { mutate, OPERATION, clone, loadDb, getDefaultSiteId, isSiteDisabled, filterBatchesBySite } from "./data-store.js";
import { ensureLineageFields } from "./batch-lineage.js";

function ensureTransferBatchFields(batch) {
  ensureLineageFields(batch);
  if (batch.inTransitQuantity === undefined || batch.inTransitQuantity === null) {
    batch.inTransitQuantity = 0;
  }
  if (!batch.lineage.transferredFrom) batch.lineage.transferredFrom = null;
  if (!batch.lineage.transferredTo) batch.lineage.transferredTo = [];
}

function ensureTransfersCollection(db) {
  if (!db.transfers) db.transfers = [];
}

function findTransfer(db, transferId) {
  ensureTransfersCollection(db);
  return db.transfers.find(t => t.id === transferId) || null;
}

function createTransaction(type, quantity, balance, note) {
  return {
    id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    type,
    quantity,
    balance,
    note
  };
}

function validateMergeConstraints(sourceBatch, targetBatch) {
  if (
    sourceBatch.species !== targetBatch.species ||
    sourceBatch.collectionPlace !== targetBatch.collectionPlace ||
    sourceBatch.motherPlant !== targetBatch.motherPlant
  ) {
    return {
      error: "transfer_merge_mismatch",
      message: "跨站点调拨合并必须同物种、同采集地、同母株",
      fields: {
        species: targetBatch.species,
        collectionPlace: targetBatch.collectionPlace,
        motherPlant: targetBatch.motherPlant
      },
      sourceBatch: {
        species: sourceBatch.species,
        collectionPlace: sourceBatch.collectionPlace,
        motherPlant: sourceBatch.motherPlant
      }
    };
  }
  return null;
}

export async function createTransfer(input, ctx = {}) {
  return mutate({
    operation: OPERATION.TRANSFER_CREATE,
    entityType: "transfer",
    entityId: null,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      ensureTransfersCollection(db);

      const defaultSiteId = getDefaultSiteId(db);
      const sourceSiteId = input.sourceSiteId || defaultSiteId;
      const targetSiteId = input.targetSiteId;

      if (!targetSiteId) {
        return { error: "missing_target_site", message: "必须指定目标站点" };
      }
      if (sourceSiteId === targetSiteId) {
        return { error: "same_site_transfer", message: "源站点和目标站点不能相同" };
      }

      const sourceSite = (db.sites || []).find(s => s.id === sourceSiteId);
      const targetSite = (db.sites || []).find(s => s.id === targetSiteId);
      if (!sourceSite) return { error: "source_site_not_found", siteId: sourceSiteId };
      if (!targetSite) return { error: "target_site_not_found", siteId: targetSiteId };
      if (isSiteDisabled(sourceSite)) return { error: "source_site_disabled", siteId: sourceSiteId };
      if (isSiteDisabled(targetSite)) return { error: "target_site_disabled", siteId: targetSiteId };

      const sourceBatch = db.batches.find(b => b.id === input.sourceBatchId);
      if (!sourceBatch) return { error: "batch_not_found", id: input.sourceBatchId };

      ensureTransferBatchFields(sourceBatch);

      if (sourceBatch.status !== "active") {
        return { error: "batch_not_active", id: sourceBatch.id, status: sourceBatch.status };
      }

      const batchSiteId = sourceBatch.siteId || defaultSiteId;
      if (batchSiteId !== sourceSiteId) {
        return {
          error: "batch_site_mismatch",
          message: "源批次不属于源站点",
          batchSiteId,
          sourceSiteId
        };
      }

      const qty = Number(input.quantity || 0);
      if (qty <= 0 || !Number.isInteger(qty)) {
        return { error: "invalid_quantity", message: "调拨数量必须为正整数" };
      }

      const availableQty = sourceBatch.quantity - (sourceBatch.frozenQuantity || 0) - (sourceBatch.inTransitQuantity || 0);
      if (qty > availableQty) {
        return {
          error: "insufficient_available_quantity",
          available: availableQty,
          requested: qty,
          total: sourceBatch.quantity,
          frozen: sourceBatch.frozenQuantity || 0,
          inTransit: sourceBatch.inTransitQuantity || 0
        };
      }

      const targetMode = input.targetMode || "new";
      if (targetMode !== "new" && targetMode !== "merge") {
        return { error: "invalid_target_mode", message: "targetMode 必须是 new 或 merge" };
      }

      if (targetMode === "merge") {
        if (!input.mergeTargetBatchId) {
          return { error: "missing_merge_target", message: "合并模式必须指定 mergeTargetBatchId" };
        }
        const mergeTarget = db.batches.find(b => b.id === input.mergeTargetBatchId);
        if (!mergeTarget) {
          return { error: "merge_target_not_found", id: input.mergeTargetBatchId };
        }
        ensureTransferBatchFields(mergeTarget);
        if (mergeTarget.status !== "active") {
          return { error: "merge_target_not_active", id: mergeTarget.id, status: mergeTarget.status };
        }
        const mergeTargetSiteId = mergeTarget.siteId || defaultSiteId;
        if (mergeTargetSiteId !== targetSiteId) {
          return {
            error: "merge_target_site_mismatch",
            message: "合并目标批次不属于目标站点",
            mergeTargetSiteId,
            targetSiteId
          };
        }
        const mergeError = validateMergeConstraints(sourceBatch, mergeTarget);
        if (mergeError) return mergeError;
      }

      if (targetMode === "new") {
        if (!input.targetContainer || !input.targetSection) {
          return { error: "missing_container_or_section", message: "新建模式必须指定 targetContainer 和 targetSection" };
        }
      }

      const transferId = input.id || `TRF-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;

      if (db.transfers.some(t => t.id === transferId)) {
        return { error: "transfer_id_conflict", id: transferId };
      }

      const transfer = {
        id: transferId,
        sourceSiteId,
        targetSiteId,
        sourceBatchId: sourceBatch.id,
        quantity: qty,
        status: "created",
        targetMode,
        targetBatchId: null,
        mergeTargetBatchId: targetMode === "merge" ? input.mergeTargetBatchId : null,
        targetContainer: targetMode === "new" ? input.targetContainer : null,
        targetSection: targetMode === "new" ? input.targetSection : null,
        targetBoxId: input.targetBoxId || null,
        targetSlotIndex: input.targetSlotIndex !== undefined && input.targetSlotIndex !== null ? Number(input.targetSlotIndex) : null,
        remark: input.remark || "",
        createdAt: new Date().toISOString(),
        shippedAt: null,
        receivedAt: null,
        cancelledAt: null,
        createdBy: ctx.operator || null,
        shippedBy: null,
        receivedBy: null,
        cancelledBy: null
      };

      db.transfers.push(transfer);

      return {
        entityIdOverride: transferId,
        details: {
          transfer: clone(transfer)
        },
        transfer
      };
    }
  });
}

export async function shipTransfer(transferId, ctx = {}) {
  return mutate({
    operation: OPERATION.TRANSFER_SHIP,
    entityType: "transfer",
    entityId: transferId,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      ensureTransfersCollection(db);

      const transfer = findTransfer(db, transferId);
      if (!transfer) return { error: "transfer_not_found", id: transferId };

      if (transfer.status !== "created") {
        return { error: "invalid_status_transition", currentStatus: transfer.status, expected: "created" };
      }

      const sourceBatch = db.batches.find(b => b.id === transfer.sourceBatchId);
      if (!sourceBatch) return { error: "batch_not_found", id: transfer.sourceBatchId };

      ensureTransferBatchFields(sourceBatch);

      if (sourceBatch.status !== "active") {
        return { error: "batch_not_active", id: sourceBatch.id, status: sourceBatch.status };
      }

      const availableQty = sourceBatch.quantity - (sourceBatch.frozenQuantity || 0) - (sourceBatch.inTransitQuantity || 0);
      if (transfer.quantity > availableQty) {
        return {
          error: "insufficient_available_quantity",
          available: availableQty,
          requested: transfer.quantity
        };
      }

      sourceBatch.inTransitQuantity += transfer.quantity;

      transfer.status = "shipped";
      transfer.shippedAt = new Date().toISOString();
      transfer.shippedBy = ctx.operator || null;

      return {
        additionalAffectedBatchIds: [sourceBatch.id],
        details: {
          transfer: clone(transfer),
          sourceBatch: {
            id: sourceBatch.id,
            inTransitQuantityAfter: sourceBatch.inTransitQuantity,
            availableQuantityAfter: sourceBatch.quantity - (sourceBatch.frozenQuantity || 0) - sourceBatch.inTransitQuantity
          }
        },
        transfer,
        sourceBatch: {
          id: sourceBatch.id,
          inTransitQuantity: sourceBatch.inTransitQuantity,
          availableQuantity: sourceBatch.quantity - (sourceBatch.frozenQuantity || 0) - sourceBatch.inTransitQuantity
        }
      };
    }
  });
}

export async function receiveTransfer(transferId, input = {}, ctx = {}) {
  return mutate({
    operation: OPERATION.TRANSFER_RECEIVE,
    entityType: "transfer",
    entityId: transferId,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      ensureTransfersCollection(db);

      const transfer = findTransfer(db, transferId);
      if (!transfer) return { error: "transfer_not_found", id: transferId };

      if (transfer.status !== "shipped") {
        return { error: "invalid_status_transition", currentStatus: transfer.status, expected: "shipped" };
      }

      const sourceBatch = db.batches.find(b => b.id === transfer.sourceBatchId);
      if (!sourceBatch) return { error: "batch_not_found", id: transfer.sourceBatchId };

      ensureTransferBatchFields(sourceBatch);

      if (sourceBatch.inTransitQuantity < transfer.quantity) {
        return {
          error: "inconsistent_in_transit_quantity",
          inTransit: sourceBatch.inTransitQuantity,
          transferQuantity: transfer.quantity
        };
      }

      const defaultSiteId = getDefaultSiteId(db);
      let slotAssignment = null;

      if (transfer.targetMode === "new") {
        const targetContainer = input.targetContainer || transfer.targetContainer;
        const targetSection = input.targetSection || transfer.targetSection;
        const targetBoxId = input.targetBoxId !== undefined ? input.targetBoxId : transfer.targetBoxId;
        const targetSlotIndex = input.targetSlotIndex !== undefined ? Number(input.targetSlotIndex) : transfer.targetSlotIndex;
        const targetBatchId = input.targetBatchId || `${sourceBatch.id}-T-${Date.now().toString().slice(-4)}`;

        if (!targetContainer || !targetSection) {
          return { error: "missing_container_or_section", message: "必须指定目标 container 和 section" };
        }

        if (db.batches.some(b => b.id === targetBatchId)) {
          return { error: "batch_id_conflict", id: targetBatchId };
        }

        const hasBoxId = targetBoxId !== undefined && targetBoxId !== null && targetBoxId !== "";
        const hasSlotIndex = targetSlotIndex !== undefined && targetSlotIndex !== null && !isNaN(targetSlotIndex);
        if (hasBoxId && hasSlotIndex) {
          slotAssignment = {
            boxId: targetBoxId,
            slotIndex: Number(targetSlotIndex),
            container: targetContainer,
            section: targetSection,
            expectedSiteId: transfer.targetSiteId,
            batchId: targetBatchId
          };
        } else if (hasBoxId !== hasSlotIndex) {
          return {
            error: "incomplete_slot_params",
            message: "目标批次：boxId 和 slotIndex 必须同时传入或同时不传",
            hint: "如需指定目标库位，请同时传入 boxId 和 slotIndex"
          };
        }

        const targetBatch = {
          id: targetBatchId,
          siteId: transfer.targetSiteId,
          species: sourceBatch.species,
          collectionPlace: sourceBatch.collectionPlace,
          motherPlant: sourceBatch.motherPlant,
          container: targetContainer,
          section: targetSection,
          viability: sourceBatch.viability,
          quantity: transfer.quantity,
          status: "active",
          lineage: {
            splitFrom: null,
            splitTo: [],
            mergedFrom: [],
            mergedInto: null,
            transferredFrom: sourceBatch.id,
            transferredTo: []
          },
          temperatures: [],
          transactions: [],
          germinations: [],
          frozenQuantity: 0,
          inTransitQuantity: 0,
          reservations: [],
          remark: input.remark || `从站点 ${transfer.sourceSiteId} 批次 ${sourceBatch.id} 调拨入库`,
          reviews: [],
          anomalies: []
        };

        const targetTx = createTransaction(
          "transfer_in",
          transfer.quantity,
          transfer.quantity,
          `从站点 ${transfer.sourceSiteId} 批次 ${sourceBatch.id} 调拨入库，数量 ${transfer.quantity} 粒，调拨单 ${transfer.id}`
        );
        targetBatch.transactions.push(targetTx);

        db.batches.push(targetBatch);

        sourceBatch.inTransitQuantity -= transfer.quantity;
        if (sourceBatch.inTransitQuantity < 0) sourceBatch.inTransitQuantity = 0;
        const sourceQtyBefore = sourceBatch.quantity;
        sourceBatch.quantity -= transfer.quantity;
        if (sourceBatch.quantity < 0) sourceBatch.quantity = 0;

        const sourceTx = createTransaction(
          "transfer_out",
          transfer.quantity,
          sourceBatch.quantity,
          `调拨到站点 ${transfer.targetSiteId} 批次 ${targetBatchId}，数量 ${transfer.quantity} 粒，调拨单 ${transfer.id}`
        );
        sourceBatch.transactions.push(sourceTx);

        if (sourceBatch.quantity === 0 && sourceBatch.status === "active") {
          sourceBatch.status = "split_closed";
        }

        if (!sourceBatch.lineage.transferredTo) sourceBatch.lineage.transferredTo = [];
        sourceBatch.lineage.transferredTo.push(targetBatchId);

        transfer.status = "received";
        transfer.receivedAt = new Date().toISOString();
        transfer.receivedBy = ctx.operator || null;
        transfer.targetBatchId = targetBatchId;

        return {
          createdBatchIds: [targetBatchId],
          additionalAffectedBatchIds: [sourceBatch.id, targetBatchId],
          slotAssignment,
          details: {
            transfer: clone(transfer),
            sourceBatch: {
              id: sourceBatch.id,
              quantityAfter: sourceBatch.quantity,
              inTransitQuantityAfter: sourceBatch.inTransitQuantity,
              statusAfter: sourceBatch.status,
              transaction: clone(sourceTx)
            },
            targetBatch: clone(targetBatch)
          },
          transfer,
          sourceBatch: {
            id: sourceBatch.id,
            quantity: sourceBatch.quantity,
            inTransitQuantity: sourceBatch.inTransitQuantity,
            status: sourceBatch.status,
            transaction: sourceTx
          },
          targetBatch: {
            id: targetBatchId,
            quantity: transfer.quantity,
            container: targetContainer,
            section: targetSection,
            transaction: targetTx
          }
        };
      } else {
        const mergeTargetId = transfer.mergeTargetBatchId;
        const targetBatch = db.batches.find(b => b.id === mergeTargetId);
        if (!targetBatch) {
          return { error: "merge_target_not_found", id: mergeTargetId };
        }
        ensureTransferBatchFields(targetBatch);

        if (targetBatch.status !== "active") {
          return { error: "merge_target_not_active", id: targetBatch.id, status: targetBatch.status };
        }

        const targetSiteId = targetBatch.siteId || defaultSiteId;
        if (targetSiteId !== transfer.targetSiteId) {
          return {
            error: "merge_target_site_mismatch",
            message: "合并目标批次不属于目标站点",
            targetSiteId,
            expectedSiteId: transfer.targetSiteId
          };
        }

        const mergeError = validateMergeConstraints(sourceBatch, targetBatch);
        if (mergeError) return mergeError;

        sourceBatch.inTransitQuantity -= transfer.quantity;
        if (sourceBatch.inTransitQuantity < 0) sourceBatch.inTransitQuantity = 0;
        sourceBatch.quantity -= transfer.quantity;
        if (sourceBatch.quantity < 0) sourceBatch.quantity = 0;

        const sourceTx = createTransaction(
          "transfer_out",
          transfer.quantity,
          sourceBatch.quantity,
          `调拨到站点 ${transfer.targetSiteId} 批次 ${mergeTargetId}（合并），数量 ${transfer.quantity} 粒，调拨单 ${transfer.id}`
        );
        sourceBatch.transactions.push(sourceTx);

        if (sourceBatch.quantity === 0 && sourceBatch.status === "active") {
          sourceBatch.status = "split_closed";
        }

        if (!sourceBatch.lineage.transferredTo) sourceBatch.lineage.transferredTo = [];
        if (!sourceBatch.lineage.transferredTo.includes(mergeTargetId)) {
          sourceBatch.lineage.transferredTo.push(mergeTargetId);
        }

        const targetQtyBefore = targetBatch.quantity;
        targetBatch.quantity += transfer.quantity;

        const targetTx = createTransaction(
          "transfer_in",
          transfer.quantity,
          targetBatch.quantity,
          `从站点 ${transfer.sourceSiteId} 批次 ${sourceBatch.id} 调拨合并入库，数量 ${transfer.quantity} 粒，调拨单 ${transfer.id}`
        );
        targetBatch.transactions.push(targetTx);

        if (!targetBatch.lineage.mergedFrom) targetBatch.lineage.mergedFrom = [];
        if (!targetBatch.lineage.mergedFrom.includes(sourceBatch.id)) {
          targetBatch.lineage.mergedFrom.push(sourceBatch.id);
        }
        if (!targetBatch.lineage.transferredFrom) {
          targetBatch.lineage.transferredFrom = null;
        }

        transfer.status = "received";
        transfer.receivedAt = new Date().toISOString();
        transfer.receivedBy = ctx.operator || null;
        transfer.targetBatchId = mergeTargetId;

        return {
          additionalAffectedBatchIds: [sourceBatch.id, targetBatch.id],
          details: {
            transfer: clone(transfer),
            sourceBatch: {
              id: sourceBatch.id,
              quantityAfter: sourceBatch.quantity,
              inTransitQuantityAfter: sourceBatch.inTransitQuantity,
              statusAfter: sourceBatch.status,
              transaction: clone(sourceTx)
            },
            targetBatch: {
              id: targetBatch.id,
              quantityAfter: targetBatch.quantity,
              transaction: clone(targetTx)
            },
            mergeMode: true
          },
          transfer,
          sourceBatch: {
            id: sourceBatch.id,
            quantity: sourceBatch.quantity,
            inTransitQuantity: sourceBatch.inTransitQuantity,
            status: sourceBatch.status,
            transaction: sourceTx
          },
          targetBatch: {
            id: targetBatch.id,
            quantity: targetBatch.quantity,
            transaction: targetTx
          }
        };
      }
    },
    locMutator: (locDb, mutatorResult, db) => {
      if (!mutatorResult || !mutatorResult.slotAssignment) {
        return null;
      }

      const sa = mutatorResult.slotAssignment;
      const defaultSiteId = getDefaultSiteId(db);
      const sites = db.sites || [];

      function findBoxLoc(boxId) {
        for (const sec of locDb.sections) {
          const box = sec.boxes.find(b => b.id === boxId);
          if (box) return { section: sec, box };
        }
        return null;
      }

      const found = findBoxLoc(sa.boxId);
      if (!found) {
        return {
          error: "box_not_found",
          message: `目标批次指定的 boxId ${sa.boxId} 不存在`,
          boxId: sa.boxId
        };
      }
      const { section, box } = found;
      const sectionSiteId = section.siteId || defaultSiteId;

      if (sectionSiteId !== sa.expectedSiteId) {
        const batchSite = sites.find(s => s.id === sa.expectedSiteId);
        const locationSite = sites.find(s => s.id === sectionSiteId);
        return {
          error: "site_mismatch",
          message: "目标批次的库位站点与目标站点不一致",
          batchSiteId: sa.expectedSiteId,
          batchSiteName: batchSite ? batchSite.name : sa.expectedSiteId,
          locationSiteId: sectionSiteId,
          locationSiteName: locationSite ? locationSite.name : sectionSiteId,
          boxId: sa.boxId,
          sectionId: section.id
        };
      }

      const targetSite = sites.find(s => s.id === sectionSiteId);
      if (isSiteDisabled(targetSite)) {
        return {
          error: "site_disabled",
          message: "目标站点已停用，无法分配库位",
          siteId: sectionSiteId,
          siteName: targetSite ? targetSite.name : sectionSiteId
        };
      }

      if (sa.section !== section.id) {
        return {
          error: "section_box_mismatch",
          message: `目标批次指定的 box ${sa.boxId} 不属于 section ${sa.section}，实际属于 ${section.id}`,
          specifiedSection: sa.section,
          actualSection: section.id,
          boxId: sa.boxId
        };
      }

      const idx = Number(sa.slotIndex);
      if (idx < 1 || idx > box.slotCapacity) {
        return {
          error: "slot_index_out_of_range",
          message: `目标批次的 slotIndex ${idx} 超出范围 (1-${box.slotCapacity})`,
          boxId: sa.boxId,
          slotIndex: idx,
          slotCapacity: box.slotCapacity
        };
      }

      let slot = box.slots.find(s => s.index === idx);
      if (slot && slot.batchId) {
        return {
          error: "slot_already_occupied",
          message: `目标批次的格位 ${sa.boxId}:${idx} 已被批次 ${slot.batchId} 占用`,
          boxId: sa.boxId,
          slotIndex: idx,
          occupiedBy: slot.batchId
        };
      }

      if (!slot) {
        slot = { index: idx, batchId: sa.batchId };
        box.slots.push(slot);
      } else {
        slot.batchId = sa.batchId;
      }

      const batch = db.batches.find(b => b.id === sa.batchId);
      if (batch) {
        batch.container = box.id;
        batch.section = section.id;
      }

      return {
        additionalAffectedBatchIds: [sa.batchId],
        details: {
          transferSlotAssignment: {
            boxId: box.id,
            boxName: box.name,
            slotIndex: idx,
            sectionId: section.id,
            sectionName: section.name,
            siteId: sectionSiteId,
            batchId: sa.batchId,
            changeType: "assign",
            changeNote: `调拨目标批次 ${sa.batchId} 分配到 ${section.name} / ${box.name} / 格位${idx}`
          }
        }
      };
    }
  });
}

export async function cancelTransfer(transferId, ctx = {}) {
  return mutate({
    operation: OPERATION.TRANSFER_CANCEL,
    entityType: "transfer",
    entityId: transferId,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      ensureTransfersCollection(db);

      const transfer = findTransfer(db, transferId);
      if (!transfer) return { error: "transfer_not_found", id: transferId };

      if (transfer.status !== "created" && transfer.status !== "shipped") {
        return {
          error: "invalid_status_transition",
          currentStatus: transfer.status,
          expected: "created 或 shipped"
        };
      }

      const affectedBatchIds = [];
      let sourceBatchInfo = null;

      if (transfer.status === "shipped") {
        const sourceBatch = db.batches.find(b => b.id === transfer.sourceBatchId);
        if (sourceBatch) {
          ensureTransferBatchFields(sourceBatch);
          sourceBatch.inTransitQuantity -= transfer.quantity;
          if (sourceBatch.inTransitQuantity < 0) sourceBatch.inTransitQuantity = 0;
          affectedBatchIds.push(sourceBatch.id);
          sourceBatchInfo = {
            id: sourceBatch.id,
            inTransitQuantityAfter: sourceBatch.inTransitQuantity,
            availableQuantityAfter: sourceBatch.quantity - (sourceBatch.frozenQuantity || 0) - sourceBatch.inTransitQuantity
          };
        }
      }

      transfer.status = "cancelled";
      transfer.cancelledAt = new Date().toISOString();
      transfer.cancelledBy = ctx.operator || null;

      return {
        additionalAffectedBatchIds: affectedBatchIds,
        details: {
          transfer: clone(transfer),
          sourceBatch: sourceBatchInfo
        },
        transfer
      };
    }
  });
}

export async function getTransfer(transferId) {
  const db = await loadDb();
  const transfer = findTransfer(db, transferId);
  if (!transfer) return { error: "transfer_not_found", id: transferId };

  const defaultSiteId = getDefaultSiteId(db);
  const enriched = enrichTransferWithBatchInfo(transfer, db, defaultSiteId);

  return { transfer: enriched };
}

function enrichTransferWithBatchInfo(transfer, db, defaultSiteId) {
  const sourceBatch = db.batches.find(b => b.id === transfer.sourceBatchId);
  const targetBatch = transfer.targetBatchId ? db.batches.find(b => b.id === transfer.targetBatchId) : null;
  const sourceSite = (db.sites || []).find(s => s.id === transfer.sourceSiteId);
  const targetSite = (db.sites || []).find(s => s.id === transfer.targetSiteId);

  return {
    ...transfer,
    sourceSiteName: sourceSite ? sourceSite.name : null,
    targetSiteName: targetSite ? targetSite.name : null,
    sourceBatch: sourceBatch ? {
      id: sourceBatch.id,
      species: sourceBatch.species,
      collectionPlace: sourceBatch.collectionPlace,
      motherPlant: sourceBatch.motherPlant,
      quantity: sourceBatch.quantity,
      status: sourceBatch.status
    } : null,
    targetBatch: targetBatch ? {
      id: targetBatch.id,
      species: targetBatch.species,
      quantity: targetBatch.quantity,
      status: targetBatch.status
    } : null
  };
}

function applyTransferFilters(transfers, filters = {}) {
  let result = [...transfers];
  if (filters.status) {
    result = result.filter(t => t.status === filters.status);
  }
  if (filters.sourceSiteId) {
    result = result.filter(t => t.sourceSiteId === filters.sourceSiteId);
  }
  if (filters.targetSiteId) {
    result = result.filter(t => t.targetSiteId === filters.targetSiteId);
  }
  if (filters.siteId && filters.siteId !== "all") {
    result = result.filter(t => t.sourceSiteId === filters.siteId || t.targetSiteId === filters.siteId);
  }
  if (filters.sourceBatchId) {
    result = result.filter(t => t.sourceBatchId === filters.sourceBatchId);
  }
  if (filters.targetBatchId) {
    result = result.filter(t => t.targetBatchId === filters.targetBatchId);
  }
  if (filters.targetMode) {
    result = result.filter(t => t.targetMode === filters.targetMode);
  }
  if (filters.createdFrom) {
    result = result.filter(t => t.createdAt >= filters.createdFrom);
  }
  if (filters.createdTo) {
    result = result.filter(t => t.createdAt <= filters.createdTo);
  }
  return result;
}

export async function listTransfers(filters = {}) {
  const db = await loadDb();
  ensureTransfersCollection(db);
  const defaultSiteId = getDefaultSiteId(db);

  let transfers = [...db.transfers];
  transfers = applyTransferFilters(transfers, filters);

  const enriched = transfers.map(t => enrichTransferWithBatchInfo(t, db, defaultSiteId));
  enriched.sort((a, b) => {
    if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return 0;
  });

  const stats = {
    total: enriched.length,
    byStatus: {},
    bySourceSite: {},
    byTargetSite: {}
  };
  for (const t of enriched) {
    stats.byStatus[t.status] = (stats.byStatus[t.status] || 0) + 1;
    stats.bySourceSite[t.sourceSiteId] = (stats.bySourceSite[t.sourceSiteId] || 0) + 1;
    stats.byTargetSite[t.targetSiteId] = (stats.byTargetSite[t.targetSiteId] || 0) + 1;
  }

  return {
    total: enriched.length,
    stats,
    transfers: enriched
  };
}

export { ensureTransferBatchFields };
