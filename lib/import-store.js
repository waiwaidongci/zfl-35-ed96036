import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  mutate,
  OPERATION,
  clone,
  getDefaultSiteId,
  listSites,
  isSiteDisabled,
  loadDbWithVersion,
  loadLocDbWithVersion,
  loadAuditWithVersion,
  computeBatchDigest,
  computeDataFingerprint,
  getCurrentVersions
} from "./data-store.js";
import { ensureLineageFields } from "./batch-lineage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");

async function loadDbRaw() {
  if (!existsSync(dbPath)) return { batches: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

const pendingImports = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;

function cleanupExpired() {
  const now = Date.now();
  for (const [token, session] of pendingImports) {
    if (now - session.createdAt > PREVIEW_TTL_MS) {
      pendingImports.delete(token);
    }
  }
}

async function generateFingerprint() {
  const versions = await getCurrentVersions();
  return {
    fingerprint: versions.fingerprint,
    dataVersion: versions.dataVersion,
    locVersion: versions.locVersion,
    auditVersion: versions.auditVersion,
    batchDigest: versions.batchDigest
  };
}

async function generateBatchDigestForImport(batches) {
  return await computeBatchDigest(batches);
}

const REQUIRED_FIELDS = ["id", "species", "quantity"];
const MAX_QUANTITY = 10_000_000;
const VALID_VIABILITY = ["high", "medium", "low", "unknown"];

function validateRow(row, index, existingIds, idsInImport, sitesMap, defaultSiteId, defaultSiteName) {
  const errors = [];
  const warnings = [];
  let resolvedSiteId = null;
  let siteAttribution = null;

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { index, errors: [{ code: "invalid_row_format", message: "行数据必须为JSON对象" }], warnings: [], row: null, resolvedSiteId: null, siteAttribution: null };
  }

  for (const field of REQUIRED_FIELDS) {
    if (row[field] === undefined || row[field] === null || row[field] === "") {
      errors.push({ code: "missing_required_field", field, message: `缺少必填字段: ${field}` });
    }
  }

  if (row.id !== undefined && row.id !== null) {
    if (typeof row.id !== "string" || row.id.trim() === "") {
      errors.push({ code: "invalid_field_type", field: "id", message: "id 必须为非空字符串" });
    } else {
      if (existingIds.has(row.id)) {
        errors.push({ code: "duplicate_id_existing", field: "id", message: `批次号 ${row.id} 已存在于系统中` });
      }
      const occurrences = idsInImport.filter(x => x === row.id).length;
      if (occurrences > 1) {
        errors.push({ code: "duplicate_id_in_import", field: "id", message: `批次号 ${row.id} 在导入列表中重复出现 ${occurrences} 次` });
      }
    }
  }

  if (row.siteId !== undefined && row.siteId !== null && row.siteId !== "") {
    if (typeof row.siteId !== "string") {
      errors.push({ code: "invalid_field_type", field: "siteId", message: "siteId 必须为字符串" });
    } else if (!sitesMap.has(row.siteId)) {
      errors.push({ code: "site_not_found", field: "siteId", message: `站点 ${row.siteId} 不存在于系统中` });
    } else {
      const site = sitesMap.get(row.siteId);
      if (isSiteDisabled(site)) {
        errors.push({ code: "site_disabled", field: "siteId", message: `站点 ${site.name} (${row.siteId}) 已停用，无法导入批次到该站点` });
      } else {
        resolvedSiteId = row.siteId;
        siteAttribution = "explicit";
      }
    }
  } else {
    const defaultSite = sitesMap.get(defaultSiteId);
    if (isSiteDisabled(defaultSite)) {
      errors.push({ code: "default_site_disabled", field: "siteId", message: `默认站点 ${defaultSiteName} (${defaultSiteId}) 已停用，无法使用默认站点，请显式指定有效的 siteId` });
    } else {
      resolvedSiteId = defaultSiteId;
      siteAttribution = "defaulted";
      warnings.push({ code: "site_defaulted", field: "siteId", message: `未指定 siteId，将默认归属 ${defaultSiteName} (${defaultSiteId})` });
    }
  }

  if (row.quantity !== undefined && row.quantity !== null) {
    const qty = Number(row.quantity);
    if (isNaN(qty)) {
      errors.push({ code: "invalid_field_type", field: "quantity", message: "quantity 必须为数字" });
    } else if (!Number.isInteger(qty)) {
      warnings.push({ code: "non_integer_quantity", field: "quantity", message: `数量 ${qty} 不是整数，将被截断` });
    } else if (qty <= 0) {
      errors.push({ code: "quantity_not_positive", field: "quantity", message: "quantity 必须大于0" });
    } else if (qty > MAX_QUANTITY) {
      errors.push({ code: "quantity_too_large", field: "quantity", message: `quantity 超过最大值 ${MAX_QUANTITY}` });
    }
  }

  if (row.species !== undefined && row.species !== null && typeof row.species !== "string") {
    errors.push({ code: "invalid_field_type", field: "species", message: "species 必须为字符串" });
  }

  if (row.viability !== undefined && row.viability !== null) {
    if (!VALID_VIABILITY.includes(row.viability)) {
      warnings.push({ code: "invalid_viability", field: "viability", message: `viability 值 "${row.viability}" 不合法，将为设为 "unknown"` });
    }
  }

  if (row.container !== undefined && row.container !== null && typeof row.container !== "string") {
    warnings.push({ code: "invalid_field_type", field: "container", message: "container 应为字符串" });
  }

  if (row.section !== undefined && row.section !== null && typeof row.section !== "string") {
    warnings.push({ code: "invalid_field_type", field: "section", message: "section 应为字符串" });
  }

  return { index, errors, warnings, row, resolvedSiteId, siteAttribution };
}

export async function previewImport(rows) {
  cleanupExpired();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "invalid_input", message: "请提供非空的批次数组" };
  }

  if (rows.length > 1000) {
    return { error: "too_many_rows", message: "单次导入不超过1000条", count: rows.length };
  }

  const dbResult = await loadDbWithVersion();
  const db = dbResult.data;
  const sites = await listSites();
  const sitesMap = new Map(sites.map(s => [s.id, s]));
  const defaultSite = sites.find(s => s.isDefault) || sites[0];
  const defaultSiteId = defaultSite ? defaultSite.id : getDefaultSiteId(db);
  const defaultSiteName = defaultSite ? defaultSite.name : "默认站点";

  const existingIds = new Set(db.batches.map(b => b.id));
  const idsInImport = rows.map(r => r && r.id).filter(Boolean);

  const fpResult = await generateFingerprint();
  const fingerprint = fpResult.fingerprint;

  const validationResults = rows.map((row, i) => validateRow(row, i, existingIds, idsInImport, sitesMap, defaultSiteId, defaultSiteName));

  const duplicateIds = [];
  const seenIds = new Map();
  for (const id of idsInImport) {
    if (seenIds.has(id)) {
      seenIds.set(id, seenIds.get(id) + 1);
    } else {
      seenIds.set(id, 1);
    }
  }
  for (const [id, count] of seenIds) {
    if (count > 1) {
      duplicateIds.push({ id, count });
    }
  }

  const duplicateExistingIds = idsInImport.filter(id => existingIds.has(id));
  const uniqueDuplicateExisting = [...new Set(duplicateExistingIds)];

  const quantityAnomalies = [];
  const invalidSites = [];
  for (const result of validationResults) {
    if (result.errors.some(e => e.code === "quantity_not_positive") || result.errors.some(e => e.code === "quantity_too_large")) {
      quantityAnomalies.push({
        index: result.index,
        id: result.row ? result.row.id : null,
        quantity: result.row ? result.row.quantity : null,
        issues: result.errors.filter(e => e.code === "quantity_not_positive" || e.code === "quantity_too_large")
      });
    }
    if (result.errors.some(e => ["site_not_found", "site_disabled", "default_site_disabled"].includes(e.code))) {
      invalidSites.push({
        index: result.index,
        id: result.row ? result.row.id : null,
        siteId: result.row ? result.row.siteId : null,
        issues: result.errors.filter(e => ["site_not_found", "site_disabled", "default_site_disabled"].includes(e.code))
      });
    }
  }

  const importableResults = validationResults.filter(r => r.errors.length === 0);
  const invalidResults = validationResults.filter(r => r.errors.length > 0);

  const siteSummary = {};
  for (const result of importableResults) {
    const sid = result.resolvedSiteId;
    if (!siteSummary[sid]) {
      const site = sites.find(s => s.id === sid);
      siteSummary[sid] = {
        siteId: sid,
        siteName: site ? site.name : sid,
        count: 0,
        totalQuantity: 0,
        defaultedCount: 0,
        explicitCount: 0
      };
    }
    siteSummary[sid].count += 1;
    siteSummary[sid].totalQuantity += Number(result.row.quantity) || 0;
    if (result.siteAttribution === "defaulted") {
      siteSummary[sid].defaultedCount += 1;
    } else {
      siteSummary[sid].explicitCount += 1;
    }
  }

  const siteIdsInImport = Object.keys(siteSummary);
  const hasCrossSite = siteIdsInImport.length > 1;
  const defaultedRowCount = importableResults.filter(r => r.siteAttribution === "defaulted").length;

  const previewToken = `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const importableRows = importableResults.map(r => ({
    index: r.index,
    id: r.row.id,
    species: r.row.species,
    quantity: Number(r.row.quantity),
    siteId: r.resolvedSiteId,
    siteAttribution: r.siteAttribution,
    warnings: r.warnings
  }));

  const importableDataWithSiteId = importableResults.map(r => ({
    ...r.row,
    siteId: r.resolvedSiteId
  }));

  const session = {
    token: previewToken,
    createdAt: Date.now(),
    fingerprint,
    versions: {
      dataVersion: fpResult.dataVersion,
      locVersion: fpResult.locVersion,
      auditVersion: fpResult.auditVersion,
      batchDigest: fpResult.batchDigest
    },
    importableData: importableDataWithSiteId,
    totalRows: rows.length,
    importableCount: importableResults.length,
    invalidCount: invalidResults.length
  };

  pendingImports.set(previewToken, session);

  return {
    previewToken,
    fingerprint,
    versions: session.versions,
    totalRows: rows.length,
    importableCount: importableResults.length,
    invalidCount: invalidResults.length,
    importableRows,
    duplicateIds,
    duplicateExistingIds: uniqueDuplicateExisting,
    quantityAnomalies,
    invalidSites,
    siteSummary,
    crossSite: hasCrossSite,
    siteIds: siteIdsInImport,
    defaultedRowCount,
    defaultSite: {
      siteId: defaultSiteId,
      siteName: defaultSiteName
    },
    validationResults: validationResults.map(r => ({
      index: r.index,
      id: r.row ? r.row.id : null,
      valid: r.errors.length === 0,
      siteId: r.resolvedSiteId,
      siteAttribution: r.siteAttribution,
      errors: r.errors,
      warnings: r.warnings
    }))
  };
}

export async function confirmImport(token, options, ctx = {}) {
  cleanupExpired();

  if (!token || typeof token !== "string") {
    return { error: "invalid_token", message: "无效的预览令牌" };
  }

  const session = pendingImports.get(token);
  if (!session) {
    return { error: "token_not_found", message: "预览令牌不存在或已过期，请重新预览" };
  }

  if (Date.now() - session.createdAt > PREVIEW_TTL_MS) {
    pendingImports.delete(token);
    return { error: "token_expired", message: "预览令牌已过期，请重新预览" };
  }

  const currentVersions = await getCurrentVersions();
  const currentFingerprint = currentVersions.fingerprint;

  if (currentFingerprint !== session.fingerprint) {
    pendingImports.delete(token);
    return {
      error: "version_conflict",
      message: "预览后数据已发生变化，请重新预览以获取最新校验结果",
      retryable: true,
      expectedFingerprint: session.fingerprint,
      currentFingerprint,
      expectedVersions: session.versions,
      currentVersions: {
        dataVersion: currentVersions.dataVersion,
        locVersion: currentVersions.locVersion,
        auditVersion: currentVersions.auditVersion,
        batchDigest: currentVersions.batchDigest
      }
    };
  }

  if (session.importableCount === 0) {
    pendingImports.delete(token);
    return { error: "no_importable_rows", message: "没有可导入的行" };
  }

  const dbPreCheck = await loadDbWithVersion();
  const existingIdsPre = new Set(dbPreCheck.data.batches.map(b => b.id));
  const recheckConflicts = session.importableData.filter(row => existingIdsPre.has(row.id));
  if (recheckConflicts.length > 0) {
    pendingImports.delete(token);
    return {
      error: "version_conflict",
      message: "确认时发现新的批次号冲突，请重新预览",
      retryable: true,
      conflictIds: recheckConflicts.map(r => r.id),
      currentVersions: {
        dataVersion: currentVersions.dataVersion,
        locVersion: currentVersions.locVersion,
        auditVersion: currentVersions.auditVersion
      }
    };
  }

  const rowsToImport = session.importableData;

  return mutate({
    operation: OPERATION.IMPORT_BATCHES,
    entityType: "batch",
    entityId: null,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions || session.versions,
    affectedBatchIds: [],
    details: {
      previewToken: token,
      previewFingerprint: session.fingerprint,
      previewVersions: session.versions
    },
    mutator: (db) => {
      const existingIds = new Set(db.batches.map(b => b.id));
      const importOnlyValid = options && options.importOnlyValid !== false;
      const actualRows = importOnlyValid ? rowsToImport : rowsToImport;
      const defaultSiteId = getDefaultSiteId(db);

      for (const row of actualRows) {
        const rowSiteId = row.siteId || defaultSiteId;
        const targetSite = (db.sites || []).find(s => s.id === rowSiteId);
        if (isSiteDisabled(targetSite)) {
          return { error: "site_disabled", message: `站点 ${targetSite ? targetSite.name : rowSiteId} 已停用，无法导入批次到该站点`, siteId: rowSiteId, rowId: row.id };
        }
      }

      const createdBatches = [];
      const transactions = [];

      for (const row of actualRows) {
        const qty = Math.floor(Number(row.quantity));

        if (existingIds.has(row.id)) {
          continue;
        }

        const batch = {
          id: row.id,
          siteId: row.siteId || defaultSiteId,
          species: row.species,
          collectionPlace: row.collectionPlace || "",
          motherPlant: row.motherPlant || "",
          container: row.container || "",
          section: row.section || "",
          viability: VALID_VIABILITY.includes(row.viability) ? row.viability : "unknown",
          quantity: qty,
          status: "active",
          lineage: {
            splitFrom: null,
            splitTo: [],
            mergedFrom: [],
            mergedInto: null
          },
          temperatures: [],
          transactions: [],
          germinations: [],
          frozenQuantity: 0,
          reservations: [],
          remark: row.remark || `批次导入，导入令牌 ${token}`,
          reviews: [],
          anomalies: []
        };

        ensureLineageFields(batch);

        const tx = {
          id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          at: new Date().toISOString(),
          type: "collect",
          quantity: qty,
          balance: qty,
          note: `批次导入入库`
        };
        batch.transactions.push(tx);

        db.batches.push(batch);
        existingIds.add(row.id);
        createdBatches.push(batch);
        transactions.push(tx);
      }

      pendingImports.delete(token);

      return {
        createdBatchIds: createdBatches.map(b => b.id),
        details: {
          createdBatches: createdBatches.map(b => clone(b)),
          previewToken: token,
          previewFingerprint: session.fingerprint
        },
        imported: createdBatches.length,
        totalRows: session.totalRows,
        importableCount: session.importableCount,
        invalidCount: session.invalidCount,
        batches: createdBatches.map(b => ({
          id: b.id,
          siteId: b.siteId,
          species: b.species,
          quantity: b.quantity,
          container: b.container,
          section: b.section,
          viability: b.viability
        })),
        transactions: transactions.map(tx => ({
          id: tx.id,
          type: tx.type,
          quantity: tx.quantity,
          balance: tx.balance
        }))
      };
    }
  });
}

export function getPendingImportCount() {
  cleanupExpired();
  return pendingImports.size;
}
