import { getBatchTrendSummary } from "./viability-trend.js";

const VIABILITY_LABELS = {
  high: "高活性",
  medium: "中活性",
  low: "低活性",
  unknown: "待检测"
};

const RISK_LEVEL_LABELS = {
  normal: "正常",
  warning: "警告",
  critical: "严重",
  unknown: "未知"
};

function formatViability(viability) {
  return VIABILITY_LABELS[viability] || VIABILITY_LABELS.unknown;
}

function formatGerminationRate(rate) {
  if (rate === null || rate === undefined) return null;
  return `${(rate * 100).toFixed(1)}%`;
}

function formatQuantity(quantity) {
  return Number(quantity || 0).toLocaleString("zh-CN");
}

function getLatestGermination(germinations) {
  if (!germinations || germinations.length === 0) return null;
  const sorted = [...germinations].sort((a, b) => new Date(b.at) - new Date(a.at));
  return sorted[0];
}

function formatLocation(section, container, slotLocations) {
  if (slotLocations && slotLocations.length > 0) {
    return slotLocations.map(loc => `${loc.sectionName} / ${loc.boxName} / 格位${loc.slotIndex}`).join("; ");
  }
  if (section && container) {
    return `${section} / ${container}`;
  }
  return "未分配";
}

function formatRiskLevel(riskLevel) {
  return RISK_LEVEL_LABELS[riskLevel] || RISK_LEVEL_LABELS.unknown;
}

function countPendingAnomalies(anomalies) {
  if (!anomalies || !Array.isArray(anomalies)) return 0;
  return anomalies.filter(a => a.status === "pending").length;
}

function calculateAvailableQuantity(batch) {
  const quantity = Number(batch.quantity || 0);
  const frozen = Number(batch.frozenQuantity || 0);
  return Math.max(0, quantity - frozen);
}

function getSiteName(siteId, siteMap) {
  if (!siteId || !siteMap) return null;
  const site = siteMap[siteId];
  return site ? site.name : null;
}

export function buildLabel(batch, slotLocations, siteMap) {
  const latestGerm = getLatestGermination(batch.germinations);
  const trendSummary = getBatchTrendSummary(batch);
  const pendingAnomalyCount = countPendingAnomalies(batch.anomalies);
  const availableQuantity = calculateAvailableQuantity(batch);
  const siteId = batch.siteId || "SITE-001";
  const siteName = getSiteName(siteId, siteMap);

  return {
    batchId: batch.id,
    siteId: siteId,
    siteName: siteName,
    species: batch.species,
    collectionPlace: batch.collectionPlace,
    motherPlant: batch.motherPlant,
    quantity: batch.quantity,
    quantityFormatted: formatQuantity(batch.quantity),
    availableQuantity: availableQuantity,
    availableQuantityFormatted: formatQuantity(availableQuantity),
    frozenQuantity: Number(batch.frozenQuantity || 0),
    viability: batch.viability,
    viabilityLabel: formatViability(batch.viability),
    riskLevel: trendSummary.riskLevel,
    riskLevelLabel: formatRiskLevel(trendSummary.riskLevel),
    pendingAnomalyCount: pendingAnomalyCount,
    coldBoxLocation: formatLocation(batch.section, batch.container, slotLocations),
    section: batch.section,
    container: batch.container,
    slotLocations: slotLocations || [],
    latestGermination: latestGerm ? {
      at: latestGerm.at,
      sampled: latestGerm.sampled,
      sprouted: latestGerm.sprouted,
      rate: latestGerm.rate,
      rateFormatted: formatGerminationRate(latestGerm.rate)
    } : null,
    printedAt: new Date().toISOString()
  };
}

export function buildLabels(batches, slotLocationsMap, siteMap) {
  return batches.map(batch => buildLabel(batch, slotLocationsMap[batch.id] || [], siteMap));
}
