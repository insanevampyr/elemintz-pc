import { EVENT_CHEST_RARITIES } from "./eventChestDefinitions.js";

export const EVENT_CHEST_PITY_SCHEMA_VERSION = 1;
export const EVENT_CHEST_MAX_PITY_THRESHOLD = 10_000;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeCounter(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0
    ? Math.min(EVENT_CHEST_MAX_PITY_THRESHOLD, numeric)
    : 0;
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function createDefaultEventChestPity() {
  return {
    schemaVersion: EVENT_CHEST_PITY_SCHEMA_VERSION,
    byChestId: {}
  };
}

export function normalizeEventChestPity(value) {
  if (
    !isPlainObject(value) ||
    Number(value.schemaVersion) !== EVENT_CHEST_PITY_SCHEMA_VERSION ||
    !isPlainObject(value.byChestId)
  ) {
    return createDefaultEventChestPity();
  }

  const byChestId = {};
  for (const [rawChestId, rawState] of Object.entries(value.byChestId)) {
    const chestId = String(rawChestId ?? "").trim();
    if (!chestId || !isPlainObject(rawState)) {
      continue;
    }
    byChestId[chestId] = {
      epicPlusMisses: safeCounter(rawState.epicPlusMisses),
      legendaryMisses: safeCounter(rawState.legendaryMisses),
      updatedAt: normalizeIso(rawState.updatedAt)
    };
  }

  return {
    schemaVersion: EVENT_CHEST_PITY_SCHEMA_VERSION,
    byChestId
  };
}

export function getEventChestPityState(value, chestId) {
  const normalized = normalizeEventChestPity(value);
  const safeChestId = String(chestId ?? "").trim();
  return {
    epicPlusMisses: safeCounter(normalized.byChestId[safeChestId]?.epicPlusMisses),
    legendaryMisses: safeCounter(normalized.byChestId[safeChestId]?.legendaryMisses),
    updatedAt: normalizeIso(normalized.byChestId[safeChestId]?.updatedAt)
  };
}

export function getEventChestPityRuleState(pity = {}) {
  return {
    epicPlusEnabled: pity?.epicPlusEnabled !== false,
    legendaryEnabled: pity?.legendaryEnabled !== false,
    epicPlusThreshold: Number(pity?.epicPlusThreshold),
    legendaryThreshold: Number(pity?.legendaryThreshold)
  };
}

export function resolveEventChestPity({
  pityState,
  pityRules,
  rolledRarity,
  now = new Date().toISOString()
} = {}) {
  const before = {
    epicPlusMisses: safeCounter(pityState?.epicPlusMisses),
    legendaryMisses: safeCounter(pityState?.legendaryMisses)
  };
  const rules = getEventChestPityRuleState(pityRules);
  const rarity = String(rolledRarity ?? "").trim().toLowerCase();
  if (!EVENT_CHEST_RARITIES.includes(rarity)) {
    throw Object.assign(new Error("Event Chest pity reward rarity is invalid."), {
      code: "EVENT_CHEST_OPEN_INVALID_PITY"
    });
  }

  const after = {
    epicPlusMisses: rules.epicPlusEnabled
      ? rarity === "epic" || rarity === "legendary"
        ? 0
        : safeCounter(before.epicPlusMisses + 1)
      : 0,
    legendaryMisses: rules.legendaryEnabled
      ? rarity === "legendary"
        ? 0
        : safeCounter(before.legendaryMisses + 1)
      : 0,
    updatedAt: normalizeIso(now) ?? new Date().toISOString()
  };

  return { before, after };
}

export function applyEventChestPityState(value, chestId, nextState) {
  const normalized = normalizeEventChestPity(value);
  const safeChestId = String(chestId ?? "").trim();
  if (!safeChestId) {
    throw Object.assign(new Error("Event Chest pity chestId is required."), {
      code: "EVENT_CHEST_OPEN_INVALID_PITY"
    });
  }
  return {
    schemaVersion: EVENT_CHEST_PITY_SCHEMA_VERSION,
    byChestId: {
      ...normalized.byChestId,
      [safeChestId]: {
        epicPlusMisses: safeCounter(nextState?.epicPlusMisses),
        legendaryMisses: safeCounter(nextState?.legendaryMisses),
        updatedAt: normalizeIso(nextState?.updatedAt) ?? new Date().toISOString()
      }
    }
  };
}
