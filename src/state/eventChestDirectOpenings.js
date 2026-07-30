import { EVENT_CHEST_RARITIES } from "./eventChestDefinitions.js";

export const EVENT_CHEST_DIRECT_OPENINGS_SCHEMA_VERSION = 1;
export const EVENT_CHEST_DIRECT_OPENING_SETTLEMENT_SCHEMA_VERSION = 1;
export const EVENT_CHEST_DIRECT_OPEN_METHODS = Object.freeze(["free", "paid"]);

const METHOD_SET = new Set(EVENT_CHEST_DIRECT_OPEN_METHODS);
const RARITY_SET = new Set(EVENT_CHEST_RARITIES);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeReward(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const type = requiredText(value.type);
  const rarity = requiredText(value.rarity);
  const cosmetic = isPlainObject(value.cosmetic)
    ? {
        type: requiredText(value.cosmetic.type),
        cosmeticId: requiredText(value.cosmetic.cosmeticId)
      }
    : null;
  const tokenAmount = Number(value.tokenAmount ?? 0);
  if (
    !["cosmetic", "tokens"].includes(type) ||
    !RARITY_SET.has(rarity) ||
    !Number.isInteger(tokenAmount) ||
    tokenAmount < 0
  ) {
    return null;
  }
  if (type === "cosmetic" && (!cosmetic?.type || !cosmetic?.cosmeticId)) {
    return null;
  }
  if (type === "tokens" && tokenAmount <= 0 && !value.duplicateConverted) {
    return null;
  }
  return {
    type,
    rarity,
    cosmetic: type === "cosmetic" ? cosmetic : cosmetic?.type && cosmetic?.cosmeticId ? cosmetic : null,
    tokenAmount,
    duplicateConverted: Boolean(value.duplicateConverted)
  };
}

function normalizePityCounters(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const epicPlusMisses = Number(value.epicPlusMisses);
  const legendaryMisses = Number(value.legendaryMisses);
  return Number.isInteger(epicPlusMisses) &&
    epicPlusMisses >= 0 &&
    Number.isInteger(legendaryMisses) &&
    legendaryMisses >= 0
    ? { epicPlusMisses, legendaryMisses }
    : null;
}

