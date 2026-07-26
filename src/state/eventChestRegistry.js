import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "./eventChestDefinitions.js";

const EVENT_CHEST_REGISTRY_DEFINITIONS = Object.freeze([
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET
]);

function cloneDefinition(definition) {
  return structuredClone(definition);
}

function buildRegistryMap(definitions) {
  const entries = [];
  const seenChestIds = new Set();

  for (const definition of definitions) {
    const validation = validateEventChestDefinition(definition);
    if (!validation.ok) {
      throw new Error(
        `Invalid Event Chest definition '${String(definition?.chestId ?? "unknown")}': ${validation.errors.join("; ")}`
      );
    }

    if (seenChestIds.has(definition.chestId)) {
      throw new Error(`Duplicate Event Chest definition '${definition.chestId}'.`);
    }
    seenChestIds.add(definition.chestId);
    entries.push([definition.chestId, definition]);
  }

  return Object.freeze(new Map(entries));
}

const EVENT_CHEST_REGISTRY_BY_ID = buildRegistryMap(EVENT_CHEST_REGISTRY_DEFINITIONS);

function normalizeChestId(chestId) {
  return String(chestId ?? "").trim();
}

function normalizeNowMs(now = Date.now()) {
  if (now instanceof Date) {
    return now.getTime();
  }
  const numeric = Number(now);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(String(now ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function isEventChestDefinitionActive(definition, now = Date.now()) {
  if (definition?.lifecycle?.status !== "active") {
    return false;
  }

  const windows = Array.isArray(definition.activeWindows) ? definition.activeWindows : [];
  if (windows.length === 0) {
    return true;
  }

  const nowMs = normalizeNowMs(now);
  return windows.some((window) => {
    const startsAtMs = window?.startsAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(String(window.startsAt));
    const endsAtMs = window?.endsAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(String(window.endsAt));
    return Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs) && nowMs >= startsAtMs && nowMs <= endsAtMs;
  });
}

export function getEventChestDefinitions() {
  return [...EVENT_CHEST_REGISTRY_BY_ID.values()].map(cloneDefinition);
}

export function getEventChestDefinitionById(chestId) {
  const safeChestId = normalizeChestId(chestId);
  if (!safeChestId) {
    return null;
  }

  const definition = EVENT_CHEST_REGISTRY_BY_ID.get(safeChestId);
  return definition ? cloneDefinition(definition) : null;
}

export function hasEventChestDefinition(chestId) {
  const safeChestId = normalizeChestId(chestId);
  return safeChestId ? EVENT_CHEST_REGISTRY_BY_ID.has(safeChestId) : false;
}

export function getActiveEventChestDefinitions(now = Date.now()) {
  return [...EVENT_CHEST_REGISTRY_BY_ID.values()]
    .filter((definition) => isEventChestDefinitionActive(definition, now))
    .map(cloneDefinition);
}

export function getDefaultDailyElementChestDefinition() {
  return getEventChestDefinitionById(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.chestId);
}
