import { loadAudit, loadDb, clone, seed as dbSeed } from "./data-store.js";
import { ensureLineageFields } from "./batch-lineage.js";

function isValidDateStr(s) {
  if (!s) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

export async function queryAuditLogs(filters = {}) {
  const audit = await loadAudit();
  let logs = [...audit.logs];

  if (filters.batchId) {
    logs = logs.filter(l =>
      (l.affectedBatches || []).includes(filters.batchId) ||
      l.entityId === filters.batchId
    );
  }

  if (filters.operation) {
    if (Array.isArray(filters.operation)) {
      logs = logs.filter(l => filters.operation.includes(l.operation));
    } else {
      logs = logs.filter(l => l.operation === filters.operation);
    }
  }

  if (filters.entityType) {
    logs = logs.filter(l => l.entityType === filters.entityType);
  }

  if (filters.operator) {
    logs = logs.filter(l => l.operator === filters.operator);
  }

  if (filters.fromTime && isValidDateStr(filters.fromTime)) {
    const from = new Date(filters.fromTime).getTime();
    logs = logs.filter(l => new Date(l.timestamp).getTime() >= from);
  }

  if (filters.toTime && isValidDateStr(filters.toTime)) {
    const to = new Date(filters.toTime).getTime();
    logs = logs.filter(l => new Date(l.timestamp).getTime() <= to);
  }

  if (filters.affectedBatches && Array.isArray(filters.affectedBatches)) {
    logs = logs.filter(l =>
      (l.affectedBatches || []).some(id => filters.affectedBatches.includes(id))
    );
  }

  logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const limit = Number(filters.limit) || 0;
  if (limit > 0 && logs.length > limit) {
    logs = logs.slice(-limit);
  }

  return {
    total: logs.length,
    logs
  };
}

function createBatchFromSeed(seedBatch) {
  return clone(seedBatch);
}

function findEarliestAuditForBatch(batchId, logs) {
  return logs.find(l =>
    (l.affectedBatches || []).includes(batchId) ||
    l.entityId === batchId
  );
}

function buildLineageChain(batchId, db, visited = new Set()) {
  if (visited.has(batchId)) return [];
  visited.add(batchId);

  const batch = db.batches.find(b => b.id === batchId);
  if (!batch) return [batchId];

  const chain = [batchId];

  if (batch.lineage && batch.lineage.splitFrom) {
    chain.unshift(...buildLineageChain(batch.lineage.splitFrom, db, visited));
  }
  if (batch.lineage && batch.lineage.mergedFrom && batch.lineage.mergedFrom.length) {
    for (const srcId of batch.lineage.mergedFrom) {
      const srcChain = buildLineageChain(srcId, db, visited);
      for (const id of srcChain) {
        if (!chain.includes(id)) chain.unshift(id);
      }
    }
  }

  return chain;
}

function replayBatchToPoint(targetBatchId, targetTime, currentDb, allLogs) {
  const lineageChain = buildLineageChain(targetBatchId, currentDb);

  const lineageLogs = allLogs.filter(l => {
    const affected = l.affectedBatches || [];
    return affected.some(id => lineageChain.includes(id)) || l.entityId === targetBatchId;
  });

  const hasAuditHistoryForLineage = lineageLogs.length > 0;

  const relevantLogs = lineageLogs.filter(l =>
    new Date(l.timestamp).getTime() <= targetTime
  ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const reconstructedBatches = new Map();

  const seedBatches = currentDb.batches.filter(b => lineageChain.includes(b.id));
  for (const sb of seedBatches) {
    const earliest = findEarliestAuditForBatch(sb.id, lineageLogs);
    if (!earliest) {
      reconstructedBatches.set(sb.id, clone(sb));
      continue;
    }

    const earliestTime = new Date(earliest.timestamp).getTime();
    if (earliestTime > targetTime) {
      continue;
    }

    let initialTemplate = null;
    if (earliest.changes && earliest.changes.before && earliest.changes.before[sb.id]) {
      initialTemplate = clone(earliest.changes.before[sb.id]);
    }

    if (initialTemplate) {
      const base = {
        id: initialTemplate.id,
        species: initialTemplate.species,
        collectionPlace: initialTemplate.collectionPlace,
        motherPlant: sb.motherPlant,
        container: initialTemplate.container,
        section: initialTemplate.section,
        viability: initialTemplate.viability,
        quantity: initialTemplate.quantity,
        status: initialTemplate.status,
        lineage: clone(sb.lineage || { splitFrom: null, splitTo: [], mergedFrom: [], mergedInto: null }),
        temperatures: [],
        transactions: [],
        germinations: [],
        frozenQuantity: initialTemplate.frozenQuantity || 0,
        reservations: [],
        remark: initialTemplate.remark || "",
        reviews: [],
        anomalies: []
      };
      reconstructedBatches.set(sb.id, base);
    } else {
      reconstructedBatches.set(sb.id, {
        id: sb.id,
        species: sb.species,
        collectionPlace: sb.collectionPlace,
        motherPlant: sb.motherPlant,
        container: sb.container,
        section: sb.section,
        viability: sb.viability,
        quantity: 0,
        status: "unknown",
        lineage: clone(sb.lineage || { splitFrom: null, splitTo: [], mergedFrom: [], mergedInto: null }),
        temperatures: [],
        transactions: [],
        germinations: [],
        frozenQuantity: 0,
        reservations: [],
        remark: "",
        reviews: [],
        anomalies: []
      });
    }
  }

  let earliestKnown = Infinity;
  for (const sb of seedBatches) {
    const earliest = findEarliestAuditForBatch(sb.id, relevantLogs);
    if (earliest) {
      earliestKnown = Math.min(earliestKnown, new Date(earliest.timestamp).getTime());
    }
  }

  for (const log of relevantLogs) {
    const affected = log.affectedBatches || [];
    const logTime = new Date(log.timestamp).getTime();

    switch (log.operation) {
      case "batch_create": {
        if (log.details && log.details.batch) {
          const batchId = log.details.batch.id;
          if (lineageChain.includes(batchId)) {
            reconstructedBatches.set(batchId, clone(log.details.batch));
          }
        }
        break;
      }
      case "import_batches": {
        if (log.details && log.details.createdBatches) {
          for (const b of log.details.createdBatches) {
            if (lineageChain.includes(b.id)) {
              reconstructedBatches.set(b.id, clone(b));
            }
          }
        }
        break;
      }
      case "batch_update_remark": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.remark !== undefined) {
            b.remark = log.details.remark;
          }
        }
        break;
      }
      case "transaction_add": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.transaction) {
            b.transactions.push(clone(log.details.transaction));
            if (log.details.quantityAfter !== undefined) {
              b.quantity = log.details.quantityAfter;
            }
          }
        }
        break;
      }
      case "temperature_add": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.temperature) {
            b.temperatures.push(clone(log.details.temperature));
          }
        }
        break;
      }
      case "germination_add": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.germination) {
            b.germinations.push(clone(log.details.germination));
            if (log.details.transaction) {
              b.transactions.push(clone(log.details.transaction));
            }
            if (log.details.quantityAfter !== undefined) {
              b.quantity = log.details.quantityAfter;
            }
          }
        }
        break;
      }
      case "review_add": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.review) {
            b.reviews.push(clone(log.details.review));
          }
        }
        break;
      }
      case "reservation_create": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.reservation) {
            if (!b.reservations) b.reservations = [];
            b.reservations.push(clone(log.details.reservation));
          }
        }
        break;
      }
      case "reservation_approve": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details) {
            if (log.details.reservation && b.reservations) {
              const idx = b.reservations.findIndex(r => r.id === log.details.reservation.id);
              if (idx >= 0) b.reservations[idx] = clone(log.details.reservation);
            }
            if (log.details.frozenQuantityAfter !== undefined) {
              b.frozenQuantity = log.details.frozenQuantityAfter;
            }
          }
        }
        break;
      }
      case "reservation_reject":
      case "reservation_cancel": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details) {
            if (log.details.reservation && b.reservations) {
              const idx = b.reservations.findIndex(r => r.id === log.details.reservation.id);
              if (idx >= 0) b.reservations[idx] = clone(log.details.reservation);
            }
            if (log.details.frozenQuantityAfter !== undefined) {
              b.frozenQuantity = log.details.frozenQuantityAfter;
            }
          }
        }
        break;
      }
      case "reservation_fulfill": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details) {
            if (log.details.reservation && b.reservations) {
              const idx = b.reservations.findIndex(r => r.id === log.details.reservation.id);
              if (idx >= 0) b.reservations[idx] = clone(log.details.reservation);
            }
            if (log.details.transaction) {
              b.transactions.push(clone(log.details.transaction));
            }
            if (log.details.frozenQuantityAfter !== undefined) {
              b.frozenQuantity = log.details.frozenQuantityAfter;
            }
            if (log.details.quantityAfter !== undefined) {
              b.quantity = log.details.quantityAfter;
            }
          }
        }
        break;
      }
      case "anomaly_scan": {
        if (log.details && log.details.newAnomalies) {
          for (const anom of log.details.newAnomalies) {
            if (lineageChain.includes(anom.batchId)) {
              const b = reconstructedBatches.get(anom.batchId);
              if (b) {
                if (!b.anomalies) b.anomalies = [];
                b.anomalies.push(clone(anom));
              }
            }
          }
        }
        break;
      }
      case "anomaly_handle": {
        if (log.entityId && lineageChain.includes(log.entityId)) {
          const b = reconstructedBatches.get(log.entityId);
          if (b && log.details && log.details.anomaly) {
            if (!b.anomalies) b.anomalies = [];
            const idx = b.anomalies.findIndex(a => a.id === log.details.anomaly.id);
            if (idx >= 0) {
              b.anomalies[idx] = clone(log.details.anomaly);
            }
          }
        }
        break;
      }
      case "batch_split": {
        if (log.details && log.details.sourceBatch && lineageChain.includes(log.details.sourceBatch.id)) {
          const b = reconstructedBatches.get(log.details.sourceBatch.id);
          if (b) {
            if (log.details.sourceBatch.quantityAfter !== undefined) {
              b.quantity = log.details.sourceBatch.quantityAfter;
            }
            if (log.details.sourceBatch.statusAfter) {
              b.status = log.details.sourceBatch.statusAfter;
            }
            if (log.details.sourceBatch.transaction) {
              b.transactions.push(clone(log.details.sourceBatch.transaction));
            }
            if (log.details.sourceBatch.splitToIds) {
              if (!b.lineage) b.lineage = { splitFrom: null, splitTo: [], mergedFrom: [], mergedInto: null };
              b.lineage.splitTo = [...new Set([...(b.lineage.splitTo || []), ...log.details.sourceBatch.splitToIds])];
            }
          }
        }
        if (log.details && log.details.childBatches) {
          for (const cb of log.details.childBatches) {
            if (lineageChain.includes(cb.id)) {
              reconstructedBatches.set(cb.id, clone(cb));
            }
          }
        }
        break;
      }
      case "batch_merge": {
        if (log.details && log.details.sourceBatches) {
          for (const sb of log.details.sourceBatches) {
            if (lineageChain.includes(sb.batchId)) {
              const b = reconstructedBatches.get(sb.batchId);
              if (b) {
                if (sb.transaction) b.transactions.push(clone(sb.transaction));
                if (sb.quantityAfter !== undefined) b.quantity = sb.quantityAfter;
                if (sb.frozenQuantityAfter !== undefined) b.frozenQuantity = sb.frozenQuantityAfter;
                if (sb.statusAfter) b.status = sb.statusAfter;
                if (sb.mergedIntoId) {
                  if (!b.lineage) b.lineage = { splitFrom: null, splitTo: [], mergedFrom: [], mergedInto: null };
                  b.lineage.mergedInto = sb.mergedIntoId;
                }
              }
            }
          }
        }
        if (log.details && log.details.targetBatch && lineageChain.includes(log.details.targetBatch.id)) {
          reconstructedBatches.set(log.details.targetBatch.id, clone(log.details.targetBatch));
        }
        break;
      }
    }

    if (log.changes && log.changes.after) {
      for (const [batchId, afterFields] of Object.entries(log.changes.after)) {
        if (!lineageChain.includes(batchId)) continue;
        const b = reconstructedBatches.get(batchId);
        if (!b) continue;
        if (afterFields.quantity !== undefined) b.quantity = afterFields.quantity;
        if (afterFields.status !== undefined) b.status = afterFields.status;
        if (afterFields.frozenQuantity !== undefined) b.frozenQuantity = afterFields.frozenQuantity;
        if (afterFields.viability !== undefined) b.viability = afterFields.viability;
        if (afterFields.container !== undefined) b.container = afterFields.container;
        if (afterFields.section !== undefined) b.section = afterFields.section;
        if (afterFields.remark !== undefined) b.remark = afterFields.remark;
      }
    }
  }

  if (reconstructedBatches.size === 0) {
    if (!hasAuditHistoryForLineage) {
      const fallback = currentDb.batches.find(b => b.id === targetBatchId);
      if (fallback) return clone(fallback);
    }
    return null;
  }

  const result = reconstructedBatches.get(targetBatchId);
  if (result) {
    ensureLineageFields(result);
    if (!result.reviews) result.reviews = [];
    if (result.remark === undefined) result.remark = "";
    if (!result.reservations) result.reservations = [];
    if (result.frozenQuantity === undefined || result.frozenQuantity === null) result.frozenQuantity = 0;
    if (!result.anomalies) result.anomalies = [];
  }
  return result || null;
}

