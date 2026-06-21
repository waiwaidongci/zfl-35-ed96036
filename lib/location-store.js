import { mutate, loadLocDb, loadDb, OPERATION, clone, getDefaultSiteId, isSiteDisabled } from "./data-store.js";

function filterSectionsBySite(sections, siteId, defaultSiteId) {
  return sections.filter(s => (s.siteId || defaultSiteId) === siteId);
}

function findSection(db, sectionId) {
  return db.sections.find(s => s.id === sectionId) || null;
}

function findBox(db, boxId) {
  for (const sec of db.sections) {
    const box = sec.boxes.find(b => b.id === boxId);
    if (box) return { section: sec, box };
  }
  return null;
}

function sectionStats(section) {
  let totalSlots = 0;
  let occupiedSlots = 0;
  for (const box of section.boxes) {
    totalSlots += box.slotCapacity;
    occupiedSlots += box.slots.filter(s => s.batchId).length;
  }
  const freeSlots = totalSlots - occupiedSlots;
  const occupancyRate = totalSlots ? Number((occupiedSlots / totalSlots).toFixed(4)) : 0;
  return { totalSlots, occupiedSlots, freeSlots, occupancyRate };
}

export async function listSections(siteIdParam = null) {
  const db = await loadLocDb();
  const mainDb = await loadDb();
  const defaultSiteId = getDefaultSiteId(mainDb);
  const effectiveSiteId = siteIdParam || defaultSiteId;
  const isGlobal = effectiveSiteId === "all";
  let sections = db.sections;
  if (!isGlobal) {
    sections = filterSectionsBySite(sections, effectiveSiteId, defaultSiteId);
  }
  return sections.map(s => ({
    id: s.id,
    siteId: s.siteId || defaultSiteId,
    name: s.name,
    ...sectionStats(s)
  }));
}

export async function getSection(sectionId) {
  const db = await loadLocDb();
  const mainDb = await loadDb();
  const defaultSiteId = getDefaultSiteId(mainDb);
  const section = findSection(db, sectionId);
  if (!section) return null;
  const boxes = section.boxes.map(b => ({
    id: b.id,
    name: b.name,
    slotCapacity: b.slotCapacity,
    occupied: b.slots.filter(s => s.batchId).length,
    free: b.slotCapacity - b.slots.filter(s => s.batchId).length
  }));
  return {
    id: section.id,
    siteId: section.siteId || defaultSiteId,
    name: section.name,
    ...sectionStats(section),
    boxes
  };
}

export async function createSection(input, ctx = {}) {
  return mutate({
    operation: OPERATION.LOCATION_SECTION_CREATE,
    entityType: "location_section",
    entityId: input.id,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      const defaultSiteId = getDefaultSiteId(db);
      const effectiveSiteId = input.siteId || defaultSiteId;
      const targetSite = (db.sites || []).find(s => s.id === effectiveSiteId);
      if (isSiteDisabled(targetSite)) {
        return { error: "site_disabled", message: `站点 ${targetSite ? targetSite.name : effectiveSiteId} 已停用，无法新增分区`, siteId: effectiveSiteId };
      }
      return { defaultSiteId };
    },
    locMutator: (locDb, { defaultSiteId }) => {
      if (findSection(locDb, input.id)) return { error: "section_already_exists" };
      const section = {
        id: input.id,
        siteId: input.siteId || defaultSiteId,
        name: input.name || input.id,
        boxes: []
      };
      locDb.sections.push(section);
      return {
        details: {
          section: clone(section)
        },
        ...clone(section)
      };
    }
  });
}

export async function addBox(sectionId, input, ctx = {}) {
  return mutate({
    operation: OPERATION.LOCATION_BOX_ADD,
    entityType: "location_box",
    entityId: input.id,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds: [],
    details: { sectionId },
    mutator: () => ({}),
    locMutator: (locDb) => {
      const section = findSection(locDb, sectionId);
      if (!section) return { error: "section_not_found" };
      if (findBox(locDb, input.id)) return { error: "box_already_exists" };
      const capacity = Number(input.slotCapacity) || 16;
      const box = { id: input.id, name: input.name || input.id, slotCapacity: capacity, slots: [] };
      section.boxes.push(box);
      return {
        details: {
          box: clone(box),
          sectionId
        },
        ...clone(box)
      };
    }
  });
}

