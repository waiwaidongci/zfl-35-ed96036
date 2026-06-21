import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const DATA_FILES = ["rare-seeds.json", "locations.json", "audit-logs.json"];
const SMOKE_PORT = 3036;

async function backupDataFiles() {
  const backups = new Map();
  for (const file of DATA_FILES) {
    const filePath = join(DATA_DIR, file);
    try {
      if (existsSync(filePath)) {
        backups.set(file, await readFile(filePath, "utf8"));
      } else {
        backups.set(file, null);
      }
    } catch {
      backups.set(file, null);
    }
  }
  return backups;
}

async function restoreDataFiles(backups) {
  for (const [file, content] of backups.entries()) {
    if (content !== null) {
      const filePath = join(DATA_DIR, file);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
  }
}

function httpRequest(method, path, port, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "localhost",
      port,
      path,
      method,
      headers: { "Content-Type": "application/json" }
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function startServer(port) {
  const proc = spawn("node", ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["pipe", "pipe", "pipe"]
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Server start timeout (10s)"));
    }, 10000);
    proc.stdout.on("data", (data) => {
      if (data.toString().includes("listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.stderr.on("data", () => {});
  });

  return proc;
}

describe("稀有种子冷库API - 完整测试套件", { concurrency: 1, timeout: 300_000 }, () => {
  let backups;
  let serverProc;

  before(async () => {
    console.log("\n🔒 备份 data/ 目录原始数据 ...");
    backups = await backupDataFiles();
    console.log("✓ 数据备份完成\n");
  });

  after(async () => {
    console.log("\n🔒 恢复 data/ 目录原始数据 ...");
    await restoreDataFiles(backups);
    console.log("✓ 数据已恢复\n");

    if (serverProc && !serverProc.killed) {
      serverProc.kill();
    }
  });

  test("版本控制与原子事务", { timeout: 60_000 }, async () => {
    const { runVersioningTests } = await import("./test-versioning.js");
    await runVersioningTests();
  });

  test("JSON版本读写与锁串行化隔离验证", { timeout: 60_000 }, async () => {
    const { runFixesTests } = await import("./test-fixes.js");
    await runFixesTests();
  });

  test("调拨流程集成回归", { timeout: 120_000 }, async () => {
    const { runTransferTests } = await import("./test-transfer-integration.js");
    await runTransferTests();
  });

  test("HTTP 冒烟测试", { timeout: 30_000 }, async () => {
    serverProc = await startServer(SMOKE_PORT);

    try {
      const root = await httpRequest("GET", "/", SMOKE_PORT);
      assert.equal(root.status, 200);
      assert.ok(root.body.service, "根路径应返回 service 字段");
      assert.ok(Array.isArray(root.body.endpoints), "根路径应返回 endpoints 数组");

      const version = await httpRequest("GET", "/version", SMOKE_PORT);
      assert.equal(version.status, 200);
      assert.ok(version.body.dataVersion !== undefined, "/version 应返回 dataVersion");
      assert.ok(version.body.auditVersion !== undefined, "/version 应返回 auditVersion");

      const sites = await httpRequest("GET", "/sites", SMOKE_PORT);
      assert.equal(sites.status, 200);
      assert.ok(sites.body.sites, "/sites 应返回 sites 字段");
      assert.ok(Array.isArray(sites.body.sites), "/sites 返回的 sites 应为数组");
      assert.ok(sites.body.sites.some((s) => s.id === "SITE-001"), "应包含默认站点 SITE-001");

      const batches = await httpRequest("GET", "/batches", SMOKE_PORT);
      assert.equal(batches.status, 200);
      assert.ok(batches.body.batches, "/batches 应返回 batches 字段");
      assert.ok(Array.isArray(batches.body.batches), "/batches 返回的 batches 应为数组");

      const inventory = await httpRequest("GET", "/reports/inventory", SMOKE_PORT);
      assert.equal(inventory.status, 200);
      assert.ok(inventory.body.total !== undefined, "/reports/inventory 应返回 total");

      const sections = await httpRequest("GET", "/locations/sections", SMOKE_PORT);
      assert.equal(sections.status, 200);
      assert.ok(Array.isArray(sections.body), "/locations/sections 应返回数组");

      const notFound = await httpRequest("GET", "/nonexistent", SMOKE_PORT);
      assert.equal(notFound.status, 404);
      assert.equal(notFound.body.error, "not_found", "未知路径应返回 not_found");

      console.log("    ✓ 7 个端点冒烟测试全部通过");
    } finally {
      if (serverProc && !serverProc.killed) {
        serverProc.kill();
        serverProc = null;
      }
    }
  });
});