export async function replayBatchHistory(batchId, targetTimeStr) {
  const currentDb = await loadDb();
  const audit = await loadAudit();

  const targetBatch = currentDb.batches.find(b => b.id === batchId);
  if (!targetBatch) {
    return { error: "batch_not_found" };
  }

  if (!targetTimeStr) {
    return {
      batchId,
      targetTime: new Date().toISOString(),
      replayedState: clone(targetBatch),
      notes: "未指定时间点，返回当前状态。"
    };
  }

  if (!isValidDateStr(targetTimeStr)) {
    return { error: "invalid_target_time", message: "targetTime 必须是有效的 ISO8601 时间字符串" };
  }

  const targetTime = new Date(targetTimeStr).getTime();

  const result = replayBatchToPoint(batchId, targetTime, currentDb, audit.logs);

  const lineageChain = buildLineageChain(batchId, currentDb);
  const hasAuditHistory = audit.logs.some(l => {
    const affected = l.affectedBatches || [];
    return affected.some(id => lineageChain.includes(id)) || l.entityId === batchId;
  });

  let notes = null;
  let replayedState = result;
  if (!hasAuditHistory) {
    notes = "该批次及其谱系没有审计历史记录（可能是初始数据），无法回溯历史状态，返回当前快照。";
    if (replayedState === null) replayedState = clone(targetBatch);
  } else if (replayedState === null) {
    notes = "指定的时间点早于该批次（及其谱系）的任何操作记录，当时该批次尚未存在。";
  }

  return {
    batchId,
    targetTime: new Date(targetTime).toISOString(),
    replayedState,
    lineageChain,
    notes
  };
}

