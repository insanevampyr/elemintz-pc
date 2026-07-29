import { getCosmeticDefinition, getEventChestRewardCosmeticEligibility } from "./cosmeticSystem.js";
import {
  DAILY_ELEMENT_CHEST_COLLECTION,
  DAILY_ELEMENT_CHEST_DROP_KEY,
  DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS,
  DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD,
  DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD,
  DAILY_ELEMENT_CHEST_ODDS,
  DAILY_ELEMENT_CHEST_PAID_OPEN_COST,
  DAILY_ELEMENT_CHEST_POOL,
  DAILY_ELEMENT_CHEST_RELEASE_TAG,
  DAILY_ELEMENT_CHEST_SOURCE,
  DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID
} from "./dailyElementChestSystem.js";
import { normalizeEventChestActiveWindows } from "./eventChestSchedule.js";

export const EVENT_CHEST_SCHEMA_VERSION = 1;
export const EVENT_CHEST_TYPES = Object.freeze(["daily_event_chest"]);
export const EVENT_CHEST_OPEN_TYPES = Object.freeze(["free", "paid"]);
export const EVENT_CHEST_RARITIES = Object.freeze(["common", "rare", "epic", "legendary"]);
export const EVENT_CHEST_LIFECYCLE_STATUSES = Object.freeze(["draft", "active", "inactive", "archived"]);
export const EVENT_CHEST_COSMETIC_TYPES = Object.freeze([
  "avatar",
  "cardBack",
  "background",
  "elementCardVariant",
  "badge",
  "title"
]);

const ODDS_SUM_TOLERANCE = 0.000001;
const PRIVATE_EVENT_CHEST_DEFINITION_FIELD_KEYS = Object.freeze([
  "account",
  "accounts",
  "accountId",
  "adminSessionToken",
  "dailyElementChest",
  "eventChests",
  "ownedCosmetics",
  "playerLevel",
  "playerProfile",
  "playerXP",
  "profile",
  "profiles",
  "profileKey",
  "sessionId",
  "sessionToken",
  "settlementKey",
  "socketId",
  "tokens",
  "uniqueCosmeticAcquisitions"
]);

function clonePool(pool) {
  return Object.freeze(
    Object.fromEntries(
      EVENT_CHEST_RARITIES.map((rarity) => [
        rarity,
        Object.freeze(
          (pool?.[rarity] ?? []).map((entry) =>
            Object.freeze({
              type: entry.type,
              cosmeticId: entry.cosmeticId
            })
          )
        )
      ])
    )
  );
}

