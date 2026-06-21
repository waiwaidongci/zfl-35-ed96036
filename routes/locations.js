import * as store from "../lib/location-store.js";
import { getExpectedVersionsFromRequest, getRequestContext } from "../lib/data-store.js";

function makeCtx(req, input = {}) {
  const headers = req.headers || {};
  return {
    operator: input.operator || headers["x-operator"] || headers["x-user"] || null,
    source: getRequestContext(req),
    expectedVersions: getExpectedVersionsFromRequest(req, input)
  };
}

const routes = [
  {
    method: "GET",
    pattern: /^\/locations\/sections$/,
    handler: async (req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const siteId = url.searchParams.get("siteId") || null;
      return store.listSections(siteId);
    }
  },
  { method: "POST", pattern: /^\/locations\/sections$/, handler: async (req, _res, body) => store.createSection(body, makeCtx(req, body)) },
  { method: "GET", pattern: /^\/locations\/sections\/([^/]+)\/free-slots$/, handler: async (_req, _res, _body, params) => store.listFreeSlots(params[1]) },
  { method: "GET", pattern: /^\/locations\/sections\/([^/]+)$/, handler: async (_req, _res, _body, params) => store.getSection(params[1]) },
  { method: "POST", pattern: /^\/locations\/sections\/([^/]+)\/boxes$/, handler: async (req, _res, body, params) => store.addBox(params[1], body, makeCtx(req, body)) },
  { method: "PATCH", pattern: /^\/locations\/boxes\/([^/]+)\/slots\/(\d+)$/, handler: async (req, _res, body, params) => store.assignSlot(params[1], params[2], body.batchId, makeCtx(req, body)) },
  { method: "GET", pattern: /^\/locations\/boxes\/([^/]+)$/, handler: async (_req, _res, _body, params) => store.getBox(params[1]) },
  { method: "GET", pattern: /^\/locations\/batches\/([^/]+)\/slots$/, handler: async (_req, _res, _body, params) => store.getBatchLocations(params[1]) },
];

export async function handleLocationRoutes(req, res, send, readBody) {
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
        section_not_found: 404,
        box_not_found: 404,
        batch_not_found: 404,
        section_already_exists: 409,
        box_already_exists: 409,
        slot_already_occupied: 409,
        slot_index_out_of_range: 400,
        site_disabled: 409,
        site_mismatch: 409,
        version_conflict: 409,
        transaction_failed: 409
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
