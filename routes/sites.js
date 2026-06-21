import { listSites, getSite, createSite, updateSite } from "../lib/data-store.js";
import { makeCtx, createRouteHandler } from "../lib/utils.js";

const routes = [
  {
    method: "GET",
    pattern: /^\/sites$/,
    handler: async () => {
      const sites = await listSites();
      const defaultSite = sites.find(s => s.isDefault);
      return {
        total: sites.length,
        defaultSiteId: defaultSite ? defaultSite.id : null,
        sites
      };
    },
    successStatus: 200
  },
  {
    method: "GET",
    pattern: /^\/sites\/([^/]+)$/,
    handler: async (_req, _res, _body, params) => {
      const siteId = params[1];
      const site = await getSite(siteId);
      if (!site) return { error: "site_not_found" };
      return site;
    },
    successStatus: 200
  },
  {
    method: "POST",
    pattern: /^\/sites$/,
    handler: async (req, _res, body) => {
      const input = body;
      const ctx = makeCtx(req, input);
      if (!input.id) return { error: "missing_site_id" };
      const result = await createSite(input, ctx);
      if (result.error) return result;
      return result.site || result;
    },
    successStatus: 201
  },
  {
    method: "PATCH",
    pattern: /^\/sites\/([^/]+)$/,
    handler: async (req, _res, body, params) => {
      const siteId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
      const result = await updateSite(siteId, input, ctx);
      if (result.error) return result;
      return result.site || result;
    },
    successStatus: 200
  }
];

export const handleSiteRoutes = createRouteHandler(routes);