export const DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET = Object.freeze({
  schemaVersion: EVENT_CHEST_SCHEMA_VERSION,
  chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
  presetId: "daily_elemintz_chest_default",
  title: "Daily EleMintz Chest",
  subtitle: "Free daily open or token open.",
  description: "Open once per daily reset for free, or spend Tokens for another chance at chest-exclusive cosmetics.",
  modalTitle: "Daily EleMintz Chest",
  chestType: "daily_event_chest",
  lifecycle: Object.freeze({
    status: "active",
    defaultPreset: true
  }),
  source: DAILY_ELEMENT_CHEST_SOURCE,
  dropKey: DAILY_ELEMENT_CHEST_DROP_KEY,
  collection: DAILY_ELEMENT_CHEST_COLLECTION,
  releaseTag: DAILY_ELEMENT_CHEST_RELEASE_TAG,
  icons: Object.freeze({
    closed: "icons/daily_chest.png",
    open: "icons/daily_chest_open.png",
    fallbackClosed: "icons/loot_chest.png",
    fallbackOpen: "icons/loot_chest_open.png"
  }),
  openTypes: Object.freeze(["free", "paid"]),
  freeOpenPolicy: Object.freeze({
    cadence: "daily",
    resetTimeZone: "America/Chicago",
    resetHour: 18
  }),
  paidTokenCost: DAILY_ELEMENT_CHEST_PAID_OPEN_COST,
  odds: Object.freeze({ ...DAILY_ELEMENT_CHEST_ODDS }),
  pity: Object.freeze({
    epicPlusThreshold: DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD,
    legendaryThreshold: DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD,
    epicPlusTable: Object.freeze([
      Object.freeze({ rarity: "epic", weight: 0.875 }),
      Object.freeze({ rarity: "legendary", weight: 0.125 })
    ])
  }),
  duplicateTokenRewards: Object.freeze({ ...DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS }),
  pool: clonePool(DAILY_ELEMENT_CHEST_POOL),
  preferUnownedWithinRolledRarity: true,
  hideTileWhenPoolComplete: true,
  allowOpensAfterCompleteAsDuplicateConversion: true,
  activeWindows: Object.freeze([]),
  definitionHistory: Object.freeze([]),
  preserveHistoryOnReactivation: true,
  profileProgressField: "dailyElementChest"
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateOdds(odds, errors) {
  if (!isObject(odds)) {
    errors.push("odds must be an object.");
    return;
  }

  let total = 0;
  for (const rarity of EVENT_CHEST_RARITIES) {
    const value = odds[rarity];
    if (!isNonNegativeNumber(value)) {
      errors.push(`odds.${rarity} must be a non-negative number.`);
      continue;
    }
    total += value;
  }

  if (Math.abs(total - 1) > ODDS_SUM_TOLERANCE) {
    errors.push("odds must sum to 1.");
  }
}

function validateWeightedRarityTable(table, fieldName, errors) {
  if (!Array.isArray(table) || table.length === 0) {
    errors.push(`${fieldName} must be a non-empty array.`);
    return;
  }

  let total = 0;
  for (const [index, entry] of table.entries()) {
    if (!isObject(entry)) {
      errors.push(`${fieldName}[${index}] must be an object.`);
      continue;
    }
    if (!EVENT_CHEST_RARITIES.includes(entry.rarity)) {
      errors.push(`${fieldName}[${index}].rarity is unsupported.`);
    }
    if (!isNonNegativeNumber(entry.weight)) {
      errors.push(`${fieldName}[${index}].weight must be a non-negative number.`);
      continue;
    }
    total += entry.weight;
  }

  if (Math.abs(total - 1) > ODDS_SUM_TOLERANCE) {
    errors.push(`${fieldName} weights must sum to 1.`);
  }
}

function validatePity(pity, errors) {
  if (!isObject(pity)) {
    errors.push("pity must be an object.");
    return;
  }

  if (!isNonNegativeInteger(pity.epicPlusThreshold) || pity.epicPlusThreshold <= 0) {
    errors.push("pity.epicPlusThreshold must be a positive integer.");
  }
  if (!isNonNegativeInteger(pity.legendaryThreshold) || pity.legendaryThreshold <= 0) {
    errors.push("pity.legendaryThreshold must be a positive integer.");
  }
  if (
    isNonNegativeInteger(pity.epicPlusThreshold) &&
    isNonNegativeInteger(pity.legendaryThreshold) &&
    pity.legendaryThreshold < pity.epicPlusThreshold
  ) {
    errors.push("pity.legendaryThreshold must be greater than or equal to pity.epicPlusThreshold.");
  }

  validateWeightedRarityTable(pity.epicPlusTable, "pity.epicPlusTable", errors);
}

function validatePool(pool, errors) {
  if (!isObject(pool)) {
    errors.push("pool must be an object.");
    return;
  }

  let totalEntries = 0;
  const seenCosmetics = new Set();
  for (const [rarity, entries] of Object.entries(pool)) {
    if (!EVENT_CHEST_RARITIES.includes(rarity)) {
      errors.push(`pool rarity '${rarity}' is unsupported.`);
      continue;
    }
    if (!Array.isArray(entries)) {
      errors.push(`pool.${rarity} must be an array.`);
      continue;
    }

    totalEntries += entries.length;
    for (const [index, entry] of entries.entries()) {
      if (!isObject(entry)) {
        errors.push(`pool.${rarity}[${index}] must be an object.`);
        continue;
      }

      const type = String(entry.type ?? "").trim();
      const cosmeticId = String(entry.cosmeticId ?? "").trim();
      if (!EVENT_CHEST_COSMETIC_TYPES.includes(type)) {
        errors.push(`pool.${rarity}[${index}].type is unsupported.`);
      }
      if (!cosmeticId) {
        errors.push(`pool.${rarity}[${index}].cosmeticId is required.`);
      }

      const key = `${type}:${cosmeticId}`;
      if (seenCosmetics.has(key)) {
        errors.push(`pool contains duplicate cosmetic '${key}'.`);
      }
      seenCosmetics.add(key);

      if (type && cosmeticId && !getCosmeticDefinition(type, cosmeticId)) {
        errors.push(`pool.${rarity}[${index}] references unknown cosmetic '${key}'.`);
        continue;
      }

      if (type && cosmeticId) {
        const eligibility = getEventChestRewardCosmeticEligibility(type, cosmeticId);
        if (eligibility.rarityKey && eligibility.rarityKey !== rarity) {
          errors.push(
            `pool.${rarity}[${index}] rarity bucket does not match catalog rarity '${eligibility.rarityKey}' for cosmetic '${key}'.`
          );
        }
        for (const reason of eligibility.blockingReasons) {
          if (reason === "unknown_cosmetic" || reason === "missing_cosmetic_id") {
            continue;
          }
          errors.push(`pool.${rarity}[${index}] cosmetic '${key}' is not eligible for normal Event Chests: ${reason}.`);
        }
      }
    }
  }

  if (totalEntries === 0) {
    errors.push("pool must contain at least one cosmetic.");
  }
}

function validateActiveWindows(activeWindows, errors) {
  errors.push(...normalizeEventChestActiveWindows(activeWindows).errors);
}

function validateDefinitionHistory(definitionHistory, errors) {
  if (!Array.isArray(definitionHistory)) {
    errors.push("definitionHistory must be an array.");
  }
}

function validateNoPrivateFields(value, errors, prefix = "") {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateNoPrivateFields(entry, errors, `${prefix}[${index}]`);
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const pathName = prefix ? `${prefix}.${key}` : key;
    if (PRIVATE_EVENT_CHEST_DEFINITION_FIELD_KEYS.includes(key)) {
      errors.push(`definition contains private player/profile field '${pathName}'.`);
    }
    validateNoPrivateFields(child, errors, pathName);
  }
}

export function validateEventChestDefinition(definition) {
  const errors = [];
  if (!isObject(definition)) {
    return {
      ok: false,
      errors: ["definition must be an object."]
    };
  }

  validateNoPrivateFields(definition, errors);

  if (!hasText(definition.chestId)) {
    errors.push("chestId is required.");
  }
  if (!hasText(definition.title)) {
    errors.push("title is required.");
  }
  if (!EVENT_CHEST_TYPES.includes(definition.chestType)) {
    errors.push("chestType is unsupported.");
  }
  if (!hasText(definition.modalTitle)) {
    errors.push("modalTitle is required.");
  }
  if (!hasText(definition.source)) {
    errors.push("source is required.");
  }
  if (!hasText(definition.dropKey)) {
    errors.push("dropKey is required.");
  }
  if (!hasText(definition.collection)) {
    errors.push("collection is required.");
  }
  if (!hasText(definition.releaseTag)) {
    errors.push("releaseTag is required.");
  }
  if (!isObject(definition.lifecycle)) {
    errors.push("lifecycle must be an object.");
  } else {
    if (!EVENT_CHEST_LIFECYCLE_STATUSES.includes(definition.lifecycle.status)) {
      errors.push("lifecycle.status is unsupported.");
    }
    if (typeof definition.lifecycle.defaultPreset !== "boolean") {
      errors.push("lifecycle.defaultPreset must be explicit boolean.");
    }
  }

  if (!isObject(definition.icons)) {
    errors.push("icons must be an object.");
  } else {
    for (const field of ["closed", "open", "fallbackClosed", "fallbackOpen"]) {
      if (!hasText(definition.icons[field])) {
        errors.push(`icons.${field} is required.`);
      }
    }
  }

  if (!Array.isArray(definition.openTypes) || definition.openTypes.length === 0) {
    errors.push("openTypes must be a non-empty array.");
  } else {
    for (const openType of definition.openTypes) {
      if (!EVENT_CHEST_OPEN_TYPES.includes(openType)) {
        errors.push(`openType '${String(openType)}' is unsupported.`);
      }
    }
  }

  if (definition.openTypes?.includes("free")) {
    const policy = definition.freeOpenPolicy;
    if (!isObject(policy)) {
      errors.push("freeOpenPolicy is required when free opens are allowed.");
    } else {
      if (policy.cadence !== "daily") {
        errors.push("freeOpenPolicy.cadence must be 'daily'.");
      }
      if (!hasText(policy.resetTimeZone)) {
        errors.push("freeOpenPolicy.resetTimeZone is required.");
      }
      if (!Number.isInteger(policy.resetHour) || policy.resetHour < 0 || policy.resetHour > 23) {
        errors.push("freeOpenPolicy.resetHour must be an integer from 0 to 23.");
      }
    }
  }

  if (definition.openTypes?.includes("paid") && !isNonNegativeInteger(definition.paidTokenCost)) {
    errors.push("paidTokenCost must be a non-negative integer when paid opens are allowed.");
  }

  validateOdds(definition.odds, errors);
  validatePity(definition.pity, errors);

  if (!isObject(definition.duplicateTokenRewards)) {
    errors.push("duplicateTokenRewards must be an object.");
  } else {
    for (const rarity of EVENT_CHEST_RARITIES) {
      if (!isNonNegativeInteger(definition.duplicateTokenRewards[rarity])) {
        errors.push(`duplicateTokenRewards.${rarity} must be a non-negative integer.`);
      }
    }
  }

  validatePool(definition.pool, errors);

  for (const flag of [
    "preferUnownedWithinRolledRarity",
    "hideTileWhenPoolComplete",
    "allowOpensAfterCompleteAsDuplicateConversion",
    "preserveHistoryOnReactivation"
  ]) {
    if (typeof definition[flag] !== "boolean") {
      errors.push(`${flag} must be explicit boolean.`);
    }
  }

  if (definition.activeWindows === undefined) {
    errors.push("activeWindows must be defined.");
  } else {
    validateActiveWindows(definition.activeWindows, errors);
  }
  if (definition.definitionHistory === undefined) {
    errors.push("definitionHistory must be defined.");
  } else {
    validateDefinitionHistory(definition.definitionHistory, errors);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
