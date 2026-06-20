import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const locPath = join(__dirname, "..", "data", "locations.json");

const seed = {
  sections: [
    {
      id: "A1",
      name: "A1极低温区",
      boxes: [
        { id: "C-冷盒-01", name: "冷盒01", slotCapacity: 20, slots: [] },
        { id: "C-冷盒-02", name: "冷盒02", slotCapacity: 20, slots: [] }
      ]
    },
    {
      id: "A2",
      name: "A2低温区",
      boxes: [
        { id: "C-冷盒-07", name: "冷盒07", slotCapacity: 16, slots: [] },
        { id: "C-冷盒-08", name: "冷盒08", slotCapacity: 16, slots: [
          { index: 1, batchId: "RS-001" },
          { index: 2, batchId: null },
          { index: 3, batchId: null },
          { index: 4, batchId: null }
        ]}
      ]
    },
    {
      id: "B1",
      name: "B1中温区",
      boxes: [
        { id: "C-冷盒-15", name: "冷盒15", slotCapacity: 24, slots: [] }
      ]
    }
  ]
};

async function load() {
  if (!existsSync(locPath)) {
    await mkdir(dirname(locPath), { recursive: true });
    await writeFile(locPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(locPath, "utf8"));
}

async function save(data) {
  await writeFile(locPath, JSON.stringify(data, null, 2));
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

export async function listSections() {
  const db = await load();
  return db.sections.map(s => ({ id: s.id, name: s.name, ...sectionStats(s) }));
}

export async function getSection(sectionId) {
  const db = await load();
  const section = findSection(db, sectionId);
  if (!section) return null;
  const boxes = section.boxes.map(b => ({
    id: b.id,
    name: b.name,
    slotCapacity: b.slotCapacity,
    occupied: b.slots.filter(s => s.batchId).length,
    free: b.slotCapacity - b.slots.filter(s => s.batchId).length
  }));
  return { id: section.id, name: section.name, ...sectionStats(section), boxes };
}

export async function createSection(input) {
  const db = await load();
  if (findSection(db, input.id)) return { error: "section_already_exists" };
  const section = { id: input.id, name: input.name || input.id, boxes: [] };
  db.sections.push(section);
  await save(db);
  return section;
}

export async function addBox(sectionId, input) {
  const db = await load();
  const section = findSection(db, sectionId);
  if (!section) return { error: "section_not_found" };
  if (findBox(db, input.id)) return { error: "box_already_exists" };
  const capacity = Number(input.slotCapacity) || 16;
  const box = { id: input.id, name: input.name || input.id, slotCapacity: capacity, slots: [] };
  section.boxes.push(box);
  await save(db);
  return box;
}

export async function assignSlot(boxId, slotIndex, batchId) {
  const db = await load();
  const found = findBox(db, boxId);
  if (!found) return { error: "box_not_found" };
  const { box } = found;
  const idx = Number(slotIndex);
  if (idx < 1 || idx > box.slotCapacity) return { error: "slot_index_out_of_range" };
  let slot = box.slots.find(s => s.index === idx);
  if (batchId === null || batchId === undefined) {
    if (slot) slot.batchId = null;
    await save(db);
    return { boxId, index: idx, batchId: null };
  }
  if (slot && slot.batchId) return { error: "slot_already_occupied" };
  if (!slot) {
    slot = { index: idx, batchId };
    box.slots.push(slot);
  } else {
    slot.batchId = batchId;
  }
  await save(db);
  return { boxId, index: idx, batchId };
}

export async function getBox(boxId) {
  const db = await load();
  const found = findBox(db, boxId);
  if (!found) return null;
  const { section, box } = found;
  const occupied = box.slots.filter(s => s.batchId);
  return {
    id: box.id,
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
  const db = await load();
  const locations = [];
  for (const sec of db.sections) {
    for (const box of sec.boxes) {
      for (const slot of box.slots) {
        if (slot.batchId === batchId) {
          locations.push({ sectionId: sec.id, sectionName: sec.name, boxId: box.id, boxName: box.name, slotIndex: slot.index });
        }
      }
    }
  }
  return locations;
}

export async function listFreeSlots(sectionId) {
  const db = await load();
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
