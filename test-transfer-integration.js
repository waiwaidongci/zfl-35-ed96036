import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTransfer,
  shipTransfer,
  receiveTransfer,
  cancelTransfer,
  getTransfer,
  listTransfers
} from "./lib/transfer-store.js";
import {
  loadDb,
  loadDbWithVersion,
  loadAudit,
  loadAuditWithVersion,
  loadLocDb,
  loadLocDbWithVersion,
  getCurrentVersions,
  OPERATION,
  clone,
  seed,
  locSeed
} from "./lib/data-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = join(__dirname, "data", "rare-seeds.json");
const locPath = join(__dirname, "data", "locations.json");
const auditPath = join(__dirname, "data", "audit-logs.json");

const DATA_FILES = [dbPath, locPath, auditPath];

function wrapWithMetadataLocal(data, type, version = 1) {
  return {
    _version: version,
    _updatedAt: new Date().toISOString(),
    _dataType: type,
    data
  };
}

async function atomicWriteJsonLocal(filePath, data) {
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

const ctx = {
  operator: "integration-test",
  source: { ip: "test", userAgent: "test-runner", endpoint: "internal-test" }
};

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEq(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}\n  Expected: ${expectedStr}\n  Actual:   ${actualStr}`);
  }
}

async function backupDataFiles() {
  const backups = new Map();
  for (const file of DATA_FILES) {
    try {
      if (existsSync(file)) {
        backups.set(file, await readFile(file, "utf8"));
      } else {
        backups.set(file, null);
      }
    } catch (e) {
      backups.set(file, null);
    }
  }
  return backups;
}

async function restoreDataFiles(backups) {
  for (const [file, content] of backups.entries()) {
    if (content !== null) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
  }
}

async function resetDataToSeed() {
  await mkdir(dirname(dbPath), { recursive: true });
  const wrappedDb = wrapWithMetadataLocal(clone(seed), "rare-seeds", 1);
  await atomicWriteJsonLocal(dbPath, wrappedDb);
  const wrappedLoc = wrapWithMetadataLocal(clone(locSeed), "locations", 1);
  await atomicWriteJsonLocal(locPath, wrappedLoc);
  const wrappedAudit = wrapWithMetadataLocal({ logs: [] }, "audit-logs", 1);
  await atomicWriteJsonLocal(auditPath, wrappedAudit);
}

async function runTest(name, fn) {
  console.log(`  ${name} ... `);
  try {
    await fn();
    passCount++;
    console.log(`    ✓ PASS`);
  } catch (e) {
    failCount++;
    failures.push({ name, error: e });
    console.log(`    ✗ FAIL: ${e.message}`);
  }
}

function findAuditLogsByOperation(audit, operation) {
  return audit.logs.filter(l => l.operation === operation);
}

async function testSuite(name, fn) {
  console.log(`\n=== ${name} ===`);
  await resetDataToSeed();
  await fn();
}

// ============================================================
// 1. 创建调拨 (Create Transfer)
// ============================================================
async function testCreateTransfer() {
  await testSuite("场景1: 创建调拨", async () => {
    const initialVersions = await getCurrentVersions();
    const initialAudit = await loadAudit();
    const initialAuditCount = initialAudit.logs.length;
    const initialDb = await loadDb();
    const rs001Qty = initialDb.batches.find(b => b.id === "RS-001").quantity;

    await runTest("可以成功创建从 SITE-001 到 SITE-002 的调拨单", async () => {
      const result = await createTransfer({
        id: "TRF-TEST-001",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 300,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1",
        remark: "集成测试调拨-新建模式"
      }, ctx);

      assert(!result.error, `创建调拨失败: ${result.error || ""} ${result.message || ""}`);
      assert(result.transfer, "返回结果应包含 transfer");
      assertEq(result.transfer.id, "TRF-TEST-001", "调拨单ID应匹配");
      assertEq(result.transfer.status, "created", "状态应为 created");
      assertEq(result.transfer.sourceSiteId, "SITE-001", "源站点应正确");
      assertEq(result.transfer.targetSiteId, "SITE-002", "目标站点应正确");
      assertEq(result.transfer.sourceBatchId, "RS-001", "源批次ID应正确");
      assertEq(result.transfer.quantity, 300, "调拨数量应正确");
      assertEq(result.transfer.targetMode, "new", "目标模式应为 new");
      assert(result.transfer.createdAt, "应有创建时间");
      assertEq(result.transfer.createdBy, "integration-test", "创建人应正确");
    });

    await runTest("创建调拨后版本号应递增", async () => {
      const afterVersions = await getCurrentVersions();
      assert(afterVersions.dataVersion > initialVersions.dataVersion,
        `dataVersion 应递增: ${initialVersions.dataVersion} -> ${afterVersions.dataVersion}`);
      assert(afterVersions.auditVersion > initialVersions.auditVersion,
        `auditVersion 应递增: ${initialVersions.auditVersion} -> ${afterVersions.auditVersion}`);
    });

    await runTest("创建调拨应写入审计日志", async () => {
      const audit = await loadAudit();
      assert(audit.logs.length > initialAuditCount, "审计日志数量应增加");

      const createLogs = findAuditLogsByOperation(audit, OPERATION.TRANSFER_CREATE);
      const transferLog = createLogs.find(l => l.entityId === "TRF-TEST-001");
      assert(transferLog, "应找到 transfer_create 审计记录");
      assertEq(transferLog.operation, OPERATION.TRANSFER_CREATE, "操作类型应正确");
      assertEq(transferLog.entityType, "transfer", "实体类型应为 transfer");
      assertEq(transferLog.operator, "integration-test", "操作人应正确");
      assert(transferLog.details && transferLog.details.transfer, "审计详情应包含调拨信息");
      assertEq(transferLog.details.transfer.quantity, 300, "审计详情中调拨数量应正确");
    });

    await runTest("源批次在创建阶段不应修改库存和在途数量", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-001");
      assertEq(sourceBatch.quantity, rs001Qty, "源批次数量应保持不变");
      assertEq(sourceBatch.inTransitQuantity || 0, 0, "在途数量应为0（尚未发运）");
      assertEq(sourceBatch.transactions.length, 1, "流水数量应保持1条（初始采集）");
    });

    await runTest("同站点调拨应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-001",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-07",
        targetSection: "A2"
      }, ctx);
      assertEq(result.error, "same_site_transfer", "同站点调拨应返回错误");
    });

    await runTest("数量超过可用库存应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 99999,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "insufficient_available_quantity", "库存不足应返回错误");
    });

    await runTest("无效数量应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: -1,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "invalid_quantity", "无效数量应返回错误");
    });

    await runTest("新建模式缺少 container/section 应被拒绝", async () => {
      const result = await createTransfer({
        id: "TRF-TEST-MISSING-PARAMS",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-002",
        quantity: 100,
        targetMode: "new"
      }, ctx);
      assertEq(result.error, "missing_container_or_section", "缺少参数应返回错误");
    });

    await runTest("合并模式缺少 mergeTargetBatchId 应被拒绝", async () => {
      const result = await createTransfer({
        id: "TRF-TEST-MISSING-MERGE",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-003",
        quantity: 100,
        targetMode: "merge"
      }, ctx);
      assertEq(result.error, "missing_merge_target", "缺少合并目标应返回错误");
    });
  });
}

// ============================================================
// 2. 发运冻结 inTransitQuantity
// ============================================================
async function testShipTransfer() {
  await testSuite("场景2: 发运冻结 inTransitQuantity", async () => {
    const initialDb = await loadDb();
    const initialQty = initialDb.batches.find(b => b.id === "RS-001").quantity;
    const initialVersions = await getCurrentVersions();
    const initialAudit = await loadAudit();

    const createResult = await createTransfer({
      id: "TRF-TEST-SHIP",
      sourceSiteId: "SITE-001",
      targetSiteId: "SITE-002",
      sourceBatchId: "RS-001",
      quantity: 500,
      targetMode: "new",
      targetContainer: "C-冷盒-15",
      targetSection: "B1"
    }, ctx);
    assert(!createResult.error, `前置: 创建调拨应成功: ${createResult.error || ""}`);

    await runTest("发运调拨应成功并冻结在途数量", async () => {
      const result = await shipTransfer("TRF-TEST-SHIP", ctx);
      assert(!result.error, `发运失败: ${result.error || ""}`);
      assertEq(result.transfer.status, "shipped", "状态应为 shipped");
      assert(result.transfer.shippedAt, "应有发运时间");
      assertEq(result.transfer.shippedBy, "integration-test", "发运人应正确");
    });

    await runTest("源批次 inTransitQuantity 应正确增加", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-001");
      assertEq(sourceBatch.inTransitQuantity || 0, 500, "在途数量应为 500");
      assertEq(sourceBatch.quantity, initialQty, "总数量在发运阶段应不变");
      const available = sourceBatch.quantity - (sourceBatch.frozenQuantity || 0) - (sourceBatch.inTransitQuantity || 0);
      assertEq(available, initialQty - 500, "可用数量应减少 500");
    });

    await runTest("发运后版本号应递增", async () => {
      const afterVersions = await getCurrentVersions();
      assert(afterVersions.dataVersion > initialVersions.dataVersion, "dataVersion 应递增");
      assert(afterVersions.auditVersion > initialVersions.auditVersion, "auditVersion 应递增");
    });

    await runTest("发运应写入审计日志", async () => {
      const audit = await loadAudit();
      const shipLogs = findAuditLogsByOperation(audit, OPERATION.TRANSFER_SHIP);
      const log = shipLogs.find(l => l.entityId === "TRF-TEST-SHIP");
      assert(log, "应找到 transfer_ship 审计记录");
      assertEq(log.operator, "integration-test", "操作人应正确");
      assert(log.affectedBatches && log.affectedBatches.includes("RS-001"),
        "应关联源批次 RS-001");
      assert(log.changes && log.changes.after && log.changes.after["RS-001"],
        "审计记录应包含变更后快照");
      assertEq(log.changes.after["RS-001"].inTransitQuantity, 500,
        "快照中 inTransitQuantity 应为 500");
    });

    await runTest("非 created 状态的调拨不能重复发运", async () => {
      const result = await shipTransfer("TRF-TEST-SHIP", ctx);
      assertEq(result.error, "invalid_status_transition", "重复发运应返回状态错误");
      assertEq(result.currentStatus, "shipped", "当前状态应为 shipped");
    });

    await runTest("已发运后再次调拨可用数量应扣除在途量", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: initialQty - 400,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "insufficient_available_quantity",
        "扣除在途量后库存不足应被拒绝");
      assertEq(result.requested, initialQty - 400, "请求数量应正确");
      assertEq(result.available, initialQty - 500, "可用数量应扣除在途量");
      assertEq(result.inTransit, 500, "返回的在途数量应为 500");
    });

    await runTest("不存在的调拨单发运应返回错误", async () => {
      const result = await shipTransfer("TRF-NOT-EXIST", ctx);
      assertEq(result.error, "transfer_not_found", "应返回未找到错误");
    });
  });
}

// ============================================================
// 3. 收货新建目标批次
// ============================================================
async function testReceiveNewBatch() {
  await testSuite("场景3: 收货新建目标批次", async () => {
    const initialDb = await loadDb();
    const initialSourceQty = initialDb.batches.find(b => b.id === "RS-002").quantity;
    const initialTxCount = initialDb.batches.find(b => b.id === "RS-002").transactions.length;
    const initialVersions = await getCurrentVersions();

    const createResult = await createTransfer({
      id: "TRF-TEST-RECV-NEW",
      sourceSiteId: "SITE-001",
      targetSiteId: "SITE-002",
      sourceBatchId: "RS-002",
      quantity: 300,
      targetMode: "new",
      targetContainer: "C-冷盒-15",
      targetSection: "B1",
      targetBatchId: "RS-002-RECV-TEST"
    }, ctx);
    assert(!createResult.error, `前置: 创建调拨应成功: ${createResult.error || ""}`);

    const shipResult = await shipTransfer("TRF-TEST-RECV-NEW", ctx);
    assert(!shipResult.error, `前置: 发运调拨应成功: ${shipResult.error || ""}`);

    await runTest("收货新建目标批次应成功", async () => {
      const result = await receiveTransfer("TRF-TEST-RECV-NEW", {
        targetBatchId: "RS-002-RECV-TEST"
      }, ctx);

      assert(!result.error, `收货失败: ${result.error || ""}`);
      assertEq(result.transfer.status, "received", "调拨状态应为 received");
      assert(result.transfer.receivedAt, "应有收货时间");
      assertEq(result.transfer.receivedBy, "integration-test", "收货人应正确");
      assertEq(result.transfer.targetBatchId, "RS-002-RECV-TEST", "目标批次ID应正确");
      assert(result.targetBatch, "应返回目标批次信息");
    });

    await runTest("应在目标站点创建新批次", async () => {
      const db = await loadDb();
      const targetBatch = db.batches.find(b => b.id === "RS-002-RECV-TEST");
      assert(targetBatch, "目标批次应存在");
      assertEq(targetBatch.siteId, "SITE-002", "目标批次应属于 SITE-002");
      assertEq(targetBatch.species, "珙桐", "物种应与源批次一致");
      assertEq(targetBatch.collectionPlace, "峨眉山", "采集地应与源批次一致");
      assertEq(targetBatch.motherPlant, "MP-23", "母株应与源批次一致");
      assertEq(targetBatch.viability, "medium", "活性应与源批次一致");
      assertEq(targetBatch.quantity, 300, "目标批次数量应为调拨数量");
      assertEq(targetBatch.status, "active", "状态应为 active");
      assertEq(targetBatch.container, "C-冷盒-15", "container 应正确");
      assertEq(targetBatch.section, "B1", "section 应正确");
      assertEq(targetBatch.frozenQuantity || 0, 0, "冻结数量应为 0");
      assertEq(targetBatch.inTransitQuantity || 0, 0, "在途数量应为 0");
    });

    await runTest("目标批次 lineage.transferredFrom 应指向源批次", async () => {
      const db = await loadDb();
      const targetBatch = db.batches.find(b => b.id === "RS-002-RECV-TEST");
      assert(targetBatch.lineage, "应有 lineage 字段");
      assertEq(targetBatch.lineage.transferredFrom, "RS-002",
        "transferredFrom 应指向源批次 RS-002");
      assertEq(targetBatch.lineage.transferredTo && targetBatch.lineage.transferredTo.length, 0,
        "transferredTo 应为空数组");
    });

    await runTest("源批次 lineage.transferredTo 应包含目标批次", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-002");
      assert(sourceBatch.lineage && sourceBatch.lineage.transferredTo, "应有 transferredTo");
      assert(sourceBatch.lineage.transferredTo.includes("RS-002-RECV-TEST"),
        "transferredTo 应包含目标批次 ID");
    });

    await runTest("源批次数量应减少并清零在途数量", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-002");
      assertEq(sourceBatch.quantity, initialSourceQty - 300,
        `源批次数量应从 ${initialSourceQty} 减少到 ${initialSourceQty - 300}`);
      assertEq(sourceBatch.inTransitQuantity || 0, 0, "在途数量应清零");
    });

    await runTest("源批次和目标批次应有正确的库存流水", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-002");
      const targetBatch = db.batches.find(b => b.id === "RS-002-RECV-TEST");

      assertEq(sourceBatch.transactions.length, initialTxCount + 1,
        "源批次应新增一条流水");
      const sourceLastTx = sourceBatch.transactions[sourceBatch.transactions.length - 1];
      assertEq(sourceLastTx.type, "transfer_out", "源批次最后流水类型应为 transfer_out");
      assertEq(sourceLastTx.quantity, 300, "调拨出库数量应为 300");
      assertEq(sourceLastTx.balance, initialSourceQty - 300, "源批次余额应正确");
      assert(sourceLastTx.note && sourceLastTx.note.includes("RS-002-RECV-TEST"),
        "流水备注应包含目标批次 ID");

      assertEq(targetBatch.transactions.length, 1, "目标批次应有一条流水");
      const targetTx = targetBatch.transactions[0];
      assertEq(targetTx.type, "transfer_in", "目标批次流水类型应为 transfer_in");
      assertEq(targetTx.quantity, 300, "调拨入库数量应为 300");
      assertEq(targetTx.balance, 300, "目标批次余额应为 300");
      assert(targetTx.note && targetTx.note.includes("RS-002"),
        "流水备注应包含源批次 ID");
    });

    await runTest("收货后版本号应递增", async () => {
      const afterVersions = await getCurrentVersions();
      assert(afterVersions.dataVersion > initialVersions.dataVersion, "dataVersion 应递增");
      assert(afterVersions.auditVersion > initialVersions.auditVersion, "auditVersion 应递增");
    });

    await runTest("收货应写入审计日志", async () => {
      const audit = await loadAudit();
      const recvLogs = findAuditLogsByOperation(audit, OPERATION.TRANSFER_RECEIVE);
      const log = recvLogs.find(l => l.entityId === "TRF-TEST-RECV-NEW");
      assert(log, "应找到 transfer_receive 审计记录");
      assertEq(log.operation, OPERATION.TRANSFER_RECEIVE, "操作类型应正确");
      assert(log.affectedBatches && log.affectedBatches.includes("RS-002"),
        "应关联源批次");
      assert(log.affectedBatches && log.affectedBatches.includes("RS-002-RECV-TEST"),
        "应关联目标批次");
      assert(log.changes && log.changes.before && log.changes.before["RS-002"],
        "应有源批次变更前快照");
      assert(log.changes && log.changes.after && log.changes.after["RS-002-RECV-TEST"],
        "应有目标批次变更后快照");
    });

    await runTest("源批次全部调拨完后状态应为 split_closed", async () => {
      const db = await loadDb();
      const batchRS003 = db.batches.find(b => b.id === "RS-003");
      const fullQty = batchRS003.quantity;

      const createResult2 = await createTransfer({
        id: "TRF-TEST-FULL-EMPTY",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-003",
        quantity: fullQty,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assert(!createResult2.error, `创建全额调拨应成功: ${createResult2.error || ""}`);

      const shipResult2 = await shipTransfer("TRF-TEST-FULL-EMPTY", ctx);
      assert(!shipResult2.error, `发运全额调拨应成功: ${shipResult2.error || ""}`);

      const recvResult2 = await receiveTransfer("TRF-TEST-FULL-EMPTY", {}, ctx);
      assert(!recvResult2.error, `收货全额调拨应成功: ${recvResult2.error || ""}`);

      const dbAfter = await loadDb();
      const sourceAfter = dbAfter.batches.find(b => b.id === "RS-003");
      assertEq(sourceAfter.quantity, 0, "源批次数量应为 0");
      assertEq(sourceAfter.status, "split_closed", "状态应为 split_closed");
    });
  });
}

// ============================================================
// 4. 收货合并既有批次
// ============================================================
async function testReceiveMergeBatch() {
  await testSuite("场景4: 收货合并既有批次", async () => {
    const initialDb = await loadDb();

    await runTest("先在目标站点(SITE-002)创建一个珙桐批次，用于后续合并", async () => {
      const createResult = await createTransfer({
        id: "TRF-TEST-MERGE-PREP",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-002",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1",
        targetBatchId: "RS-002-MERGE-TARGET"
      }, ctx);
      assert(!createResult.error, `准备调拨创建失败: ${createResult.error || ""}`);
      const shipResult = await shipTransfer("TRF-TEST-MERGE-PREP", ctx);
      assert(!shipResult.error, `准备调拨发运失败: ${shipResult.error || ""}`);
      const recvResult = await receiveTransfer("TRF-TEST-MERGE-PREP", {
        targetBatchId: "RS-002-MERGE-TARGET"
      }, ctx);
      assert(!recvResult.error, `准备调拨收货失败: ${recvResult.error || ""}`);

      const db = await loadDb();
      const target = db.batches.find(b => b.id === "RS-002-MERGE-TARGET");
      assert(target, "应已创建目标批次 RS-002-MERGE-TARGET");
      assertEq(target.siteId, "SITE-002", "目标批次应在 SITE-002");
      assertEq(target.species, "珙桐", "物种应为珙桐");
      assertEq(target.collectionPlace, "峨眉山", "采集地应为峨眉山");
      assertEq(target.motherPlant, "MP-23", "母株应为 MP-23");
    });

    await runTest("应可创建合并模式调拨（同物种同采集地同母株）", async () => {
      const result = await createTransfer({
        id: "TRF-TEST-MERGE-001",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-002",
        quantity: 200,
        targetMode: "merge",
        mergeTargetBatchId: "RS-002-MERGE-TARGET"
      }, ctx);
      assert(!result.error, `创建合并调拨失败: ${result.error || ""} ${result.message || ""}`);
      assertEq(result.transfer.targetMode, "merge", "目标模式应为 merge");
      assertEq(result.transfer.mergeTargetBatchId, "RS-002-MERGE-TARGET", "合并目标应为 RS-002-MERGE-TARGET");
    });

    const shipResult = await shipTransfer("TRF-TEST-MERGE-001", ctx);
    assert(!shipResult.error, `前置: 发运应成功: ${shipResult.error || ""}`);

    const dbAfterCreate = await loadDb();
    const initialSource = clone(dbAfterCreate.batches.find(b => b.id === "RS-002"));
    const initialTarget = clone(dbAfterCreate.batches.find(b => b.id === "RS-002-MERGE-TARGET"));
    const initialVersions = await getCurrentVersions();

    await runTest("收货合并到既有批次应成功", async () => {
      const result = await receiveTransfer("TRF-TEST-MERGE-001", {}, ctx);
      assert(!result.error, `合并收货失败: ${result.error || ""}`);
      assertEq(result.transfer.status, "received", "状态应为 received");
      assertEq(result.transfer.targetBatchId, "RS-002-MERGE-TARGET", "目标批次应为 RS-002-MERGE-TARGET");
    });

    await runTest("合并后目标批次数量应累加", async () => {
      const db = await loadDb();
      const targetBatch = db.batches.find(b => b.id === "RS-002-MERGE-TARGET");
      assertEq(targetBatch.quantity, initialTarget.quantity + 200,
        `目标数量应从 ${initialTarget.quantity} 增加到 ${initialTarget.quantity + 200}`);
    });

    await runTest("合并后源批次数量应减少并清零在途", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-002");
      assertEq(sourceBatch.quantity, initialSource.quantity - 200,
        `源数量应从 ${initialSource.quantity} 减少到 ${initialSource.quantity - 200}`);
      assertEq(sourceBatch.inTransitQuantity || 0, 0, "在途数量应清零");
    });

    await runTest("目标批次 lineage.mergedFrom 应包含源批次", async () => {
      const db = await loadDb();
      const targetBatch = db.batches.find(b => b.id === "RS-002-MERGE-TARGET");
      assert(targetBatch.lineage && targetBatch.lineage.mergedFrom, "应有 mergedFrom");
      assert(targetBatch.lineage.mergedFrom.includes("RS-002"),
        "mergedFrom 应包含源批次 RS-002");
    });

    await runTest("源批次 lineage.transferredTo 应包含合并目标", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-002");
      assert(sourceBatch.lineage && sourceBatch.lineage.transferredTo, "应有 transferredTo");
      assert(sourceBatch.lineage.transferredTo.includes("RS-002-MERGE-TARGET"),
        "transferredTo 应包含目标批次 RS-002-MERGE-TARGET");
    });

    await runTest("源批次和目标批次都应有库存流水", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-002");
      const targetBatch = db.batches.find(b => b.id === "RS-002-MERGE-TARGET");

      const sourceLastTx = sourceBatch.transactions[sourceBatch.transactions.length - 1];
      assertEq(sourceLastTx.type, "transfer_out", "源批次最后流水应为 transfer_out");
      assertEq(sourceLastTx.quantity, 200, "出库数量应为 200");

      const targetLastTx = targetBatch.transactions[targetBatch.transactions.length - 1];
      assertEq(targetLastTx.type, "transfer_in", "目标批次最后流水应为 transfer_in");
      assertEq(targetLastTx.quantity, 200, "入库数量应为 200");
      assert(targetLastTx.note && targetLastTx.note.includes("合并"),
        "流水备注应包含'合并'字样");
    });

    await runTest("合并收货审计日志应正确", async () => {
      const audit = await loadAudit();
      const recvLogs = findAuditLogsByOperation(audit, OPERATION.TRANSFER_RECEIVE);
      const log = recvLogs.find(l => l.entityId === "TRF-TEST-MERGE-001");
      assert(log, "应找到 transfer_receive 审计记录");
      assert(log.details && log.details.mergeMode === true,
        "审计详情应标记 mergeMode: true");
      assert(log.affectedBatches && log.affectedBatches.includes("RS-002"),
        "应关联源批次");
      assert(log.affectedBatches && log.affectedBatches.includes("RS-002-MERGE-TARGET"),
        "应关联目标批次");
    });

    await runTest("合并收货后版本号应递增", async () => {
      const afterVersions = await getCurrentVersions();
      assert(afterVersions.dataVersion > initialVersions.dataVersion, "dataVersion 应递增");
      assert(afterVersions.auditVersion > initialVersions.auditVersion, "auditVersion 应递增");
    });

    await runTest("物种不匹配的合并应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "merge",
        mergeTargetBatchId: "RS-004"
      }, ctx);
      assertEq(result.error, "transfer_merge_mismatch",
        "物种不同（独叶草 vs 望天树）应拒绝合并");
    });

    await runTest("非 shipped 状态的调拨不能收货", async () => {
      const createResult2 = await createTransfer({
        id: "TRF-TEST-NORECV",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assert(!createResult2.error, `创建调拨应成功: ${createResult2.error || ""}`);

      const result = await receiveTransfer("TRF-TEST-NORECV", {}, ctx);
      assertEq(result.error, "invalid_status_transition",
        "created 状态不应直接收货");
      assertEq(result.currentStatus, "created", "当前状态应为 created");
      assertEq(result.expected, "shipped", "期望状态应为 shipped");
    });
  });
}

// ============================================================
// 5. 取消已创建调拨
// ============================================================
async function testCancelTransfer() {
  await testSuite("场景5: 取消已创建调拨", async () => {
    const initialDb = await loadDb();
    const initialQty = initialDb.batches.find(b => b.id === "RS-001").quantity;
    const initialVersions = await getCurrentVersions();

    const createResult = await createTransfer({
      id: "TRF-TEST-CANCEL-CREATED",
      sourceSiteId: "SITE-001",
      targetSiteId: "SITE-002",
      sourceBatchId: "RS-001",
      quantity: 250,
      targetMode: "new",
      targetContainer: "C-冷盒-15",
      targetSection: "B1"
    }, ctx);
    assert(!createResult.error, `前置: 创建调拨应成功: ${createResult.error || ""}`);

    await runTest("取消 created 状态的调拨应成功", async () => {
      const result = await cancelTransfer("TRF-TEST-CANCEL-CREATED", ctx);
      assert(!result.error, `取消失败: ${result.error || ""}`);
      assertEq(result.transfer.status, "cancelled", "状态应为 cancelled");
      assert(result.transfer.cancelledAt, "应有取消时间");
      assertEq(result.transfer.cancelledBy, "integration-test", "取消人应正确");
    });

    await runTest("取消 created 调拨不影响源批次库存", async () => {
      const db = await loadDb();
      const sourceBatch = db.batches.find(b => b.id === "RS-001");
      assertEq(sourceBatch.quantity, initialQty, "源批次数量应不变");
      assertEq(sourceBatch.inTransitQuantity || 0, 0, "在途数量应为 0");
    });

    await runTest("取消 shipped 状态的调拨应归还在途数量", async () => {
      const createResult2 = await createTransfer({
        id: "TRF-TEST-CANCEL-SHIPPED",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 400,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assert(!createResult2.error, `创建调拨应成功: ${createResult2.error || ""}`);

      const shipResult2 = await shipTransfer("TRF-TEST-CANCEL-SHIPPED", ctx);
      assert(!shipResult2.error, `发运应成功: ${shipResult2.error || ""}`);

      const dbBeforeCancel = await loadDb();
      const inTransitBefore = dbBeforeCancel.batches.find(b => b.id === "RS-001").inTransitQuantity || 0;
      assertEq(inTransitBefore, 400, "发运后在途应为 400");

      const cancelResult = await cancelTransfer("TRF-TEST-CANCEL-SHIPPED", ctx);
      assert(!cancelResult.error, `取消发运中调拨失败: ${cancelResult.error || ""}`);
      assertEq(cancelResult.transfer.status, "cancelled", "状态应为 cancelled");

      const dbAfterCancel = await loadDb();
      const sourceAfter = dbAfterCancel.batches.find(b => b.id === "RS-001");
      assertEq(sourceAfter.inTransitQuantity || 0, 0, "取消后在途应清零");
      assertEq(sourceAfter.quantity, initialQty, "源批次总数量应不变");
    });

    await runTest("取消调拨应写入审计日志", async () => {
      const audit = await loadAudit();
      const cancelLogs = findAuditLogsByOperation(audit, OPERATION.TRANSFER_CANCEL);
      assert(cancelLogs.length >= 2, "应有至少两条取消审计记录");

      const cancelShipped = cancelLogs.find(l => l.entityId === "TRF-TEST-CANCEL-SHIPPED");
      assert(cancelShipped, "应找到取消已发运调拨的审计记录");
      assert(cancelShipped.affectedBatches && cancelShipped.affectedBatches.includes("RS-001"),
        "取消已发运调拨应关联源批次");
      assert(cancelShipped.details && cancelShipped.details.sourceBatch,
        "审计详情应包含源批次信息");
      assertEq(cancelShipped.details.sourceBatch.inTransitQuantityAfter, 0,
        "审计详情中在途数量应为 0");
    });

    await runTest("取消后版本号应递增", async () => {
      const afterVersions = await getCurrentVersions();
      assert(afterVersions.dataVersion > initialVersions.dataVersion, "dataVersion 应递增");
      assert(afterVersions.auditVersion > initialVersions.auditVersion, "auditVersion 应递增");
    });

    await runTest("已收货的调拨不能取消", async () => {
      const createResult3 = await createTransfer({
        id: "TRF-TEST-NOCANCEL",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assert(!createResult3.error, `创建调拨应成功: ${createResult3.error || ""}`);
      const shipResult3 = await shipTransfer("TRF-TEST-NOCANCEL", ctx);
      assert(!shipResult3.error, `发运应成功: ${shipResult3.error || ""}`);
      const recvResult3 = await receiveTransfer("TRF-TEST-NOCANCEL", {}, ctx);
      assert(!recvResult3.error, `收货应成功: ${recvResult3.error || ""}`);

      const result = await cancelTransfer("TRF-TEST-NOCANCEL", ctx);
      assertEq(result.error, "invalid_status_transition",
        "received 状态的调拨不能取消");
    });

    await runTest("不存在的调拨取消应返回错误", async () => {
      const result = await cancelTransfer("TRF-NOT-EXIST", ctx);
      assertEq(result.error, "transfer_not_found", "应返回未找到错误");
    });
  });
}

// ============================================================
// 6. 错误状态流转
// ============================================================
async function testInvalidStatusTransitions() {
  await testSuite("场景6: 错误状态流转", async () => {
    await runTest("对不存在的调拨执行操作应返回 transfer_not_found", async () => {
      const shipRes = await shipTransfer("TRF-GHOST", ctx);
      assertEq(shipRes.error, "transfer_not_found", "发运不存在调拨应报错");

      const recvRes = await receiveTransfer("TRF-GHOST", {}, ctx);
      assertEq(recvRes.error, "transfer_not_found", "收货不存在调拨应报错");

      const cancelRes = await cancelTransfer("TRF-GHOST", ctx);
      assertEq(cancelRes.error, "transfer_not_found", "取消不存在调拨应报错");
    });

    await runTest("状态流转链路: created → shipped → received 不可跳跃", async () => {
      const createRes = await createTransfer({
        id: "TRF-TEST-STATUS-CHAIN",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assert(!createRes.error, `创建应成功: ${createRes.error || ""}`);

      const tryRecv1 = await receiveTransfer("TRF-TEST-STATUS-CHAIN", {}, ctx);
      assertEq(tryRecv1.error, "invalid_status_transition",
        "created 不能直接收货，必须先发运");
      assertEq(tryRecv1.currentStatus, "created", "当前状态应为 created");

      const shipRes = await shipTransfer("TRF-TEST-STATUS-CHAIN", ctx);
      assert(!shipRes.error, `发运应成功: ${shipRes.error || ""}`);

      const tryShip2 = await shipTransfer("TRF-TEST-STATUS-CHAIN", ctx);
      assertEq(tryShip2.error, "invalid_status_transition",
        "shipped 不能重复发运");

      const recvRes = await receiveTransfer("TRF-TEST-STATUS-CHAIN", {}, ctx);
      assert(!recvRes.error, `收货应成功: ${recvRes.error || ""}`);

      const tryShip3 = await shipTransfer("TRF-TEST-STATUS-CHAIN", ctx);
      assertEq(tryShip3.error, "invalid_status_transition",
        "received 不能再发运");

      const tryRecv2 = await receiveTransfer("TRF-TEST-STATUS-CHAIN", {}, ctx);
      assertEq(tryRecv2.error, "invalid_status_transition",
        "received 不能重复收货");

      const tryCancel = await cancelTransfer("TRF-TEST-STATUS-CHAIN", ctx);
      assertEq(tryCancel.error, "invalid_status_transition",
        "received 不能取消");
    });

    await runTest("已取消的调拨不可再进行任何流转", async () => {
      const createRes = await createTransfer({
        id: "TRF-TEST-CANCELLED-CHAIN",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-002",
        quantity: 50,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assert(!createRes.error, `创建应成功: ${createRes.error || ""}`);

      const cancelRes = await cancelTransfer("TRF-TEST-CANCELLED-CHAIN", ctx);
      assert(!cancelRes.error, `取消应成功: ${cancelRes.error || ""}`);

      const tryShip = await shipTransfer("TRF-TEST-CANCELLED-CHAIN", ctx);
      assertEq(tryShip.error, "invalid_status_transition",
        "cancelled 状态不能发运");

      const tryRecv = await receiveTransfer("TRF-TEST-CANCELLED-CHAIN", {}, ctx);
      assertEq(tryRecv.error, "invalid_status_transition",
        "cancelled 状态不能收货");

      const tryCancel2 = await cancelTransfer("TRF-TEST-CANCELLED-CHAIN", ctx);
      assertEq(tryCancel2.error, "invalid_status_transition",
        "cancelled 状态不能重复取消");
    });

    await runTest("错误状态流转应记录审计日志", async () => {
      const auditBefore = await loadAudit();
      const beforeCount = auditBefore.logs.length;

      await createTransfer({
        id: "TRF-TEST-ERROR-AUDIT",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-003",
        quantity: 30,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);

      await receiveTransfer("TRF-TEST-ERROR-AUDIT", {}, ctx);

      const auditAfter = await loadAudit();
      assert(auditAfter.logs.length > beforeCount,
        "错误操作后审计日志数量应增加");
    });
  });
}

// ============================================================
// 7. 跨站点权限约束
// ============================================================
async function testCrossSiteConstraints() {
  await testSuite("场景7: 跨站点权限约束", async () => {
    await runTest("源批次不属于源站点应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-002",
        targetSiteId: "SITE-001",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-07",
        targetSection: "A2"
      }, ctx);
      assertEq(result.error, "batch_site_mismatch",
        "RS-001 属于 SITE-001，不能从 SITE-002 调出");
    });

    await runTest("合并目标不属于目标站点应被拒绝", async () => {
      const prep = await createTransfer({
        id: "TRF-PREP-SITE-MISMATCH",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 50,
        targetMode: "new",
        targetContainer: "C-冷盒-99",
        targetSection: "A1",
        targetBatchId: "RS-001-AT-SITE2"
      }, ctx);
      assert(!prep.error, `准备调拨创建失败: ${prep.error || ""}`);
      await shipTransfer("TRF-PREP-SITE-MISMATCH", ctx);
      await receiveTransfer("TRF-PREP-SITE-MISMATCH", { targetBatchId: "RS-001-AT-SITE2" }, ctx);

      const dbCheck = await loadDb();
      const copyBatch = dbCheck.batches.find(b => b.id === "RS-001-AT-SITE2");
      assert(copyBatch && copyBatch.siteId === "SITE-002", "准备批次应在 SITE-002");

      const result = await createTransfer({
        sourceSiteId: "SITE-002",
        targetSiteId: "SITE-001",
        sourceBatchId: "RS-001-AT-SITE2",
        quantity: 20,
        targetMode: "merge",
        mergeTargetBatchId: "RS-001-AT-SITE2"
      }, ctx);
      assertEq(result.error, "merge_target_site_mismatch",
        "RS-001-AT-SITE2 在 SITE-002，目标站点是 SITE-001，应报站点不匹配");
    });

    await runTest("源站点不存在应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-NOT-EXIST",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "source_site_not_found", "源站点不存在应报错");
    });

    await runTest("目标站点不存在应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-NOT-EXIST",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "target_site_not_found", "目标站点不存在应报错");
    });

    await runTest("源批次不存在应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-NOT-EXIST",
        quantity: 100,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "batch_not_found", "源批次不存在应报错");
    });

    await runTest("合并目标批次不存在应被拒绝", async () => {
      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 100,
        targetMode: "merge",
        mergeTargetBatchId: "RS-NOT-EXIST"
      }, ctx);
      assertEq(result.error, "merge_target_not_found", "合并目标不存在应报错");
    });

    await runTest("站点与批次归属完整流程验证（SITE-002 → SITE-001）", async () => {
      const result = await createTransfer({
        id: "TRF-TEST-SITE-2-TO-1",
        sourceSiteId: "SITE-002",
        targetSiteId: "SITE-001",
        sourceBatchId: "RS-005",
        quantity: 150,
        targetMode: "new",
        targetContainer: "C-冷盒-07",
        targetSection: "A2"
      }, ctx);
      assert(!result.error, `反向调拨创建失败: ${result.error || ""}`);
      assertEq(result.transfer.sourceSiteId, "SITE-002", "源站点应为 SITE-002");
      assertEq(result.transfer.targetSiteId, "SITE-001", "目标站点应为 SITE-001");

      const shipRes = await shipTransfer("TRF-TEST-SITE-2-TO-1", ctx);
      assert(!shipRes.error, `发运应成功: ${shipRes.error || ""}`);

      const dbBeforeRecv = await loadDb();
      const sourceBefore = dbBeforeRecv.batches.find(b => b.id === "RS-005");
      assertEq(sourceBefore.inTransitQuantity || 0, 150,
        "SITE-002 的 RS-005 在途数量应为 150");

      const recvRes = await receiveTransfer("TRF-TEST-SITE-2-TO-1", {
        targetBatchId: "RS-005-RECV-SITE1"
      }, ctx);
      assert(!recvRes.error, `收货失败: ${recvRes.error || ""}`);

      const dbAfter = await loadDb();
      const targetBatch = dbAfter.batches.find(b => b.id === "RS-005-RECV-SITE1");
      assert(targetBatch, "应在 SITE-001 创建目标批次");
      assertEq(targetBatch.siteId, "SITE-001", "目标批次应归属 SITE-001");
      assertEq(targetBatch.quantity, 150, "目标批次数量应为 150");

      const sourceAfter = dbAfter.batches.find(b => b.id === "RS-005");
      assertEq(sourceAfter.siteId, "SITE-002", "源批次仍应归属 SITE-002");
      assertEq(sourceAfter.lineage.transferredTo && sourceAfter.lineage.transferredTo.includes("RS-005-RECV-SITE1"),
        true, "源批次 transferredTo 应包含新批次");
    });

    await runTest("非 active 状态的批次不能作为调拨源", async () => {
      const dbInitial = await loadDb();
      const nonActiveBatch = dbInitial.batches.find(b => b.id === "RS-001");

      await createTransfer({
        id: "TRF-TEST-CLOSE-SRC",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: nonActiveBatch.quantity,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);

      await shipTransfer("TRF-TEST-CLOSE-SRC", ctx);
      await receiveTransfer("TRF-TEST-CLOSE-SRC", {}, ctx);

      const dbAfterClose = await loadDb();
      const closedBatch = dbAfterClose.batches.find(b => b.id === "RS-001");
      assertEq(closedBatch.status, "split_closed", "批次应为 split_closed");

      const result = await createTransfer({
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-001",
        quantity: 10,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);
      assertEq(result.error, "batch_not_active",
        "split_closed 状态的批次不能再调拨");
      assertEq(result.status, "split_closed", "应返回当前状态");
    });

    await runTest("listTransfers 按站点筛选应正确", async () => {
      await createTransfer({
        id: "TRF-TEST-FILTER-1",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-002",
        quantity: 50,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);

      await createTransfer({
        id: "TRF-TEST-FILTER-2",
        sourceSiteId: "SITE-002",
        targetSiteId: "SITE-001",
        sourceBatchId: "RS-006",
        quantity: 50,
        targetMode: "new",
        targetContainer: "C-冷盒-07",
        targetSection: "A2"
      }, ctx);

      const listAll = await listTransfers();
      const listSite1 = await listTransfers({ siteId: "SITE-001" });
      const listSource1 = await listTransfers({ sourceSiteId: "SITE-001" });
      const listTarget2 = await listTransfers({ targetSiteId: "SITE-002" });

      assert(listSite1.transfers.length >= 2,
        "SITE-001 筛选应包含源或目标为 SITE-001 的调拨");
      assert(listSource1.transfers.every(t => t.sourceSiteId === "SITE-001"),
        "sourceSiteId 筛选应只返回源为 SITE-001 的调拨");
      assert(listTarget2.transfers.every(t => t.targetSiteId === "SITE-002"),
        "targetSiteId 筛选应只返回目标为 SITE-002 的调拨");
    });

    await runTest("getTransfer 应返回丰富的批次和站点信息", async () => {
      await createTransfer({
        id: "TRF-TEST-GET-DETAIL",
        sourceSiteId: "SITE-001",
        targetSiteId: "SITE-002",
        sourceBatchId: "RS-002",
        quantity: 80,
        targetMode: "new",
        targetContainer: "C-冷盒-15",
        targetSection: "B1"
      }, ctx);

      const result = await getTransfer("TRF-TEST-GET-DETAIL");
      assert(!result.error, "获取调拨详情应成功");
      const t = result.transfer;
      assertEq(t.sourceSiteName, "主冷库", "源站点名称应为'主冷库'");
      assertEq(t.targetSiteName, "二号备库", "目标站点名称应为'二号备库'");
      assert(t.sourceBatch, "应返回源批次信息");
      assertEq(t.sourceBatch.id, "RS-002", "源批次ID应正确");
      assertEq(t.sourceBatch.species, "珙桐", "源批次物种应正确");
    });
  });
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  多站点调拨流程集成回归测试");
  console.log("═══════════════════════════════════════════════════");
  console.log("  测试范围: 创建/发运/收货(新建)/收货(合并)/取消");
  console.log("            错误状态流转 / 跨站点权限约束");
  console.log("  验证项: 批次数量 / 库存流水 / lineage 关系");
  console.log("          transfers 状态 / 审计日志 / 版本号");
  console.log("  数据保护: 每个场景开始前重置为种子数据");
  console.log("═══════════════════════════════════════════════════");

  const globalBackups = await backupDataFiles();

  try {
    await testCreateTransfer();
    await testShipTransfer();
    await testReceiveNewBatch();
    await testReceiveMergeBatch();
    await testCancelTransfer();
    await testInvalidStatusTransitions();
    await testCrossSiteConstraints();

    console.log("\n═══════════════════════════════════════════════════");
    console.log(`  总计: ${passCount + failCount} 个断言`);
    console.log(`  通过: ${passCount} ✓`);
    console.log(`  失败: ${failCount} ✗`);
    console.log("═══════════════════════════════════════════════════");

    if (failures.length > 0) {
      console.log("\n失败详情:");
      for (const f of failures) {
        console.log(`  ✗ ${f.name}`);
        console.log(`    ${f.error.message}`);
      }
      process.exit(1);
    } else {
      console.log("\n  所有集成回归测试通过 ✓");
      process.exit(0);
    }
  } finally {
    await restoreDataFiles(globalBackups);
  }
}

main().catch(err => {
  console.error("测试运行异常:", err);
  process.exit(1);
});
