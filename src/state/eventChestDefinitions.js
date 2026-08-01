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
import {
  normalizeEventChestEligibility,
  validateEventChestEligibility
} from "./eventChestEligibility.js";

export const EVENT_CHEST_SCHEMA_VERSION = 1;
export const EVENT_CHEST_TYPES = Object.freeze(["daily_event_chest"]);
export const EVENT_CHEST_OPEN_TYPES = Object.freeze(["entitlement", "free", "paid"]);
export const EVENT_CHEST_MAX_PAID_TOKEN_COST = 1_000_000;
export const EVENT_CHEST_MAX_DUPLICATE_TOKEN_REWARD = 1_000_000;
export const EVENT_CHEST_MAX_PITY_THRESHOLD = 10_000;
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
  eligibility: Object.freeze({ mode: "all_players" }),
  freeOpenPolicy: Object.freeze({
    cadence: "daily",
    resetTimeZone: "America/Chicago",
    resetHour: 18
  }),
  paidTokenCost: DAILY_ELEMENT_CHEST_PAID_OPEN_COST,
  odds: Object.freeze({ ...DAILY_ELEMENT_CHEST_ODDS }),
  pity: Object.freeze({
    epicPlusEnabled: true,
    legendaryEnabled: true,
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

function isSupportedTimeZone(value) {
  if (!hasText(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeEventChestOpeningRules(definition) {
  const safeDefinition = structuredClone(definition ?? {});
  const openTypeSet = new Set(
    (Array.isArray(safeDefinition.openTypes) ? safeDefinition.openTypes : [])
      .map((entry) => String(entry ?? "").trim())
  );
  safeDefinition.openTypes = EVENT_CHEST_OPEN_TYPES.filter((entry) => openTypeSet.has(entry));
  safeDefinition.eligibility = normalizeEventChestEligibility(safeDefinition.eligibility);
  return safeDefinition;
}

function validateOdds(odds, errors) {
  if (!isObject(odds)) {
    errors.push("odds must be an object.");
    return;
  }

  let total = 0;
  for (const key of Object.keys(odds)) {
    if (!EVENT_CHEST_RARITIES.includes(key)) {
      errors.push(`odds.${key} is unsupported.`);
    }
  }
  for (const rarity of EVENT_CHEST_RARITIES) {
    const value = odds[rarity];
    if (!isNonNegativeNumber(value) || value > 1) {
      errors.push(`odds.${rarity} must be a number from 0 to 1.`);
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
  const seenRarities = new Set();
  for (const [index, entry] of table.entries()) {
    if (!isObject(entry)) {
      errors.push(`${fieldName}[${index}] must be an object.`);
      continue;
    }
    if (!EVENT_CHEST_RARITIES.includes(entry.rarity)) {
      errors.push(`${fieldName}[${index}].rarity is unsupported.`);
    } else if (!["epic", "legendary"].includes(entry.rarity)) {
      errors.push(`${fieldName}[${index}].rarity must be epic or legendary.`);
    }
    if (seenRarities.has(entry.rarity)) {
      errors.push(`${fieldName} contains duplicate rarity '${entry.rarity}'.`);
    }
    seenRarities.add(entry.rarity);
    if (!isNonNegativeNumber(entry.weight) || entry.weight > 1) {
      errors.push(`${fieldName}[${index}].weight must be a number from 0 to 1.`);
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

  const supportedFields = new Set([
    "epicPlusEnabled",
    "legendaryEnabled",
    "epicPlusThreshold",
    "legendaryThreshold",
    "epicPlusTable"
  ]);
  for (const key of Object.keys(pity)) {
    if (!supportedFields.has(key)) {
      errors.push(`pity.${key} is unsupported.`);
    }
  }
  const epicPlusEnabled = pity.epicPlusEnabled !== false;
  const legendaryEnabled = pity.legendaryEnabled !== false;
  if (pity.epicPlusEnabled !== undefined && typeof pity.epicPlusEnabled !== "boolean") {
    errors.push("pity.epicPlusEnabled must be a boolean.");
  }
  if (pity.legendaryEnabled !== undefined && typeof pity.legendaryEnabled !== "boolean") {
    errors.push("pity.legendaryEnabled must be a boolean.");
  }
  if (
    epicPlusEnabled &&
    (!isNonNegativeInteger(pity.epicPlusThreshold) ||
      pity.epicPlusThreshold <= 0 ||
      pity.epicPlusThreshold > EVENT_CHEST_MAX_PITY_THRESHOLD)
  ) {
    errors.push(`pity.epicPlusThreshold must be a positive integer no greater than ${EVENT_CHEST_MAX_PITY_THRESHOLD}.`);
  }
  if (
    legendaryEnabled &&
    (!isNonNegativeInteger(pity.legendaryThreshold) ||
      pity.legendaryThreshold <= 0 ||
      pity.legendaryThreshold > EVENT_CHEST_MAX_PITY_THRESHOLD)
  ) {
    errors.push(`pity.legendaryThreshold must be a positive integer no greater than ${EVENT_CHEST_MAX_PITY_THRESHOLD}.`);
  }
  if (
    epicPlusEnabled &&
    legendaryEnabled &&
    isNonNegativeInteger(pity.epicPlusThreshold) &&
    isNonNegativeInteger(pity.legendaryThreshold) &&
    pity.legendaryThreshold < pity.epicPlusThreshold
  ) {
    errors.push("pity.legendaryThreshold must be greater than or equal to pity.epicPlusThreshold.");
  }

  if (epicPlusEnabled) {
    validateWeightedRarityTable(pity.epicPlusTable, "pity.epicPlusTable", errors);
  }
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
    const seenOpenTypes = new Set();
    for (const openType of definition.openTypes) {
      if (!EVENT_CHEST_OPEN_TYPES.includes(openType)) {
        errors.push(`openType '${String(openType)}' is unsupported.`);
      }
      if (seenOpenTypes.has(openType)) {
        errors.push(`openTypes contains duplicate value '${String(openType)}'.`);
      }
      seenOpenTypes.add(openType);
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
      if (!isSupportedTimeZone(policy.resetTimeZone)) {
        errors.push("freeOpenPolicy.resetTimeZone must be a valid IANA timezone.");
      }
      if (!Number.isInteger(policy.resetHour) || policy.resetHour < 0 || policy.resetHour > 23) {
        errors.push("freeOpenPolicy.resetHour must be an integer from 0 to 23.");
      }
      const unsupportedFields = Object.keys(policy).filter(
        (field) => !["cadence", "resetTimeZone", "resetHour"].includes(field)
      );
      if (unsupportedFields.length > 0) {
        errors.push(`freeOpenPolicy contains unsupported field '${unsupportedFields[0]}'.`);
      }
    }
  }

  if (definition.openTypes?.includes("paid")) {
    if (!Number.isInteger(definition.paidTokenCost) || definition.paidTokenCost <= 0) {
      errors.push("paidTokenCost must be a positive integer when paid opens are allowed.");
    } else if (definition.paidTokenCost > EVENT_CHEST_MAX_PAID_TOKEN_COST) {
      errors.push(`paidTokenCost cannot exceed ${EVENT_CHEST_MAX_PAID_TOKEN_COST}.`);
    }
  }

  validateEventChestEligibility(definition.eligibility, errors);

  validateOdds(definition.odds, errors);
  validatePity(definition.pity, errors);

  if (!isObject(definition.duplicateTokenRewards)) {
    errors.push("duplicateTokenRewards must be an object.");
  } else {
    for (const key of Object.keys(definition.duplicateTokenRewards)) {
      if (!EVENT_CHEST_RARITIES.includes(key)) {
        errors.push(`duplicateTokenRewards.${key} is unsupported.`);
      }
    }
    for (const rarity of EVENT_CHEST_RARITIES) {
      const value = definition.duplicateTokenRewards[rarity];
      if (!isNonNegativeInteger(value) || value > EVENT_CHEST_MAX_DUPLICATE_TOKEN_REWARD) {
        errors.push(
          `duplicateTokenRewards.${rarity} must be a non-negative integer no greater than ${EVENT_CHEST_MAX_DUPLICATE_TOKEN_REWARD}.`
        );
      }
    }
  }

  validatePool(definition.pool, errors);

  if (isObject(definition.odds) && isObject(definition.pool)) {
    for (const rarity of EVENT_CHEST_RARITIES) {
      if (Number(definition.odds[rarity]) > 0 && !Array.isArray(definition.pool[rarity])) {
        errors.push(`pool.${rarity} must be an array because ${rarity} odds are greater than 0.`);
      } else if (Number(definition.odds[rarity]) > 0 && definition.pool[rarity].length === 0) {
        errors.push(`${rarity} rewards are required because ${rarity} odds are greater than 0.`);
      }
    }
    if (
      definition.pity?.legendaryEnabled !== false &&
      Array.isArray(definition.pool.legendary) &&
      definition.pool.legendary.length === 0
    ) {
      errors.push("legendary rewards are required while Legendary pity is enabled.");
    }
    if (definition.pity?.epicPlusEnabled !== false) {
      for (const entry of Array.isArray(definition.pity?.epicPlusTable)
        ? definition.pity.epicPlusTable
        : []) {
        if (
          Number(entry?.weight) > 0 &&
          Array.isArray(definition.pool[entry.rarity]) &&
          definition.pool[entry.rarity].length === 0
        ) {
          errors.push(`${entry.rarity} rewards are required by the Epic+ pity table.`);
        }
      }
    }
  }

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
