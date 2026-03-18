import { normalizeProfileCosmetics } from "./cosmeticSystem.js";
import { normalizeProfileStore } from "./storeSystem.js";

export const MAX_LEVEL = 100;

export const LEVEL_REWARD_DEFINITIONS = Object.freeze([
  { id: "lvl2_tokens", level: 2, rewardType: "tokens", amount: 50, name: "+50 Tokens" },
  { id: "lvl3_title_apprentice", level: 3, rewardType: "cosmetic", cosmeticType: "title", cosmeticId: "title_apprentice", name: "Title: Apprentice" },
  { id: "lvl5_avatar_novice_mage", level: 5, rewardType: "cosmetic", cosmeticType: "avatar", cosmeticId: "avatar_novice_mage", name: "Avatar: Novice Mage" },
  { id: "lvl7_tokens", level: 7, rewardType: "tokens", amount: 100, name: "+100 Tokens" },
  { id: "lvl10_badge_element_initiate", level: 10, rewardType: "cosmetic", cosmeticType: "badge", cosmeticId: "badge_element_initiate", name: "Badge: Element Initiate" },

  { id: "lvl12_tokens", level: 12, rewardType: "tokens", amount: 150, name: "+150 Tokens" },
  { id: "lvl15_fire_variant_ember", level: 15, rewardType: "cosmetic", cosmeticType: "elementCardVariant", cosmeticId: "fire_variant_ember", name: "Fire Card Variant: Ember Fire" },
  { id: "lvl18_background_ancient_arena", level: 18, rewardType: "cosmetic", cosmeticType: "background", cosmeticId: "background_ancient_arena", name: "Background: Ancient Arena" },
  { id: "lvl20_title_elementalist", level: 20, rewardType: "cosmetic", cosmeticType: "title", cosmeticId: "title_elementalist", name: "Title: Elementalist" },
  { id: "lvl25_avatar_battle_adept", level: 25, rewardType: "cosmetic", cosmeticType: "avatar", cosmeticId: "avatar_battle_adept", name: "Avatar: Battle Adept" },
  { id: "lvl30_badge_arena_challenger", level: 30, rewardType: "cosmetic", cosmeticType: "badge", cosmeticId: "badge_arena_challenger", name: "Badge: Arena Challenger" },

  { id: "lvl35_tokens", level: 35, rewardType: "tokens", amount: 250, name: "+250 Tokens" },
  { id: "lvl40_water_variant_crystal", level: 40, rewardType: "cosmetic", cosmeticType: "elementCardVariant", cosmeticId: "water_variant_crystal", name: "Water Card Variant: Crystal Water" },
  { id: "lvl45_background_storm_citadel", level: 45, rewardType: "cosmetic", cosmeticType: "background", cosmeticId: "background_storm_citadel", name: "Background: Storm Citadel" },
  { id: "lvl50_title_war_master", level: 50, rewardType: "cosmetic", cosmeticType: "title", cosmeticId: "title_war_master", name: "Title: War Master" },
  { id: "lvl55_avatar_veteran_champion", level: 55, rewardType: "cosmetic", cosmeticType: "avatar", cosmeticId: "avatar_veteran_champion", name: "Avatar: Veteran Champion" },
  { id: "lvl60_badge_element_veteran", level: 60, rewardType: "cosmetic", cosmeticType: "badge", cosmeticId: "badge_element_veteran", name: "Badge: Element Veteran" },

  { id: "lvl65_tokens", level: 65, rewardType: "tokens", amount: 400, name: "+400 Tokens" },
  { id: "lvl70_earth_variant_titan", level: 70, rewardType: "cosmetic", cosmeticType: "elementCardVariant", cosmeticId: "earth_variant_titan", name: "Earth Card Variant: Titan Earth" },
  { id: "lvl75_background_sky_temple", level: 75, rewardType: "cosmetic", cosmeticType: "background", cosmeticId: "background_sky_temple", name: "Background: Sky Temple" },
  { id: "lvl80_title_element_sovereign", level: 80, rewardType: "cosmetic", cosmeticType: "title", cosmeticId: "title_element_sovereign", name: "Title: Element Sovereign" },

  { id: "lvl85_tokens", level: 85, rewardType: "tokens", amount: 600, name: "+600 Tokens" },
  { id: "lvl90_avatar_grand_archmage", level: 90, rewardType: "cosmetic", cosmeticType: "avatar", cosmeticId: "avatar_grand_archmage", name: "Avatar: Grand Archmage" },
  { id: "lvl95_badge_arena_legend", level: 95, rewardType: "cosmetic", cosmeticType: "badge", cosmeticId: "badge_arena_legend", name: "Badge: Arena Legend" },
  { id: "lvl100_title_master_elemintz", level: 100, rewardType: "cosmetic", cosmeticType: "title", cosmeticId: "title_master_elemintz", name: "Title: Master of EleMintz" }
]);

export const LEVEL_COSMETIC_UNLOCKS = Object.freeze(
  LEVEL_REWARD_DEFINITIONS
    .filter((reward) => reward.rewardType === "cosmetic")
    .map((reward) => ({
      level: reward.level,
      type: reward.cosmeticType,
      id: reward.cosmeticId
    }))
);

const XP_THRESHOLDS = buildXpThresholds();

