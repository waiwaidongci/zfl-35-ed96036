import { getExpectedVersionsFromRequest, getRequestContext } from "./data-store.js";

export async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function extractOperator(req, input) {
  if (input && input.operator) return input.operator;
  const headers = (req && req.headers) || {};
  return headers["x-operator"] || headers["x-user"] || undefined;
}

export function makeCtx(req, input = {}) {
  return {
    operator: extractOperator(req, input),
    source: getRequestContext(req),
    expectedVersions: getExpectedVersionsFromRequest(req, input)
  };
}

export const ERROR_STATUS_MAP = {
  batch_not_found: 404,
  site_not_found: 404,
  source_site_not_found: 404,
  target_site_not_found: 404,
  merge_target_not_found: 404,
  reservation_not_found: 404,
  anomaly_not_found: 404,
  section_not_found: 404,
  box_not_found: 404,
  transfer_not_found: 404,
  token_not_found: 404,
  version_conflict: 409,
  transaction_failed: 409,
  site_already_exists: 409,
  default_site_cannot_disable: 409,
  invalid_quantity: 400,
  negative_inventory_blocked: 409,
  insufficient_available_quantity: 409,
  invalid_status_transition: 409,
  batch_not_active: 409,
  site_disabled: 409,
  site_mismatch: 409,
  section_box_mismatch: 409,
  slot_already_occupied: 409,
  transfer_merge_mismatch: 409,
  merge_target_not_active: 409,
  merge_target_site_mismatch: 409,
  inconsistent_in_transit_quantity: 500,
  anomaly_already_handled: 409,
  batch_site_mismatch: 409,
  invalid_threshold: 400,
  invalid_input: 400,
  too_many_rows: 400,
  invalid_token: 400,
  token_expired: 410,
  data_changed_since_preview: 409,
  no_importable_rows: 409,
  invalid_target_time: 400,
  slot_index_out_of_range: 400,
  section_already_exists: 409,
  box_already_exists: 409,
  batch_id_conflict: 409,
  insufficient_batches: 409,
  merge_mismatch: 409,
  invalid_split_items: 409,
  missing_container_or_section: 409,
  missing_site_id: 400
};

export function mutationStatus(result, fallback = 409) {
  if (!result || !result.error) return null;
  return ERROR_STATUS_MAP[result.error] || fallback;
}

export function getErrorStatus(error, fallback = 400) {
  return ERROR_STATUS_MAP[error] || fallback;
}

export function matchRoute(pathname, pattern) {
  const match = pathname.match(pattern);
  if (!match) return null;
  return match.map((v, i) => (i === 0 ? v : decodeURIComponent(v)));
}

export function createRouteHandler(routes, defaultStatusMap = {}) {
  return async function handleRoutes(req, res, sendFn, readBody) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    for (const route of routes) {
      if (req.method !== route.method) continue;
      const decoded = matchRoute(url.pathname, route.pattern);
      if (!decoded) continue;
      const input = route.method === "GET" ? {} : await readBody(req);
      const result = await route.handler(req, res, input, decoded, url);
      if (result === null) {
        sendFn(res, 404, { error: "not_found" });
        return true;
      }
      if (result.error) {
        const statusMap = { ...ERROR_STATUS_MAP, ...defaultStatusMap, ...(route.statusMap || {}) };
        sendFn(res, statusMap[result.error] || 400, result);
        return true;
      }
      const successStatus = route.successStatus || (req.method === "POST" ? 201 : 200);
      sendFn(res, successStatus, result);
      return true;
    }
    return false;
  };
}
