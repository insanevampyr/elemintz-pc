import crypto from "node:crypto";

export const EVENT_CHEST_ENTITLEMENTS_SCHEMA_VERSION = 1;
export const EVENT_CHEST_ENTITLEMENT_SCHEMA_VERSION = 1;

export const EVENT_CHEST_ENTITLEMENT_GRANT_SOURCES = Object.freeze(["active_event"]);
export const EVENT_CHEST_ENTITLEMENT_STATUSES = Object.freeze(["available", "opened", "expired"]);

const GRANT_SOURCE_SET = new Set(EVENT_CHEST_ENTITLEMENT_GRANT_SOURCES);
const STATUS_SET = new Set(EVENT_CHEST_ENTITLEMENT_STATUSES);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeRequiredString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableIso(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function createDefaultEventChestEntitlements() {
  return {
    schemaVersion: EVENT_CHEST_ENTITLEMENTS_SCHEMA_VERSION,
    items: []
  };
}

export function buildEventChestEntitlementId({
  accountId,
  profileKey,
  chestId,
  definitionRevisionId
} = {}) {
  const safeAccountId = normalizeRequiredString(accountId);
  const safeProfileKey = normalizeRequiredString(profileKey);
  const safeChestId = normalizeRequiredString(chestId);
  const safeDefinitionRevisionId = normalizeRequiredString(definitionRevisionId);
  if (!safeAccountId || !safeProfileKey || !safeChestId || !safeDefinitionRevisionId) {
    return null;
  }

  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        accountId: safeAccountId,
        profileKey: safeProfileKey,
        chestId: safeChestId,
        definitionRevisionId: safeDefinitionRevisionId
      })
    )
    .digest("hex");

  return `event_chest_entitlement_${digest.slice(0, 32)}`;
}

export function createEventChestEntitlement({
  entitlementId,
  chestId,
  definitionRevisionId,
  grantedAt
} = {}) {
  return normalizeEventChestEntitlement({
    schemaVersion: EVENT_CHEST_ENTITLEMENT_SCHEMA_VERSION,
    entitlementId,
    chestId,
    definitionRevisionId,
    grantedAt,
    grantSource: "active_event",
    status: "available",
    openedAt: null,
    openTransactionId: null,
    rewardSettlement: null
  });
}

export function normalizeEventChestEntitlement(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  if (Number(value.schemaVersion) !== EVENT_CHEST_ENTITLEMENT_SCHEMA_VERSION) {
    return null;
  }

  const entitlementId = normalizeRequiredString(value.entitlementId);
  const chestId = normalizeRequiredString(value.chestId);
  const definitionRevisionId = normalizeRequiredString(value.definitionRevisionId);
  const grantedAt = normalizeNullableIso(value.grantedAt);
  const grantSource = normalizeRequiredString(value.grantSource);
  const status = normalizeRequiredString(value.status);

  if (
    !entitlementId ||
    !chestId ||
    !definitionRevisionId ||
    !grantedAt ||
    !GRANT_SOURCE_SET.has(grantSource) ||
    !STATUS_SET.has(status)
  ) {
    return null;
  }

  if (status === "available") {
    return {
      schemaVersion: EVENT_CHEST_ENTITLEMENT_SCHEMA_VERSION,
      entitlementId,
      chestId,
      definitionRevisionId,
      grantedAt,
      grantSource,
      status,
      openedAt: null,
      openTransactionId: null,
      rewardSettlement: null
    };
  }

  if (status === "expired") {
    return {
      schemaVersion: EVENT_CHEST_ENTITLEMENT_SCHEMA_VERSION,
      entitlementId,
      chestId,
      definitionRevisionId,
      grantedAt,
      grantSource,
      status,
      openedAt: null,
      openTransactionId: null,
      rewardSettlement: null
    };
  }

  const openedAt = normalizeNullableIso(value.openedAt);
  const openTransactionId = normalizeRequiredString(value.openTransactionId);
  if (!openedAt || !openTransactionId) {
    return null;
  }

  return {
    schemaVersion: EVENT_CHEST_ENTITLEMENT_SCHEMA_VERSION,
    entitlementId,
    chestId,
    definitionRevisionId,
    grantedAt,
    grantSource,
    status,
    openedAt,
    openTransactionId,
    rewardSettlement: value.rewardSettlement == null ? null : clonePlainObject(value.rewardSettlement)
  };
}

export function normalizeEventChestEntitlements(value) {
  if (
    !isPlainObject(value) ||
    Number(value.schemaVersion) !== EVENT_CHEST_ENTITLEMENTS_SCHEMA_VERSION ||
    !Array.isArray(value.items)
  ) {
    return createDefaultEventChestEntitlements();
  }

  const seenEntitlementIds = new Set();
  const items = [];
  for (const entry of value.items) {
    const normalized = normalizeEventChestEntitlement(entry);
    if (!normalized || seenEntitlementIds.has(normalized.entitlementId)) {
      continue;
    }
    seenEntitlementIds.add(normalized.entitlementId);
    items.push(normalized);
  }

  return {
    schemaVersion: EVENT_CHEST_ENTITLEMENTS_SCHEMA_VERSION,
    items
  };
}

export function sanitizeEventChestEntitlementsForOwnProfile(value) {
  const normalized = normalizeEventChestEntitlements(value);
  return {
    schemaVersion: normalized.schemaVersion,
    items: normalized.items.map(
      ({ schemaVersion, entitlementId, chestId, definitionRevisionId, grantedAt, status, openedAt }) => ({
        schemaVersion,
        entitlementId,
        chestId,
        definitionRevisionId,
        grantedAt,
        status,
        openedAt
      })
    )
  };
}

export function sanitizeEventChestEntitlementForPlayer(value) {
  const normalized = normalizeEventChestEntitlement(value);
  if (!normalized) {
    return null;
  }

  return {
    entitlementId: normalized.entitlementId,
    chestId: normalized.chestId,
    definitionRevisionId: normalized.definitionRevisionId,
    grantedAt: normalized.grantedAt,
    status: normalized.status
  };
}
