import { COSMETIC_CATALOG } from "./cosmeticSystem.js";
import { JsonStore } from "./storage/jsonStore.js";

export const COLLECTION_PACK_REGISTRY_VERSION = 1;
export const DEFAULT_COLLECTION_PACK_DISCOUNT_PERCENT = 15;
export const MIN_COLLECTION_PACK_DISCOUNT_PERCENT = 1;
export const MAX_COLLECTION_PACK_DISCOUNT_PERCENT = 30;
export const COLLECTION_PACK_SALE_LIMIT_MODES = Object.freeze(["unlimited", "limited"]);

const EMPTY_COLLECTION_PACK_REGISTRY = Object.freeze({
  version: COLLECTION_PACK_REGISTRY_VERSION,
  packs: Object.freeze([])
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePackId(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error("packId is required.");
  }
  return normalized;
}

function normalizeRequiredText(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeSoldCount(value) {
  if (value == null || value === "") {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error("soldCount must be a non-negative integer.");
  }
  return numeric;
}

function normalizeOptionalTimestamp(value, fieldName) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function normalizeSaleLimitMode(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "unlimited";
  }
  if (!COLLECTION_PACK_SALE_LIMIT_MODES.includes(normalized)) {
    throw new Error('saleLimitMode must be "unlimited" or "limited".');
  }
  return normalized;
}

function normalizeTimestamp(value, fallback) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeDiscountPercent(value) {
  if (value == null || value === "") {
    return DEFAULT_COLLECTION_PACK_DISCOUNT_PERCENT;
  }
  const numeric = Number(value);
  if (
    !Number.isInteger(numeric) ||
    numeric < MIN_COLLECTION_PACK_DISCOUNT_PERCENT ||
    numeric > MAX_COLLECTION_PACK_DISCOUNT_PERCENT
  ) {
    throw new Error(
      `discountPercent must be between ${MIN_COLLECTION_PACK_DISCOUNT_PERCENT} and ${MAX_COLLECTION_PACK_DISCOUNT_PERCENT}.`
    );
  }
  return numeric;
}

function findCosmeticDefinitionById(cosmeticId, catalog = COSMETIC_CATALOG) {
  const safeCosmeticId = String(cosmeticId ?? "").trim();
  if (!safeCosmeticId) {
    return null;
  }

  for (const [type, items] of Object.entries(catalog ?? {})) {
    const item = (Array.isArray(items) ? items : []).find((candidate) => candidate.id === safeCosmeticId);
    if (item) {
      return { type, item };
    }
  }
  return null;
}

export function resolveCollectionPackCosmetic(cosmeticId, { catalog = COSMETIC_CATALOG } = {}) {
  const resolved = findCosmeticDefinitionById(cosmeticId, catalog);
  return resolved ? clone(resolved) : null;
}

function assertEligibleNormalCosmetic(cosmeticId, { catalog = COSMETIC_CATALOG } = {}) {
  const resolved = findCosmeticDefinitionById(cosmeticId, catalog);
  if (!resolved) {
    throw new Error(`Unknown cosmeticId '${String(cosmeticId ?? "").trim()}'.`);
  }

  const { item } = resolved;
  if (item.rarity === "Unique") {
    throw new Error(`Collection Packs cannot include Unique cosmetic '${item.id}'.`);
  }
  if (item.storeHidden) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is hidden and ineligible.`);
  }
  if (item.rotationOnly) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is rotation-only and ineligible.`);
  }
  if (item.grantOnly) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is grant-only and ineligible.`);
  }
  if (item.chestOnly) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is chest-only and ineligible.`);
  }
  if (item.supporterOnly) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is supporter-only and ineligible.`);
  }
  if (item.purchasable !== true) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is not normally purchasable.`);
  }
  if (!Number.isInteger(item.price) || item.price <= 0) {
    throw new Error(`Collection Pack cosmetic '${item.id}' is missing a normal Store value.`);
  }

  return resolved;
}

function normalizeCosmeticIds(value, { catalog = COSMETIC_CATALOG } = {}) {
  if (!Array.isArray(value)) {
    throw new Error("cosmeticIds must be an array.");
  }
  const cosmeticIds = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (cosmeticIds.length < 2) {
    throw new Error("Collection Pack must contain at least two eligible cosmetics.");
  }

  const unique = new Set(cosmeticIds);
  if (unique.size !== cosmeticIds.length) {
    throw new Error("Collection Pack cosmeticIds must be unique.");
  }

  for (const cosmeticId of cosmeticIds) {
    assertEligibleNormalCosmetic(cosmeticId, { catalog });
  }
  return cosmeticIds;
}

