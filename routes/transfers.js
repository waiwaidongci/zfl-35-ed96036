import { createTransfer, shipTransfer, receiveTransfer, cancelTransfer, getTransfer, listTransfers } from "../lib/transfer-store.js";
import { makeCtx, createRouteHandler } from "../lib/utils.js";

const routes = [
  {
    method: "POST",
    pattern: /^\/transfers$/,
    handler: async (req, _res, body) => {
      const input = body;
      const ctx = makeCtx(req, input);
      const result = await createTransfer(input, ctx);
      if (result.error) return result;
      return result.transfer || result;
    },
    successStatus: 201
  },
  {
    method: "GET",
    pattern: /^\/transfers$/,
    handler: async (_req, _res, _body, _params, url) => {
      const filters = {
        status: url.searchParams.get("status") || "",
        sourceSiteId: url.searchParams.get("sourceSiteId") || "",
        targetSiteId: url.searchParams.get("targetSiteId") || "",
        siteId: url.searchParams.get("siteId") || "",
        sourceBatchId: url.searchParams.get("sourceBatchId") || "",
        targetBatchId: url.searchParams.get("targetBatchId") || "",
        targetMode: url.searchParams.get("targetMode") || ""
      };
      const hasFilters = Object.values(filters).some(v => v);
      const result = await listTransfers(hasFilters ? filters : {});
      return result;
    },
    successStatus: 200
  },
  {
    method: "GET",
    pattern: /^\/transfers\/([^/]+)$/,
    handler: async (_req, _res, _body, params) => {
      const transferId = params[1];
      const result = await getTransfer(transferId);
      if (result.error) return result;
      return result.transfer;
    },
    successStatus: 200
  },
  {
    method: "PATCH",
    pattern: /^\/transfers\/([^/]+)\/ship$/,
    handler: async (req, _res, body, params) => {
      const transferId = params[1];
      const ctx = makeCtx(req, body);
      const result = await shipTransfer(transferId, ctx);
      if (result.error) return result;
      return result;
    },
    successStatus: 200
  },
  {
    method: "PATCH",
    pattern: /^\/transfers\/([^/]+)\/receive$/,
    handler: async (req, _res, body, params) => {
      const transferId = params[1];
      const input = body;
      const ctx = makeCtx(req, input);
      const result = await receiveTransfer(transferId, input, ctx);
      if (result.error) return result;
      return result;
    },
    successStatus: 200
  },
  {
    method: "PATCH",
    pattern: /^\/transfers\/([^/]+)\/cancel$/,
    handler: async (req, _res, body, params) => {
      const transferId = params[1];
      const ctx = makeCtx(req, body);
      const result = await cancelTransfer(transferId, ctx);
      if (result.error) return result;
      return result;
    },
    successStatus: 200
  }
];

export const handleTransferRoutes = createRouteHandler(routes);
