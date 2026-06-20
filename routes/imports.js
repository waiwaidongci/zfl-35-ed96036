import * as store from "../lib/import-store.js";

const routes = [
  {
    method: "POST",
    pattern: /^\/imports\/preview$/,
    handler: async (_req, _res, body) => store.previewImport(body.batches)
  },
  {
    method: "POST",
    pattern: /^\/imports\/confirm$/,
    handler: async (_req, _res, body) => store.confirmImport(body.previewToken, body)
  }
];

const errorStatusMap = {
  invalid_input: 400,
  too_many_rows: 400,
  invalid_token: 400,
  token_not_found: 404,
  token_expired: 410,
  data_changed_since_preview: 409,
  no_importable_rows: 409
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