export function validateCollectionPackDraft(
  draft = {},
  { now = new Date().toISOString(), catalog = COSMETIC_CATALOG } = {}
) {
  const source = draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
  const packId = normalizePackId(source.packId ?? source.id);
  const name = normalizeRequiredText(source.name, "name");
  const description = String(source.description ?? "").trim();
  const image = normalizeOptionalText(source.image ?? source.banner ?? source.bannerImage);
  const cosmeticIds = normalizeCosmeticIds(source.cosmeticIds, { catalog });
  const discountPercent = normalizeDiscountPercent(source.discountPercent);
  const startsAt = normalizeOptionalTimestamp(source.startsAt, "startsAt");
  const endsAt = normalizeOptionalTimestamp(source.endsAt, "endsAt");

  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error("startsAt must be before endsAt.");
  }

  const saleLimitMode = normalizeSaleLimitMode(source.saleLimitMode);
  const saleLimitTotal =
    saleLimitMode === "limited" ? normalizePositiveInteger(source.saleLimitTotal) : null;
  if (saleLimitMode === "limited" && !saleLimitTotal) {
    throw new Error("saleLimitTotal must be a positive integer for limited Collection Packs.");
  }

  const soldCount = normalizeSoldCount(source.soldCount);
  if (saleLimitMode === "limited" && soldCount > saleLimitTotal) {
    throw new Error("soldCount cannot exceed saleLimitTotal.");
  }

  const createdAt = normalizeTimestamp(source.createdAt, now);
  const updatedAt = normalizeTimestamp(source.updatedAt, createdAt);

  return {
    packId,
    name,
    description,
    image,
    cosmeticIds,
    discountPercent,
    active: normalizeBoolean(source.active, false),
    visible: normalizeBoolean(source.visible, false),
    startsAt,
    endsAt,
    saleLimitMode,
    saleLimitTotal,
    soldCount,
    sortPriority: normalizeInteger(source.sortPriority, 0),
    adminNotes: typeof source.adminNotes === "string" ? source.adminNotes.trim() : "",
    createdAt,
    updatedAt
  };
}

export function calculateCollectionPackPriceForOwnedCosmetics(
  pack,
  ownedCosmeticIds = [],
  options = {}
) {
  const normalizedPack = validateCollectionPackDraft(pack, options);
  const owned = new Set(
    (Array.isArray(ownedCosmeticIds) ? ownedCosmeticIds : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
  );
  const remainingCosmeticIds = normalizedPack.cosmeticIds.filter((cosmeticId) => !owned.has(cosmeticId));
  const remainingNormalValue = remainingCosmeticIds.reduce((total, cosmeticId) => {
    return total + assertEligibleNormalCosmetic(cosmeticId, options).item.price;
  }, 0);
  const savings = Math.floor((remainingNormalValue * normalizedPack.discountPercent) / 100);
  const finalPrice = Math.max(0, remainingNormalValue - savings);
  const complete = remainingCosmeticIds.length === 0;

  return {
    packId: normalizedPack.packId,
    discountPercent: normalizedPack.discountPercent,
    remainingCosmeticIds,
    remainingNormalValue,
    savings: complete ? 0 : savings,
    finalPrice: complete ? 0 : finalPrice,
    status: complete ? "complete" : "available"
  };
}

function normalizeCollectionPackRegistryDocument(value, { now } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const packs = Array.isArray(source.packs) ? source.packs : [];
  const byId = new Map();

  for (const pack of packs) {
    try {
      const normalized = validateCollectionPackDraft(pack, { now });
      byId.set(normalized.packId, normalized);
    } catch {
      // Records without a valid server-owned pack shape cannot be recovered safely.
    }
  }

  return {
    version: COLLECTION_PACK_REGISTRY_VERSION,
    packs: [...byId.values()].sort((left, right) => {
      const priorityDelta = left.sortPriority - right.sortPriority;
      return priorityDelta || left.packId.localeCompare(right.packId);
    })
  };
}

export class CollectionPackStore {
  constructor(options = {}) {
    this.store = new JsonStore("collection-packs.json", options);
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
    const raw = await this.store.read(clone(EMPTY_COLLECTION_PACK_REGISTRY));
    return normalizeCollectionPackRegistryDocument(raw, { now });
  }

  async listPacks() {
    return clone((await this.readRegistry()).packs);
  }

  async getPack(packId) {
    const safePackId = normalizePackId(packId);
    return clone((await this.listPacks()).find((pack) => pack.packId === safePackId) ?? null);
  }

  validateDraft(draft) {
    return clone(validateCollectionPackDraft(draft, { now: this.now() }));
  }

  calculateDraftValue(draft, ownedCosmeticIds = []) {
    return clone(
      calculateCollectionPackPriceForOwnedCosmetics(draft, ownedCosmeticIds, {
        now: this.now()
      })
    );
  }

  async upsertPack(draft) {
    return this.runMutation(async () => {
      const now = this.now();
      const registry = await this.readRegistry({ now });
      const packId = normalizePackId(draft?.packId ?? draft?.id);
      const existingIndex = registry.packs.findIndex((pack) => pack.packId === packId);
      const existing = existingIndex >= 0 ? registry.packs[existingIndex] : null;
      const normalized = validateCollectionPackDraft(
        {
          ...(existing ?? {}),
          ...(draft ?? {}),
          packId,
          createdAt: existing?.createdAt ?? draft?.createdAt ?? now,
          updatedAt: now
        },
        { now }
      );

      if (existingIndex >= 0) {
        registry.packs[existingIndex] = normalized;
      } else {
        registry.packs.push(normalized);
      }
      registry.packs.sort((left, right) => {
        const priorityDelta = left.sortPriority - right.sortPriority;
        return priorityDelta || left.packId.localeCompare(right.packId);
      });
      await this.store.write(registry);
      return clone(normalized);
    });
  }
}
