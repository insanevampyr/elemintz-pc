import { COSMETIC_CATALOG, normalizeProfileCosmetics } from "./cosmeticSystem.js";
import { normalizeProfileStore } from "./storeSystem.js";

export const DEFAULT_CHEST_TYPE = "basic";
export const BASIC_CHEST_XP_REWARD = 5;
export const BASIC_CHEST_TOKEN_REWARD = 10;
export const BASIC_CHEST_XP_CHANCE = 0.5;
export const BASIC_CHEST_TOKEN_CHANCE = 0.45;

export function createDefaultChestState() {
  return {
    chests: {
      [DEFAULT_CHEST_TYPE]: 0
    }
  };
}

function safeChestCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.floor(numeric));
}

function normalizeChestType(chestType) {
  const normalized = String(chestType ?? DEFAULT_CHEST_TYPE).trim();
  return normalized.length > 0 ? normalized : DEFAULT_CHEST_TYPE;
}

function drawRandomInt(min, max, random) {
  const safeMin = Math.floor(min);
  const safeMax = Math.floor(max);
  return safeMin + Math.floor(random() * (safeMax - safeMin + 1));
}

function buildChestCosmeticPool(profile) {
  const normalized = normalizeProfileCosmetics(profile);
  const pool = [];

  for (const [type, items] of Object.entries(COSMETIC_CATALOG)) {
    const owned = new Set(normalized.ownedCosmetics?.[type] ?? []);

    for (const item of items) {
      if (
        !item?.purchasable ||
        item.defaultOwned ||
        item.supporterOnly ||
        item.rarity !== "Common" ||
        owned.has(item.id)
      ) {
        continue;
      }

      pool.push({
        type,
        id: item.id,
        name: item.name
      });
    }
  }

  return pool;
}

export function normalizeProfileChests(profile) {
  const source = profile ?? {};
  const defaults = createDefaultChestState();
  const rawChests =
    source.chests && typeof source.chests === "object" && !Array.isArray(source.chests)
      ? source.chests
      : defaults.chests;

  return {
    ...source,
    chests: {
      ...defaults.chests,
      ...Object.fromEntries(
        Object.entries(rawChests).map(([type, count]) => [String(type), safeChestCount(count)])
      )
    }
  };
}

export function grantChest(profile, { chestType = DEFAULT_CHEST_TYPE, amount = 1 } = {}) {
  const normalized = normalizeProfileChests(profile);
  const nextChestType = normalizeChestType(chestType);
  const nextAmount = safeChestCount(amount);

  return normalizeProfileChests({
    ...normalized,
    chests: {
      ...normalized.chests,
      [nextChestType]: safeChestCount(normalized.chests?.[nextChestType]) + nextAmount
    }
  });
}

export function openChest(
  profile,
  { chestType = DEFAULT_CHEST_TYPE, random = Math.random } = {}
) {
  const normalized = normalizeProfileChests(normalizeProfileStore(profile));
  const nextChestType = normalizeChestType(chestType);
  const available = safeChestCount(normalized.chests?.[nextChestType]);

  if (available < 1) {
    throw new Error(`No '${nextChestType}' chests available.`);
  }

  const roll = random();
  let xpReward = 0;
  let tokenReward = 0;

  if (roll < BASIC_CHEST_XP_CHANCE) {
    xpReward = BASIC_CHEST_XP_REWARD;
  } else if (roll < BASIC_CHEST_XP_CHANCE + BASIC_CHEST_TOKEN_CHANCE) {
    tokenReward = BASIC_CHEST_TOKEN_REWARD;
  }

  let nextProfile = normalizeProfileChests({
    ...normalized,
    playerXP: Math.max(0, Number(normalized.playerXP ?? 0)) + xpReward,
    tokens: Math.max(0, Number(normalized.tokens ?? 0)) + tokenReward,
    chests: {
      ...normalized.chests,
      [nextChestType]: available - 1
    }
  });

  let cosmetic = null;
  const cosmeticPool = buildChestCosmeticPool(nextProfile);

  if (xpReward === 0 && tokenReward === 0) {
    if (cosmeticPool.length > 0) {
    const selected = cosmeticPool[drawRandomInt(0, cosmeticPool.length - 1, random)];
    nextProfile = normalizeProfileChests(
      normalizeProfileStore({
        ...nextProfile,
        ownedCosmetics: {
          ...nextProfile.ownedCosmetics,
          [selected.type]: [...(nextProfile.ownedCosmetics?.[selected.type] ?? []), selected.id]
        }
      })
    );

    cosmetic = selected;
    } else {
      tokenReward = BASIC_CHEST_TOKEN_REWARD;
      nextProfile = normalizeProfileChests({
        ...nextProfile,
        tokens: Math.max(0, Number(nextProfile.tokens ?? 0)) + tokenReward
      });
    }
  }

  return {
    profile: nextProfile,
    chestType: nextChestType,
    consumed: 1,
    remaining: safeChestCount(nextProfile.chests?.[nextChestType]),
    rewards: {
      xp: xpReward,
      tokens: tokenReward,
      cosmetic
    }
  };
}
