import * as anomalyStore from "../lib/temperature-anomaly.js";
import { getRequestContext } from "../lib/data-store.js";

function makeCtx(req, body) {
  const headers = (req && req.headers) || {};
  const operator = (body && body.operator) || headers["x-operator"] || headers["x-user"] || undefined;
  return {
    operator,
    source: getRequestContext(req)
  };
}

const routes = [
  {
    method: "GET",
    pattern: /^\/anomalies\/pending$/,
    handler: async () => anomalyStore.listPendingAnomalies()
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)\/anomalies$/,
    handler: async (req, _res, _body, params) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const status = url.searchParams.get("status") || null;
      return anomalyStore.listAnomaliesByBatch(params[1], status);
    }
  },
  {
    method: "PATCH",
    pattern: /^\/batches\/([^/]+)\/anomalies\/([^/]+)\/handle$/,
    handler: async (req, _res, body, params) =>
      anomalyStore.handleAnomaly(params[1], params[2], body, makeCtx(req, body))
  },
  {
    method: "POST",
    pattern: /^\/anomalies\/scan$/,
    handler: async (req, _res, body) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const batchId = url.searchParams.get("batchId") || body.batchId || null;
      const threshold = url.searchParams.get("threshold")
        ? Number(url.searchParams.get("threshold"))
        : body.threshold
          ? Number(body.threshold)
          : undefined;
      return anomalyStore.scanAndDetectAnomalies(batchId, threshold, makeCtx(req, body));
    }
  }
];

export async function handleAnomalyRoutes(req, res, send, readBody) {
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
        anomaly_not_found: 404,
        anomaly_already_handled: 409
      };
      send(res, statusMap[result.error] || 400, result);
      return true;
    }
    const status = (req.method === "POST" && !result.error) ? 201 : 200;
    send(res, status, result);
    return true;
  }
  return false;
}