export async function assignSlot(boxId, slotIndex, batchId, ctx = {}) {
  const affectedBatchIds = [];
  if (batchId) affectedBatchIds.push(batchId);

  return mutate({
    operation: OPERATION.LOCATION_SLOT_ASSIGN,
    entityType: "location_slot",
    entityId: `${boxId}:${slotIndex}`,
    operator: ctx.operator,
    source: ctx.source,
    expectedVersions: ctx.expectedVersions,
    affectedBatchIds,
    details: {},
    mutator: (db) => {
      return {
        sites: db.sites || [],
        defaultSiteId: getDefaultSiteId(db)
      };
    },
    locMutator: (locDb, { sites, defaultSiteId }, db) => {
      const found = findBox(locDb, boxId);
      if (!found) return { error: "box_not_found" };
      const { section, box } = found;
      const sectionSiteId = section.siteId || defaultSiteId;
      const sectionId = section.id;
      const sectionName = section.name;
      const boxName = box.name;

      const idx = Number(slotIndex);
      if (idx < 1 || idx > box.slotCapacity) return { error: "slot_index_out_of_range" };
      let slot = box.slots.find(s => s.index === idx);
      const previousBatchId = slot ? slot.batchId : null;

      if (batchId === null || batchId === undefined) {
        if (slot) slot.batchId = null;

        const previousBatch = previousBatchId ? db.batches.find(b => b.id === previousBatchId) : null;
        const previousBatchSnapshot = previousBatch ? {
          id: previousBatch.id,
          siteId: previousBatch.siteId || defaultSiteId,
          container: previousBatch.container,
          section: previousBatch.section
        } : null;

        const additionalAffectedBatchIds = previousBatchId ? [previousBatchId] : [];

        return {
          additionalAffectedBatchIds,
          details: {
            boxId,
            boxName,
            slotIndex: idx,
            sectionId,
            sectionName,
            siteId: sectionSiteId,
            previousBatchId,
            previousBatchSnapshot,
            newBatchId: null,
            changeType: "clear",
            changeNote: previousBatchId
              ? `清空槽位 ${boxId}:${idx}，原批次 ${previousBatchId} 已移出。批次的 container/section 字段保留历史值。`
              : `槽位 ${boxId}:${idx} 原本为空，无需操作。`,
            clearedFrom: previousBatchId ? {
              sectionId,
              sectionName,
              boxId,
              boxName,
              slotIndex: idx,
              siteId: sectionSiteId,
              clearedAt: new Date().toISOString()
            } : null
          },
          boxId,
          boxName,
          index: idx,
          sectionId,
          sectionName,
          siteId: sectionSiteId,
          batchId: null,
          previousBatchId,
          changeType: "clear",
          clearedFrom: previousBatchId ? {
            sectionId,
            sectionName,
            boxId,
            boxName,
            slotIndex: idx,
            siteId: sectionSiteId,
            clearedAt: new Date().toISOString()
          } : null
        };
      }

      const batch = db.batches.find(b => b.id === batchId);
      if (!batch) {
        return { error: "batch_not_found", message: `批次 ${batchId} 不存在`, batchId };
      }

      const batchSiteId = batch.siteId || defaultSiteId;
      if (batchSiteId !== sectionSiteId) {
        const batchSite = (sites || []).find(s => s.id === batchSiteId);
        const locationSite = (sites || []).find(s => s.id === sectionSiteId);
        return {
          error: "site_mismatch",
          message: `批次站点与库位站点不一致`,
          batchId,
          batchSiteId,
          batchSiteName: batchSite ? batchSite.name : batchSiteId,
          locationSiteId: sectionSiteId,
          locationSiteName: locationSite ? locationSite.name : sectionSiteId,
          details: `批次 ${batchId} 属于站点 ${batchSite ? batchSite.name : batchSiteId}，但库位 ${sectionId}/${boxId} 属于站点 ${locationSite ? locationSite.name : sectionSiteId}`
        };
      }

      const targetSite = (sites || []).find(s => s.id === sectionSiteId);
      if (isSiteDisabled(targetSite)) {
        return { error: "site_disabled", message: `站点 ${targetSite ? targetSite.name : sectionSiteId} 已停用，无法分配批次到该站点的库位`, siteId: sectionSiteId };
      }

      if (slot && slot.batchId) return { error: "slot_already_occupied" };

      const originalContainer = batch.container;
      const originalSection = batch.section;

      batch.container = boxId;
      batch.section = sectionId;

      if (!slot) {
        slot = { index: idx, batchId };
        box.slots.push(slot);
      } else {
        slot.batchId = batchId;
      }

      return {
        details: {
          boxId,
          boxName,
          slotIndex: idx,
          sectionId,
          sectionName,
          siteId: sectionSiteId,
          previousBatchId,
          newBatchId: batchId,
          changeType: "assign",
          batchSiteMatch: true,
          originalContainer,
          originalSection,
          newContainer: boxId,
          newSection: sectionId,
          containerChanged: originalContainer !== boxId,
          sectionChanged: originalSection !== sectionId,
          changeNote: `批次 ${batchId} 分配到 ${sectionName} / ${boxName} / 格位${idx}，已同步更新批次 container 和 section 字段。`
        },
        boxId,
        boxName,
        index: idx,
        sectionId,
        sectionName,
        siteId: sectionSiteId,
        batchId,
        previousBatchId,
        changeType: "assign",
        batchSiteMatch: true,
        originalContainer,
        originalSection,
        newContainer: boxId,
        newSection: sectionId,
        containerChanged: originalContainer !== boxId,
        sectionChanged: originalSection !== sectionId
      };
    }
  });
}

