import { getCosmeticDefinition } from "./cosmeticSystem.js";
import { getDailyResetWindow } from "./dailyChallengesSystem.js";
import { grantCosmeticItem, normalizeProfileStore } from "./storeSystem.js";

export const DAILY_ELEMENT_CHEST_SOURCE = "daily_element_chest";
export const DAILY_ELEMENT_CHEST_COLLECTION = "Daily EleMintz Chest";
export const DAILY_ELEMENT_CHEST_DROP_KEY = "daily_elemintz_chest";
export const DAILY_ELEMENT_CHEST_RELEASE_TAG = "daily_elemintz_chest_2026_06";
export const DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID = "daily_elemintz_chest_current";
export const DAILY_ELEMENT_CHEST_PAID_OPEN_COST = 100;
export const DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD = 10;
export const DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD = 30;
export const DAILY_ELEMENT_CHEST_OPEN_TYPES = Object.freeze(["free", "paid"]);
export const DAILY_ELEMENT_CHEST_ODDS = Object.freeze({
  common: 0.7,
  rare: 0.22,
  epic: 0.07,
  legendary: 0.01
});
export const DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS = Object.freeze({
  common: 25,
  rare: 60,
  epic: 150,
  legendary: 400
});

const FULL_RARITY_TABLE = Object.freeze([
  Object.freeze({ rarity: "common", threshold: DAILY_ELEMENT_CHEST_ODDS.common }),
  Object.freeze({
    rarity: "rare",
    threshold: DAILY_ELEMENT_CHEST_ODDS.common + DAILY_ELEMENT_CHEST_ODDS.rare
  }),
  Object.freeze({
    rarity: "epic",
    threshold:
      DAILY_ELEMENT_CHEST_ODDS.common +
      DAILY_ELEMENT_CHEST_ODDS.rare +
      DAILY_ELEMENT_CHEST_ODDS.epic
  }),
  Object.freeze({ rarity: "legendary", threshold: 1 })
]);

const EPIC_PLUS_PITY_TABLE = Object.freeze([
  Object.freeze({ rarity: "epic", threshold: 0.875 }),
  Object.freeze({ rarity: "legendary", threshold: 1 })
]);

export const DAILY_ELEMENT_CHEST_POOL = Object.freeze({
  common: Object.freeze([
    Object.freeze({ type: "title", cosmeticId: "title_first_light" }),
    Object.freeze({ type: "title", cosmeticId: "title_element_touched" }),
    Object.freeze({ type: "badge", cosmeticId: "badge_daily_emblem" })
  ]),
  rare: Object.freeze([
    Object.freeze({ type: "avatar", cosmeticId: "avatar_chestbound_adept" }),
    Object.freeze({ type: "background", cosmeticId: "background_morning_sanctum" })
  ]),
  epic: Object.freeze([
    Object.freeze({ type: "cardBack", cosmeticId: "cardback_daily_element_chest" }),
    Object.freeze({ type: "elementCardVariant", cosmeticId: "fire_variant_sunflare" }),
    Object.freeze({ type: "elementCardVariant", cosmeticId: "water_variant_tideglass" }),
    Object.freeze({ type: "elementCardVariant", cosmeticId: "earth_variant_verdant_core" }),
    Object.freeze({ type: "elementCardVariant", cosmeticId: "wind_variant_cloudcoil" })
  ]),
  legendary: Object.freeze([
    Object.freeze({ type: "avatar", cosmeticId: "avatar_element_chosen" }),
    Object.freeze({ type: "background", cosmeticId: "background_chamber_of_the_four" })
  ])
});

function getDailyElementChestDateKey(nowMs = Date.now()) {
  const { lastResetMs } = getDailyResetWindow(nowMs);
  return new Date(lastResetMs).toISOString();
}

function safeCounter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.floor(numeric));
}

function normalizePityState(value) {
  const safeValue =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    opensSinceEpicPlus: safeCounter(safeValue.opensSinceEpicPlus),
    opensSinceLegendary: safeCounter(safeValue.opensSinceLegendary)
  };
}

export function createDefaultDailyElementChestState() {
  return {
    dailyElementChest: {
      lastFreeOpenDateKey: null,
      totalOpens: 0,
      paidOpens: 0,
      freeOpens: 0,
      pity: normalizePityState(null)
    }
  };
}

export function normalizeProfileDailyElementChest(profile) {
  const defaults = createDefaultDailyElementChestState().dailyElementChest;
  const current =
    profile?.dailyElementChest &&
    typeof profile.dailyElementChest === "object" &&
    !Array.isArray(profile.dailyElementChest)
      ? profile.dailyElementChest
      : {};
  const lastFreeOpenDateKey = String(current.lastFreeOpenDateKey ?? "").trim();

  return {
    ...profile,
    dailyElementChest: {
      lastFreeOpenDateKey: lastFreeOpenDateKey || null,
      totalOpens: safeCounter(current.totalOpens ?? defaults.totalOpens),
      paidOpens: safeCounter(current.paidOpens ?? defaults.paidOpens),
      freeOpens: safeCounter(current.freeOpens ?? defaults.freeOpens),
      pity: normalizePityState(current.pity)
    }
  };
}

