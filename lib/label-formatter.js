const VIABILITY_LABELS = {
  high: "高活性",
  medium: "中活性",
  low: "低活性",
  unknown: "待检测"
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

export function buildLabel(batch, slotLocations) {
  const latestGerm = getLatestGermination(batch.germinations);

  return {
    batchId: batch.id,
    siteId: batch.siteId || "SITE-001",
    species: batch.species,
    collectionPlace: batch.collectionPlace,
    motherPlant: batch.motherPlant,
    quantity: batch.quantity,
    quantityFormatted: formatQuantity(batch.quantity),
    viability: batch.viability,
    viabilityLabel: formatViability(batch.viability),
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

export function buildLabels(batches, slotLocationsMap) {
  return batches.map(batch => buildLabel(batch, slotLocationsMap[batch.id] || []));
}
