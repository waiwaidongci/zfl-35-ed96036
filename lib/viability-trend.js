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
  significantChangeThreshold: 0.05,
  standardRetestIntervalDays: 180,
  highPriorityRetestDays: 14,
  mediumPriorityRetestDays: 30,
  lowPriorityRetestDays: 60,
  veryHighRateCriticalDays: 365
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
  const retest = calculateRetestPlan(batch, opts);

  return {
    batchId: batch.id,
    species: batch.species,
    siteId: batch.siteId,
    collectionPlace: batch.collectionPlace,
    latestGermination: latest,
    latestRate: latest ? latest.rate : null,
    latestRateFormatted: latest ? `${(latest.rate * 100).toFixed(1)}%` : null,
    daysSinceLastTest,
    trendDirection: trend.direction,
    trendReason: trend.reason,
    trendChange: trend.change,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    germinationCount: sortedGerminations.length,
    germinationHistory: sortedGerminations,
    retestPriority: retest.retestPriority,
    suggestedRetestDate: retest.suggestedRetestDate,
    retestReasons: retest.retestReasons,
    ruleTriggers: retest.ruleTriggers,
    priorityScore: retest.priorityScore,
    pendingReviewCount: retest.pendingReviewCount,
    lastTestDate: retest.lastTestDate,
    retestIntervalDays: retest.retestIntervalDays
  };
}

