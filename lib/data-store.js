import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");
const auditPath = join(__dirname, "..", "data", "audit-logs.json");
const locPath = join(__dirname, "..", "data", "locations.json");

const seed = {
  batches: [
    {
      id: "RS-001",
      species: "独叶草",
      collectionPlace: "西岭北坡",
      motherPlant: "MP-17",
      container: "C-冷盒-08",
      section: "A2",
      viability: "high",
      quantity: 1800,
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18.4 },
        { at: "2026-06-02T08:00:00.000Z", value: -17.2 },
        { at: "2026-06-03T08:00:00.000Z", value: -12.5 },
        { at: "2026-06-04T08:00:00.000Z", value: -19.1 },
        { at: "2026-06-05T08:00:00.000Z", value: -8.3 }
      ],
      transactions: [
        { id: "TX-1", at: "2026-05-20", type: "collect", quantity: 1800, balance: 1800, note: "采集入库" }
      ],
      germinations: [
        { at: "2026-01-15", sampled: 100, sprouted: 85, rate: 0.85 },
        { at: "2026-03-15", sampled: 100, sprouted: 82, rate: 0.82 },
        { at: "2026-05-15", sampled: 100, sprouted: 78, rate: 0.78 },
        { at: "2026-06-12", sampled: 100, sprouted: 72, rate: 0.72 }
      ],
      frozenQuantity: 0,
      reservations: [],
      remark: "初始入库批次，待质量复核",
      reviews: [
        { id: "RV-1", at: "2026-05-25T10:30:00.000Z", reviewer: "李管理员", conclusion: "pending", note: "初步检查种子外观完整，等待萌发实验结果后最终确认" }
      ],
      anomalies: []
    },
    {
      id: "RS-002",
      species: "珙桐",
      collectionPlace: "峨眉山",
      motherPlant: "MP-23",
      container: "C-冷盒-09",
      section: "A2",
      viability: "medium",
      quantity: 950,
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18.2 },
        { at: "2026-06-02T08:00:00.000Z", value: -18 },
        { at: "2026-06-03T08:00:00.000Z", value: -18.5 },
        { at: "2026-06-04T08:00:00.000Z", value: -18.1 },
        { at: "2026-06-05T08:00:00.000Z", value: -18.3 }
      ],
      transactions: [
        { id: "TX-2", at: "2026-04-10", type: "collect", quantity: 1000, balance: 1000, note: "采集入库" },
        { id: "TX-3", at: "2026-05-20", type: "sample", quantity: 50, balance: 950, note: "萌发实验取样" }
      ],
      germinations: [
        { at: "2026-02-10", sampled: 100, sprouted: 78, rate: 0.78 },
        { at: "2026-04-10", sampled: 100, sprouted: 71, rate: 0.71 },
        { at: "2026-05-20", sampled: 100, sprouted: 55, rate: 0.55 }
      ],
      frozenQuantity: 0,
      reservations: [],
      remark: "珙桐种子，注意观察活性变化趋势",
      reviews: [
        { id: "RV-2", at: "2026-04-15T09:00:00.000Z", reviewer: "王主任", conclusion: "approved", note: "种子质量良好，入库保存" }
      ],
      anomalies: []
    },
    {
      id: "RS-003",
      species: "红豆杉",
      collectionPlace: "神农架",
      motherPlant: "MP-45",
      container: "C-冷盒-10",
      section: "A3",
      viability: "high",
      quantity: 2200,
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18 },
        { at: "2026-06-02T08:00:00.000Z", value: -17.9 },
        { at: "2026-06-03T08:00:00.000Z", value: -18.1 },
        { at: "2026-06-04T08:00:00.000Z", value: -18.2 },
        { at: "2026-06-05T08:00:00.000Z", value: -18 }
      ],
      transactions: [
        { id: "TX-4", at: "2026-02-01", type: "collect", quantity: 2200, balance: 2200, note: "采集入库" }
      ],
      germinations: [
        { at: "2026-02-05", sampled: 100, sprouted: 92, rate: 0.92 },
        { at: "2026-04-05", sampled: 100, sprouted: 90, rate: 0.9 },
        { at: "2026-06-05", sampled: 100, sprouted: 89, rate: 0.89 }
      ],
      frozenQuantity: 0,
      reservations: [],
      remark: "红豆杉种子，活性很高，定期复测",
      reviews: [
        { id: "RV-3", at: "2026-02-10T14:00:00.000Z", reviewer: "张研究员", conclusion: "approved", note: "高品质种子，活性92%，符合标准" }
      ],
      anomalies: []
    },
    {
      id: "RS-004",
      species: "望天树",
      collectionPlace: "西双版纳",
      motherPlant: "MP-61",
      container: "C-冷盒-11",
      section: "A3",
      viability: "low",
      quantity: 600,
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18.5 },
        { at: "2026-06-02T08:00:00.000Z", value: -18.3 },
        { at: "2026-06-03T08:00:00.000Z", value: -18.4 },
        { at: "2026-06-04T08:00:00.000Z", value: -18.6 },
        { at: "2026-06-05T08:00:00.000Z", value: -18.2 }
      ],
      transactions: [
        { id: "TX-5", at: "2026-01-15", type: "collect", quantity: 600, balance: 600, note: "采集入库" }
      ],
      germinations: [
        { at: "2026-01-20", sampled: 100, sprouted: 52, rate: 0.52 }
      ],
      frozenQuantity: 0,
      reservations: [],
      remark: "望天树种子，初始萌发率偏低，需要重点关注",
      reviews: [
        { id: "RV-4", at: "2026-01-25T11:00:00.000Z", reviewer: "李管理员", conclusion: "pending", note: "萌发率52%，低于阈值，建议尽快复测" }
      ],
      anomalies: []
    },
    {
      id: "RS-005",
      species: "水杉",
      collectionPlace: "湖北利川",
      motherPlant: "MP-33",
      container: "C-冷盒-12",
      section: "A1",
      viability: "high",
      quantity: 1500,
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18.1 },
        { at: "2026-06-02T08:00:00.000Z", value: -18 },
        { at: "2026-06-03T08:00:00.000Z", value: -17.8 },
        { at: "2026-06-04T08:00:00.000Z", value: -18.2 },
        { at: "2026-06-05T08:00:00.000Z", value: -18.1 }
      ],
      transactions: [
        { id: "TX-6", at: "2026-02-10", type: "collect", quantity: 1500, balance: 1500, note: "采集入库" }
      ],
      germinations: [
        { at: "2026-02-15", sampled: 100, sprouted: 88, rate: 0.88 }
      ],
      frozenQuantity: 0,
      reservations: [],
      remark: "水杉种子，已超过90天未复测",
      reviews: [
        { id: "RV-5", at: "2026-02-20T10:00:00.000Z", reviewer: "王主任", conclusion: "approved", note: "初始活性良好，建议3个月后复测" }
      ],
      anomalies: []
    },
    {
      id: "RS-006",
      species: "银杏",
      collectionPlace: "天目山",
      motherPlant: "MP-77",
      container: "C-冷盒-13",
      section: "A1",
      viability: "medium",
      quantity: 800,
      status: "active",
      lineage: {
        splitFrom: null,
        splitTo: [],
        mergedFrom: [],
        mergedInto: null
      },
      temperatures: [
        { at: "2026-06-01T08:00:00.000Z", value: -18.3 },
        { at: "2026-06-02T08:00:00.000Z", value: -18.2 },
        { at: "2026-06-03T08:00:00.000Z", value: -18.4 },
        { at: "2026-06-04T08:00:00.000Z", value: -18.1 },
        { at: "2026-06-05T08:00:00.000Z", value: -18.3 }
      ],
      transactions: [
        { id: "TX-7", at: "2026-03-05", type: "collect", quantity: 800, balance: 800, note: "采集入库" }
      ],
      germinations: [],
      frozenQuantity: 0,
      reservations: [],
      remark: "银杏种子，尚未进行萌发实验",
      reviews: [],
      anomalies: []
    }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const raw = await readFile(dbPath, "utf8");
  const data = JSON.parse(raw);
  if (!data.batches) data.batches = [];
  return data;
}