export async function getBatchChangeTimeline(batchId) {
  const audit = await loadAudit();
  const currentDb = await loadDb();

  const targetBatch = currentDb.batches.find(b => b.id === batchId);
  if (!targetBatch) {
    return { error: "batch_not_found" };
  }

  const lineageChain = buildLineageChain(batchId, currentDb);

  const logs = audit.logs.filter(l => {
    const affected = l.affectedBatches || [];
    return affected.some(id => lineageChain.includes(id)) || l.entityId === batchId;
  }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const timeline = logs.map(l => ({
    timestamp: l.timestamp,
    operation: l.operation,
    operator: l.operator,
    source: l.source,
    entityId: l.entityId,
    affectedBatches: l.affectedBatches,
    summary: summarizeOperation(l, batchId),
    details: l.details
  }));

  return {
    batchId,
    lineageChain,
    totalEvents: timeline.length,
    timeline
  };
}

function summarizeOperation(log, targetBatchId) {
  const d = log.details || {};
  switch (log.operation) {
    case "batch_create":
      return d.batch ? `创建批次 ${d.batch.id}，数量 ${d.batch.quantity}` : `创建批次`;
    case "import_batches":
      return `批量导入 ${(d.createdBatches || []).length} 个批次`;
    case "batch_update_remark":
      return `更新备注为 "${d.remark || ""}"`;
    case "transaction_add":
      return d.transaction ? `库存流水：${d.transaction.type} ${d.transaction.quantity} 粒` : `新增库存流水`;
    case "temperature_add":
      return d.temperature ? `温度记录：${d.temperature.value}°C` : `新增温度记录`;
    case "germination_add":
      return d.germination ? `萌发实验：采样${d.germination.sampled}粒，发芽${d.germination.sprouted}粒` : `新增萌发实验`;
    case "review_add":
      return d.review ? `复核处理：${d.review.conclusion} - ${d.review.note || ""}` : `新增复核`;
    case "reservation_create":
      return d.reservation ? `创建预约：${d.reservation.quantity}粒` : `创建预约`;
    case "reservation_approve":
      return `批准预约`;
    case "reservation_reject":
      return `拒绝预约`;
    case "reservation_cancel":
      return `取消预约`;
    case "reservation_fulfill":
      return d.reservation ? `执行预约 ${d.reservation.id}` : `执行预约`;
    case "anomaly_scan":
      return `扫描异常，新发现 ${(d.newAnomalies || []).length} 条`;
    case "anomaly_handle":
      return d.anomaly ? `处理异常：${d.anomaly.handlingResult}` : `处理异常`;
    case "batch_split":
      return `拆分为 ${(d.childBatches || []).length} 个子批次`;
    case "batch_merge":
      return `合并为批次 ${d.targetBatch ? d.targetBatch.id : ""}`;
    case "location_section_create":
      return d.section ? `创建库区 ${d.section.id}（${d.section.name}）` : `创建库区`;
    case "location_box_add":
      return d.box ? `添加冷盒 ${d.box.id}（${d.box.name}）到库区 ${d.sectionId || ""}，容量 ${d.box.slotCapacity}` : `添加冷盒`;
    case "location_slot_assign":
      return `槽位分配：${d.boxId || ""}:${d.slotIndex || ""} ${d.previousBatchId || "空"} → ${d.newBatchId || "空"}`;
    default:
      return log.operation;
  }
}

export async function getAuditStats() {
  const audit = await loadAudit();
  const currentDb = await loadDb();

  const byOperation = {};
  const byOperator = {};
  const byBatch = {};
  let total = 0;
  let firstTime = null;
  let lastTime = null;

  for (const log of audit.logs) {
    total++;
    const op = log.operation || "unknown";
    byOperation[op] = (byOperation[op] || 0) + 1;

    const oper = log.operator || "unknown";
    byOperator[oper] = (byOperator[oper] || 0) + 1;

    for (const bid of (log.affectedBatches || [])) {
      byBatch[bid] = (byBatch[bid] || 0) + 1;
    }

    const t = new Date(log.timestamp).getTime();
    if (!firstTime || t < firstTime) firstTime = t;
    if (!lastTime || t > lastTime) lastTime = t;
  }

  const batchesWithAudit = Object.keys(byBatch).length;
  const batchesWithoutAudit = currentDb.batches.length - batchesWithAudit;

  return {
    totalLogs: total,
    firstLogAt: firstTime ? new Date(firstTime).toISOString() : null,
    lastLogAt: lastTime ? new Date(lastTime).toISOString() : null,
    byOperation,
    byOperator,
    totalBatchesInSystem: currentDb.batches.length,
    batchesWithAuditHistory: batchesWithAudit,
    batchesWithoutAuditHistory: batchesWithoutAudit,
    topBatchedByChanges: Object.entries(byBatch)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ batchId: id, changeCount: count }))
  };
}
