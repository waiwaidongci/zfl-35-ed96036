import http from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLocationRoutes } from "./routes/locations.js";
import { handleLabelRoutes } from "./routes/labels.js";
import { handleReservationRoutes } from "./routes/reservations.js";
import { handleAnomalyRoutes } from "./routes/anomalies.js";
import { handleViabilityRoutes } from "./routes/viability.js";
import { handleImportRoutes } from "./routes/imports.js";
import { handleAuditRoutes } from "./routes/audit.js";
import { handleSiteRoutes } from "./routes/sites.js";
import { handleBatchRoutes } from "./routes/batches.js";
import { handleTransferRoutes } from "./routes/transfers.js";
import { handleReportRoutes } from "./routes/reports.js";
import { loadDb, loadDbWithVersion, getCurrentVersions } from "./lib/data-store.js";
import { body, send } from "./lib/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3035);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (await handleLocationRoutes(req, res, send, body)) return;
    if (await handleLabelRoutes(req, res, send, body)) return;
    if (await handleReservationRoutes(req, res, send, body)) return;
    if (await handleAnomalyRoutes(req, res, send, body)) return;
    if (await handleViabilityRoutes(req, res, send, body)) return;
    if (await handleImportRoutes(req, res, send, body)) return;
    if (await handleAuditRoutes(req, res, send, body)) return;
    if (await handleSiteRoutes(req, res, send, body)) return;
    if (await handleBatchRoutes(req, res, send, body)) return;
    if (await handleTransferRoutes(req, res, send, body)) return;
    if (await handleReportRoutes(req, res, send, body)) return;

    if (req.method === "GET" && url.pathname === "/") {
      const endpoints = [
        "GET /version",
        "GET /sites",
        "GET /sites/:id",
        "POST /sites",
        "PATCH /sites/:id",
        "GET /temperature-thresholds?siteId=",
        "PATCH /temperature-thresholds/site/:siteId",
        "PATCH /temperature-thresholds/section/:sectionId",
        "GET /batches?siteId=&species=&collectionPlace=&section=&viability=&hasPendingReview=&status=&riskLevel=&retestPriority=",
        "POST /batches",
        "GET /batches/:id",
        "PATCH /batches/:id/remark",
        "GET /batches/:id/reviews",
        "POST /batches/:id/reviews",
        "POST /batches/:id/transactions",
        "POST /batches/:id/temperatures",
        "POST /batches/:id/germinations",
        "POST /batches/:id/reservations",
        "GET /batches/:id/reservations?status=",
        "PATCH /batches/:id/reservations/:reservationId/approve",
        "PATCH /batches/:id/reservations/:reservationId/reject",
        "PATCH /batches/:id/reservations/:reservationId/cancel",
        "POST /batches/:id/reservations/:reservationId/fulfill",
        "POST /batches/:id/split",
        "POST /batches/merge",
        "POST /transfers",
        "GET /transfers?status=&sourceSiteId=&targetSiteId=&siteId=&sourceBatchId=&targetBatchId=&targetMode=",
        "GET /transfers/:id",
        "PATCH /transfers/:id/ship",
        "PATCH /transfers/:id/receive",
        "PATCH /transfers/:id/cancel",
        "GET /anomalies/pending?siteId=",
        "GET /batches/:id/anomalies?status=",
        "PATCH /batches/:id/anomalies/:anomalyId/handle",
        "POST /anomalies/scan?batchId=&threshold=&siteId=",
        "GET /reservations?status=&applicant=&plannedDateFrom=&plannedDateTo=&siteId=",
        "GET /reports/inventory?siteId=&applicant=&plannedDateFrom=&plannedDateTo=&reservationStatus=",
        "GET /reports/viability-risk?siteId=&lowRateThreshold=&consecutiveDeclineThreshold=&longTermDays=",
        "GET /reports/retest-plan?siteId=&lowRateThreshold=&longTermDays=&standardRetestIntervalDays=",
        "GET /reports/retest-batches?siteId=&lowRateThreshold=",
        "GET /batches/:id/viability",
        "GET /batches/:id/retest-plan",
        "GET /locations/sites",
        "GET /locations/sections?siteId=",
        "POST /locations/sections",
        "GET /locations/sections/:id",
        "GET /locations/sections/:id/free-slots",
        "POST /locations/sections/:id/boxes",
        "GET /locations/boxes/:id",
        "PATCH /locations/boxes/:id/slots/:index",
        "GET /locations/batches/:id/slots",
        "GET /labels/batches/:id",
        "GET /labels/batches?siteId=&species=&collectionPlace=&section=&viability=",
        "POST /labels/batches/batch",
        "GET /imports/versions",
        "POST /imports/preview",
        "POST /imports/confirm",
        "GET /audit-logs?siteId=",
        "GET /audit-logs/stats",
        "GET /batches/:id/history/timeline",
        "GET /batches/:id/history/replay"
      ];
      return send(res, 200, { service: "稀有种子冷库库存和活性追踪API（多站点版）", endpoints });
    }

    if (req.method === "GET" && url.pathname === "/version") {
      const versions = await getCurrentVersions();
      return send(res, 200, versions);
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

async function bootstrap() {
  await loadDb();
  server.listen(port, () => console.log(`Rare seed cold storage API listening on http://localhost:${port}`));
}

bootstrap();