function buildXpThresholds() {
  const thresholds = [0];
  if (MAX_LEVEL >= 2) {
    thresholds[1] = 25;
  }
  if (MAX_LEVEL >= 3) {
    thresholds[2] = 60;
  }
  if (MAX_LEVEL >= 4) {
    thresholds[3] = 110;
  }

  for (let level = 5; level <= MAX_LEVEL; level += 1) {
    const prior = thresholds[level - 2];
    const step = Math.round(50 + (level - 4) * 3.75 + Math.pow(level - 4, 1.08));
    thresholds[level - 1] = prior + step;
  }

  return thresholds;
}

function normalizeClaims(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next = {};
  for (const [key, claimed] of Object.entries(value)) {
    if (claimed) {
      next[key] = true;
    }
  }

  return next;
}

function claimReward(claims, rewardId) {
  return {
    ...claims,
    [rewardId]: true
  };
}

export function normalizeProfileLevelRewards(profile) {
  return {
    ...profile,
    levelRewardsClaimed: normalizeClaims(profile.levelRewardsClaimed)
  };
}

export function getXpForLevel(level) {
  const safe = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
  return XP_THRESHOLDS[safe - 1];
}

export function deriveLevelFromXp(totalXp) {
  const safeXp = Math.max(0, Number(totalXp) || 0);

  for (let level = MAX_LEVEL; level >= 1; level -= 1) {
    if (safeXp >= getXpForLevel(level)) {
      return level;
    }
  }

  return 1;
}

export function getNextLevelReward(level) {
  const safe = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
  return LEVEL_REWARD_DEFINITIONS.find((reward) => reward.level > safe) ?? null;
}

export function getLevelProgress(profile) {
  const normalized = normalizeProfileLevelRewards(profile);
  const playerXP = Math.max(0, Number(normalized?.playerXP ?? 0));
  const playerLevel = deriveLevelFromXp(playerXP);

  const currentLevelXp = getXpForLevel(playerLevel);
  const nextLevel = Math.min(MAX_LEVEL, playerLevel + 1);
  const nextLevelXp = getXpForLevel(nextLevel);
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const progressWithin = Math.max(0, Math.min(span, playerXP - currentLevelXp));
  const progressRatio = playerLevel >= MAX_LEVEL ? 1 : progressWithin / span;
  const nextReward = getNextLevelReward(playerLevel);

  return {
    playerXP,
    playerLevel,
    maxLevel: MAX_LEVEL,
    currentLevelXp,
    nextLevelXp,
    progressRatio,
    nextReward,
    levelCapReached: playerLevel >= MAX_LEVEL
  };
}

export function getXpThresholds() {
  return [...XP_THRESHOLDS];
}

export function buildXpBreakdown({ isCompleted, isQuit, didWin, warsWon }) {
  if (!isCompleted || isQuit) {
    return {
      lines: [],
      total: 0
    };
  }

  const lineItems = [
    {
      key: "match_completed",
      label: "Match Completed",
      amount: 1,
      applies: true
    },
    {
      key: "victory_bonus",
      label: "Victory Bonus",
      amount: 2,
      applies: Boolean(didWin)
    },
    {
      key: "war_victory",
      label: "WAR Victory",
      amount: Math.max(0, Number(warsWon) || 0),
      applies: Math.max(0, Number(warsWon) || 0) > 0
    }
  ];

  const lines = lineItems
    .filter((item) => item.applies)
    .map((item) => ({
      key: item.key,
      label: item.label,
      amount: item.amount
    }));

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.amount, 0)
  };
}

export function applyLevelRewardsForLevelChange(profile, { fromLevel, toLevel }) {
  let normalized = normalizeProfileStore(normalizeProfileCosmetics(normalizeProfileLevelRewards(profile)));
  const startLevel = Math.max(1, Math.min(MAX_LEVEL, Number(fromLevel) || 1));
  const endLevel = Math.max(1, Math.min(MAX_LEVEL, Number(toLevel) || 1));

  if (endLevel <= startLevel) {
    return {
      profile: normalized,
      grantedRewards: [],
      tokenDelta: 0
    };
  }

  let claims = normalizeClaims(normalized.levelRewardsClaimed);
  let tokenDelta = 0;
  let nextProfile = normalized;
  const grantedRewards = [];

  for (const reward of LEVEL_REWARD_DEFINITIONS) {
    if (reward.level <= startLevel || reward.level > endLevel) {
      continue;
    }

    if (claims[reward.id]) {
      continue;
    }

    claims = claimReward(claims, reward.id);

    if (reward.rewardType === "tokens") {
      tokenDelta += reward.amount;
      grantedRewards.push({
        ...reward
      });
      continue;
    }

    const type = reward.cosmeticType;
    const id = reward.cosmeticId;
    if (!nextProfile.ownedCosmetics[type].includes(id)) {
      nextProfile = {
        ...nextProfile,
        ownedCosmetics: {
          ...nextProfile.ownedCosmetics,
          [type]: [...nextProfile.ownedCosmetics[type], id]
        }
      };
    }

    grantedRewards.push({
      ...reward
    });
  }

  nextProfile = normalizeProfileStore(
    normalizeProfileCosmetics({
      ...nextProfile,
      tokens: Math.max(0, Number(nextProfile.tokens ?? 0) + tokenDelta),
      levelRewardsClaimed: claims
    })
  );

  return {
    profile: nextProfile,
    grantedRewards,
    tokenDelta
  };
}
