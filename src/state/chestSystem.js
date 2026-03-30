import { COSMETIC_CATALOG, normalizeProfileCosmetics } from "./cosmeticSystem.js";
import { deriveLevelFromXp } from "./levelRewardsSystem.js";
import { normalizeProfileStore } from "./storeSystem.js";

export const DEFAULT_CHEST_TYPE = "basic";
export const MILESTONE_CHEST_TYPE = "milestone";
export const EPIC_CHEST_TYPE = "epic";
export const LEGENDARY_CHEST_TYPE = "legendary";
export const BASIC_CHEST_XP_REWARD = 5;
export const BASIC_CHEST_TOKEN_REWARD = 10;
export const BASIC_CHEST_XP_CHANCE = 0.5;
export const BASIC_CHEST_TOKEN_CHANCE = 0.45;
export const MILESTONE_CHEST_MIN_TOKENS = 2;
export const MILESTONE_CHEST_MAX_TOKENS = 100;
export const MILESTONE_CHEST_LEVEL_INTERVAL = 5;
export const LEGENDARY_CHEST_LEVEL_INTERVAL = 25;

const CHEST_LABELS = Object.freeze({
  [DEFAULT_CHEST_TYPE]: "Basic Chest",
  [MILESTONE_CHEST_TYPE]: "Milestone Chest",
  [EPIC_CHEST_TYPE]: "Epic Chest",
  [LEGENDARY_CHEST_TYPE]: "Legendary Chest"
});

const EPIC_GUARANTEED_TOKENS = Object.freeze({ min: 40, max: 100 });
const EPIC_GUARANTEED_XP = Object.freeze({ min: 20, max: 50 });
const EPIC_BONUS_TOKENS = Object.freeze({ min: 20, max: 60 });
const LEGENDARY_GUARANTEED_TOKENS = Object.freeze({ min: 100, max: 250 });
const LEGENDARY_GUARANTEED_XP = Object.freeze({ min: 50, max: 120 });
const LEGENDARY_BONUS_TOKENS = Object.freeze({ min: 75, max: 150 });

const EPIC_COSMETIC_CHANCE = 0.25;
const LEGENDARY_COSMETIC_CHANCE = 0.6;

const EPIC_RARITY_ROLLS = Object.freeze([
  { rarity: "Common", threshold: 0.7 },
  { rarity: "Rare", threshold: 1 }
]);

const LEGENDARY_RARITY_ROLLS = Object.freeze([
  { rarity: "Common", threshold: 0.6 },
  { rarity: "Rare", threshold: 0.9 },
  { rarity: "Epic", threshold: 1 }
]);

