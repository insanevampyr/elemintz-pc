import { JsonStore } from "./storage/jsonStore.js";

export const SPECIAL_COSMETIC_REGISTRY_VERSION = 1;
export const SPECIAL_COSMETIC_STATUSES = Object.freeze([
  "draft",
  "readyForReview",
  "approved",
  "assigned",
  "granted",
  "retired"
]);
export const SPECIAL_COSMETIC_ASSIGNMENT_STATUSES = Object.freeze([
  "unassigned",
  "assigned",
  "revoked"
]);
export const SPECIAL_COSMETIC_SALE_LIMIT_MODES = Object.freeze(["unlimited", "limited"]);

const EMPTY_REGISTRY = Object.freeze({
  version: SPECIAL_COSMETIC_REGISTRY_VERSION,
  records: Object.freeze([])
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeRequiredId(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error("cosmeticId is required.");
  }
  return normalized;
}

function normalizeOptionalUsername(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function normalizeTimestamp(value, fallback) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function normalizeSpecialCosmeticRecord(record = {}, { now = new Date().toISOString() } = {}) {
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const cosmeticId = normalizeRequiredId(source.cosmeticId ?? source.id);
  const status = SPECIAL_COSMETIC_STATUSES.includes(source.status) ? source.status : "draft";
  const requestedAssignmentStatus = SPECIAL_COSMETIC_ASSIGNMENT_STATUSES.includes(source.assignmentStatus)
    ? source.assignmentStatus
    : "unassigned";
  const uniqueOwnerUsername = normalizeOptionalUsername(source.uniqueOwnerUsername);
  const assignmentStatus =
    requestedAssignmentStatus === "assigned" && !uniqueOwnerUsername
      ? "unassigned"
      : requestedAssignmentStatus;
  const requestedSaleLimitMode = SPECIAL_COSMETIC_SALE_LIMIT_MODES.includes(source.saleLimitMode)
    ? source.saleLimitMode
    : "unlimited";
  const requestedSaleLimitTotal = normalizeNonNegativeInteger(source.saleLimitTotal, 0);
  const saleLimitMode =
    requestedSaleLimitMode === "limited" && requestedSaleLimitTotal > 0
      ? "limited"
      : "unlimited";
  const saleLimitTotal = saleLimitMode === "limited" ? requestedSaleLimitTotal : null;
  const saleLimitSold = Math.min(
    normalizeNonNegativeInteger(source.saleLimitSold, 0),
    saleLimitTotal ?? Number.MAX_SAFE_INTEGER
  );
  const royaltySource =
    source.royalty && typeof source.royalty === "object" && !Array.isArray(source.royalty)
      ? source.royalty
      : {};
  const royaltyRecipientUsername = normalizeOptionalUsername(royaltySource.recipientUsername);
  const royaltyPercent = Math.min(
    100,
    Math.max(0, Number.isFinite(Number(royaltySource.tokenPercent)) ? Number(royaltySource.tokenPercent) : 0)
  );
  const royaltyEnabled =
    royaltySource.enabled === true && Boolean(royaltyRecipientUsername) && royaltyPercent > 0;
  const createdAt = normalizeTimestamp(source.createdAt, now);
  const updatedAt = normalizeTimestamp(source.updatedAt, createdAt);

  return {
    cosmeticId,
    status,
    assignmentStatus,
    uniqueOwnerUsername:
      assignmentStatus === "assigned" && uniqueOwnerUsername ? uniqueOwnerUsername : null,
    grantOnly: typeof source.grantOnly === "boolean" ? source.grantOnly : true,
    shopEligible: typeof source.shopEligible === "boolean" ? source.shopEligible : false,
    shopListed: typeof source.shopListed === "boolean" ? source.shopListed : false,
    storeHidden: typeof source.storeHidden === "boolean" ? source.storeHidden : false,
    rotationOnly: typeof source.rotationOnly === "boolean" ? source.rotationOnly : false,
    saleLimitMode,
    saleLimitTotal,
    saleLimitSold,
    royalty: royaltyEnabled
      ? {
          enabled: true,
          recipientUsername: royaltyRecipientUsername,
          tokenPercent: royaltyPercent
        }
      : {
          enabled: false,
          recipientUsername: null,
          tokenPercent: 0
        },
    adminNotes: typeof source.adminNotes === "string" ? source.adminNotes.trim() : "",
    createdAt,
    updatedAt
  };
}

export function buildPublicSpecialCosmeticRecord(record) {
  const normalized = normalizeSpecialCosmeticRecord(record);
  const { adminNotes: _adminNotes, ...publicRecord } = normalized;
  return publicRecord;
}

function normalizeRegistryDocument(value, { now } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const records = Array.isArray(source.records) ? source.records : [];
  const byId = new Map();

  for (const record of records) {
    try {
      const normalized = normalizeSpecialCosmeticRecord(record, { now });
      byId.set(normalized.cosmeticId, normalized);
    } catch {
      // Invalid records without an identity cannot be recovered safely.
    }
  }

  return {
    version: SPECIAL_COSMETIC_REGISTRY_VERSION,
    records: [...byId.values()].sort((left, right) =>
      left.cosmeticId.localeCompare(right.cosmeticId)
    )
  };
}

export class SpecialCosmeticRegistryStore {
  constructor(options = {}) {
    this.store = new JsonStore("special-cosmetic-registry.json", options);
    this.mutationQueue = Promise.resolve();
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  }

  runMutation(task) {
    const run = this.mutationQueue.then(task, task);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async readRegistry({ now = this.now() } = {}) {
    const raw = await this.store.read(clone(EMPTY_REGISTRY));
    return normalizeRegistryDocument(raw, { now });
  }

  async listRecords() {
    return clone((await this.readRegistry()).records);
  }

  async getRecord(cosmeticId) {
    const safeCosmeticId = normalizeRequiredId(cosmeticId);
    return (
      (await this.listRecords()).find((record) => record.cosmeticId === safeCosmeticId) ?? null
    );
  }

  async upsertConfig(record) {
    return this.runMutation(async () => {
      const now = this.now();
      const registry = await this.readRegistry({ now });
      const cosmeticId = normalizeRequiredId(record?.cosmeticId ?? record?.id);
      const index = registry.records.findIndex((entry) => entry.cosmeticId === cosmeticId);
      const existing = index >= 0 ? registry.records[index] : null;
      const normalized = normalizeSpecialCosmeticRecord(
        {
          ...(existing ?? {}),
          ...(record ?? {}),
          cosmeticId,
          saleLimitSold: existing?.saleLimitSold ?? 0,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        },
        { now }
      );

      if (index >= 0) {
        registry.records[index] = normalized;
      } else {
        registry.records.push(normalized);
      }
      registry.records.sort((left, right) => left.cosmeticId.localeCompare(right.cosmeticId));
      await this.store.write(registry);
      return clone(normalized);
    });
  }
}
