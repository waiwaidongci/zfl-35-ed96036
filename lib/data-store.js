import { mkdir, readFile, writeFile, rename, unlink, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");
const auditPath = join(__dirname, "..", "data", "audit-logs.json");
const locPath = join(__dirname, "..", "data", "locations.json");

const DEFAULT_SITE_ID = "SITE-001";

let lockTail = Promise.resolve();

async function acquireLock() {
  let release;
  const previous = lockTail;
  lockTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

function wrapWithMetadata(data, type, version = 1) {
  return {
    _version: version,
    _updatedAt: new Date().toISOString(),
    _dataType: type,
    data
  };
}

function unwrapMetadata(wrapped) {
  if (!wrapped) return { data: wrapped, version: 0 };
  if (wrapped._version !== undefined && wrapped.data !== undefined) {
    return {
      data: wrapped.data,
      version: wrapped._version,
      updatedAt: wrapped._updatedAt
    };
  }
  return { data: wrapped, version: 0, updatedAt: null };
}

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
    if (site.temperatureThreshold === undefined) {
      site.temperatureThreshold = null;
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

async function atomicWriteJson(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tempPath, JSON.stringify(data, null, 2));
    await rename(tempPath, filePath);
    return true;
  } catch (e) {
    try {
      await unlink(tempPath).catch(() => {});
    } catch (_) {}
    throw e;
  }
}

async function backupFile(filePath) {
  if (!existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak.${Date.now()}`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

async function restoreFromBackup(filePath, backupPath) {
  if (!backupPath || !existsSync(backupPath)) return false;
  try {
    await copyFile(backupPath, filePath);
    await unlink(backupPath).catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

async function cleanBackup(backupPath) {
  if (!backupPath) return;
  try {
    if (existsSync(backupPath)) {
      await unlink(backupPath);
    }
  } catch (_) {}
}

async function readJsonWithVersion(filePath, defaultData, dataType) {
  if (!existsSync(filePath)) {
    await mkdir(dirname(filePath), { recursive: true });
    const wrapped = wrapWithMetadata(defaultData, dataType, 1);
    await atomicWriteJson(filePath, wrapped);
    return { data: clone(defaultData), version: 1, updatedAt: wrapped._updatedAt, wrapped };
  }
  const raw = await readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const wrapped = wrapWithMetadata(defaultData, dataType, 1);
    await atomicWriteJson(filePath, wrapped);
    return { data: clone(defaultData), version: 1, updatedAt: wrapped._updatedAt, wrapped };
  }

  const { data, version, updatedAt } = unwrapMetadata(parsed);
  let needsMigration = false;
  let finalData = data;

  if (dataType === "rare-seeds") {
    if (!data.batches) {
      finalData = { batches: [], ...data };
      needsMigration = true;
    }
    const changed = migrateLegacyData(finalData);
    if (changed) needsMigration = true;
  }

  if (needsMigration || version === 0) {
    const newVersion = Math.max(version, 0) + 1;
    const wrapped = wrapWithMetadata(finalData, dataType, newVersion);
    await atomicWriteJson(filePath, wrapped);
    return { data: finalData, version: newVersion, updatedAt: wrapped._updatedAt, wrapped };
  }

  return { data: finalData, version, updatedAt, wrapped: parsed };
}

async function loadDb() {
  const result = await readJsonWithVersion(dbPath, seed, "rare-seeds");
  return result.data;
}

async function loadDbWithVersion() {
  return readJsonWithVersion(dbPath, seed, "rare-seeds");
}

async function saveDb(db, expectedVersion = null) {
  return saveDbWithVersion(db, expectedVersion);
}

async function _saveDbWithVersionInternal(db, expectedVersion = null) {
  const current = await readJsonWithVersion(dbPath, seed, "rare-seeds");
  if (expectedVersion !== null && current.version !== expectedVersion) {
    return {
      error: "version_conflict",
      message: "rare-seeds 数据版本不匹配，数据已被其他操作修改，请重试",
      expectedVersion,
      currentVersion: current.version,
      dataType: "rare-seeds",
      retryable: true
    };
  }
  const wrapped = wrapWithMetadata(db, "rare-seeds", current.version + 1);
  await atomicWriteJson(dbPath, wrapped);
  return { success: true, newVersion: current.version + 1 };
}

async function saveDbWithVersion(db, expectedVersion = null) {
  await acquireLock();
  try {
    return await _saveDbWithVersionInternal(db, expectedVersion);
  } finally {
    releaseLock();
  }
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
    if (section.temperatureThreshold === undefined) {
      section.temperatureThreshold = null;
      changed = true;
    }
  }

  return changed;
}

async function loadLocDb() {
  const result = await loadLocDbWithVersion();
  return result.data;
}

async function loadLocDbWithVersion() {
  const result = await readJsonWithVersion(locPath, locSeed, "locations");
  let needsMigration = false;
  const changed = ensureLocDefaults(result.data);
  if (changed) needsMigration = true;

  if (needsMigration) {
    const saveResult = await saveLocDbWithVersion(result.data, result.version);
    if (saveResult.success) {
      return { data: result.data, version: saveResult.newVersion, updatedAt: new Date().toISOString() };
    }
  }
  return result;
}

async function saveLocDb(locDb, expectedVersion = null) {
  return saveLocDbWithVersion(locDb, expectedVersion);
}

async function _saveLocDbWithVersionInternal(locDb, expectedVersion = null) {
  const current = await readJsonWithVersion(locPath, locSeed, "locations");
  if (expectedVersion !== null && current.version !== expectedVersion) {
    return {
      error: "version_conflict",
      message: "locations 数据版本不匹配，数据已被其他操作修改，请重试",
      expectedVersion,
      currentVersion: current.version,
      dataType: "locations",
      retryable: true
    };
  }
  const wrapped = wrapWithMetadata(locDb, "locations", current.version + 1);
  await atomicWriteJson(locPath, wrapped);
  return { success: true, newVersion: current.version + 1 };
}

async function saveLocDbWithVersion(locDb, expectedVersion = null) {
  await acquireLock();
  try {
    return await _saveLocDbWithVersionInternal(locDb, expectedVersion);
  } finally {
    releaseLock();
  }
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
    inTransitQuantity: batch.inTransitQuantity,
    remark: batch.remark,
    transactionsCount: (batch.transactions || []).length,
    temperaturesCount: (batch.temperatures || []).length,
    germinationsCount: (batch.germinations || []).length,
    reviewsCount: (batch.reviews || []).length,
    reservationsCount: (batch.reservations || []).length,
    anomaliesCount: (batch.anomalies || []).length
  };
}

async function computeBatchDigest(batches) {
  let targetBatches = batches;
  if (!targetBatches) {
    const db = await loadDb();
    targetBatches = db.batches || [];
  }
  if (!targetBatches || targetBatches.length === 0) return "";
  const data = targetBatches
    .filter(b => b.status !== "merged_closed")
    .map(b => `${b.id}:${b.quantity}:${b.status}:${b.frozenQuantity || 0}:${(b.transactions || []).length}`)
    .sort()
    .join("|");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

async function computeDataFingerprint(params) {
  let dataVersion, locVersion, auditVersion, batchDigest;
  if (params) {
    ({ dataVersion, locVersion, auditVersion, batchDigest } = params);
  }
  if (dataVersion === undefined || locVersion === undefined || auditVersion === undefined || batchDigest === undefined) {
    const versions = await getCurrentVersions();
    dataVersion = dataVersion ?? versions.dataVersion;
    locVersion = locVersion ?? versions.locVersion;
    auditVersion = auditVersion ?? versions.auditVersion;
    batchDigest = batchDigest ?? versions.batchDigest;
  }
  const parts = [
    `v:${dataVersion || 0}`,
    `l:${locVersion || 0}`,
    `a:${auditVersion || 0}`,
    `b:${batchDigest || ""}`
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
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
    expectedVersions: ctx.expectedVersions,
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
    expectedVersions: ctx.expectedVersions,
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
  TRANSFER_CREATE: "transfer_create",
  TRANSFER_SHIP: "transfer_ship",
  TRANSFER_RECEIVE: "transfer_receive",
  TRANSFER_CANCEL: "transfer_cancel",
  ANOMALY_SCAN: "anomaly_scan",
  ANOMALY_HANDLE: "anomaly_handle",
  IMPORT_BATCHES: "import_batches",
  LOCATION_SECTION_CREATE: "location_section_create",
  LOCATION_BOX_ADD: "location_box_add",
  LOCATION_SLOT_ASSIGN: "location_slot_assign",
  SITE_CREATE: "site_create",
  SITE_UPDATE: "site_update",
  TEMPERATURE_THRESHOLD_SITE_UPDATE: "temperature_threshold_site_update",
  TEMPERATURE_THRESHOLD_SECTION_UPDATE: "temperature_threshold_section_update",
  VERSION_CONFLICT: "version_conflict",
  TRANSACTION_ROLLBACK: "transaction_rollback"
};

async function loadAudit() {
  const result = await loadAuditWithVersion();
  return result.data;
}

async function loadAuditWithVersion() {
  return readJsonWithVersion(auditPath, { logs: [] }, "audit-logs");
}

async function saveAudit(audit, expectedVersion = null) {
  return saveAuditWithVersion(audit, expectedVersion);
}

async function _saveAuditWithVersionInternal(audit, expectedVersion = null) {
  const current = await readJsonWithVersion(auditPath, { logs: [] }, "audit-logs");
  if (expectedVersion !== null && current.version !== expectedVersion) {
    return {
      error: "version_conflict",
      message: "audit-logs 数据版本不匹配，数据已被其他操作修改，请重试",
      expectedVersion,
      currentVersion: current.version,
      dataType: "audit-logs",
      retryable: true
    };
  }
  const wrapped = wrapWithMetadata(audit, "audit-logs", current.version + 1);
  await atomicWriteJson(auditPath, wrapped);
  return { success: true, newVersion: current.version + 1 };
}

async function saveAuditWithVersion(audit, expectedVersion = null) {
  await acquireLock();
  try {
    return await _saveAuditWithVersionInternal(audit, expectedVersion);
  } finally {
    releaseLock();
  }
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

function parseVersionValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeExpectedVersions(input = {}) {
  const source = input.expectedVersions && typeof input.expectedVersions === "object"
    ? input.expectedVersions
    : input;
  const expectedVersions = {};
  const dataVersion = parseVersionValue(source.dataVersion ?? source.rareSeedsVersion ?? source.version);
  const locVersion = parseVersionValue(source.locVersion ?? source.locationsVersion);
  const auditVersion = parseVersionValue(source.auditVersion ?? source.auditLogsVersion);
  if (dataVersion !== null) expectedVersions.dataVersion = dataVersion;
  if (locVersion !== null) expectedVersions.locVersion = locVersion;
  if (auditVersion !== null) expectedVersions.auditVersion = auditVersion;
  return expectedVersions;
}

function getExpectedVersionsFromRequest(req, input = {}) {
  const headers = (req && req.headers) || {};
  let headerVersions = {};
  if (headers["x-expected-versions"]) {
    try {
      headerVersions = JSON.parse(headers["x-expected-versions"]);
    } catch (_) {
      headerVersions = {};
    }
  }
  const directHeaders = {
    dataVersion: headers["x-data-version"],
    locVersion: headers["x-loc-version"],
    auditVersion: headers["x-audit-version"]
  };
  return {
    ...normalizeExpectedVersions(input),
    ...normalizeExpectedVersions(headerVersions),
    ...normalizeExpectedVersions(directHeaders)
  };
}

function validateExpectedVersions(expectedVersions = {}, currentVersions = {}, needsLoc = false) {
  const checks = [
    ["dataVersion", "rare-seeds", currentVersions.dataVersion],
    ["auditVersion", "audit-logs", currentVersions.auditVersion]
  ];
  if (needsLoc) checks.push(["locVersion", "locations", currentVersions.locVersion]);
  for (const [key, dataType, currentVersion] of checks) {
    if (expectedVersions[key] !== undefined && expectedVersions[key] !== currentVersion) {
      return {
        error: "version_conflict",
        message: `${dataType} 数据版本不匹配，数据已被其他操作修改，请重试`,
        dataType,
        expectedVersion: expectedVersions[key],
        currentVersion,
        retryable: true
      };
    }
  }
  return null;
}

function buildVersionConflictAuditEntry({
  operator,
  source,
  operation,
  entityType,
  entityId,
  affectedBatchIds,
  details,
  beforeVersions,
  conflict
}) {
  return {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    operator: operator || getDefaultOperator(),
    source: source || getRequestContext(null),
    operation: OPERATION.VERSION_CONFLICT,
    entityType,
    entityId,
    affectedBatches: [...(affectedBatchIds || [])],
    changes: {
      before: beforeVersions,
      after: null
    },
    details: {
      conflictType: "version_mismatch",
      originalOperation: operation,
      originalDetails: clone(details || {}),
      conflict: clone(conflict)
    }
  };
}

async function _writeFileInternal(filePath, data, expectedVersion, defaultData, dataType) {
  const current = await readJsonWithVersion(filePath, defaultData, dataType);
  if (expectedVersion !== null && current.version !== expectedVersion) {
    return {
      error: "version_conflict",
      message: `${dataType} 数据版本不匹配，数据已被其他操作修改，请重试`,
      expectedVersion,
      currentVersion: current.version,
      dataType,
      retryable: true
    };
  }
  const wrapped = wrapWithMetadata(data, dataType, current.version + 1);
  await atomicWriteJson(filePath, wrapped);
  return { success: true, newVersion: current.version + 1 };
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
    expectedVersions = {},
    mutator,
    locMutator
  } = options;

  const releaseLock = await acquireLock();

  const backups = {};

  try {
    const dbResult = await loadDbWithVersion();
    const auditResult = await loadAuditWithVersion();
    let locResult = null;
    if (locMutator) {
      locResult = await loadLocDbWithVersion();
    }

    const db = dbResult.data;
    const audit = auditResult.data;
    let locDb = locResult ? locResult.data : null;

    const beforeDb = clone(db);
    const beforeAudit = clone(audit);
    const beforeLocDb = locResult ? clone(locDb) : null;

    const beforeVersions = {
      dataVersion: dbResult.version,
      locVersion: locResult ? locResult.version : null,
      auditVersion: auditResult.version
    };

    const versionConflict = validateExpectedVersions(expectedVersions, beforeVersions, !!locMutator);
    if (versionConflict) {
      const conflictAuditEntry = buildVersionConflictAuditEntry({
        operator,
        source,
        operation,
        entityType,
        entityId,
        affectedBatchIds,
        details,
        beforeVersions,
        conflict: versionConflict
      });
      audit.logs.push(conflictAuditEntry);
      await _saveAuditWithVersionInternal(audit, beforeVersions.auditVersion);
      return versionConflict;
    }

    const result = await mutator(db);
    if (result && result.error) {
      const conflictAuditEntry = {
        id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        operator: operator || getDefaultOperator(),
        source: source || getRequestContext(null),
        operation: OPERATION.VERSION_CONFLICT,
        entityType,
        entityId,
        affectedBatches: [...affectedBatchIds],
        changes: {
          before: beforeVersions,
          after: null
        },
        details: {
          conflictType: "mutator_error",
          originalOperation: operation,
          originalDetails: clone(details),
          mutatorError: clone(result)
        }
      };
      audit.logs.push(conflictAuditEntry);
      await _saveAuditWithVersionInternal(audit, auditResult.version);
      return result;
    }

    let locMutatorResult = null;
    if (locMutator && locDb) {
      locMutatorResult = await locMutator(locDb, result, db);
      if (locMutatorResult && locMutatorResult.error) {
        const conflictAuditEntry = {
          id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          operator: operator || getDefaultOperator(),
          source: source || getRequestContext(null),
          operation: OPERATION.VERSION_CONFLICT,
          entityType,
          entityId,
          affectedBatches: [...affectedBatchIds],
          changes: {
            before: beforeVersions,
            after: null
          },
          details: {
            conflictType: "locMutator_error",
            originalOperation: operation,
            originalDetails: clone(details),
            locMutatorError: clone(locMutatorResult)
          }
        };
        audit.logs.push(conflictAuditEntry);
        await _saveAuditWithVersionInternal(audit, auditResult.version);
        return locMutatorResult;
      }
    }

    const finalAffectedIds = new Set([...affectedBatchIds]);
    if (result && result.additionalAffectedBatchIds) {
      for (const id of result.additionalAffectedBatchIds) finalAffectedIds.add(id);
    }
    if (locMutatorResult && locMutatorResult.additionalAffectedBatchIds) {
      for (const id of locMutatorResult.additionalAffectedBatchIds) finalAffectedIds.add(id);
    }
    const resolvedAffectedIds = [...finalAffectedIds];

    const beforeSnapshots = {};
    for (const id of resolvedAffectedIds) {
      const batch = beforeDb.batches.find(b => b.id === id);
      if (batch) {
        beforeSnapshots[id] = extractBatchKeyFields(clone(batch));
      }
    }

    const afterSnapshots = {};
    for (const id of resolvedAffectedIds) {
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
    if (locMutatorResult && locMutatorResult.details) {
      Object.assign(mergedDetails, locMutatorResult.details);
    }

    const resolvedEntityId = (result && result.entityIdOverride) !== undefined ? result.entityIdOverride : entityId;

    const afterVersions = { ...beforeVersions };

    const entry = {
      id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      operator: operator || getDefaultOperator(),
      source: source || getRequestContext(null),
      operation,
      entityType,
      entityId: resolvedEntityId,
      affectedBatches: [...resolvedAffectedIds, ...(result && result.createdBatchIds ? result.createdBatchIds : [])],
      changes: {
        before: beforeSnapshots,
        after: afterSnapshots
      },
      details: mergedDetails,
      versions: {
        before: beforeVersions,
        after: afterVersions
      }
    };
    audit.logs.push(entry);

    const committed = [];

    try {
      backups.db = await backupFile(dbPath);
      const dbSave = await _writeFileInternal(dbPath, db, beforeVersions.dataVersion, seed, "rare-seeds");
      if (dbSave.error) throw dbSave;
      afterVersions.dataVersion = dbSave.newVersion;
      committed.push("rare-seeds");

      if (locMutator && locDb) {
        backups.loc = await backupFile(locPath);
        const locSave = await _writeFileInternal(locPath, locDb, beforeVersions.locVersion, locSeed, "locations");
        if (locSave.error) throw locSave;
        afterVersions.locVersion = locSave.newVersion;
        committed.push("locations");
      }

      backups.audit = await backupFile(auditPath);
      const auditSave = await _writeFileInternal(auditPath, audit, beforeVersions.auditVersion, { logs: [] }, "audit-logs");
      if (auditSave.error) throw auditSave;
      afterVersions.auditVersion = auditSave.newVersion;
      committed.push("audit-logs");

    } catch (writeError) {
      const rollbackAuditEntry = {
        id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        operator: operator || getDefaultOperator(),
        source: source || getRequestContext(null),
        operation: OPERATION.TRANSACTION_ROLLBACK,
        entityType,
        entityId: resolvedEntityId,
        affectedBatches: [...resolvedAffectedIds, ...(result && result.createdBatchIds ? result.createdBatchIds : [])],
        changes: {
          before: beforeVersions,
          after: null
        },
        details: {
          originalOperation: operation,
          committedFiles: committed,
          writeError: writeError.message || writeError.error || JSON.stringify(writeError),
          errorDetails: clone(writeError)
        }
      };

      const restoreErrors = [];
      for (let i = committed.length - 1; i >= 0; i--) {
        const file = committed[i];
        let backupPath, targetPath, defaultData, dataType;
        if (file === "rare-seeds") {
          backupPath = backups.db;
          targetPath = dbPath;
          defaultData = beforeDb;
          dataType = "rare-seeds";
        } else if (file === "locations") {
          backupPath = backups.loc;
          targetPath = locPath;
          defaultData = beforeLocDb;
          dataType = "locations";
        } else if (file === "audit-logs") {
          backupPath = backups.audit;
          targetPath = auditPath;
          defaultData = beforeAudit;
          dataType = "audit-logs";
        }
        if (backupPath) {
          const restored = await restoreFromBackup(targetPath, backupPath);
          if (!restored) {
            const wrapped = wrapWithMetadata(defaultData, dataType, beforeVersions[file === "rare-seeds" ? "dataVersion" : file === "locations" ? "locVersion" : "auditVersion"]);
            try {
              await atomicWriteJson(targetPath, wrapped);
            } catch (e) {
              restoreErrors.push({ file, error: e.message });
            }
          }
        }
      }

      const rollbackAudit = clone(beforeAudit);
      rollbackAudit.logs.push(rollbackAuditEntry);
      try {
        const wrapped = wrapWithMetadata(rollbackAudit, "audit-logs", beforeVersions.auditVersion);
        await atomicWriteJson(auditPath, wrapped);
      } catch (_) {}

      await cleanBackup(backups.db);
      await cleanBackup(backups.loc);
      await cleanBackup(backups.audit);

      return {
        error: "transaction_failed",
        message: writeError.message || "事务执行失败，所有变更已回滚",
        cause: writeError.error || writeError.message || "unknown",
        failedAt: writeError.dataType || "unknown",
        details: writeError,
        retryable: true,
        rollbackDetails: {
          restoredFiles: committed,
          restoreErrors
        },
        currentVersions: beforeVersions
      };
    }

    await cleanBackup(backups.db);
    await cleanBackup(backups.loc);
    await cleanBackup(backups.audit);

    entry.versions.after = { ...afterVersions };

    let finalResult;
    if (locMutatorResult) {
      finalResult = { ...locMutatorResult, _auditId: entry.id, _versions: { ...afterVersions } };
      if (result && result.createdBatchIds) {
        finalResult.createdBatchIds = result.createdBatchIds;
      }
      delete finalResult.details;
      delete finalResult.error;
      delete finalResult.additionalAffectedBatchIds;
    } else {
      finalResult = { ...(result || {}), _auditId: entry.id, _versions: { ...afterVersions } };
      delete finalResult.additionalAffectedBatchIds;
    }
    return finalResult;

  } finally {
    releaseLock();
  }
}

async function getCurrentVersions() {
  const [db, loc, audit] = await Promise.all([
    loadDbWithVersion(),
    loadLocDbWithVersion(),
    loadAuditWithVersion()
  ]);
  const batchDigest = await computeBatchDigest(db.data.batches);
  return {
    dataVersion: db.version,
    locVersion: loc.version,
    auditVersion: audit.version,
    batchDigest,
    fingerprint: await computeDataFingerprint({
      dataVersion: db.version,
      locVersion: loc.version,
      auditVersion: audit.version,
      batchDigest
    }),
    dataUpdatedAt: db.updatedAt,
    locUpdatedAt: loc.updatedAt,
    auditUpdatedAt: audit.updatedAt
  };
}

async function listTemperatureThresholds(siteIdParam = null) {
  const db = await loadDb();
  const locDb = await loadLocDb();
  const defaultSiteId = getDefaultSiteId(db);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";

  let sites = db.sites || [];
  if (!isGlobal) {
    sites = sites.filter(s => s.id === effectiveSiteId);
  }

  let sections = locDb.sections || [];
  if (!isGlobal) {
    sections = sections.filter(s => (s.siteId || defaultSiteId) === effectiveSiteId);
  }

  const siteThresholds = sites.map(s => ({
    id: s.id,
    name: s.name,
    code: s.code,
    temperatureThreshold: s.temperatureThreshold !== undefined ? s.temperatureThreshold : null,
    type: "site"
  }));

  const sectionThresholds = sections.map(s => ({
    id: s.id,
    name: s.name,
    siteId: s.siteId || defaultSiteId,
    temperatureThreshold: s.temperatureThreshold !== undefined ? s.temperatureThreshold : null,
    type: "section"
  }));

  return {
    siteFilter: {
      siteId: isGlobal ? null : effectiveSiteId,
      applied: siteIdParam ? (isGlobal ? "all" : "specified") : "default",
      note: isGlobal
        ? "所有站点和分区的温度阈值配置"
        : siteIdParam
          ? `站点 ${effectiveSiteId} 及其分区的温度阈值配置`
          : `默认站点 ${effectiveSiteId} 及其分区的温度阈值配置`
    },
    defaultThreshold: -18,
    siteThresholds,
    sectionThresholds
  };
}

async function updateSiteTemperatureThreshold(siteId, threshold, ctx = {}) {
  return mutate({
    operation: OPERATION.TEMPERATURE_THRESHOLD_SITE_UPDATE,
    entityType: "site",
    entityId: siteId,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      if (!db.sites) db.sites = [];
      const site = db.sites.find(s => s.id === siteId);
      if (!site) {
        return { error: "site_not_found" };
      }

      if (threshold !== null && threshold !== undefined) {
        const t = Number(threshold);
        if (isNaN(t)) {
          return { error: "invalid_threshold", message: "阈值必须是有效数字" };
        }
        site.temperatureThreshold = t;
      } else {
        site.temperatureThreshold = null;
      }

      return {
        details: {
          siteId: site.id,
          thresholdBefore: site.temperatureThreshold,
          thresholdAfter: site.temperatureThreshold
        },
        siteId: site.id,
        threshold: site.temperatureThreshold
      };
    }
  });
}

async function updateSectionTemperatureThreshold(sectionId, threshold, ctx = {}) {
  return mutate({
    operation: OPERATION.TEMPERATURE_THRESHOLD_SECTION_UPDATE,
    entityType: "section",
    entityId: sectionId,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: () => ({}),
    locMutator: (locDb) => {
      const section = (locDb.sections || []).find(s => s.id === sectionId);
      if (!section) {
        return { error: "section_not_found" };
      }

      if (threshold !== null && threshold !== undefined) {
        const t = Number(threshold);
        if (isNaN(t)) {
          return { error: "invalid_threshold", message: "阈值必须是有效数字" };
        }
        section.temperatureThreshold = t;
      } else {
        section.temperatureThreshold = null;
      }

      return {
        details: {
          sectionId: section.id,
          threshold: section.temperatureThreshold
        },
        sectionId: section.id,
        threshold: section.temperatureThreshold
      };
    }
  });
}

export {
  loadDb,
  saveDb,
  loadDbWithVersion,
  saveDbWithVersion,
  loadLocDb,
  saveLocDb,
  loadLocDbWithVersion,
  saveLocDbWithVersion,
  loadAudit,
  saveAudit,
  loadAuditWithVersion,
  saveAuditWithVersion,
  getCurrentVersions,
  computeBatchDigest,
  computeDataFingerprint,
  mutate,
  recordAudit,
  extractBatchKeyFields,
  clone,
  getRequestContext,
  getExpectedVersionsFromRequest,
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
  listLocSites,
  listTemperatureThresholds,
  updateSiteTemperatureThreshold,
  updateSectionTemperatureThreshold
};