export function createDefaultChestState() {
  return {
    chests: {
      [DEFAULT_CHEST_TYPE]: 0,
      [MILESTONE_CHEST_TYPE]: 0,
      [EPIC_CHEST_TYPE]: 0,
      [LEGENDARY_CHEST_TYPE]: 0
    },
    milestoneChestGrantedLevels: {},
    legendaryChestGrantedLevels: {},
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

function buildChestCosmeticPool(profile, { rarities = ["Common"] } = {}) {
  const normalized = normalizeProfileCosmetics(profile);
  const pool = [];
  const allowedRarities = new Set(
    Array.isArray(rarities)
      ? rarities.map((rarity) => String(rarity ?? "").trim()).filter(Boolean)
      : ["Common"]
  );

  for (const [type, items] of Object.entries(COSMETIC_CATALOG)) {
    const owned = new Set(normalized.ownedCosmetics?.[type] ?? []);

    for (const item of items) {
      if (
        !item?.purchasable ||
        item.defaultOwned ||
        item.supporterOnly ||
        !allowedRarities.has(String(item.rarity ?? "").trim()) ||
        owned.has(item.id)
      ) {
        continue;
      }

      pool.push({
        type,
        id: item.id,
        name: item.name,
        rarity: item.rarity
      });
    }
  }

  return pool;
}

function addTokens(profile, amount) {
  const nextAmount = Math.max(0, Number(amount ?? 0) || 0);
  return {
    ...profile,
    tokens: Math.max(0, Number(profile.tokens ?? 0)) + nextAmount
  };
}

function addXp(profile, amount) {
  const nextAmount = Math.max(0, Number(amount ?? 0) || 0);
  return {
    ...profile,
    playerXP: Math.max(0, Number(profile.playerXP ?? 0)) + nextAmount
  };
}

function addOwnedCosmetic(profile, cosmetic) {
  if (!cosmetic?.type || !cosmetic?.id) {
    return profile;
  }

  return normalizeProfileStore({
    ...profile,
    ownedCosmetics: {
      ...profile.ownedCosmetics,
      [cosmetic.type]: [...(profile.ownedCosmetics?.[cosmetic.type] ?? []), cosmetic.id]
    }
  });
}

function chooseChestCosmetic(profile, { rarities, random }) {
  const pool = buildChestCosmeticPool(profile, { rarities });
  if (pool.length <= 0) {
    return null;
  }

  return pool[drawRandomInt(0, pool.length - 1, random)] ?? null;
}

function chooseWeightedRarity(roll, weightedRarities) {
  const safeRoll = Math.max(0, Math.min(1, Number(roll ?? 0) || 0));
  for (const entry of weightedRarities) {
    if (safeRoll < entry.threshold) {
      return entry.rarity;
    }
  }

  return weightedRarities.at(-1)?.rarity ?? "Common";
}

function openBasicChest(profile, random) {
  let nextProfile = profile;
  let xpReward = 0;
  let tokenReward = 0;
  let cosmetic = null;

  const roll = random();

  if (roll < BASIC_CHEST_XP_CHANCE) {
    xpReward = BASIC_CHEST_XP_REWARD;
    nextProfile = addXp(nextProfile, xpReward);
  } else if (roll < BASIC_CHEST_XP_CHANCE + BASIC_CHEST_TOKEN_CHANCE) {
    tokenReward = BASIC_CHEST_TOKEN_REWARD;
    nextProfile = addTokens(nextProfile, tokenReward);
  } else {
    const selected = chooseChestCosmetic(nextProfile, {
      rarities: ["Common"],
      random
    });
    if (selected) {
      nextProfile = addOwnedCosmetic(nextProfile, selected);
      cosmetic = selected;
    } else {
      tokenReward = BASIC_CHEST_TOKEN_REWARD;
      nextProfile = addTokens(nextProfile, tokenReward);
    }
  }

  return {
    profile: nextProfile,
    rewards: {
      xp: xpReward,
      tokens: tokenReward,
      cosmetic
    }
  };
}

function openMilestoneChest(profile, random) {
  const tokenReward = drawRandomInt(MILESTONE_CHEST_MIN_TOKENS, MILESTONE_CHEST_MAX_TOKENS, random);
  return {
    profile: addTokens(profile, tokenReward),
    rewards: {
      xp: 0,
      tokens: tokenReward,
      cosmetic: null
    }
  };
}

function openTieredCosmeticChest(
  profile,
  {
    random,
    guaranteedTokens,
    guaranteedXp,
    cosmeticChance,
    weightedRarities,
    fallbackTokenRange
  }
) {
  let nextProfile = profile;
  const guaranteedTokenReward = drawRandomInt(guaranteedTokens.min, guaranteedTokens.max, random);
  const guaranteedXpReward = drawRandomInt(guaranteedXp.min, guaranteedXp.max, random);
  let bonusTokenReward = 0;
  let cosmetic = null;

  nextProfile = addTokens(nextProfile, guaranteedTokenReward);
  nextProfile = addXp(nextProfile, guaranteedXpReward);

  const cosmeticRoll = random();
  if (cosmeticRoll < cosmeticChance) {
    const rarityRoll = random();
    const rarity = chooseWeightedRarity(rarityRoll, weightedRarities);
    const selected = chooseChestCosmetic(nextProfile, {
      rarities: [rarity],
      random
    });

    if (selected) {
      nextProfile = addOwnedCosmetic(nextProfile, selected);
      cosmetic = selected;
    } else {
      bonusTokenReward = drawRandomInt(fallbackTokenRange.min, fallbackTokenRange.max, random);
      nextProfile = addTokens(nextProfile, bonusTokenReward);
    }
  } else {
    bonusTokenReward = drawRandomInt(fallbackTokenRange.min, fallbackTokenRange.max, random);
    nextProfile = addTokens(nextProfile, bonusTokenReward);
  }

  return {
    profile: nextProfile,
    rewards: {
      xp: guaranteedXpReward,
      tokens: guaranteedTokenReward + bonusTokenReward,
      cosmetic
    }
  };
}

export function getChestLabel(chestType) {
  return CHEST_LABELS[normalizeChestType(chestType)] ?? "Reward Chest";
}

export function normalizeProfileChests(profile) {
  const source = profile ?? {};
  const defaults = createDefaultChestState();
  const milestoneGrantedLevels = normalizeGrantedLevels(source.milestoneChestGrantedLevels);
  const legendaryChestGrantedLevels = normalizeGrantedLevels(source.legendaryChestGrantedLevels);
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
    milestoneChestGrantedLevels: milestoneGrantedLevels,
    legendaryChestGrantedLevels,
    pendingMilestoneChestRewardLevel: normalizePendingMilestoneLevel(
      source.pendingMilestoneChestRewardLevel,
      milestoneGrantedLevels
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
  const legendaryChestGrantedLevels = {
    ...normalized.legendaryChestGrantedLevels
  };
  const newlyGrantedLevels = [];
  const newlyGrantedLegendaryLevels = [];

  for (let level = MILESTONE_CHEST_LEVEL_INTERVAL; level <= playerLevel; level += MILESTONE_CHEST_LEVEL_INTERVAL) {
    if (grantedLevels[String(level)]) {
      continue;
    }

    grantedLevels[String(level)] = true;
    newlyGrantedLevels.push(level);
  }

  for (
    let level = LEGENDARY_CHEST_LEVEL_INTERVAL;
    level <= playerLevel;
    level += LEGENDARY_CHEST_LEVEL_INTERVAL
  ) {
    if (legendaryChestGrantedLevels[String(level)]) {
      continue;
    }

    legendaryChestGrantedLevels[String(level)] = true;
    newlyGrantedLegendaryLevels.push(level);
  }

  if (newlyGrantedLevels.length === 0 && newlyGrantedLegendaryLevels.length === 0) {
    return normalized;
  }

  return normalizeProfileChests({
    ...normalized,
    chests: {
      ...normalized.chests,
      [MILESTONE_CHEST_TYPE]:
        safeChestCount(normalized.chests?.[MILESTONE_CHEST_TYPE]) + newlyGrantedLevels.length,
      [LEGENDARY_CHEST_TYPE]:
        safeChestCount(normalized.chests?.[LEGENDARY_CHEST_TYPE]) + newlyGrantedLegendaryLevels.length
    },
    milestoneChestGrantedLevels: grantedLevels,
    legendaryChestGrantedLevels,
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

export function applyWinStreakChestGrants(
  profile,
  { previousWinStreak = 0, nextWinStreak = 0 } = {}
) {
  const normalized = normalizeProfileChests(profile);
  const prior = Math.max(0, Math.floor(Number(previousWinStreak) || 0));
  const next = Math.max(0, Math.floor(Number(nextWinStreak) || 0));
  let nextProfile = normalized;
  const granted = [];

  if (next === 3 && prior < 3) {
    nextProfile = grantChest(nextProfile, { chestType: EPIC_CHEST_TYPE, amount: 1 });
    granted.push({ chestType: EPIC_CHEST_TYPE, amount: 1 });
  }

  if (next === 6 && prior < 6) {
    nextProfile = grantChest(nextProfile, { chestType: LEGENDARY_CHEST_TYPE, amount: 1 });
    granted.push({ chestType: LEGENDARY_CHEST_TYPE, amount: 1 });
  }

  return {
    profile: nextProfile,
    granted
  };
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
  const consumedProfile = normalizeProfileChests({
    ...normalized,
    chests: {
      ...normalized.chests,
      [nextChestType]: available - 1
    }
  });

  let openResult = null;
  if (nextChestType === MILESTONE_CHEST_TYPE) {
    openResult = openMilestoneChest(consumedProfile, random);
  } else if (nextChestType === EPIC_CHEST_TYPE) {
    openResult = openTieredCosmeticChest(consumedProfile, {
      random,
      guaranteedTokens: EPIC_GUARANTEED_TOKENS,
      guaranteedXp: EPIC_GUARANTEED_XP,
      cosmeticChance: EPIC_COSMETIC_CHANCE,
      weightedRarities: EPIC_RARITY_ROLLS,
      fallbackTokenRange: EPIC_BONUS_TOKENS
    });
  } else if (nextChestType === LEGENDARY_CHEST_TYPE) {
    openResult = openTieredCosmeticChest(consumedProfile, {
      random,
      guaranteedTokens: LEGENDARY_GUARANTEED_TOKENS,
      guaranteedXp: LEGENDARY_GUARANTEED_XP,
      cosmeticChance: LEGENDARY_COSMETIC_CHANCE,
      weightedRarities: LEGENDARY_RARITY_ROLLS,
      fallbackTokenRange: LEGENDARY_BONUS_TOKENS
    });
  } else {
    openResult = openBasicChest(consumedProfile, random);
  }

  const nextProfile = normalizeProfileChests(openResult.profile);

  return {
    profile: nextProfile,
    chestType: nextChestType,
    consumed: 1,
    remaining: safeChestCount(nextProfile.chests?.[nextChestType]),
    rewards: openResult.rewards
  };
}
