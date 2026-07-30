import crypto from "node:crypto";

import {
  EVENT_CHEST_RARITIES,
  validateEventChestDefinition
} from "./eventChestDefinitions.js";
import { getCosmeticDefinition } from "./cosmeticSystem.js";
import { grantCosmeticItem, normalizeProfileStore } from "./storeSystem.js";
import {
  getEventChestPityRuleState,
  getEventChestPityState,
  resolveEventChestPity
} from "./eventChestPity.js";

export const EVENT_CHEST_REWARD_SETTLEMENT_SCHEMA_VERSION = 1;
export const EVENT_CHEST_REWARD_TYPES = Object.freeze(["cosmetic", "tokens"]);

const REWARD_TYPE_SET = new Set(EVENT_CHEST_REWARD_TYPES);
const RARITY_SET = new Set(EVENT_CHEST_RARITIES);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeRequiredString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableCosmetic(value) {
  if (value == null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }

  const type = normalizeRequiredString(value.type);
  const cosmeticId = normalizeRequiredString(value.cosmeticId);
  if (!type || !cosmeticId) {
    return null;
  }

  return { type, cosmeticId };
}

function normalizeNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeIso(value) {
  const parsedMs = Date.parse(String(value ?? ""));
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : null;
}

function normalizePityCounters(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const epicPlusMisses = normalizeNonNegativeInteger(value.epicPlusMisses);
  const legendaryMisses = normalizeNonNegativeInteger(value.legendaryMisses);
  return epicPlusMisses == null || legendaryMisses == null
    ? null
    : { epicPlusMisses, legendaryMisses };
}

function normalizePitySettlement(value) {
  if (value == null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  const before = normalizePityCounters(value.before);
  const after = normalizePityCounters(value.after);
  const appliedTarget =
    value.appliedTarget == null ? null : normalizeRequiredString(value.appliedTarget);
  if (
    !before ||
    !after ||
    (appliedTarget != null && !["epic_plus", "legendary"].includes(appliedTarget))
  ) {
    return null;
  }
  return { appliedTarget, before, after };
}

function getOwnedSet(profile, type) {
  return new Set(Array.isArray(profile?.ownedCosmetics?.[type]) ? profile.ownedCosmetics[type] : []);
}

function addTokens(profile, amount) {
  const tokenAmount = normalizeNonNegativeInteger(amount);
  if (tokenAmount == null) {
    throw Object.assign(new Error("Event Chest duplicate token reward is invalid."), {
      code: "EVENT_CHEST_OPEN_INVALID_DUPLICATE_REWARD"
    });
  }

  const normalized = normalizeProfileStore(profile);
  return normalizeProfileStore({
    ...normalized,
    tokens: Math.max(0, Number(normalized.tokens ?? 0)) + tokenAmount
  });
}

export function buildEventChestOpenTransactionId(entitlementId) {
  const safeEntitlementId = normalizeRequiredString(entitlementId);
  if (!safeEntitlementId) {
    return null;
  }

  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ purpose: "event_chest_open", entitlementId: safeEntitlementId }))
    .digest("hex");
  return `event_chest_open_${digest.slice(0, 32)}`;
}

export function normalizeEventChestRewardSettlement(value) {
  if (!isPlainObject(value) || Number(value.schemaVersion) !== EVENT_CHEST_REWARD_SETTLEMENT_SCHEMA_VERSION) {
    return null;
  }

  const entitlementId = normalizeRequiredString(value.entitlementId);
  const chestId = normalizeRequiredString(value.chestId);
  const definitionRevisionId = normalizeRequiredString(value.definitionRevisionId);
  const transactionId = normalizeRequiredString(value.transactionId);
  const settledAt = normalizeIso(value.settledAt);
  const reward = isPlainObject(value.reward) ? value.reward : null;
  const rewardType = normalizeRequiredString(reward?.type);
  const rarity = normalizeRequiredString(reward?.rarity);
  const cosmetic = normalizeNullableCosmetic(reward?.cosmetic);
  const tokenAmount = normalizeNonNegativeInteger(reward?.tokenAmount ?? 0);
  const openingMethod =
    value.openingMethod == null ? null : normalizeRequiredString(value.openingMethod);
  const tokensCharged = normalizeNonNegativeInteger(value.tokensCharged ?? 0);
  const tokenBalance =
    value.tokenBalance == null ? null : normalizeNonNegativeInteger(value.tokenBalance);
  const pity = normalizePitySettlement(value.pity);

  if (
    !entitlementId ||
    !chestId ||
    !definitionRevisionId ||
    !transactionId ||
    !settledAt ||
    !REWARD_TYPE_SET.has(rewardType) ||
    !RARITY_SET.has(rarity) ||
    tokenAmount == null ||
    tokensCharged == null ||
    (value.tokenBalance != null && tokenBalance == null) ||
    (value.pity != null && !pity)
  ) {
    return null;
  }

  if (rewardType === "cosmetic" && !cosmetic) {
    return null;
  }

  if (rewardType === "tokens" && tokenAmount <= 0 && !reward?.duplicateConverted) {
    return null;
  }

  return {
    schemaVersion: EVENT_CHEST_REWARD_SETTLEMENT_SCHEMA_VERSION,
    entitlementId,
    chestId,
    definitionRevisionId,
    transactionId,
    settledAt,
    ...(openingMethod ? { openingMethod } : {}),
    tokensCharged,
    tokenBalance,
    pity,
    reward: {
      type: rewardType,
      rarity,
      cosmetic,
      tokenAmount,
      duplicateConverted: Boolean(reward?.duplicateConverted)
    }
  };
}

