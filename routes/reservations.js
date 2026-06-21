import * as store from "../lib/reservation-store.js";
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
    pattern: /^\/reservations$/,
    handler: async (req, _res, _body) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        status: url.searchParams.get("status") || "",
        applicant: url.searchParams.get("applicant") || "",
        plannedDateFrom: url.searchParams.get("plannedDateFrom") || "",
        plannedDateTo: url.searchParams.get("plannedDateTo") || "",
        siteId: url.searchParams.get("siteId") || ""
      };
      return store.listAllReservations(filters);
    }
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/reservations$/,
    handler: async (req, _res, body, params) => store.createReservation(params[1], body, makeCtx(req, body))
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)\/reservations$/,
    handler: async (req, _res, _body, params) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const status = url.searchParams.get("status") || "";
      return store.listReservations(params[1], status);
    }
  },
  {
    method: "PATCH",
    pattern: /^\/batches\/([^/]+)\/reservations\/([^/]+)\/approve$/,
    handler: async (req, _res, body, params) => store.approveReservation(params[1], params[2], makeCtx(req, body))
  },
  {
    method: "PATCH",
    pattern: /^\/batches\/([^/]+)\/reservations\/([^/]+)\/reject$/,
    handler: async (req, _res, body, params) => store.rejectReservation(params[1], params[2], makeCtx(req, body))
  },
  {
    method: "PATCH",
    pattern: /^\/batches\/([^/]+)\/reservations\/([^/]+)\/cancel$/,
    handler: async (req, _res, body, params) => store.cancelReservation(params[1], params[2], makeCtx(req, body))
  },
  {
    method: "POST",
    pattern: /^\/batches\/([^/]+)\/reservations\/([^/]+)\/fulfill$/,
    handler: async (req, _res, body, params) => store.fulfillReservation(params[1], params[2], makeCtx(req, body))
  }
];

export async function handleReservationRoutes(req, res, send, readBody) {
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
        reservation_not_found: 404,
        invalid_quantity: 400,
        invalid_status_transition: 409,
        insufficient_available_quantity: 409,
        negative_inventory_blocked: 409
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
