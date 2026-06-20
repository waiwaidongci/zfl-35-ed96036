import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ensureLineageFields } from "./batch-lineage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");

async function loadDb() {
  if (!existsSync(dbPath)) return { batches: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
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

function generateFingerprint(db) {
  const data = db.batches
    .filter(b => b.status !== "merged_closed")
    .map(b => `${b.id}:${b.quantity}`)
    .sort()
    .join("|");
  return createHash("md5").update(data).digest("hex");
}

const REQUIRED_FIELDS = ["id", "species", "quantity"];
const MAX_QUANTITY = 10_000_000;
const VALID_VIABILITY = ["high", "medium", "low", "unknown"];

function validateRow(row, index, existingIds, idsInImport) {
  const errors = [];
  const warnings = [];

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { index, errors: [{ code: "invalid_row_format", message: "行数据必须为JSON对象" }], warnings: [], row: null };
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

  return { index, errors, warnings, row };
}

export async function previewImport(rows) {
  cleanupExpired();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "invalid_input", message: "请提供非空的批次数组" };
  }

  if (rows.length > 1000) {
    return { error: "too_many_rows", message: "单次导入不超过1000条", count: rows.length };
  }

  const db = await loadDb();
  const existingIds = new Set(db.batches.map(b => b.id));
  const idsInImport = rows.map(r => r && r.id).filter(Boolean);
  const fingerprint = generateFingerprint(db);

  const validationResults = rows.map((row, i) => validateRow(row, i, existingIds, idsInImport));

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
  for (const result of validationResults) {
    if (result.errors.some(e => e.code === "quantity_not_positive") || result.errors.some(e => e.code === "quantity_too_large")) {
      quantityAnomalies.push({
        index: result.index,
        id: result.row ? result.row.id : null,
        quantity: result.row ? result.row.quantity : null,
        issues: result.errors.filter(e => e.code === "quantity_not_positive" || e.code === "quantity_too_large")
      });
    }
  }

  const importableResults = validationResults.filter(r => r.errors.length === 0);
  const invalidResults = validationResults.filter(r => r.errors.length > 0);

  const previewToken = `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const importableRows = importableResults.map(r => ({
    index: r.index,
    id: r.row.id,
    species: r.row.species,
    quantity: Number(r.row.quantity),
    warnings: r.warnings
  }));

  const session = {
    token: previewToken,
    createdAt: Date.now(),
    fingerprint,
    importableData: importableResults.map(r => r.row),
    totalRows: rows.length,
    importableCount: importableResults.length,
    invalidCount: invalidResults.length
  };

  pendingImports.set(previewToken, session);

  return {
    previewToken,
    fingerprint,
    totalRows: rows.length,
    importableCount: importableResults.length,
    invalidCount: invalidResults.length,
    importableRows,
    duplicateIds,
    duplicateExistingIds: uniqueDuplicateExisting,
    quantityAnomalies,
    validationResults: validationResults.map(r => ({
      index: r.index,
      id: r.row ? r.row.id : null,
      valid: r.errors.length === 0,
      errors: r.errors,
      warnings: r.warnings
    }))
  };
}

export async function confirmImport(token, options) {
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

  const db = await loadDb();
  const currentFingerprint = generateFingerprint(db);

  if (currentFingerprint !== session.fingerprint) {
    pendingImports.delete(token);
    return { error: "data_changed_since_preview", message: "预览后数据已发生变化，请重新预览以获取最新校验结果" };
  }

  if (session.importableCount === 0) {
    pendingImports.delete(token);
    return { error: "no_importable_rows", message: "没有可导入的行" };
  }

  const existingIds = new Set(db.batches.map(b => b.id));
  const recheckConflicts = session.importableData.filter(row => existingIds.has(row.id));
  if (recheckConflicts.length > 0) {
    pendingImports.delete(token);
    return {
      error: "data_changed_since_preview",
      message: "确认时发现新的批次号冲突，请重新预览",
      conflictIds: recheckConflicts.map(r => r.id)
    };
  }

  const importOnlyValid = options && options.importOnlyValid !== false;
  const rowsToImport = importOnlyValid ? session.importableData : session.importableData;

  const createdBatches = [];
  const transactions = [];

  for (const row of rowsToImport) {
    const qty = Math.floor(Number(row.quantity));

    if (existingIds.has(row.id)) {
      continue;
    }

    const batch = {
      id: row.id,
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

  await saveDb(db);
  pendingImports.delete(token);

  return {
    imported: createdBatches.length,
    totalRows: session.totalRows,
    importableCount: session.importableCount,
    invalidCount: session.invalidCount,
    batches: createdBatches.map(b => ({
      id: b.id,
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

export function getPendingImportCount() {
  cleanupExpired();
  return pendingImports.size;
}
