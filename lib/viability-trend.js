import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultSiteId, filterBatchesBySite } from "./data-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "rare-seeds.json");

const DEFAULT_OPTIONS = {
  lowRateThreshold: 0.6,
  consecutiveDeclineThreshold: 2,
  longTermDays: 90,
  minRecordsForTrend: 2,
  significantChangeThreshold: 0.05
};

async function loadDb() {
  if (!existsSync(dbPath)) return { batches: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(date1, date2) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs(date1.getTime() - date2.getTime()) / msPerDay;
}

function sortGerminations(germinations) {
  if (!Array.isArray(germinations)) return [];
  return [...germinations].sort((a, b) => {
    const da = parseDate(a.at);
    const db = parseDate(b.at);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.getTime() - db.getTime();
  });
}

function getLatestGermination(germinations) {
  const sorted = sortGerminations(germinations);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

function calculateTrendDirection(germinations, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sorted = sortGerminations(germinations);

  if (sorted.length < opts.minRecordsForTrend) {
    return { direction: "unknown", reason: "insufficient_data", change: 0 };
  }

  const rates = sorted.map(g => g.rate);
  const recentRates = rates.slice(-3);
  let declineCount = 0;
  let riseCount = 0;

  for (let i = 1; i < recentRates.length; i++) {
    const diff = recentRates[i] - recentRates[i - 1];
    if (diff < -opts.significantChangeThreshold) {
      declineCount++;
    } else if (diff > opts.significantChangeThreshold) {
      riseCount++;
    }
  }

  const firstRate = recentRates[0];
  const lastRate = recentRates[recentRates.length - 1];
  const overallChange = lastRate - firstRate;

  if (declineCount >= opts.consecutiveDeclineThreshold || overallChange < -opts.significantChangeThreshold) {
    return { direction: "declining", reason: declineCount >= opts.consecutiveDeclineThreshold ? "consecutive_decline" : "overall_decline", change: overallChange };
  } else if (riseCount >= 1 && overallChange > opts.significantChangeThreshold) {
    return { direction: "rising", reason: riseCount >= 2 ? "consecutive_rise" : "overall_rise", change: overallChange };
  } else {
    return { direction: "stable", reason: "no_significant_change", change: overallChange };
  }
}

function calculateRiskLevel(trendData, latestGermination, daysSinceLastTest, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!latestGermination) {
    return { level: "unknown", reasons: ["no_germination_data"] };
  }

  const reasons = [];

  if (latestGermination.rate < opts.lowRateThreshold) {
    reasons.push("rate_below_threshold");
  }

  if (trendData.direction === "declining") {
    reasons.push("declining_trend");
  }

  if (daysSinceLastTest > opts.longTermDays) {
    reasons.push("long_term_no_retest");
  }

  if (reasons.length === 0) {
    return { level: "normal", reasons: [] };
  } else if (reasons.includes("declining_trend") && latestGermination.rate < opts.lowRateThreshold) {
    return { level: "critical", reasons };
  } else if (reasons.length >= 2) {
    return { level: "warning", reasons };
  } else {
    return { level: "warning", reasons };
  }
}

export function analyzeBatchViability(batch, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const germinations = batch.germinations || [];
  const sortedGerminations = sortGerminations(germinations);
  const latest = getLatestGermination(germinations);

  const now = new Date();
  const latestDate = latest ? parseDate(latest.at) : null;
  const daysSinceLastTest = latestDate ? Math.floor(daysBetween(now, latestDate)) : null;

  const trend = calculateTrendDirection(germinations, opts);
  const risk = calculateRiskLevel(trend, latest, daysSinceLastTest, opts);

  return {
    batchId: batch.id,
    latestGermination: latest,
    latestRate: latest ? latest.rate : null,
    daysSinceLastTest,
    trendDirection: trend.direction,
    trendReason: trend.reason,
    trendChange: trend.change,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    germinationCount: sortedGerminations.length,
    germinationHistory: sortedGerminations
  };
}

export function getBatchTrendSummary(batch, options = {}) {
  const analysis = analyzeBatchViability(batch, options);
  return {
    latestRate: analysis.latestRate,
    latestRateFormatted: analysis.latestRate !== null ? `${(analysis.latestRate * 100).toFixed(1)}%` : null,
    trendDirection: analysis.trendDirection,
    riskLevel: analysis.riskLevel,
    daysSinceLastTest: analysis.daysSinceLastTest
  };
}

export function isRiskLevel(batch, level, options = {}) {
  const analysis = analyzeBatchViability(batch, options);
  return analysis.riskLevel === level;
}

export function filterBatchesByRisk(batches, riskLevel, options = {}) {
  return batches.filter(batch => {
    const analysis = analyzeBatchViability(batch, options);
    return analysis.riskLevel === riskLevel;
  });
}

export async function generateViabilityRiskReport(options = {}, siteIdParam = null) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const db = await loadDb();
  const defaultSiteId = getDefaultSiteId(db);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";
  const appliedFilter = siteIdParam ? (isGlobal ? "all" : "specified") : "default";

  let batches = db.batches || [];
  if (!isGlobal) {
    batches = filterBatchesBySite(batches, effectiveSiteId, defaultSiteId);
  }
  const now = new Date();

  const analyses = batches.map(batch => ({
    batch,
    analysis: analyzeBatchViability(batch, opts)
  }));

  const continuouslyDeclining = analyses.filter(({ analysis }) =>
    analysis.trendDirection === "declining" && analysis.trendReason === "consecutive_decline"
  ).map(({ batch, analysis }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    latestRate: analysis.latestRate,
    trendChange: analysis.trendChange,
    germinationCount: analysis.germinationCount,
    germinationHistory: analysis.germinationHistory.slice(-3)
  }));

  const belowThreshold = analyses.filter(({ analysis }) =>
    analysis.latestGermination && analysis.latestRate < opts.lowRateThreshold
  ).map(({ batch, analysis }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    latestRate: analysis.latestRate,
    latestRateFormatted: `${(analysis.latestRate * 100).toFixed(1)}%`,
    threshold: opts.lowRateThreshold,
    latestTestDate: analysis.latestGermination?.at
  }));

  const longTermNoRetest = analyses.filter(({ analysis }) =>
    analysis.daysSinceLastTest !== null && analysis.daysSinceLastTest > opts.longTermDays
  ).map(({ batch, analysis }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    latestRate: analysis.latestRate,
    daysSinceLastTest: analysis.daysSinceLastTest,
    latestTestDate: analysis.latestGermination?.at
  }));

  const riskSummary = {
    totalBatches: batches.length,
    criticalCount: analyses.filter(a => a.analysis.riskLevel === "critical").length,
    warningCount: analyses.filter(a => a.analysis.riskLevel === "warning").length,
    normalCount: analyses.filter(a => a.analysis.riskLevel === "normal").length,
    unknownCount: analyses.filter(a => a.analysis.riskLevel === "unknown").length
  };

  return {
    siteFilter: {
      siteId: isGlobal ? null : effectiveSiteId,
      applied: appliedFilter,
      note: isGlobal
        ? "全局活性风险报告（所有站点）"
        : siteIdParam
          ? `指定站点 ${effectiveSiteId} 活性风险报告`
          : `未传 siteId，使用默认站点 ${effectiveSiteId} 活性风险报告`
    },
    generatedAt: now.toISOString(),
    options: {
      lowRateThreshold: opts.lowRateThreshold,
      consecutiveDeclineThreshold: opts.consecutiveDeclineThreshold,
      longTermDays: opts.longTermDays,
      significantChangeThreshold: opts.significantChangeThreshold
    },
    summary: riskSummary,
    continuouslyDeclining,
    belowThreshold,
    longTermNoRetest,
    allAnalyses: analyses.map(({ batch, analysis }) => ({
      batchId: batch.id,
      siteId: batch.siteId || defaultSiteId,
      species: batch.species,
      latestRate: analysis.latestRate,
      trendDirection: analysis.trendDirection,
      riskLevel: analysis.riskLevel,
      riskReasons: analysis.riskReasons,
      daysSinceLastTest: analysis.daysSinceLastTest
    }))
  };
}

export async function getBatchViabilityAnalysis(batchId, options = {}) {
  const db = await loadDb();
  const batch = db.batches.find(b => b.id === batchId);
  if (!batch) return { error: "batch_not_found" };
  return analyzeBatchViability(batch, options);
}

export { DEFAULT_OPTIONS as VIABILITY_OPTIONS };