function normalizePity(value) {
  if (value == null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  const before = normalizePityCounters(value.before);
  const after = normalizePityCounters(value.after);
  const appliedTarget = value.appliedTarget == null ? null : requiredText(value.appliedTarget);
  return before &&
    after &&
    (appliedTarget == null || ["epic_plus", "legendary"].includes(appliedTarget))
    ? { appliedTarget, before, after }
    : null;
}

export function normalizeEventChestDirectRequestId(value) {
  const requestId = requiredText(value);
  return requestId && REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

export function createDefaultEventChestDirectOpenings() {
  return {
    schemaVersion: EVENT_CHEST_DIRECT_OPENINGS_SCHEMA_VERSION,
    settlements: [],
    invalidRequestIds: []
  };
}

export function normalizeEventChestDirectOpeningSettlement(value) {
  if (
    !isPlainObject(value) ||
    Number(value.schemaVersion) !== EVENT_CHEST_DIRECT_OPENING_SETTLEMENT_SCHEMA_VERSION
  ) {
    return null;
  }
  const requestId = normalizeEventChestDirectRequestId(value.requestId);
  const openingId = requiredText(value.openingId);
  const transactionId = requiredText(value.transactionId);
  const chestId = requiredText(value.chestId);
  const definitionRevisionId = requiredText(value.definitionRevisionId);
  const method = requiredText(value.method);
  const settledAt = normalizeIso(value.settledAt);
  const costCharged = Number(value.costCharged ?? 0);
  const freeWindowKey = value.freeWindowKey == null ? null : requiredText(value.freeWindowKey);
  const reward = normalizeReward(value.reward);
  const tokenBalance =
    value.tokenBalance == null ? null : Number(value.tokenBalance);
  const pity = normalizePity(value.pity);
  if (
    !requestId ||
    !openingId ||
    !transactionId ||
    !chestId ||
    !definitionRevisionId ||
    !METHOD_SET.has(method) ||
    !settledAt ||
    !Number.isInteger(costCharged) ||
    costCharged < 0 ||
    !reward ||
    (value.tokenBalance != null && (!Number.isInteger(tokenBalance) || tokenBalance < 0)) ||
    (value.pity != null && !pity)
  ) {
    return null;
  }
  if (method === "paid" && costCharged <= 0) {
    return null;
  }
  if (method === "free" && (costCharged !== 0 || !freeWindowKey)) {
    return null;
  }
  return {
    schemaVersion: EVENT_CHEST_DIRECT_OPENING_SETTLEMENT_SCHEMA_VERSION,
    requestId,
    openingId,
    transactionId,
    chestId,
    definitionRevisionId,
    method,
    settledAt,
    costCharged,
    tokenBalance,
    pity,
    freeWindowKey,
    reward
  };
}

export function normalizeEventChestDirectOpenings(value) {
  if (
    !isPlainObject(value) ||
    Number(value.schemaVersion) !== EVENT_CHEST_DIRECT_OPENINGS_SCHEMA_VERSION ||
    !Array.isArray(value.settlements)
  ) {
    return createDefaultEventChestDirectOpenings();
  }
  const settlements = [];
  const invalidRequestIds = new Set(
    (Array.isArray(value.invalidRequestIds) ? value.invalidRequestIds : [])
      .map(normalizeEventChestDirectRequestId)
      .filter(Boolean)
  );
  const seen = new Set();
  for (const candidate of value.settlements) {
    const requestId = normalizeEventChestDirectRequestId(candidate?.requestId);
    const settlement = normalizeEventChestDirectOpeningSettlement(candidate);
    if (!settlement) {
      if (requestId) {
        invalidRequestIds.add(requestId);
      }
      continue;
    }
    if (seen.has(settlement.requestId)) {
      invalidRequestIds.add(settlement.requestId);
      continue;
    }
    seen.add(settlement.requestId);
    settlements.push(settlement);
  }
  return {
    schemaVersion: EVENT_CHEST_DIRECT_OPENINGS_SCHEMA_VERSION,
    settlements,
    invalidRequestIds: [...invalidRequestIds]
  };
}

function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function zonedDateTimeToUtc({ year, month, day, hour }, timeZone) {
  let candidate = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(candidate, timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const target = Date.UTC(year, month - 1, day, hour, 0, 0);
    const delta = target - represented;
    candidate += delta;
    if (delta === 0) {
      break;
    }
  }
  return candidate;
}

function addUtcDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

export function getEventChestFreeResetWindow(policy, nowMs = Date.now()) {
  if (
    policy?.cadence !== "daily" ||
    typeof policy.resetTimeZone !== "string" ||
    !Number.isInteger(policy.resetHour)
  ) {
    return null;
  }
  try {
    const timestamp =
      typeof nowMs === "number" ? nowMs : Date.parse(String(nowMs ?? ""));
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    const nowParts = zonedParts(timestamp, policy.resetTimeZone);
    const today = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    const todayReset = zonedDateTimeToUtc(
      { ...today, hour: policy.resetHour },
      policy.resetTimeZone
    );
    const currentDay = timestamp >= todayReset ? today : addUtcDays(today, -1);
    const nextDay = addUtcDays(currentDay, 1);
    const startMs = zonedDateTimeToUtc(
      { ...currentDay, hour: policy.resetHour },
      policy.resetTimeZone
    );
    const endMs = zonedDateTimeToUtc(
      { ...nextDay, hour: policy.resetHour },
      policy.resetTimeZone
    );
    return {
      key: new Date(startMs).toISOString(),
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      startMs,
      endMs
    };
  } catch {
    return null;
  }
}
