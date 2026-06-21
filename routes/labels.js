import { buildLabel, buildLabels } from "../lib/label-formatter.js";
import * as locationStore from "../lib/location-store.js";
import { loadDb, getDefaultSiteId, filterBatchesBySite } from "../lib/data-store.js";

function buildSiteMap(db) {
  const map = {};
  for (const site of (db.sites || [])) {
    map[site.id] = site;
  }
  return map;
}

async function getBatchSlotLocations(batchIds) {
  const map = {};
  for (const id of batchIds) {
    map[id] = await locationStore.getBatchLocations(id);
  }
  return map;
}

const routes = [
  {
    method: "GET",
    pattern: /^\/labels\/batches\/([^/]+)$/,
    handler: async (_req, _res, _body, params) => {
      const db = await loadDb();
      const siteMap = buildSiteMap(db);
      const batch = db.batches.find(b => b.id === params[1]);
      if (!batch) return { error: "batch_not_found" };
      const slotLocations = await locationStore.getBatchLocations(batch.id);
      return buildLabel(batch, slotLocations, siteMap);
    }
  },
  {
    method: "GET",
    pattern: /^\/labels\/batches$/,
    handler: async (req) => {
      const db = await loadDb();
      const siteMap = buildSiteMap(db);
      const url = new URL(req.url, `http://${req.headers.host}`);
      let batches = db.batches;
      const defaultSiteId = getDefaultSiteId(db);
      const siteIdParam = url.searchParams.get("siteId") || null;
      const effectiveSiteId = siteIdParam || defaultSiteId;
      if (effectiveSiteId !== "all") {
        batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
      }
      for (const key of ["species", "collectionPlace", "section", "viability"]) {
        const value = url.searchParams.get(key);
        if (value) {
          batches = batches.filter(batch => String(batch[key]).includes(value));
        }
      }
      const batchIds = batches.map(b => b.id);
      const slotLocationsMap = await getBatchSlotLocations(batchIds);
      return buildLabels(batches, slotLocationsMap, siteMap);
    }
  },
  {
    method: "POST",
    pattern: /^\/labels\/batches\/batch$/,
    handler: async (_req, _res, body) => {
      const db = await loadDb();
      const siteMap = buildSiteMap(db);
      const ids = body.ids || [];
      const batches = db.batches.filter(b => ids.includes(b.id));
      const batchIds = batches.map(b => b.id);
      const slotLocationsMap = await getBatchSlotLocations(batchIds);
      return buildLabels(batches, slotLocationsMap, siteMap);
    }
  }
];

export async function handleLabelRoutes(req, res, send, readBody) {
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