function chooseWeightedRarity(roll, odds) {
  const safeRoll = Math.max(0, Math.min(1, Number(roll ?? 0) || 0));
  let running = 0;
  for (const rarity of EVENT_CHEST_RARITIES) {
    running += Math.max(0, Number(odds?.[rarity] ?? 0));
    if (safeRoll < running) {
      return rarity;
    }
  }

  return EVENT_CHEST_RARITIES.at(-1);
}

function pickEntry(entries, random) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const roll = Number(typeof random === "function" ? random() : Math.random());
  const index = Math.max(0, Math.min(entries.length - 1, Math.floor((Number.isFinite(roll) ? roll : 0) * entries.length)));
  return entries[index];
}

function validateRewardEntry(entry, rarity) {
  const type = normalizeRequiredString(entry?.type);
  const cosmeticId = normalizeRequiredString(entry?.cosmeticId);
  if (!type || !cosmeticId) {
    throw Object.assign(new Error("Event Chest reward entry is malformed."), {
      code: "EVENT_CHEST_OPEN_INVALID_REWARD"
    });
  }

  const definition = getCosmeticDefinition(type, cosmeticId);
  if (!definition || String(definition.rarity ?? "").trim().toLowerCase() !== rarity) {
    throw Object.assign(new Error(`Event Chest reward ${type}:${cosmeticId} is invalid.`), {
      code: "EVENT_CHEST_OPEN_INVALID_REWARD"
    });
  }

  return { type, cosmeticId, definition };
}

export function selectEventChestReward({
  definition,
  profile,
  random = Math.random,
  now = new Date().toISOString()
} = {}) {
  const validation = validateEventChestDefinition(definition);
  if (!validation.ok) {
    throw Object.assign(new Error(`Event Chest definition is invalid: ${validation.errors.join("; ")}`), {
      code: "EVENT_CHEST_OPEN_INVALID_DEFINITION"
    });
  }

  const normalizedProfile = normalizeProfileStore(profile);
  const pityBefore = getEventChestPityState(profile?.eventChestPity, definition.chestId);
  const pityRules = getEventChestPityRuleState(definition.pity);
  const legendaryDue =
    pityRules.legendaryEnabled &&
    pityBefore.legendaryMisses + 1 >= pityRules.legendaryThreshold;
  const epicPlusDue =
    pityRules.epicPlusEnabled &&
    pityBefore.epicPlusMisses + 1 >= pityRules.epicPlusThreshold;
  const appliedPityTarget = legendaryDue ? "legendary" : epicPlusDue ? "epic_plus" : null;
  const epicPlusOdds = Object.fromEntries(
    EVENT_CHEST_RARITIES.map((rarityKey) => [
      rarityKey,
      (definition.pity?.epicPlusTable ?? [])
        .filter((entry) => entry.rarity === rarityKey)
        .reduce((sum, entry) => sum + Number(entry.weight ?? 0), 0)
    ])
  );
  const rarity = legendaryDue
    ? "legendary"
    : epicPlusDue
      ? chooseWeightedRarity(
          typeof random === "function" ? random() : Math.random(),
          epicPlusOdds
        )
      : chooseWeightedRarity(
          typeof random === "function" ? random() : Math.random(),
          definition.odds
        );
  const rarityPool = Array.isArray(definition?.pool?.[rarity]) ? definition.pool[rarity] : [];
  const validEntries = rarityPool.map((entry) => validateRewardEntry(entry, rarity));
  if (validEntries.length === 0) {
    throw Object.assign(new Error(`Event Chest pool has no rewards for rarity '${rarity}'.`), {
      code: "EVENT_CHEST_OPEN_INVALID_POOL"
    });
  }

  const candidateEntries = definition.preferUnownedWithinRolledRarity
    ? validEntries.filter((entry) => !getOwnedSet(normalizedProfile, entry.type).has(entry.cosmeticId))
    : validEntries;
  const selected = pickEntry(candidateEntries.length > 0 ? candidateEntries : validEntries, random);
  if (!selected) {
    throw Object.assign(new Error("Event Chest reward selection failed."), {
      code: "EVENT_CHEST_OPEN_INVALID_REWARD"
    });
  }

  const alreadyOwned = getOwnedSet(normalizedProfile, selected.type).has(selected.cosmeticId);
  const pity = resolveEventChestPity({
    pityState: pityBefore,
    pityRules: definition.pity,
    rolledRarity: rarity,
    now
  });
  return {
    rarity,
    type: selected.type,
    cosmeticId: selected.cosmeticId,
    alreadyOwned,
    pity: {
      appliedTarget: appliedPityTarget,
      before: pity.before,
      after: pity.after
    }
  };
}