export function getBatchTrendSummary(batch, options = {}) {
  const analysis = analyzeBatchViability(batch, options);
  const retest = getBatchRetestSummary(batch, options);
  return {
    latestRate: analysis.latestRate,
    latestRateFormatted: analysis.latestRateFormatted,
    trendDirection: analysis.trendDirection,
    riskLevel: analysis.riskLevel,
    daysSinceLastTest: analysis.daysSinceLastTest,
    ...retest
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

function hasPendingReviews(batch) {
  return Array.isArray(batch.reviews) && batch.reviews.some(r => r.conclusion === "pending");
}

function getPendingReviewCount(batch) {
  if (!Array.isArray(batch.reviews)) return 0;
  return batch.reviews.filter(r => r.conclusion === "pending").length;
}

export function calculateRetestPlan(batch, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = new Date();
  const reasons = [];
  const ruleTriggers = [];
  let priorityScore = 0;

  const germinations = batch.germinations || [];
  const sortedGerminations = sortGerminations(germinations);
  const latest = getLatestGermination(germinations);
  const latestDate = latest ? parseDate(latest.at) : null;
  const daysSinceLastTest = latestDate ? Math.floor(daysBetween(now, latestDate)) : null;
  const trend = calculateTrendDirection(germinations, opts);
  const latestRate = latest ? latest.rate : null;

  if (!latest) {
    reasons.push("no_germination_record");
    ruleTriggers.push({ rule: "no_germination_record", description: "缺少萌发实验记录，需建立基线数据" });
    priorityScore += 100;
  } else {
    if (latestRate < opts.lowRateThreshold) {
      reasons.push("rate_below_threshold");
      ruleTriggers.push({
        rule: "rate_below_threshold",
        description: `萌发率 ${(latestRate * 100).toFixed(1)}% 低于阈值 ${(opts.lowRateThreshold * 100).toFixed(1)}%`,
        currentRate: latestRate,
        threshold: opts.lowRateThreshold
      });
      priorityScore += 50;
    }

    if (trend.direction === "declining") {
      reasons.push("declining_trend");
      ruleTriggers.push({
        rule: "declining_trend",
        description: trend.reason === "consecutive_decline"
          ? `连续 ${opts.consecutiveDeclineThreshold} 次萌发率下降`
          : "整体呈下降趋势",
        trendChange: trend.change
      });
      priorityScore += trend.reason === "consecutive_decline" ? 45 : 30;
    }

    if (daysSinceLastTest > opts.longTermDays) {
      reasons.push("long_term_no_retest");
      ruleTriggers.push({
        rule: "long_term_no_retest",
        description: `距上次萌发实验 ${daysSinceLastTest} 天，超过建议周期 ${opts.longTermDays} 天`,
        daysSinceLastTest,
        threshold: opts.longTermDays
      });
      priorityScore += 35;
    }

    if (latestRate >= opts.lowRateThreshold && daysSinceLastTest > opts.veryHighRateCriticalDays) {
      reasons.push("exceeds_annual_interval");
      ruleTriggers.push({
        rule: "exceeds_annual_interval",
        description: `距上次检测 ${daysSinceLastTest} 天，已超年度复测周期`,
        daysSinceLastTest
      });
      priorityScore += 20;
    }
  }

  if (hasPendingReviews(batch)) {
    const pendingCount = getPendingReviewCount(batch);
    reasons.push("pending_review");
    ruleTriggers.push({
      rule: "pending_review",
      description: `存在 ${pendingCount} 条待复核记录`,
      pendingCount
    });
    priorityScore += 40;
  }

  let retestPriority;
  if (priorityScore >= 100) {
    retestPriority = "urgent";
  } else if (priorityScore >= 70) {
    retestPriority = "high";
  } else if (priorityScore >= 40) {
    retestPriority = "medium";
  } else if (priorityScore > 0) {
    retestPriority = "low";
  } else {
    retestPriority = "none";
  }

  let suggestedRetestDate = null;
  let retestIntervalDays = opts.standardRetestIntervalDays;

  if (retestPriority === "urgent") {
    retestIntervalDays = 7;
  } else if (retestPriority === "high") {
    retestIntervalDays = opts.highPriorityRetestDays;
  } else if (retestPriority === "medium") {
    retestIntervalDays = opts.mediumPriorityRetestDays;
  } else if (retestPriority === "low") {
    retestIntervalDays = opts.lowPriorityRetestDays;
  }

  if (retestPriority === "none" && latestDate) {
    suggestedRetestDate = new Date(latestDate.getTime() + opts.standardRetestIntervalDays * 24 * 60 * 60 * 1000);
  } else {
    suggestedRetestDate = new Date(now.getTime() + retestIntervalDays * 24 * 60 * 60 * 1000);
  }

  return {
    batchId: batch.id,
    species: batch.species,
    siteId: batch.siteId,
    collectionPlace: batch.collectionPlace,
    retestPriority,
    priorityScore,
    retestReasons: reasons,
    ruleTriggers,
    suggestedRetestDate: suggestedRetestDate.toISOString().slice(0, 10),
    retestIntervalDays,
    latestRate,
    latestRateFormatted: latestRate !== null ? `${(latestRate * 100).toFixed(1)}%` : null,
    daysSinceLastTest,
    lastTestDate: latestDate ? latestDate.toISOString().slice(0, 10) : null,
    trendDirection: trend.direction,
    pendingReviewCount: getPendingReviewCount(batch),
    germinationCount: sortedGerminations.length
  };
}

export function getBatchRetestSummary(batch, options = {}) {
  const plan = calculateRetestPlan(batch, options);
  return {
    retestPriority: plan.retestPriority,
    suggestedRetestDate: plan.suggestedRetestDate,
    retestReasons: plan.retestReasons,
    priorityScore: plan.priorityScore,
    pendingReviewCount: plan.pendingReviewCount
  };
}

export function filterBatchesByRetestPriority(batches, priority, options = {}) {
  return batches.filter(batch => {
    const plan = calculateRetestPlan(batch, options);
    if (priority === "all_need_retest") {
      return plan.retestPriority !== "none";
    }
    return plan.retestPriority === priority;
  });
}

export async function generateRetestPlanReport(options = {}, siteIdParam = null) {
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
    viabilityAnalysis: analyzeBatchViability(batch, opts),
    retestPlan: calculateRetestPlan(batch, opts)
  }));

  const needRetest = analyses.filter(({ retestPlan }) => retestPlan.retestPriority !== "none");
  const urgent = analyses.filter(({ retestPlan }) => retestPlan.retestPriority === "urgent");
  const high = analyses.filter(({ retestPlan }) => retestPlan.retestPriority === "high");
  const medium = analyses.filter(({ retestPlan }) => retestPlan.retestPriority === "medium");
  const low = analyses.filter(({ retestPlan }) => retestPlan.retestPriority === "low");

  const formatRetestItem = ({ retestPlan }) => ({
    ...retestPlan
  });

  const retestBatchList = needRetest
    .sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const pa = priorityOrder[a.retestPlan.retestPriority];
      const pb = priorityOrder[b.retestPlan.retestPriority];
      if (pa !== pb) return pa - pb;
      return b.retestPlan.priorityScore - a.retestPlan.priorityScore;
    })
    .map(formatRetestItem);

  const priorityCounts = {
    urgent: urgent.length,
    high: high.length,
    medium: medium.length,
    low: low.length,
    none: analyses.length - needRetest.length
  };

  const reasonBreakdown = {};
  for (const { retestPlan } of needRetest) {
    for (const reason of retestPlan.retestReasons) {
      reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + 1;
    }
  }

  const riskSummary = {
    totalBatches: batches.length,
    criticalCount: analyses.filter(a => a.viabilityAnalysis.riskLevel === "critical").length,
    warningCount: analyses.filter(a => a.viabilityAnalysis.riskLevel === "warning").length,
    normalCount: analyses.filter(a => a.viabilityAnalysis.riskLevel === "normal").length,
    unknownCount: analyses.filter(a => a.viabilityAnalysis.riskLevel === "unknown").length
  };

  const retestSummary = {
    totalBatches: batches.length,
    needRetestCount: needRetest.length,
    retestRate: batches.length > 0 ? Number((needRetest.length / batches.length).toFixed(3)) : 0,
    priorityCounts,
    reasonBreakdown
  };

  const continuouslyDeclining = analyses.filter(({ viabilityAnalysis }) =>
    viabilityAnalysis.trendDirection === "declining" && viabilityAnalysis.trendReason === "consecutive_decline"
  ).map(({ batch, viabilityAnalysis, retestPlan }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    latestRate: viabilityAnalysis.latestRate,
    trendChange: viabilityAnalysis.trendChange,
    germinationCount: viabilityAnalysis.germinationCount,
    germinationHistory: viabilityAnalysis.germinationHistory.slice(-3),
    retestPriority: retestPlan.retestPriority,
    suggestedRetestDate: retestPlan.suggestedRetestDate
  }));

  const belowThreshold = analyses.filter(({ viabilityAnalysis }) =>
    viabilityAnalysis.latestGermination && viabilityAnalysis.latestRate < opts.lowRateThreshold
  ).map(({ batch, viabilityAnalysis, retestPlan }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    latestRate: viabilityAnalysis.latestRate,
    latestRateFormatted: `${(viabilityAnalysis.latestRate * 100).toFixed(1)}%`,
    threshold: opts.lowRateThreshold,
    latestTestDate: viabilityAnalysis.latestGermination?.at,
    retestPriority: retestPlan.retestPriority,
    suggestedRetestDate: retestPlan.suggestedRetestDate
  }));

  const longTermNoRetest = analyses.filter(({ viabilityAnalysis }) =>
    viabilityAnalysis.daysSinceLastTest !== null && viabilityAnalysis.daysSinceLastTest > opts.longTermDays
  ).map(({ batch, viabilityAnalysis, retestPlan }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    latestRate: viabilityAnalysis.latestRate,
    daysSinceLastTest: viabilityAnalysis.daysSinceLastTest,
    latestTestDate: viabilityAnalysis.latestGermination?.at,
    retestPriority: retestPlan.retestPriority,
    suggestedRetestDate: retestPlan.suggestedRetestDate
  }));

  const pendingReviewBatches = analyses.filter(({ batch }) =>
    hasPendingReviews(batch)
  ).map(({ batch, retestPlan }) => ({
    batchId: batch.id,
    siteId: batch.siteId || defaultSiteId,
    species: batch.species,
    pendingReviewCount: getPendingReviewCount(batch),
    latestRate: retestPlan.latestRate,
    lastTestDate: retestPlan.lastTestDate,
    retestPriority: retestPlan.retestPriority,
    suggestedRetestDate: retestPlan.suggestedRetestDate
  }));

  return {
    reportType: "retest_plan",
    siteFilter: {
      siteId: isGlobal ? null : effectiveSiteId,
      applied: appliedFilter,
      note: isGlobal
        ? "全局复测计划报告（所有站点）"
        : siteIdParam
          ? `指定站点 ${effectiveSiteId} 复测计划报告`
          : `未传 siteId，使用默认站点 ${effectiveSiteId} 复测计划报告`
    },
    generatedAt: now.toISOString(),
    options: {
      lowRateThreshold: opts.lowRateThreshold,
      consecutiveDeclineThreshold: opts.consecutiveDeclineThreshold,
      longTermDays: opts.longTermDays,
      significantChangeThreshold: opts.significantChangeThreshold,
      standardRetestIntervalDays: opts.standardRetestIntervalDays,
      highPriorityRetestDays: opts.highPriorityRetestDays,
      mediumPriorityRetestDays: opts.mediumPriorityRetestDays,
      lowPriorityRetestDays: opts.lowPriorityRetestDays
    },
    riskSummary,
    retestSummary,
    retestBatchList,
    continuouslyDeclining,
    belowThreshold,
    longTermNoRetest,
    pendingReviewBatches,
    allAnalyses: analyses.map(({ viabilityAnalysis, retestPlan }) => ({
      ...retestPlan,
      riskLevel: viabilityAnalysis.riskLevel,
      riskReasons: viabilityAnalysis.riskReasons
    }))
  };
}

export async function getRetestBatchList(options = {}, siteIdParam = null) {
  const report = await generateRetestPlanReport(options, siteIdParam);
  return {
    reportType: "retest_batch_list",
    siteFilter: report.siteFilter,
    generatedAt: report.generatedAt,
    options: report.options,
    retestSummary: report.retestSummary,
    retestBatchList: report.retestBatchList
  };
}

export async function getBatchRetestPlan(batchId, options = {}) {
  const db = await loadDb();
  const batch = db.batches.find(b => b.id === batchId);
  if (!batch) return { error: "batch_not_found" };
  return calculateRetestPlan(batch, options);
}
