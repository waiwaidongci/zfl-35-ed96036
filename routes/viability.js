import * as viabilityStore from "../lib/viability-trend.js";

const routes = [
  {
    method: "GET",
    pattern: /^\/reports\/viability-risk$/,
    handler: async (req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const options = {};
      const lowRateThreshold = url.searchParams.get("lowRateThreshold");
      const consecutiveDeclineThreshold = url.searchParams.get("consecutiveDeclineThreshold");
      const longTermDays = url.searchParams.get("longTermDays");
      const significantChangeThreshold = url.searchParams.get("significantChangeThreshold");

      if (lowRateThreshold) options.lowRateThreshold = Number(lowRateThreshold);
      if (consecutiveDeclineThreshold) options.consecutiveDeclineThreshold = Number(consecutiveDeclineThreshold);
      if (longTermDays) options.longTermDays = Number(longTermDays);
      if (significantChangeThreshold) options.significantChangeThreshold = Number(significantChangeThreshold);

      return viabilityStore.generateViabilityRiskReport(options);
    }
  },
  {
    method: "GET",
    pattern: /^\/batches\/([^/]+)\/viability$/,
    handler: async (req, _res, _body, params) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const options = {};
      const lowRateThreshold = url.searchParams.get("lowRateThreshold");
      const consecutiveDeclineThreshold = url.searchParams.get("consecutiveDeclineThreshold");
      const longTermDays = url.searchParams.get("longTermDays");
      const significantChangeThreshold = url.searchParams.get("significantChangeThreshold");

      if (lowRateThreshold) options.lowRateThreshold = Number(lowRateThreshold);
      if (consecutiveDeclineThreshold) options.consecutiveDeclineThreshold = Number(consecutiveDeclineThreshold);
      if (longTermDays) options.longTermDays = Number(longTermDays);
      if (significantChangeThreshold) options.significantChangeThreshold = Number(significantChangeThreshold);

      return viabilityStore.getBatchViabilityAnalysis(params[1], options);
    }
  }
];

export async function handleViabilityRoutes(req, res, send, readBody) {
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
        batch_not_found: 404
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