export function applyEventChestReward({ profile, definition, selectedReward } = {}) {
  const normalizedProfile = normalizeProfileStore(profile);
  const selected = validateRewardEntry(selectedReward, selectedReward?.rarity);
  const alreadyOwned = getOwnedSet(normalizedProfile, selected.type).has(selected.cosmeticId);

  if (alreadyOwned) {
    if (!definition?.allowOpensAfterCompleteAsDuplicateConversion) {
      throw Object.assign(new Error("Event Chest duplicate conversion is disabled for this reward."), {
        code: "EVENT_CHEST_OPEN_DUPLICATE_CONVERSION_DISABLED"
      });
    }

    const tokenAmount = normalizeNonNegativeInteger(definition?.duplicateTokenRewards?.[selectedReward.rarity]);
    if (tokenAmount == null) {
      throw Object.assign(new Error("Event Chest duplicate token reward is invalid."), {
        code: "EVENT_CHEST_OPEN_INVALID_DUPLICATE_REWARD"
      });
    }

    return {
      profile: addTokens(normalizedProfile, tokenAmount),
      reward: {
        type: "tokens",
        rarity: selectedReward.rarity,
        cosmetic: {
          type: selected.type,
          cosmeticId: selected.cosmeticId
        },
        tokenAmount,
        duplicateConverted: true
      }
    };
  }

  const grant = grantCosmeticItem(normalizedProfile, {
    type: selected.type,
    cosmeticId: selected.cosmeticId
  });
  return {
    profile: grant.profile,
    reward: {
      type: "cosmetic",
      rarity: selectedReward.rarity,
      cosmetic: {
        type: selected.type,
        cosmeticId: selected.cosmeticId
      },
      tokenAmount: 0,
      duplicateConverted: false
    }
  };
}

export function createEventChestRewardSettlement({
  entitlementId,
  chestId,
  definitionRevisionId,
  transactionId,
  settledAt,
  reward,
  openingMethod = "entitlement",
  tokensCharged = 0,
  tokenBalance = null,
  pity = null
} = {}) {
  const normalized = normalizeEventChestRewardSettlement({
    schemaVersion: EVENT_CHEST_REWARD_SETTLEMENT_SCHEMA_VERSION,
    entitlementId,
    chestId,
    definitionRevisionId,
    transactionId,
    settledAt,
    openingMethod,
    tokensCharged,
    tokenBalance,
    pity,
    reward
  });
  if (!normalized) {
    throw Object.assign(new Error("Event Chest reward settlement is invalid."), {
      code: "EVENT_CHEST_OPEN_SETTLEMENT_INVALID"
    });
  }

  return normalized;
}

function buildSafeCosmeticMetadata(cosmetic) {
  if (!cosmetic) {
    return null;
  }

  const definition = getCosmeticDefinition(cosmetic.type, cosmetic.cosmeticId);
  return {
    type: cosmetic.type,
    cosmeticId: cosmetic.cosmeticId,
    name: definition?.name ?? cosmetic.cosmeticId,
    rarity: definition?.rarity ?? null,
    element: definition?.element ?? null,
    collection: definition?.collection ?? null,
    image: definition?.image ?? null
  };
}

export function buildSafeEventChestRewardResponse(reward) {
  return {
    type: reward.type,
    rarity: reward.rarity,
    tokenAmount: reward.tokenAmount,
    duplicateConverted: reward.duplicateConverted,
    cosmetic:
      reward.type === "cosmetic"
        ? buildSafeCosmeticMetadata(reward.cosmetic)
        : null
  };
}

export function buildEventChestOpenResponse({ entitlement, settlement, replayed = false } = {}) {
  const normalizedSettlement = normalizeEventChestRewardSettlement(settlement);
  if (!normalizedSettlement) {
    throw Object.assign(new Error("Event Chest reward settlement is invalid."), {
      code: "EVENT_CHEST_OPEN_SETTLEMENT_INVALID"
    });
  }

  const openedAt = entitlement?.openedAt ?? normalizedSettlement.settledAt;
  return {
    entitlement: {
      entitlementId: normalizedSettlement.entitlementId,
      chestId: normalizedSettlement.chestId,
      definitionRevisionId: normalizedSettlement.definitionRevisionId,
      status: "opened",
      openedAt
    },
    replayed: Boolean(replayed),
    alreadyOpened: Boolean(replayed),
    tokensCharged: normalizedSettlement.tokensCharged,
    duplicateTokensAwarded: normalizedSettlement.reward.duplicateConverted
      ? normalizedSettlement.reward.tokenAmount
      : 0,
    tokenBalance: normalizedSettlement.tokenBalance,
    pityGuarantee: normalizedSettlement.pity?.appliedTarget ?? null,
    reward: buildSafeEventChestRewardResponse(normalizedSettlement.reward)
  };
}

export function cloneEventChestSettlement(value) {
  return clone(value);
}
