import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");
const auditPath = join(__dirname, "..", "data", "audit-logs.json");
const locPath = join(__dirname, "..", "data", "locations.json");

const DEFAULT_SITE_ID = "SITE-001";

const seed = {
  sites: [
    {
      id: "SITE-001",
      name: "主冷库",
      code: "MAIN",
      address: "一号库区",
      isDefault: true,
      disabled: false,
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "SITE-002",
      name: "二号备库",
      code: "BACKUP",
      address: "二号库区",
      isDefault: false,
      disabled: false,
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  batches: [
    {
      id: "RS-001",
      siteId: "SITE-001",
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
      siteId: "SITE-001",
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
      siteId: "SITE-001",
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
      siteId: "SITE-002",
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
      siteId: "SITE-002",
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
      siteId: "SITE-002",
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

function ensureSites(data) {
  if (!data.sites) data.sites = [];
  let changed = false;

  for (const seedSite of seed.sites) {
    let site = data.sites.find(s => s.id === seedSite.id);
    if (!site) {
      data.sites.push(clone(seedSite));
      changed = true;
    }
  }

  for (const site of data.sites) {
    if (site.disabled === undefined) {
      site.disabled = false;
      changed = true;
    }
  }

  if (!data.sites.some(s => s.isDefault)) {
    if (data.sites.length > 0) {
      data.sites[0].isDefault = true;
    } else {
      data.sites.push(clone(seed.sites[0]));
    }
    changed = true;
  }

  return changed;
}

function ensureBatchSiteField(batch, defaultSiteId) {
  if (!batch.siteId) {
    batch.siteId = defaultSiteId;
    return true;
  }
  return false;
}

function migrateLegacyData(data) {
  let changed = ensureSites(data);
  const defaultSite = data.sites.find(s => s.isDefault) || data.sites[0];
  if (!defaultSite) return changed;

  if (!data.batches) data.batches = [];

  for (const batch of data.batches) {
    if (ensureBatchSiteField(batch, defaultSite.id)) {
      changed = true;
    }
  }

  return changed;
}

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const raw = await readFile(dbPath, "utf8");
  const data = JSON.parse(raw);
  if (!data.batches) data.batches = [];
  const changed = migrateLegacyData(data);
  if (changed) {
    await saveDb(data);
  }
  return data;
}

async function saveDb(db) {
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

const locSeed = {
  sites: [
    { id: "SITE-001", name: "主冷库", code: "MAIN" },
    { id: "SITE-002", name: "二号备库", code: "BACKUP" }
  ],
  sections: [
    {
      id: "A1",
      name: "A1极低温区",
      siteId: "SITE-001",
      boxes: [
        { id: "C-冷盒-01", name: "冷盒01", slotCapacity: 20, slots: [] },
        { id: "C-冷盒-02", name: "冷盒02", slotCapacity: 20, slots: [] }
      ]
    },
    {
      id: "A2",
      name: "A2低温区",
      siteId: "SITE-001",
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
      id: "A3",
      name: "A3中温区",
      siteId: "SITE-001",
      boxes: [
        { id: "C-冷盒-10", name: "冷盒10", slotCapacity: 16, slots: [] }
      ]
    },
    {
      id: "B1",
      name: "B1中温区",
      siteId: "SITE-002",
      boxes: [
        { id: "C-冷盒-15", name: "冷盒15", slotCapacity: 24, slots: [] }
      ]
    },
    {
      id: "C1",
      name: "C1恒温区",
      siteId: "SITE-002",
      boxes: [
        { id: "C-冷盒-30", name: "冷盒30", slotCapacity: 12, slots: [
          { index: 1, batchId: null }
        ] }
      ]
    },
    {
      id: "A1-BK",
      name: "A1备库低温区",
      siteId: "SITE-002",
      boxes: [
        { id: "C-冷盒-12", name: "备库冷盒12", slotCapacity: 20, slots: [] },
        { id: "C-冷盒-13", name: "备库冷盒13", slotCapacity: 20, slots: [] }
      ]
    },
    {
      id: "A3-BK",
      name: "A3备库中温区",
      siteId: "SITE-002",
      boxes: [
        { id: "C-冷盒-11", name: "备库冷盒11", slotCapacity: 16, slots: [] }
      ]
    }
  ]
};

function ensureLocDefaults(data) {
  if (!data.sites) data.sites = [];
  if (!data.sections) data.sections = [];
  let changed = false;

  for (const seedSite of locSeed.sites || []) {
    let site = data.sites.find(s => s.id === seedSite.id);
    if (!site) {
      data.sites.push(clone(seedSite));
      changed = true;
    }
  }

  const defaultLocSite = (data.sites && data.sites.length > 0) ? data.sites[0].id : DEFAULT_SITE_ID;

  for (const seedSection of locSeed.sections) {
    let section = data.sections.find(s => s.id === seedSection.id);
    if (!section) {
      const cloned = clone(seedSection);
      data.sections.push(cloned);
      changed = true;
      continue;
    }

    if (!section.siteId) {
      section.siteId = defaultLocSite;
      changed = true;
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

  for (const section of data.sections) {
    if (!section.siteId) {
      section.siteId = defaultLocSite;
      changed = true;
    }
    if (!section.boxes) {
      section.boxes = [];
      changed = true;
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
    siteId: batch.siteId,
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

function getDefaultSiteId(data) {
  if (data && data.sites) {
    const def = data.sites.find(s => s.isDefault);
    if (def) return def.id;
    if (data.sites.length > 0) return data.sites[0].id;
  }
  return DEFAULT_SITE_ID;
}

async function listSites() {
  const db = await loadDb();
  return db.sites || [];
}

async function getSite(siteId) {
  const db = await loadDb();
  return (db.sites || []).find(s => s.id === siteId) || null;
}

async function getDefaultSite() {
  const db = await loadDb();
  return (db.sites || []).find(s => s.isDefault) || (db.sites && db.sites[0]) || null;
}

function filterBatchesBySite(batches, siteId, defaultSiteId) {
  if (!siteId) return batches;
  if (siteId === "all") return batches;
  return batches.filter(b => (b.siteId || defaultSiteId) === siteId);
}

async function createSite(input, ctx = {}) {
  return mutate({
    operation: OPERATION.SITE_CREATE,
    entityType: "site",
    entityId: input.id,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      if (!db.sites) db.sites = [];
      if (db.sites.some(s => s.id === input.id)) {
        return { error: "site_already_exists", id: input.id };
      }
      const site = {
        id: input.id,
        name: input.name || input.id,
        code: input.code || input.id,
        address: input.address || "",
        isDefault: input.isDefault === true,
        disabled: false,
        createdAt: new Date().toISOString()
      };
      if (site.isDefault) {
        for (const s of db.sites) s.isDefault = false;
      }
      if (db.sites.length === 0) site.isDefault = true;
      db.sites.push(site);
      return {
        details: { site: clone(site) },
        site
      };
    }
  });
}

async function updateSite(siteId, input, ctx = {}) {
  return mutate({
    operation: OPERATION.SITE_UPDATE,
    entityType: "site",
    entityId: siteId,
    operator: ctx.operator,
    source: ctx.source,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      if (!db.sites) db.sites = [];
      const site = db.sites.find(s => s.id === siteId);
      if (!site) {
        return { error: "site_not_found" };
      }

      if (input.disabled === true && site.isDefault) {
        return { error: "default_site_cannot_disable", message: "默认站点不能被停用" };
      }

      const before = clone(site);

      if (input.name !== undefined) site.name = input.name;
      if (input.code !== undefined) site.code = input.code;
      if (input.address !== undefined) site.address = input.address;
      if (input.disabled !== undefined) site.disabled = input.disabled === true;

      if (input.isDefault === true && !site.isDefault) {
        for (const s of db.sites) s.isDefault = false;
        site.isDefault = true;
      }

      return {
        details: {
          siteBefore: before,
          siteAfter: clone(site)
        },
        site
      };
    }
  });
}

function isSiteDisabled(site) {
  return !!(site && site.disabled);
}

async function listLocSites() {
  const locDb = await loadLocDb();
  return locDb.sites || [];
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
  LOCATION_SLOT_ASSIGN: "location_slot_assign",
  SITE_CREATE: "site_create",
  SITE_UPDATE: "site_update"
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
    locResult = await locMutator(locDb, result);
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

  let finalResult;
  if (locResult) {
    finalResult = { ...locResult, _auditId: entry.id };
    if (result && result.createdBatchIds) {
      finalResult.createdBatchIds = result.createdBatchIds;
    }
    delete finalResult.details;
    delete finalResult.error;
  } else {
    finalResult = { ...(result || {}), _auditId: entry.id };
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
  locSeed,
  DEFAULT_SITE_ID,
  getDefaultSiteId,
  listSites,
  getSite,
  getDefaultSite,
  filterBatchesBySite,
  createSite,
  updateSite,
  isSiteDisabled,
  listLocSites
};
