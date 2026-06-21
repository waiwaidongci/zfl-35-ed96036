import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCurrentVersions,
  loadAudit,
  loadDbWithVersion,
  mutate,
  OPERATION
} from "./lib/data-store.js";

const DATA_FILES = [
  join("data", "rare-seeds.json"),
  join("data", "locations.json"),
  join("data", "audit-logs.json")
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function backupDataFiles() {
  const backups = new Map();
  for (const file of DATA_FILES) {
    backups.set(file, await readFile(file, "utf8"));
  }
  return backups;
}

async function restoreDataFiles(backups) {
  for (const [file, content] of backups.entries()) {
    await writeFile(file, content);
  }
}

export async function runFixesTests() {
  const backups = await backupDataFiles();
  try {
    console.log("=== 隔离验证 JSON 版本读写、锁串行化和冲突审计 ===");

    const initialVersions = await getCurrentVersions();
    const { data, version } = await loadDbWithVersion();
    const testBatchId = data.batches[0]?.id;
    assert(testBatchId, "缺少可测试批次");

    const conflict = await mutate({
      operation: OPERATION.BATCH_UPDATE_REMARK,
      entityType: "batch",
      entityId: testBatchId,
      operator: "isolated-test",
      source: { ip: "test", userAgent: "test", endpoint: "test" },
      expectedVersions: { dataVersion: version - 1 },
      affectedBatchIds: [testBatchId],
      mutator: (db) => {
        const batch = db.batches.find(b => b.id === testBatchId);
        batch.remark = "should not be written";
        return { batchId: testBatchId };
      }
    });
    assert(conflict.error === "version_conflict" && conflict.retryable === true, "旧版本写入应返回可重试版本冲突");

    const auditAfterConflict = await loadAudit();
    assert(
      auditAfterConflict.logs.some(l =>
        l.operation === OPERATION.VERSION_CONFLICT &&
        l.details &&
        l.details.conflictType === "version_mismatch"
      ),
      "版本冲突应写入清晰审计记录"
    );

    const active = new Set();
    const overlaps = [];
    const concurrent = Array.from({ length: 4 }, (_, index) => mutate({
      operation: OPERATION.BATCH_UPDATE_REMARK,
      entityType: "batch",
      entityId: testBatchId,
      operator: `isolated-concurrent-${index}`,
      source: { ip: "test", userAgent: "test", endpoint: "test" },
      affectedBatchIds: [testBatchId],
      mutator: async (db) => {
        active.add(index);
        if (active.size > 1) overlaps.push([...active]);
        await new Promise(resolve => setTimeout(resolve, 20));
        const batch = db.batches.find(b => b.id === testBatchId);
        batch.remark = `isolated concurrent ${index}`;
        active.delete(index);
        return { batchId: testBatchId, index };
      }
    }));
    const concurrentResults = await Promise.all(concurrent);
    assert(concurrentResults.every(result => !result.error), "并发写入不应失败");
    assert(overlaps.length === 0, `锁应串行化写入，但出现重叠: ${JSON.stringify(overlaps)}`);

    const txResult = await mutate({
      operation: OPERATION.LOCATION_SLOT_ASSIGN,
      entityType: "location_slot",
      entityId: "test",
      operator: "isolated-location",
      source: { ip: "test", userAgent: "test", endpoint: "test" },
      affectedBatchIds: [testBatchId],
      mutator: (db) => {
        const batch = db.batches.find(b => b.id === testBatchId);
        batch.section = "A2";
        return { batchId: testBatchId };
      },
      locMutator: (locDb) => {
        const section = (locDb.sections || []).find(s => s.id === "A2");
        const box = section?.boxes?.find(b => b.id === "C-冷盒-08");
        if (!box) return { error: "box_not_found" };
        let slot = box.slots.find(s => s.index === 2);
        if (!slot) {
          slot = { index: 2, batchId: null };
          box.slots.push(slot);
        }
        slot.batchId = testBatchId;
        return { batchId: testBatchId, boxId: box.id, slotIndex: 2 };
      }
    });
    assert(!txResult.error && txResult._versions?.locVersion, "跨文件事务应成功并返回版本");

    const finalVersions = await getCurrentVersions();
    assert(finalVersions.dataVersion > initialVersions.dataVersion, "数据版本应递增");
    assert(finalVersions.auditVersion > initialVersions.auditVersion, "审计版本应递增");

    console.log("所有隔离验证通过，数据文件将在退出前恢复。");
  } finally {
    await restoreDataFiles(backups);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  runFixesTests().catch(err => { console.error(err); process.exit(1); });
}