function normalizeOpenType(openType) {
  const normalized = String(openType ?? "").trim().toLowerCase();
  return DAILY_ELEMENT_CHEST_OPEN_TYPES.includes(normalized) ? normalized : null;
}

function chooseWeightedRarity(roll, table) {
  const safeRoll = Math.max(0, Math.min(1, Number(roll ?? 0) || 0));
  for (const entry of table) {
    if (safeRoll < entry.threshold) {
      return entry.rarity;
    }
  }

  return table.at(-1)?.rarity ?? "common";
}

function pickPoolEntry(rarity, random) {
  const pool = DAILY_ELEMENT_CHEST_POOL[rarity] ?? [];
  if (!pool.length) {
    throw new Error(`No Daily Element Chest pool is configured for rarity '${rarity}'.`);
  }

  const index = Math.max(0, Math.min(pool.length - 1, Math.floor((Number(random?.()) || 0) * pool.length)));
  return pool[index];
}

function getOwnedSet(profile, type) {
  return new Set(Array.isArray(profile?.ownedCosmetics?.[type]) ? profile.ownedCosmetics[type] : []);
}

function addTokens(profile, amount) {
  const normalized = normalizeProfileStore(profile);
  return normalizeProfileStore({
    ...normalized,
    tokens: Math.max(0, Number(normalized.tokens ?? 0)) + safeCounter(amount)
  });
}

export function getDailyChestRewardPool(poolId = DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID) {
  return DAILY_ELEMENT_CHEST_POOL;
}

function buildPoolSummary(pool = DAILY_ELEMENT_CHEST_POOL) {
  return Object.fromEntries(
    Object.entries(pool).map(([rarity, entries]) => [
      rarity,
      entries.map((entry) => {
        const definition = getCosmeticDefinition(entry.type, entry.cosmeticId);
        return {
          type: entry.type,
          cosmeticId: entry.cosmeticId,
          name: definition?.name ?? entry.cosmeticId
        };
      })
    ])
  );
}

function buildCollectionProgress(profile, pool = DAILY_ELEMENT_CHEST_POOL) {
  const byRarity = {};
  const items = {};
  let totalOwned = 0;
  let totalAvailable = 0;

  for (const [rarity, entries] of Object.entries(pool)) {
    const detailedEntries = entries.map((entry) => {
      const definition = getCosmeticDefinition(entry.type, entry.cosmeticId);
      const owned = getOwnedSet(profile, entry.type).has(entry.cosmeticId);
      if (owned) {
        totalOwned += 1;
      }
      totalAvailable += 1;
      return {
        type: entry.type,
        cosmeticId: entry.cosmeticId,
        name: definition?.name ?? entry.cosmeticId,
        owned
      };
    });

    items[rarity] = detailedEntries;
    byRarity[rarity] = {
      owned: detailedEntries.filter((entry) => entry.owned).length,
      total: detailedEntries.length,
      isComplete: detailedEntries.length > 0 && detailedEntries.every((entry) => entry.owned)
    };
  }

  return {
    totalOwned,
    totalAvailable,
    isComplete: totalAvailable > 0 && totalOwned >= totalAvailable,
    byRarity,
    items
  };
}

export function getDailyChestPoolStatus(profile, poolId = DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID) {
  const pool = getDailyChestRewardPool(poolId);
  const normalized = normalizeProfileDailyElementChest(normalizeProfileStore(profile));
  const progress = buildCollectionProgress(normalized, pool);
  return {
    poolId,
    ...progress
  };
}

export function isDailyChestPoolComplete(profile, poolId = DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID) {
  return getDailyChestPoolStatus(profile, poolId).isComplete === true;
}

function pickPoolEntryForProfile(rarity, profile, random) {
  const pool = DAILY_ELEMENT_CHEST_POOL[rarity] ?? [];
  if (!pool.length) {
    throw new Error(`No Daily Element Chest pool is configured for rarity '${rarity}'.`);
  }

  const unownedEntries = pool.filter((entry) => !getOwnedSet(profile, entry.type).has(entry.cosmeticId));
  if (unownedEntries.length > 0) {
    const index = Math.max(
      0,
      Math.min(unownedEntries.length - 1, Math.floor((Number(random?.()) || 0) * unownedEntries.length))
    );
    return unownedEntries[index];
  }

  return pickPoolEntry(rarity, random);
}

