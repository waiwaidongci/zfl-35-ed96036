import { getInventoryWithFrozen } from "../lib/reservation-store.js";
import * as viabilityStore from "../lib/viability-trend.js";
import { createRouteHandler } from "../lib/utils.js";

function parseRetestOptions(url) {
  const options = {};
  const lowRateThreshold = url.searchParams.get("lowRateThreshold");
  const consecutiveDeclineThreshold = url.searchParams.get("consecutiveDeclineThreshold");
  const longTermDays = url.searchParams.get("longTermDays");
  const significantChangeThreshold = url.searchParams.get("significantChangeThreshold");
  const standardRetestIntervalDays = url.searchParams.get("standardRetestIntervalDays");
  const highPriorityRetestDays = url.searchParams.get("highPriorityRetestDays");
  const mediumPriorityRetestDays = url.searchParams.get("mediumPriorityRetestDays");
  const lowPriorityRetestDays = url.searchParams.get("lowPriorityRetestDays");

  if (lowRateThreshold) options.lowRateThreshold = Number(lowRateThreshold);
  if (consecutiveDeclineThreshold) options.consecutiveDeclineThreshold = Number(consecutiveDeclineThreshold);
  if (longTermDays) options.longTermDays = Number(longTermDays);
  if (significantChangeThreshold) options.significantChangeThreshold = Number(significantChangeThreshold);
  if (standardRetestIntervalDays) options.standardRetestIntervalDays = Number(standardRetestIntervalDays);
  if (highPriorityRetestDays) options.highPriorityRetestDays = Number(highPriorityRetestDays);
  if (mediumPriorityRetestDays) options.mediumPriorityRetestDays = Number(mediumPriorityRetestDays);
  if (lowPriorityRetestDays) options.lowPriorityRetestDays = Number(lowPriorityRetestDays);

  return options;
}

const routes = [
  {
    method: "GET",
    pattern: /^\/reports\/inventory$/,
    handler: async (_req, _res, _body, _params, url) => {
      const siteIdParam = url.searchParams.get("siteId");
      const reservationStatus = url.searchParams.get("reservationStatus") || "";
      const reservationFilters = {
        status: reservationStatus,
        applicant: url.searchParams.get("applicant") || "",
        plannedDateFrom: url.searchParams.get("plannedDateFrom") || "",
        plannedDateTo: url.searchParams.get("plannedDateTo") || ""
      };
      const hasFilters = Object.values(reservationFilters).some(v => v);
      const report = await getInventoryWithFrozen(siteIdParam || null, hasFilters ? reservationFilters : null);
      return report;
    },
    successStatus: 200
  },
  {
    method: "GET",
    pattern: /^\/reports\/viability-risk$/,
    handler: async (_req, _res, _body, _params, url) => {
      const options = parseRetestOptions(url);
      const siteId = url.searchParams.get("siteId") || null;
      return viabilityStore.generateRetestPlanReport(options, siteId);
    },
    successStatus: 200
  },
  {
    method: "GET",
    pattern: /^\/reports\/retest-plan$/,
    handler: async (_req, _res, _body, _params, url) => {
      const options = parseRetestOptions(url);
      const siteId = url.searchParams.get("siteId") || null;
      return viabilityStore.generateRetestPlanReport(options, siteId);
    },
    successStatus: 200
  },
  {
    method: "GET",
    pattern: /^\/reports\/retest-batches$/,
    handler: async (_req, _res, _body, _params, url) => {
      const options = parseRetestOptions(url);
      const siteId = url.searchParams.get("siteId") || null;
      return viabilityStore.getRetestBatchList(options, siteId);
    },
    successStatus: 200
  }
];

export const handleReportRoutes = createRouteHandler(routes);
