import * as store from "../lib/import-store.js";
import { getExpectedVersionsFromRequest, getRequestContext, getCurrentVersions } from "../lib/data-store.js";

function makeCtx(req, body) {
  const headers = (req && req.headers) || {};
  const operator = (body && body.operator) || headers["x-operator"] || headers["x-user"] || undefined;
  return {
    operator,
    source: getRequestContext(req),
    expectedVersions: getExpectedVersionsFromRequest(req, body)
  };
}

const routes = [
  {
    method: "GET",
    pattern: /^\/imports\/versions$/,
    handler: async (_req, _res, _body) => getCurrentVersions()
  },
  {
    method: "POST",
    pattern: /^\/imports\/preview$/,
    handler: async (_req, _res, body) => store.previewImport(body.batches)
  },
  {
    method: "POST",
    pattern: /^\/imports\/confirm$/,
    handler: async (req, _res, body) => store.confirmImport(body.previewToken, body, makeCtx(req, body))
  }
];

const errorStatusMap = {
  invalid_input: 400,
  too_many_rows: 400,
  invalid_token: 400,
  token_not_found: 404,
  token_expired: 410,
  data_changed_since_preview: 409,
  version_conflict: 409,
  transaction_failed: 409,
  no_importable_rows: 409,
  site_disabled: 409
};

export async function handleImportRoutes(req, res, send, readBody) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const route of routes) {
    if (req.method !== route.method) continue;
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    const input = await readBody(req);
    const result = await route.handler(req, res, input, match);
    if (result.error) {
      send(res, errorStatusMap[result.error] || 400, result);
      return true;
    }
    const status = route.method === "POST" ? 201 : 200;
    send(res, status, result);
    return true;
  }
  return false;
}