export function getDailyElementChestStatus(profile, nowMs = Date.now()) {
  const normalized = normalizeProfileDailyElementChest(normalizeProfileStore(profile));
  const resetWindow = getDailyResetWindow(nowMs);
  const dateKey = getDailyElementChestDateKey(nowMs);
  const canOpenFree = normalized.dailyElementChest.lastFreeOpenDateKey !== dateKey;

  return {
    canOpenFree,
    nextFreeResetAt: new Date(resetWindow.nextResetMs).toISOString(),
    paidOpenCost: DAILY_ELEMENT_CHEST_PAID_OPEN_COST,
    tokens: Math.max(0, Number(normalized.tokens ?? 0)),
    dailyElementChest: normalized.dailyElementChest,
    pity: normalized.dailyElementChest.pity,
    odds: DAILY_ELEMENT_CHEST_ODDS,
    poolSummary: buildPoolSummary(),
    collectionProgress: buildCollectionProgress(normalized)
  };
}

export function openDailyElementChest(
  profile,
  { openType = "free", nowMs = Date.now(), random = Math.random } = {}
) {
  const normalizedOpenType = normalizeOpenType(openType);
  if (!normalizedOpenType) {
    throw new Error("Daily Element Chest openType must be 'free' or 'paid'.");
  }

  let nextProfile = normalizeProfileDailyElementChest(normalizeProfileStore(profile));
  const statusBefore = getDailyElementChestStatus(nextProfile, nowMs);

  if (normalizedOpenType === "free" && !statusBefore.canOpenFree) {
    throw new Error("Daily Element Chest free open has already been used for this reset window.");
  }

  if (normalizedOpenType === "paid" && nextProfile.tokens < DAILY_ELEMENT_CHEST_PAID_OPEN_COST) {
    throw new Error(
      `Insufficient tokens for a Daily Element Chest open. Need ${DAILY_ELEMENT_CHEST_PAID_OPEN_COST}, have ${nextProfile.tokens}.`
    );
  }

  if (normalizedOpenType === "paid") {
    nextProfile = normalizeProfileStore({
      ...nextProfile,
      tokens: nextProfile.tokens - DAILY_ELEMENT_CHEST_PAID_OPEN_COST
    });
  }

  const pityBefore = normalizePityState(nextProfile.dailyElementChest?.pity);
  const pityApplied = {
    epicPlus: pityBefore.opensSinceEpicPlus + 1 >= DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD,
    legendary: pityBefore.opensSinceLegendary + 1 >= DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD
  };

  const rolledRarity = pityApplied.legendary
    ? "legendary"
    : pityApplied.epicPlus
      ? chooseWeightedRarity(random(), EPIC_PLUS_PITY_TABLE)
      : chooseWeightedRarity(random(), FULL_RARITY_TABLE);
  const rolledEntry = pickPoolEntryForProfile(rolledRarity, nextProfile, random);
  const definition = getCosmeticDefinition(rolledEntry.type, rolledEntry.cosmeticId);

  if (!definition) {
    throw new Error(
      `Daily Element Chest reward ${rolledEntry.type}:${rolledEntry.cosmeticId} is missing from the cosmetic catalog.`
    );
  }

  let cosmetic = null;
  let duplicateConversion = null;
  const alreadyOwned = getOwnedSet(nextProfile, rolledEntry.type).has(rolledEntry.cosmeticId);

  if (alreadyOwned) {
    const tokensGranted = DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS[rolledRarity] ?? 0;
    nextProfile = addTokens(nextProfile, tokensGranted);
    duplicateConversion = {
      tokensGranted
    };
  } else {
    const grantResult = grantCosmeticItem(nextProfile, rolledEntry);
    nextProfile = grantResult.profile;
    cosmetic = {
      type: rolledEntry.type,
      cosmeticId: rolledEntry.cosmeticId
    };
  }

  const nextPity =
    rolledRarity === "legendary"
      ? { opensSinceEpicPlus: 0, opensSinceLegendary: 0 }
      : rolledRarity === "epic"
        ? { opensSinceEpicPlus: 0, opensSinceLegendary: pityBefore.opensSinceLegendary + 1 }
        : {
            opensSinceEpicPlus: pityBefore.opensSinceEpicPlus + 1,
            opensSinceLegendary: pityBefore.opensSinceLegendary + 1
          };

  const currentDateKey = getDailyElementChestDateKey(nowMs);
  nextProfile = normalizeProfileDailyElementChest({
    ...nextProfile,
    dailyElementChest: {
      lastFreeOpenDateKey:
        normalizedOpenType === "free"
          ? currentDateKey
          : nextProfile.dailyElementChest?.lastFreeOpenDateKey ?? null,
      totalOpens: safeCounter(nextProfile.dailyElementChest?.totalOpens) + 1,
      paidOpens:
        safeCounter(nextProfile.dailyElementChest?.paidOpens) + (normalizedOpenType === "paid" ? 1 : 0),
      freeOpens:
        safeCounter(nextProfile.dailyElementChest?.freeOpens) + (normalizedOpenType === "free" ? 1 : 0),
      pity: nextPity
    }
  });

  return {
    source: DAILY_ELEMENT_CHEST_SOURCE,
    openType: normalizedOpenType,
    rarity: rolledRarity,
    cosmetic,
    duplicateConversion,
    pityApplied,
    dailyElementChest: nextProfile.dailyElementChest,
    profile: nextProfile
  };
}