export async function getBox(boxId) {
  const db = await loadLocDb();
  const mainDb = await loadDb();
  const defaultSiteId = getDefaultSiteId(mainDb);
  const found = findBox(db, boxId);
  if (!found) return null;
  const { section, box } = found;
  const occupied = box.slots.filter(s => s.batchId);
  return {
    id: box.id,
    siteId: section.siteId || defaultSiteId,
    name: box.name,
    sectionId: section.id,
    sectionName: section.name,
    slotCapacity: box.slotCapacity,
    occupiedCount: occupied.length,
    freeCount: box.slotCapacity - occupied.length,
    slots: box.slots,
    batches: occupied.map(s => ({ slotIndex: s.index, batchId: s.batchId }))
  };
}

export async function getBatchLocations(batchId) {
  const db = await loadLocDb();
  const mainDb = await loadDb();
  const defaultSiteId = getDefaultSiteId(mainDb);
  const locations = [];
  for (const sec of db.sections) {
    for (const box of sec.boxes) {
      for (const slot of box.slots) {
        if (slot.batchId === batchId) {
          locations.push({
            siteId: sec.siteId || defaultSiteId,
            sectionId: sec.id,
            sectionName: sec.name,
            boxId: box.id,
            boxName: box.name,
            slotIndex: slot.index
          });
        }
      }
    }
  }
  return locations;
}

export async function listFreeSlots(sectionId) {
  const db = await loadLocDb();
  const section = findSection(db, sectionId);
  if (!section) return null;
  const free = [];
  for (const box of section.boxes) {
    const occupiedIndexes = new Set(box.slots.filter(s => s.batchId).map(s => s.index));
    for (let i = 1; i <= box.slotCapacity; i++) {
      if (!occupiedIndexes.has(i)) {
        free.push({ boxId: box.id, boxName: box.name, slotIndex: i });
      }
    }
  }
  return { sectionId, sectionName: section.name, freeSlots: free, freeCount: free.length };
}
