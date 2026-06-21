import * as auditLog from "../lib/audit-log.js";

const routes = [
  {
    method: "GET",
    pattern: /^\/audit-logs$/,
    handler: async (req, _res, _body) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {};
      const batchId = url.searchParams.get("batchId");
      if (batchId) filters.batchId = batchId;
      const operation = url.searchParams.get("operation");
      if (operation) filters.operation = operation.split(",").filter(Boolean);
      const entityType = url.searchParams.get("entityType");
      if (entityType) filters.entityType = entityType;
      const operator = url.searchParams.get("operator");
      if (operator) filters.operator = operator;
      const fromTime = url.searchParams.get("fromTime");
      if (fromTime) filters.fromTime = fromTime;
      const toTime = url.searchParams.get("toTime");
      if (toTime) filters.toTime = toTime;
      const limit = url.searchParams.get("limit");
      if (limit) filters.limit = Number(limit);
      const siteId = url.searchParams.get("siteId") || null;
      return auditLog.queryAuditLogs(filters, siteId);
    }
  },
  {
    method: "GET",
    pattern: /^\/audit-logs\/stats$/,
    handler: async () => auditLog.getAuditStats()
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)\/history\/replay$/,
    handler: async (req, _res, _body, params) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const targetTime = url.searchParams.get("targetTime");
      return auditLog.replayBatchHistory(params[1], targetTime);
    }
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)\/history\/timeline$/,
    handler: async (_req, _res, _body, params) => auditLog.getBatchChangeTimeline(params[1])
  }
];

export async function handleAuditRoutes(req, res, send, readBody) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const route of routes) {
    if (req.method !== route.method) continue;
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    const decoded = match.map((v, i) => i === 0 ? v : decodeURIComponent(v));
    const input = (route.method === "GET") ? {} : await readBody(req);
    const result = await route.handler(req, res, input, decoded);
    if (result === null) { send(res, 404, { error: "not_found" }); return true; }
    if (result.error) {
      const statusMap = {
        batch_not_found: 404,
        invalid_target_time: 400,
        version_conflict: 409,
        transaction_failed: 409
      };
      send(res, statusMap[result.error] || 400, result);
      return true;
    }
    send(res, 200, result);
    return true;
  }
  return false;
}
