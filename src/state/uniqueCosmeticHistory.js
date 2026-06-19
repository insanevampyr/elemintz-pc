import { getCosmeticDefinition } from "./cosmeticSystem.js";

export const UNIQUE_HISTORY_DEFAULT_LIMIT = 50;
export const UNIQUE_HISTORY_MAX_LIMIT = 100;

const RECORD_TYPES = new Set(["all", "sale", "admin_action"]);
const ACTION_TYPES = new Set(["all", "sale", "grant"]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLimit(value) {
  if (value == null || value === "") {
    return UNIQUE_HISTORY_DEFAULT_LIMIT;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > UNIQUE_HISTORY_MAX_LIMIT) {
    throw new Error(`History limit must be an integer from 1 to ${UNIQUE_HISTORY_MAX_LIMIT}.`);
  }
  return limit;
}

function normalizeOffset(value) {
  if (value == null || value === "") {
    return 0;
  }
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("History offset must be a non-negative integer.");
  }
  return offset;
}

function normalizeEnum(value, allowed, fallback, label) {
  const normalized = normalizeText(value) || fallback;
  if (!allowed.has(normalized)) {
    throw new Error(`Invalid Unique history ${label}.`);
  }
  return normalized;
}

function resolveCosmetic(type, cosmeticId, { forceUnique = false } = {}) {
  const safeType = normalizeText(type) || null;
  const safeCosmeticId = normalizeText(cosmeticId) || null;
  const definition =
    safeType && safeCosmeticId ? getCosmeticDefinition(safeType, safeCosmeticId) : null;
  return {
    cosmeticId: safeCosmeticId,
    cosmeticName: normalizeText(definition?.name) || safeCosmeticId,
    category: safeType,
    rarity: forceUnique || definition?.rarity === "Unique" ? "Unique" : null
  };
}

function normalizeSale(entry) {
  if (entry?.status !== "completed") {
    return null;
  }
  const cosmetic = resolveCosmetic(entry.cosmeticType, entry.cosmeticId, { forceUnique: true });
  const timestamp = normalizeText(entry.completedAt || entry.timestamp);
  return {
    recordType: "sale",
    actionType: "sale",
    timestamp,
    ...cosmetic,
    buyerUsername: normalizeText(entry.buyerUsername) || null,
    affectedUsername: normalizeText(entry.buyerUsername) || null,
    actingAdmin: null,
    price: Number.isInteger(entry.price) ? entry.price : null,
    saleLimitMode: entry.saleLimitMode === "limited" ? "limited" : "unlimited",
    saleLimitSoldBefore: Number.isInteger(entry.saleLimitSoldBefore)
      ? entry.saleLimitSoldBefore
      : null,
    saleLimitSoldAfter: Number.isInteger(entry.saleLimitSoldAfter)
      ? entry.saleLimitSoldAfter
      : null,
    royaltyEnabled: entry.royaltyEnabled === true,
    royaltyRecipientUsername: entry.royaltyEnabled
      ? normalizeText(entry.royaltyRecipientUsername) || null
      : null,
    royaltyTokenPercent: entry.royaltyEnabled
      ? Number(entry.royaltyTokenPercent) || 0
      : null,
    royaltyAmount: entry.royaltyEnabled ? Math.max(0, Number(entry.royaltyAmount) || 0) : null,
    royaltyStatus: entry.royaltyEnabled ? normalizeText(entry.royaltyStatus) || "none" : null,
    notificationStatus: entry.royaltyEnabled
      ? normalizeText(entry.royaltyNotificationStatus) || "none"
      : null,
    transactionId: normalizeText(entry.transactionId) || null,
    status: "completed"
  };
}

function normalizeAdminAction(entry) {
  if (normalizeText(entry?.grantType) !== "special_cosmetic_grant") {
    return null;
  }
  const cosmetic = resolveCosmetic(
    entry?.payload?.cosmetic?.type,
    entry?.payload?.cosmetic?.cosmeticId,
    { forceUnique: true }
  );
  return {
    recordType: "admin_action",
    actionType: "grant",
    timestamp: normalizeText(entry.timestamp),
    ...cosmetic,
    buyerUsername: null,
    affectedUsername: normalizeText(entry.targetUsername) || null,
    actingAdmin: normalizeText(entry.adminIdentifier) || null,
    price: null,
    saleLimitMode: null,
    saleLimitSoldBefore: null,
    saleLimitSoldAfter: null,
    royaltyEnabled: null,
    royaltyRecipientUsername: null,
    royaltyTokenPercent: null,
    royaltyAmount: null,
    royaltyStatus: null,
    notificationStatus: null,
    transactionId: normalizeText(entry.transactionId) || null,
    status: normalizeText(entry.status) || "unknown"
  };
}

function matchesQuery(record, query) {
  if (!query) {
    return true;
  }
  return [
    record.cosmeticId,
    record.cosmeticName,
    record.buyerUsername,
    record.affectedUsername,
    record.royaltyRecipientUsername,
    record.actingAdmin,
    record.transactionId
  ].some((value) => normalizeText(value).toLowerCase().includes(query));
}

export async function queryUniqueCosmeticHistory({
  storePurchaseLedgerStore,
  adminGrantStore,
  filters = {}
} = {}) {
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const recordType = normalizeEnum(filters.recordType, RECORD_TYPES, "all", "record type");
  const actionType = normalizeEnum(filters.actionType, ACTION_TYPES, "all", "action type");
  const query = normalizeText(filters.query).toLowerCase();
  if (query.length > 100) {
    throw new Error("Unique history search must be 100 characters or fewer.");
  }

  const [purchaseEntries, adminEntries] = await Promise.all([
    typeof storePurchaseLedgerStore?.listEntries === "function"
      ? storePurchaseLedgerStore.listEntries()
      : [],
    typeof adminGrantStore?.listEntries === "function" ? adminGrantStore.listEntries() : []
  ]);

  const records = [
    ...purchaseEntries.map(normalizeSale),
    ...adminEntries.map(normalizeAdminAction)
  ]
    .filter(Boolean)
    .filter((record) => recordType === "all" || record.recordType === recordType)
    .filter((record) => actionType === "all" || record.actionType === actionType)
    .filter((record) => matchesQuery(record, query))
    .sort((left, right) => Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0));

  return {
    items: records.slice(offset, offset + limit),
    total: records.length,
    limit,
    offset,
    hasMore: offset + limit < records.length
  };
}
