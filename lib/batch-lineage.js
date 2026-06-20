import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");

async function loadDb() {
  if (!existsSync(dbPath)) return { batches: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function ensureLineageFields(batch) {
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

export async function splitBatch(batchId, splitItems) {
  const db = await loadDb();
  const sourceBatch = db.batches.find(b => b.id === batchId);
  if (!sourceBatch) return { error: "batch_not_found" };

  ensureLineageFields(sourceBatch);

  if (sourceBatch.status !== "active") {
    return { error: "batch_not_active", status: sourceBatch.status };
  }

  if (!Array.isArray(splitItems) || splitItems.length < 2) {
    return { error: "invalid_split_items", message: "拆分至少需要2个子批次" };
  }

  const totalSplitQty = splitItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
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
  }

  sourceBatch.quantity = sourceOriginalQty - totalSplitQty;
  const sourceTx = createTransaction(
    "split_out",
    totalSplitQty,
    sourceBatch.quantity,
    `拆分为 ${childBatches.map(b => b.id).join("、")}，共拆分 ${totalSplitQty} 粒`
  );
  sourceBatch.transactions.push(sourceTx);

  if (sourceBatch.quantity === 0) {
    sourceBatch.status = "split_closed";
  }

  for (const child of childBatches) {
    sourceBatch.lineage.splitTo.push(child.id);
    db.batches.push(child);
  }

  await saveDb(db);

  return {
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
}

export async function mergeBatches(batchIds, targetInfo) {
  const db = await loadDb();
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
  for (const batch of sourceBatches) {
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

  const targetBatch = {
    id: targetId,
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
  }

  db.batches.push(targetBatch);
  await saveDb(db);

  return {
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

export { ensureLineageFields };
