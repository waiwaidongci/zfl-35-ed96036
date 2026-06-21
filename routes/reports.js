import { getInventoryWithFrozen } from "../lib/reservation-store.js";
import { createRouteHandler } from "../lib/utils.js";

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
  }
];

export const handleReportRoutes = createRouteHandler(routes);
