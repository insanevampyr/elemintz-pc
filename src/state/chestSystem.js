import { COSMETIC_CATALOG, normalizeProfileCosmetics } from "./cosmeticSystem.js";
import { deriveLevelFromXp } from "./levelRewardsSystem.js";
import { normalizeProfileStore } from "./storeSystem.js";

export const DEFAULT_CHEST_TYPE = "basic";
export const MILESTONE_CHEST_TYPE = "milestone";
export const BASIC_CHEST_XP_REWARD = 5;
export const BASIC_CHEST_TOKEN_REWARD = 10;
export const BASIC_CHEST_XP_CHANCE = 0.5;
export const BASIC_CHEST_TOKEN_CHANCE = 0.45;
export const MILESTONE_CHEST_MIN_TOKENS = 2;
export const MILESTONE_CHEST_MAX_TOKENS = 100;
export const MILESTONE_CHEST_LEVEL_INTERVAL = 5;

export function createDefaultChestState() {
  return {
    chests: {
      [DEFAULT_CHEST_TYPE]: 0,
      [MILESTONE_CHEST_TYPE]: 0
    },
    milestoneChestGrantedLevels: {},
    pendingMilestoneChestRewardLevel: null
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

function normalizeGrantedLevels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next = {};
  for (const [level, granted] of Object.entries(value)) {
    const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
    if (safeLevel > 0 && granted) {
      next[String(safeLevel)] = true;
    }
  }

  return next;
}

function normalizePendingMilestoneLevel(value, grantedLevels) {
  const safeLevel = Math.max(0, Math.floor(Number(value) || 0));
  if (safeLevel <= 0) {
    return null;
  }

  return grantedLevels[String(safeLevel)] ? safeLevel : null;
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
    },
    milestoneChestGrantedLevels: normalizeGrantedLevels(source.milestoneChestGrantedLevels),
    pendingMilestoneChestRewardLevel: normalizePendingMilestoneLevel(
      source.pendingMilestoneChestRewardLevel,
      normalizeGrantedLevels(source.milestoneChestGrantedLevels)
    )
  };
}

export function applyLevelMilestoneChestGrants(profile) {
  const normalized = normalizeProfileChests(profile);
  const playerLevel = Math.max(
    1,
    Math.floor(Number(normalized.playerLevel ?? deriveLevelFromXp(normalized.playerXP)) || 1)
  );
  const grantedLevels = {
    ...normalized.milestoneChestGrantedLevels
  };
  const newlyGrantedLevels = [];

  for (let level = MILESTONE_CHEST_LEVEL_INTERVAL; level <= playerLevel; level += MILESTONE_CHEST_LEVEL_INTERVAL) {
    if (grantedLevels[String(level)]) {
      continue;
    }

    grantedLevels[String(level)] = true;
    newlyGrantedLevels.push(level);
  }

  if (newlyGrantedLevels.length === 0) {
    return normalized;
  }

  return normalizeProfileChests({
    ...normalized,
    chests: {
      ...normalized.chests,
      [MILESTONE_CHEST_TYPE]:
        safeChestCount(normalized.chests?.[MILESTONE_CHEST_TYPE]) + newlyGrantedLevels.length
    },
    milestoneChestGrantedLevels: grantedLevels,
    pendingMilestoneChestRewardLevel: newlyGrantedLevels.at(-1) ?? normalized.pendingMilestoneChestRewardLevel
  });
}

export function acknowledgeMilestoneChestReward(profile, level = null) {
  const normalized = normalizeProfileChests(profile);
  const pendingLevel = Number(normalized.pendingMilestoneChestRewardLevel ?? 0) || 0;
  const requestedLevel = level == null ? pendingLevel : Math.max(0, Math.floor(Number(level) || 0));

  if (pendingLevel <= 0 || requestedLevel !== pendingLevel) {
    return normalized;
  }

  return normalizeProfileChests({
    ...normalized,
    pendingMilestoneChestRewardLevel: null
  });
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

  let xpReward = 0;
  let tokenReward = 0;
  let cosmetic = null;

  if (nextChestType === MILESTONE_CHEST_TYPE) {
    tokenReward = drawRandomInt(MILESTONE_CHEST_MIN_TOKENS, MILESTONE_CHEST_MAX_TOKENS, random);
  } else {
    const roll = random();

    if (roll < BASIC_CHEST_XP_CHANCE) {
      xpReward = BASIC_CHEST_XP_REWARD;
    } else if (roll < BASIC_CHEST_XP_CHANCE + BASIC_CHEST_TOKEN_CHANCE) {
      tokenReward = BASIC_CHEST_TOKEN_REWARD;
    }
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

  const cosmeticPool = buildChestCosmeticPool(nextProfile);

  if (nextChestType === DEFAULT_CHEST_TYPE && xpReward === 0 && tokenReward === 0) {
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
