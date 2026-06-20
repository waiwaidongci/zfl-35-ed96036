import { mutate, loadLocDb, loadDb, OPERATION, clone, getDefaultSiteId } from "./data-store.js";

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
    affectedBatchIds: [],
    details: {},
    mutator: (db) => {
      return { defaultSiteId: getDefaultSiteId(db) };
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
    affectedBatchIds,
    details: {},
    mutator: (db) => {
      return {};
    },
    locMutator: (locDb) => {
      const found = findBox(locDb, boxId);
      if (!found) return { error: "box_not_found" };
      const { box } = found;
      const idx = Number(slotIndex);
      if (idx < 1 || idx > box.slotCapacity) return { error: "slot_index_out_of_range" };
      let slot = box.slots.find(s => s.index === idx);
      const previousBatchId = slot ? slot.batchId : null;

      if (batchId === null || batchId === undefined) {
        if (slot) slot.batchId = null;
        return {
          details: {
            boxId,
            slotIndex: idx,
            previousBatchId,
            newBatchId: null
          },
          boxId,
          index: idx,
          batchId: null
        };
      }

      if (slot && slot.batchId) return { error: "slot_already_occupied" };
      if (!slot) {
        slot = { index: idx, batchId };
        box.slots.push(slot);
      } else {
        slot.batchId = batchId;
      }
      return {
        details: {
          boxId,
          slotIndex: idx,
          previousBatchId,
          newBatchId: batchId
        },
        boxId,
        index: idx,
        batchId
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