async function saveDb(db) {
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

const locSeed = {
  sections: [
    {
      id: "A1",
      name: "A1极低温区",
      boxes: [
        { id: "C-冷盒-01", name: "冷盒01", slotCapacity: 20, slots: [] },
        { id: "C-冷盒-02", name: "冷盒02", slotCapacity: 20, slots: [] }
      ]
    },
    {
      id: "A2",
      name: "A2低温区",
      boxes: [
        { id: "C-冷盒-07", name: "冷盒07", slotCapacity: 16, slots: [] },
        { id: "C-冷盒-08", name: "冷盒08", slotCapacity: 16, slots: [
          { index: 1, batchId: "RS-001" },
          { index: 2, batchId: null },
          { index: 3, batchId: null },
          { index: 4, batchId: null }
        ]}
      ]
    },
    {
      id: "B1",
      name: "B1中温区",
      boxes: [
        { id: "C-冷盒-15", name: "冷盒15", slotCapacity: 24, slots: [] }
      ]
    },
    {
      id: "C1",
      name: "C1恒温区",
      boxes: [
        { id: "C-冷盒-30", name: "冷盒30", slotCapacity: 12, slots: [
          { index: 1, batchId: null }
        ] }
      ]
    }
  ]
};

function ensureLocDefaults(data) {
  if (!data.sections) data.sections = [];
  let changed = false;

  for (const seedSection of locSeed.sections) {
    let section = data.sections.find(s => s.id === seedSection.id);
    if (!section) {
      data.sections.push(clone(seedSection));
      changed = true;
      continue;
    }

    if (!section.boxes) {
      section.boxes = [];
      changed = true;
    }
    for (const seedBox of seedSection.boxes || []) {
      if (!section.boxes.some(b => b.id === seedBox.id)) {
        section.boxes.push(clone(seedBox));
        changed = true;
      }
    }
  }

  return changed;
}

async function loadLocDb() {
  if (!existsSync(locPath)) {
    await mkdir(dirname(locPath), { recursive: true });
    await writeFile(locPath, JSON.stringify(locSeed, null, 2));
  }
  try {
    const raw = await readFile(locPath, "utf8");
    const data = JSON.parse(raw);
    const changed = ensureLocDefaults(data);
    if (changed) await saveLocDb(data);
    return data;
  } catch (e) {
    return clone(locSeed);
  }
}

async function saveLocDb(locDb) {
  await mkdir(dirname(locPath), { recursive: true });
  await writeFile(locPath, JSON.stringify(locDb, null, 2));
}

function extractBatchKeyFields(batch) {
  if (!batch) return null;
  return {
    id: batch.id,
    species: batch.species,
    collectionPlace: batch.collectionPlace,
    container: batch.container,
    section: batch.section,
    viability: batch.viability,
    quantity: batch.quantity,
    status: batch.status,
    frozenQuantity: batch.frozenQuantity,
    remark: batch.remark,
    transactionsCount: (batch.transactions || []).length,
    temperaturesCount: (batch.temperatures || []).length,
    germinationsCount: (batch.germinations || []).length,
    reviewsCount: (batch.reviews || []).length,
    reservationsCount: (batch.reservations || []).length,
    anomaliesCount: (batch.anomalies || []).length
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const OPERATION = {
  BATCH_CREATE: "batch_create",
  BATCH_UPDATE_REMARK: "batch_update_remark",
  TRANSACTION_ADD: "transaction_add",
  TEMPERATURE_ADD: "temperature_add",
  GERMINATION_ADD: "germination_add",
  REVIEW_ADD: "review_add",
  BATCH_SPLIT: "batch_split",
  BATCH_MERGE: "batch_merge",
  RESERVATION_CREATE: "reservation_create",
  RESERVATION_APPROVE: "reservation_approve",
  RESERVATION_REJECT: "reservation_reject",
  RESERVATION_CANCEL: "reservation_cancel",
  RESERVATION_FULFILL: "reservation_fulfill",
  ANOMALY_SCAN: "anomaly_scan",
  ANOMALY_HANDLE: "anomaly_handle",
  IMPORT_BATCHES: "import_batches",
  LOCATION_SECTION_CREATE: "location_section_create",
  LOCATION_BOX_ADD: "location_box_add",
  LOCATION_SLOT_ASSIGN: "location_slot_assign"
};

async function loadAudit() {
  if (!existsSync(auditPath)) {
    await mkdir(dirname(auditPath), { recursive: true });
    await writeFile(auditPath, JSON.stringify({ logs: [] }, null, 2));
    return { logs: [] };
  }
  try {
    const raw = await readFile(auditPath, "utf8");
    const data = JSON.parse(raw);
    if (!data.logs) data.logs = [];
    return data;
  } catch (e) {
    return { logs: [] };
  }
}

async function saveAudit(audit) {
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, JSON.stringify(audit, null, 2));
}

function getDefaultOperator() {
  return process.env.DEFAULT_OPERATOR || "系统自动";
}

async function recordAudit(entry) {
  const audit = await loadAudit();
  audit.logs.push(entry);
  await saveAudit(audit);
}

function getRequestContext(req) {
  if (!req) {
    return {
      ip: "internal",
      userAgent: "system",
      endpoint: "internal"
    };
  }
  const headers = req.headers || {};
  const url = (req.url || "/").split("?")[0];
  return {
    ip: headers["x-forwarded-for"] || headers["x-real-ip"] || "unknown",
    userAgent: headers["user-agent"] || "unknown",
    endpoint: `${req.method || "?"} ${url}`
  };
}

async function mutate(options) {
  const {
    operation,
    entityType = "batch",
    entityId = null,
    operator,
    source,
    affectedBatchIds = [],
    details = {},
    mutator,
    locMutator
  } = options;

  const db = await loadDb();
  const audit = await loadAudit();
  let locDb = null;
  if (locMutator) {
    locDb = await loadLocDb();
  }

  const beforeSnapshots = {};
  for (const id of affectedBatchIds) {
    const batch = db.batches.find(b => b.id === id);
    if (batch) {
      beforeSnapshots[id] = extractBatchKeyFields(clone(batch));
    }
  }

  const result = await mutator(db);
  if (result && result.error) {
    return result;
  }

  let locResult = null;
  if (locMutator && locDb) {
    locResult = await locMutator(locDb);
    if (locResult && locResult.error) {
      return locResult;
    }
  }

  const afterSnapshots = {};
  for (const id of affectedBatchIds) {
    const batch = db.batches.find(b => b.id === id);
    if (batch) {
      afterSnapshots[id] = extractBatchKeyFields(clone(batch));
    }
  }
  if (result && result.createdBatchIds) {
    for (const id of result.createdBatchIds) {
      const batch = db.batches.find(b => b.id === id);
      if (batch) {
        afterSnapshots[id] = extractBatchKeyFields(clone(batch));
        if (!beforeSnapshots[id]) beforeSnapshots[id] = null;
      }
    }
  }

  const mergedDetails = { ...(details || {}), ...((result && result.details) || {}) };
  if (locResult && locResult.details) {
    Object.assign(mergedDetails, locResult.details);
  }

  const entry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    operator: operator || getDefaultOperator(),
    source: source || getRequestContext(null),
    operation,
    entityType,
    entityId,
    affectedBatches: [...affectedBatchIds, ...(result && result.createdBatchIds ? result.createdBatchIds : [])],
    changes: {
      before: beforeSnapshots,
      after: afterSnapshots
    },
    details: mergedDetails
  };
  audit.logs.push(entry);

  await saveDb(db);
  if (locDb && locMutator) await saveLocDb(locDb);
  await saveAudit(audit);

  const finalResult = { ...(result || {}), _auditId: entry.id };
  if (locResult) {
    Object.assign(finalResult, locResult);
    delete finalResult.details;
    delete finalResult.error;
  }
  return finalResult;
}

export {
  loadDb,
  saveDb,
  loadLocDb,
  saveLocDb,
  loadAudit,
  saveAudit,
  mutate,
  recordAudit,
  extractBatchKeyFields,
  clone,
  getRequestContext,
  getDefaultOperator,
  OPERATION,
  seed,
  locSeed
};
