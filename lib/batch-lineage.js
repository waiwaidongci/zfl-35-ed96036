import { mutate, OPERATION, clone, getDefaultSiteId, isSiteDisabled } from "./data-store.js";

export function ensureLineageFields(batch) {
  if (!batch.status) batch.status = "active";
  if (!batch.lineage) {
    batch.lineage = {
      splitFrom: null,
      splitTo: [],
      mergedFrom: [],
      mergedInto: null
    };
  } else {
    if (batch.lineage.splitFrom === undefined) batch.lineage.splitFrom = null;
    if (!batch.lineage.splitTo) batch.lineage.splitTo = [];
    if (!batch.lineage.mergedFrom) batch.lineage.mergedFrom = [];
    if (batch.lineage.mergedInto === undefined) batch.lineage.mergedInto = null;
  }
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

export async function splitBatch(batchId, splitItems, ctx = {}) {
  return mutate({
    operation: OPERATION.BATCH_SPLIT,
    entityType: "batch",
    entityId: batchId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [batchId],
    details: {},
    mutator: (db) => {
      const sourceBatch = db.batches.find(b => b.id === batchId);
      if (!sourceBatch) return { error: "batch_not_found" };

      ensureLineageFields(sourceBatch);

      if (sourceBatch.status !== "active") {
        return { error: "batch_not_active", status: sourceBatch.status };
      }

      if (!Array.isArray(splitItems) || splitItems.length < 2) {
        return { error: "invalid_split_items", message: "拆分至少需要2个子批次" };
      }

      for (let i = 0; i < splitItems.length; i++) {
        const qty = Number(splitItems[i].quantity);
        if (!qty || qty <= 0 || !Number.isInteger(qty)) {
          return {
            error: "invalid_quantity",
            message: `第 ${i + 1} 个子批次数量无效，必须为正整数`,
            index: i
          };
        }
      }

      const totalSplitQty = splitItems.reduce((sum, item) => sum + Number(item.quantity), 0);
      if (totalSplitQty <= 0) {
        return { error: "invalid_quantity", message: "拆分总数量必须大于0" };
      }

      const availableQty = sourceBatch.quantity - (sourceBatch.frozenQuantity || 0);
      if (totalSplitQty > availableQty) {
        return {
          error: "insufficient_available_quantity",
          available: availableQty,
          requested: totalSplitQty
        };
      }

      if (splitItems.some(item => !item.container || !item.section)) {
        return { error: "missing_container_or_section", message: "每个子批次必须指定 container 和 section" };
      }

      const slotAssignments = [];
      const sourceSiteId = sourceBatch.siteId || "SITE-001";
      for (let i = 0; i < splitItems.length; i++) {
        const item = splitItems[i];
        const hasBoxId = item.boxId !== undefined && item.boxId !== null && item.boxId !== "";
        const hasSlotIndex = item.slotIndex !== undefined && item.slotIndex !== null && item.slotIndex !== "";
        if (hasBoxId !== hasSlotIndex) {
          return {
            error: "incomplete_slot_params",
            message: `第 ${i + 1} 个子批次：boxId 和 slotIndex 必须同时传入或同时不传，不能只传一个`,
            childIndex: i,
            provided: hasBoxId ? "仅 boxId" : "仅 slotIndex",
            hint: "如需指定目标库位，请同时传入 boxId 和 slotIndex；否则两个参数都不要传"
          };
        }
        if (hasBoxId && hasSlotIndex) {
          slotAssignments.push({
            index: i,
            boxId: item.boxId,
            slotIndex: Number(item.slotIndex),
            container: item.container,
            section: item.section,
            expectedSiteId: sourceSiteId
          });
        }
      }

      const childBatches = [];
      const sourceOriginalQty = sourceBatch.quantity;

      for (let i = 0; i < splitItems.length; i++) {
        const item = splitItems[i];
        const qty = Number(item.quantity);
        const childId = item.id || `${sourceBatch.id}-S${i + 1}-${Date.now().toString().slice(-4)}`;

        if (db.batches.some(b => b.id === childId)) {
          return { error: "batch_id_conflict", id: childId };
        }

        const childBatch = {
          id: childId,
          siteId: sourceBatch.siteId || "SITE-001",
          species: sourceBatch.species,
          collectionPlace: sourceBatch.collectionPlace,
          motherPlant: sourceBatch.motherPlant,
          container: item.container,
          section: item.section,
          viability: sourceBatch.viability,
          quantity: qty,
          status: "active",
          lineage: {
            splitFrom: sourceBatch.id,
            splitTo: [],
            mergedFrom: [],
            mergedInto: null
          },
          temperatures: [],
          transactions: [],
          germinations: [],
          frozenQuantity: 0,
          reservations: [],
          remark: item.remark || `从批次 ${sourceBatch.id} 拆分`,
          reviews: [],
          anomalies: []
        };

        const childTx = createTransaction(
          "split_in",
          qty,
          qty,
          `从批次 ${sourceBatch.id} 拆分子批次，拆分数量 ${qty}`
        );
        childBatch.transactions.push(childTx);

        childBatches.push(childBatch);
        if (slotAssignments.find(s => s.index === i)) {
          const sa = slotAssignments.find(s => s.index === i);
          sa.batchId = childId;
        }
      }

      sourceBatch.quantity = sourceOriginalQty - totalSplitQty;
      const sourceTx = createTransaction(
        "split_out",
        totalSplitQty,
        sourceBatch.quantity,
        `拆分为 ${childBatches.map(b => b.id).join("、")}，共拆分 ${totalSplitQty} 粒`
      );
      sourceBatch.transactions.push(sourceTx);

      let sourceStatusAfter = sourceBatch.status;
      if (sourceBatch.quantity === 0) {
        sourceBatch.status = "split_closed";
        sourceStatusAfter = "split_closed";
      }

      const splitToIds = [];
      for (const child of childBatches) {
        sourceBatch.lineage.splitTo.push(child.id);
        splitToIds.push(child.id);
        db.batches.push(child);
      }

      return {
        createdBatchIds: childBatches.map(b => b.id),
        slotAssignments,
        details: {
          sourceBatch: {
            id: sourceBatch.id,
            quantityAfter: sourceBatch.quantity,
            statusAfter: sourceStatusAfter,
            transaction: clone(sourceTx),
            splitToIds
          },
          childBatches: childBatches.map(b => clone(b))
        },
        sourceBatch: {
          id: sourceBatch.id,
          quantity: sourceBatch.quantity,
          status: sourceBatch.status,
          transaction: sourceTx
        },
        childBatches: childBatches.map(b => ({
          id: b.id,
          quantity: b.quantity,
          container: b.container,
          section: b.section,
          transaction: b.transactions[0]
        }))
      };
    },
    locMutator: (locDb, mutatorResult, db) => {
      if (!mutatorResult || !mutatorResult.slotAssignments || mutatorResult.slotAssignments.length === 0) {
        return null;
      }

      const slotAssignments = mutatorResult.slotAssignments;
      const defaultSiteId = getDefaultSiteId(db);
      const sites = db.sites || [];

      function findBoxLoc(boxId) {
        for (const sec of locDb.sections) {
          const box = sec.boxes.find(b => b.id === boxId);
          if (box) return { section: sec, box };
        }
        return null;
      }

      const preparedSlots = [];
      for (const sa of slotAssignments) {
        const found = findBoxLoc(sa.boxId);
        if (!found) {
          return {
            error: "box_not_found",
            message: `子批次 ${sa.index + 1} 指定的 boxId ${sa.boxId} 不存在`,
            childIndex: sa.index,
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
            message: `子批次 ${sa.index + 1} 的库位站点与批次站点不一致`,
            childIndex: sa.index,
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
            message: `子批次 ${sa.index + 1} 目标站点已停用，无法分配库位`,
            childIndex: sa.index,
            siteId: sectionSiteId,
            siteName: targetSite ? targetSite.name : sectionSiteId
          };
        }

        if (sa.section !== section.id) {
          return {
            error: "section_box_mismatch",
            message: `子批次 ${sa.index + 1} 指定的 box ${sa.boxId} 不属于 section ${sa.section}，实际属于 ${section.id}`,
            childIndex: sa.index,
            specifiedSection: sa.section,
            actualSection: section.id,
            boxId: sa.boxId
          };
        }

        const idx = Number(sa.slotIndex);
        if (idx < 1 || idx > box.slotCapacity) {
          return {
            error: "slot_index_out_of_range",
            message: `子批次 ${sa.index + 1} 的 slotIndex ${idx} 超出范围 (1-${box.slotCapacity})`,
            childIndex: sa.index,
            boxId: sa.boxId,
            slotIndex: idx,
            slotCapacity: box.slotCapacity
          };
        }

        let slot = box.slots.find(s => s.index === idx);
        if (slot && slot.batchId) {
          return {
            error: "slot_already_occupied",
            message: `子批次 ${sa.index + 1} 的目标格位 ${sa.boxId}:${idx} 已被批次 ${slot.batchId} 占用`,
            childIndex: sa.index,
            boxId: sa.boxId,
            slotIndex: idx,
            occupiedBy: slot.batchId
          };
        }

        preparedSlots.push({
          box,
          slot,
          slotIndex: idx,
          batchId: sa.batchId,
          sectionId: section.id,
          sectionName: section.name,
          boxName: box.name,
          siteId: sectionSiteId
        });
      }

      for (let i = 0; i < preparedSlots.length; i++) {
        for (let j = i + 1; j < preparedSlots.length; j++) {
          if (preparedSlots[i].box.id === preparedSlots[j].box.id &&
              preparedSlots[i].slotIndex === preparedSlots[j].slotIndex) {
            return {
              error: "duplicate_slot_assignment",
              message: `子批次 ${slotAssignments[i].index + 1} 和 ${slotAssignments[j].index + 1} 指定了相同的格位 ${preparedSlots[i].box.id}:${preparedSlots[i].slotIndex}`,
              childIndex1: slotAssignments[i].index,
              childIndex2: slotAssignments[j].index,
              boxId: preparedSlots[i].box.id,
              slotIndex: preparedSlots[i].slotIndex
            };
          }
        }
      }

      const slotDetails = [];
      const additionalAffectedBatchIds = [];

      for (const ps of preparedSlots) {
        if (!ps.slot) {
          ps.slot = { index: ps.slotIndex, batchId: ps.batchId };
          ps.box.slots.push(ps.slot);
        } else {
          ps.slot.batchId = ps.batchId;
        }

        const batch = db.batches.find(b => b.id === ps.batchId);
        if (batch) {
          batch.container = ps.box.id;
          batch.section = ps.sectionId;
        }

        additionalAffectedBatchIds.push(ps.batchId);

        slotDetails.push({
          boxId: ps.box.id,
          boxName: ps.boxName,
          slotIndex: ps.slotIndex,
          sectionId: ps.sectionId,
          sectionName: ps.sectionName,
          siteId: ps.siteId,
          batchId: ps.batchId,
          changeType: "assign",
          changeNote: `拆分子批次 ${ps.batchId} 分配到 ${ps.sectionName} / ${ps.boxName} / 格位${ps.slotIndex}`
        });
      }

      return {
        additionalAffectedBatchIds,
        details: {
          splitSlotAssignments: slotDetails
        }
      };
    }
  });
}

export async function mergeBatches(batchIds, targetInfo, ctx = {}) {
  return mutate({
    operation: OPERATION.BATCH_MERGE,
    entityType: "batch",
    entityId: null,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [...batchIds],
    details: {},
    mutator: (db) => {
      const sourceBatches = batchIds.map(id => db.batches.find(b => b.id === id)).filter(Boolean);

      if (sourceBatches.length !== batchIds.length) {
        const missingIds = batchIds.filter(id => !db.batches.find(b => b.id === id));
        return { error: "batch_not_found", missingIds };
      }

      if (sourceBatches.length < 2) {
        return { error: "insufficient_batches", message: "合并至少需要2个批次" };
      }

      for (const batch of sourceBatches) {
        ensureLineageFields(batch);
        if (batch.status !== "active") {
          return { error: "batch_not_active", id: batch.id, status: batch.status };
        }
      }

      const firstBatch = sourceBatches[0];
      const firstSiteId = firstBatch.siteId || "SITE-001";
      for (const batch of sourceBatches) {
        const batchSiteId = batch.siteId || "SITE-001";
        if (batchSiteId !== firstSiteId) {
          return {
            error: "merge_site_mismatch",
            message: "合并批次必须来自同一站点",
            batchSite: batchSiteId,
            expectedSite: firstSiteId
          };
        }
        if (
          batch.species !== firstBatch.species ||
          batch.collectionPlace !== firstBatch.collectionPlace ||
          batch.motherPlant !== firstBatch.motherPlant
        ) {
          return {
            error: "merge_mismatch",
            message: "合并批次必须同物种、同采集地、同母株",
            fields: {
              species: firstBatch.species,
              collectionPlace: firstBatch.collectionPlace,
              motherPlant: firstBatch.motherPlant
            },
            mismatchedBatch: batch.id
          };
        }
      }

      const targetId = (targetInfo && targetInfo.id) || `RS-M-${Date.now().toString().slice(-6)}`;
      if (db.batches.some(b => b.id === targetId)) {
        return { error: "batch_id_conflict", id: targetId };
      }

      const totalMergedQty = sourceBatches.reduce((sum, b) => sum + b.quantity, 0);
      const totalFrozenQty = sourceBatches.reduce((sum, b) => sum + (b.frozenQuantity || 0), 0);

      if (!targetInfo || !targetInfo.container || !targetInfo.section) {
        return { error: "missing_container_or_section", message: "目标批次必须指定 container 和 section" };
      }

      let slotAssignment = null;
      const hasBoxId = targetInfo.boxId !== undefined && targetInfo.boxId !== null && targetInfo.boxId !== "";
      const hasSlotIndex = targetInfo.slotIndex !== undefined && targetInfo.slotIndex !== null && targetInfo.slotIndex !== "";
      if (hasBoxId !== hasSlotIndex) {
        return {
          error: "incomplete_slot_params",
          message: "目标批次：boxId 和 slotIndex 必须同时传入或同时不传，不能只传一个",
          provided: hasBoxId ? "仅 boxId" : "仅 slotIndex",
          hint: "如需指定目标库位，请同时传入 boxId 和 slotIndex；否则两个参数都不要传"
        };
      }
      if (hasBoxId && hasSlotIndex) {
        slotAssignment = {
          boxId: targetInfo.boxId,
          slotIndex: Number(targetInfo.slotIndex),
          container: targetInfo.container,
          section: targetInfo.section,
          expectedSiteId: firstSiteId,
          batchId: targetId
        };
      }

      const targetBatch = {
        id: targetId,
        siteId: firstSiteId,
        species: firstBatch.species,
        collectionPlace: firstBatch.collectionPlace,
        motherPlant: firstBatch.motherPlant,
        container: targetInfo.container,
        section: targetInfo.section,
        viability: firstBatch.viability,
        quantity: totalMergedQty,
        status: "active",
        lineage: {
          splitFrom: null,
          splitTo: [],
          mergedFrom: sourceBatches.map(b => b.id),
          mergedInto: null
        },
        temperatures: [],
        transactions: [],
        germinations: [],
        frozenQuantity: totalFrozenQty,
        reservations: [],
        remark: targetInfo.remark || `由 ${sourceBatches.map(b => b.id).join("、")} 合并`,
        reviews: [],
        anomalies: []
      };

      const targetTx = createTransaction(
        "merge_in",
        totalMergedQty,
        totalMergedQty,
        `由批次 ${sourceBatches.map(b => b.id).join("、")} 合并，合并数量 ${totalMergedQty} 粒`
      );
      targetBatch.transactions.push(targetTx);

      const sourceTransactions = [];
      const sourceDetails = [];
      for (const source of sourceBatches) {
        const sourceTx = createTransaction(
          "merge_out",
          source.quantity,
          0,
          `合并到批次 ${targetId}，合并数量 ${source.quantity} 粒`
        );
        source.transactions.push(sourceTx);
        source.quantity = 0;
        source.frozenQuantity = 0;
        source.status = "merged_closed";
        source.lineage.mergedInto = targetId;
        sourceTransactions.push({ batchId: source.id, transaction: sourceTx });
        sourceDetails.push({
          batchId: source.id,
          transaction: clone(sourceTx),
          quantityAfter: 0,
          frozenQuantityAfter: 0,
          statusAfter: "merged_closed",
          mergedIntoId: targetId
        });
      }

      db.batches.push(targetBatch);

      return {
        createdBatchIds: [targetId],
        slotAssignment,
        details: {
          sourceBatches: sourceDetails,
          targetBatch: clone(targetBatch)
        },
        targetBatch: {
          id: targetBatch.id,
          quantity: targetBatch.quantity,
          frozenQuantity: targetBatch.frozenQuantity,
          container: targetBatch.container,
          section: targetBatch.section,
          transaction: targetTx,
          mergedFrom: sourceBatches.map(b => b.id)
        },
        sourceBatches: sourceTransactions
      };
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
          message: "目标批次的库位站点与批次站点不一致",
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
          mergeSlotAssignment: {
            boxId: box.id,
            boxName: box.name,
            slotIndex: idx,
            sectionId: section.id,
            sectionName: section.name,
            siteId: sectionSiteId,
            batchId: sa.batchId,
            changeType: "assign",
            changeNote: `合并目标批次 ${sa.batchId} 分配到 ${section.name} / ${box.name} / 格位${idx}`
          }
        }
      };
    }
  });
}

export async function enrichBatchWithLineage(batch) {
  ensureLineageFields(batch);
  return batch;
}

export function isBatchActive(batch) {
  ensureLineageFields(batch);
  return batch.status === "active";
}

export function getActiveBatches(batches) {
  return batches.filter(b => {
    ensureLineageFields(b);
    return b.status === "active";
  });
}
