import { ProfileSystem, normalizeRecentOpponents } from "./profileSystem.js";
import { AdminGrantStore } from "./adminGrantStore.js";
import {
  MAX_UNIQUE_ROYALTY_TOKEN_PERCENT,
  SpecialCosmeticRegistryStore
} from "./specialCosmeticRegistryStore.js";
import {
  normalizeStorePurchaseTransactionId,
  StorePurchaseLedgerStore
} from "./storePurchaseLedgerStore.js";
import {
  calculateCollectionPackPriceForOwnedCosmetics,
  CollectionPackStore,
  listEligibleCollectionPackCosmetics
} from "./collectionPackStore.js";
import { claimCollectionAlbumReward } from "./collectionAlbums.js";
import { SaveSystem } from "./saveSystem.js";
import { SettingsService } from "./settingsService.js";
import {
  applyAchievementTokenRewards,
  applyAchievementUnlocks,
  buildAchievementCatalog,
  buildAchievementView,
  evaluateAchievements,
  evaluateBloodMatchAchievements
} from "./achievementSystem.js";
import {
  acknowledgeUnlockedLoadoutSlots,
  applyAchievementCosmeticRewards,
  applyCosmeticLoadout,
  buildAuthoritativeCosmeticSnapshot,
  buildUniqueCosmeticAcquisitionKey,
  COSMETIC_CATALOG,
  getCosmeticCatalogForProfile,
  getCosmeticDefinition,
  getCosmeticLoadoutsForProfile,
  normalizeCosmeticRandomizationPreferences,
  preserveUniqueCosmeticAcquisition,
  renameCosmeticLoadout,
  RANDOMIZABLE_COSMETIC_TYPES,
  saveCosmeticLoadout,
  updateProfileShowcaseSlot
} from "./cosmeticSystem.js";
import { createDefaultBloodMatchStats, deriveMatchStats } from "./statsTracking.js";
import {
  buyCollectionPackItems,
  buyConfiguredUniqueStoreItem,
  buyStoreItem,
  getStoreViewForProfile,
  grantCosmeticItem,
  grantFounderStatus,
  grantSupporterPass,
  mergePublicSpecialCosmeticMetadata
} from "./storeSystem.js";
import {
  acknowledgeMilestoneChestReward,
  applyWinStreakChestGrants,
  DEFAULT_CHEST_TYPE,
  EPIC_CHEST_TYPE,
  grantChest,
  getChestLabel,
  LEGENDARY_CHEST_TYPE,
  MILESTONE_CHEST_TYPE,
  openChest
} from "./chestSystem.js";
import {
  applyDailyChallengesForMatch,
  getDailyChallengesView,
  getDailyResetWindow
} from "./dailyChallengesSystem.js";
import {
  getDailyElementChestStatus,
  openDailyElementChest
} from "./dailyElementChestSystem.js";
import {
  applyLevelRewardsForLevelChange,
  applyXpWithMaxLevelFallback,
  buildXpBreakdown,
  deriveLevelFromXp,
  getLevelProgress
} from "./levelRewardsSystem.js";
import { rollBasicChest } from "../shared/basicChestDrop.js";
import { getGauntletRivalById } from "../engine/gauntletRivals.js";

const DAILY_LOGIN_STREAK_REWARDS = Object.freeze([
  Object.freeze({ day: 1, xp: 2, tokens: 4 }),
  Object.freeze({ day: 2, xp: 4, tokens: 0 }),
  Object.freeze({ day: 3, xp: 0, tokens: 10 }),
  Object.freeze({ day: 4, xp: 8, tokens: 0 }),
  Object.freeze({ day: 5, xp: 0, tokens: 20 }),
  Object.freeze({ day: 6, xp: 16, tokens: 0 }),
  Object.freeze({
    day: 7,
    xp: 20,
    tokens: 50,
    chestRolls: Object.freeze([
      Object.freeze({ chestType: LEGENDARY_CHEST_TYPE, chance: 0.03 }),
      Object.freeze({ chestType: EPIC_CHEST_TYPE, chance: 0.1 })
    ])
  })
]);
const DAILY_LOGIN_STREAK_MAX_DAY = DAILY_LOGIN_STREAK_REWARDS.length;
const FEATURED_RIVAL_DAILY_WIN_REWARD_CONFIGS = {
  crownfire_duelist: {
    xpDelta: 10,
    tokenDelta: 10,
    label: "Crownfire First Win Bonus"
  }
};
const FEATURED_RIVAL_PUBLIC_NAMES = Object.freeze({
  crownfire_duelist: "Crownfire Duelist"
});
const VALID_RUNTIME_MODES = new Set(["pve", "local_pvp", "online_pvp"]);
const BLOOD_MATCH_WIN_XP = 10;
const BLOOD_MATCH_WIN_TOKENS = 10;
const BLOOD_MATCH_LOSS_TOKENS = 1;
const BLOOD_MATCH_RIVAL_NAME = "Countess Veyra & Ravena Moonfang";
const VALID_ADMIN_CHEST_TYPES = new Set(["basic", "milestone", "epic", "legendary"]);
const GAUNTLET_MILESTONE_REWARDS = Object.freeze([
  Object.freeze({ streak: 3, chests: Object.freeze([{ chestType: DEFAULT_CHEST_TYPE, amount: 1 }]) }),
  Object.freeze({ streak: 5, tokens: 25 }),
  Object.freeze({ streak: 10, chests: Object.freeze([{ chestType: MILESTONE_CHEST_TYPE, amount: 1 }]) }),
  Object.freeze({ streak: 15, xp: 100, tokens: 75 }),
  Object.freeze({ streak: 20, chests: Object.freeze([{ chestType: EPIC_CHEST_TYPE, amount: 1 }]) })
]);
const GAUNTLET_MILESTONE_CYCLE_LENGTH = 20;
const LOCAL_PVP_DAILY_REWARD_CAP = 3;

function profilesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getDailyLoginDateKey(nowMs = Date.now()) {
  const { lastResetMs } = getDailyResetWindow(nowMs);
  return new Date(lastResetMs).toISOString();
}

function getPreviousDailyLoginDateKey(nowMs = Date.now()) {
  const { lastResetMs } = getDailyResetWindow(nowMs);
  return getDailyLoginDateKey(lastResetMs - 1);
}

function getSafeDailyLoginStreakDay(profile) {
  const safeDay = Math.max(0, Math.floor(Number(profile?.dailyLoginStreakDay ?? 0) || 0));
  return Math.min(DAILY_LOGIN_STREAK_MAX_DAY, safeDay);
}

function getDailyLoginRewardForDay(day) {
  return DAILY_LOGIN_STREAK_REWARDS.find((entry) => entry.day === day) ?? DAILY_LOGIN_STREAK_REWARDS[0];
}

function getLocalPvpRewardWindowKey(nowMs = Date.now()) {
  const { lastResetMs } = getDailyResetWindow(nowMs);
  return new Date(lastResetMs).toISOString();
}

function getLocalPvpRewardTracking(profile, nowMs = Date.now()) {
  const rewardWindowKey = getLocalPvpRewardWindowKey(nowMs);
  const existing =
    profile?.localPvpRewardTracking &&
    typeof profile.localPvpRewardTracking === "object" &&
    !Array.isArray(profile.localPvpRewardTracking)
      ? profile.localPvpRewardTracking
      : {};
  const rewardedMatches =
    existing.rewardWindowKey === rewardWindowKey
      ? Math.max(0, Math.floor(Number(existing.rewardedMatches ?? 0) || 0))
      : 0;

  return {
    rewardWindowKey,
    rewardedMatches,
    rewardEligible: rewardedMatches < LOCAL_PVP_DAILY_REWARD_CAP,
    rewardCap: LOCAL_PVP_DAILY_REWARD_CAP
  };
}

function buildNextLocalPvpRewardTracking(profile, { rewardedMatchApplied = false, nowMs = Date.now() } = {}) {
  const tracking = getLocalPvpRewardTracking(profile, nowMs);
  return {
    rewardWindowKey: tracking.rewardWindowKey,
    rewardedMatches: rewardedMatchApplied
      ? Math.min(tracking.rewardCap, tracking.rewardedMatches + 1)
      : tracking.rewardedMatches
  };
}

function getDailyLoginStatus(profile, nowMs = Date.now()) {
  const resetWindow = getDailyResetWindow(nowMs);
  const loginDayKey = new Date(resetWindow.lastResetMs).toISOString();
  const lastClaim = String(profile?.lastDailyLoginClaimDate ?? "");
  const eligible = lastClaim !== loginDayKey;

  return {
    nowMs,
    loginDayKey,
    lastDailyLoginClaimDate: lastClaim || null,
    streakDay: getSafeDailyLoginStreakDay(profile),
    eligible,
    nextResetAt: new Date(resetWindow.nextResetMs).toISOString(),
    msUntilReset: Math.max(0, resetWindow.nextResetMs - nowMs)
  };
}

function getFeaturedRivalDailyRewardDateKey(nowMs = Date.now()) {
  const { lastResetMs } = getDailyResetWindow(nowMs);
  return new Date(lastResetMs).toISOString();
}

function maybeApplyFeaturedRivalWinReward(profile, { matchState, perspective = "p1", nowMs = Date.now() } = {}) {
  const rivalId = String(matchState?.featuredRivalId ?? "").trim().toLowerCase();
  const rewardConfig = FEATURED_RIVAL_DAILY_WIN_REWARD_CONFIGS[rivalId] ?? null;
  const didWin = matchState?.winner === perspective;
  const isQuitForfeit = String(matchState?.endReason ?? "") === "quit_forfeit";

  if (!rewardConfig || !didWin || isQuitForfeit) {
    return {
      profile,
      reward: {
        rivalId: rewardConfig ? rivalId : null,
        granted: false,
        xpDelta: 0,
        tokenDelta: 0,
        label: rewardConfig?.label ?? null,
        rewardDateKey: rewardConfig ? getFeaturedRivalDailyRewardDateKey(nowMs) : null
      }
    };
  }

  const rewardDateKey = getFeaturedRivalDailyRewardDateKey(nowMs);
  const existingRewardState = profile?.featuredRivalRewards?.[rivalId] ?? {};
  const lastDailyWinRewardDate =
    typeof existingRewardState.lastDailyWinRewardDate === "string" &&
    existingRewardState.lastDailyWinRewardDate.trim()
      ? existingRewardState.lastDailyWinRewardDate
      : null;

  if (lastDailyWinRewardDate === rewardDateKey) {
    return {
      profile,
      reward: {
        rivalId,
        granted: false,
        xpDelta: 0,
        tokenDelta: 0,
        label: rewardConfig.label,
        rewardDateKey
      }
    };
  }

  const xpAwardResult = applyXpWithMaxLevelFallback({
    currentXp: profile?.playerXP ?? 0,
    xpToAward: rewardConfig.xpDelta
  });
  const nextProfile = {
    ...profile,
    tokens:
      Math.max(0, Number(profile?.tokens ?? 0) + rewardConfig.tokenDelta) +
      xpAwardResult.convertedTokens,
    playerXP: xpAwardResult.nextXp,
    playerLevel: xpAwardResult.levelAfter,
    featuredRivalRewards: {
      ...(profile?.featuredRivalRewards ?? {}),
      [rivalId]: {
        ...existingRewardState,
        lastDailyWinRewardDate: rewardDateKey
      }
    }
  };

  return {
    profile: nextProfile,
    reward: {
      rivalId,
      granted: true,
      xpDelta: xpAwardResult.appliedXp,
      tokenDelta: rewardConfig.tokenDelta,
      xpConversionTokenBonus: xpAwardResult.convertedTokens,
      overflowXp: xpAwardResult.overflowXp,
      label: rewardConfig.label,
      rewardDateKey
    }
  };
}

function profileCommitSnapshot(profile) {
  return {
    username: profile?.username,
    wins: profile?.wins ?? 0,
    losses: profile?.losses ?? 0,
    gamesPlayed: profile?.gamesPlayed ?? 0,
    warsEntered: profile?.warsEntered ?? 0,
    warsWon: profile?.warsWon ?? 0,
    cardsCaptured: profile?.cardsCaptured ?? 0,
    featuredRivalWins: profile?.featuredRivalWins ?? 0,
    gauntletBestStreak: profile?.gauntletBestStreak ?? 0,
    gauntletRuns: profile?.gauntletRuns ?? 0,
    gauntletWins: profile?.gauntletWins ?? 0,
    gauntletLosses: profile?.gauntletLosses ?? 0,
    gauntletRivalsDefeated: profile?.gauntletRivalsDefeated ?? 0,
    tokens: profile?.tokens ?? 0,
    playerXP: profile?.playerXP ?? 0,
    playerLevel: profile?.playerLevel ?? 1,
    achievements: Object.keys(profile?.achievements ?? {}).length
  };
}

function buildGauntletStatsSnapshot(profile) {
  return {
    gauntletBestStreak: Math.max(0, Number(profile?.gauntletBestStreak ?? 0)),
    gauntletRuns: Math.max(0, Number(profile?.gauntletRuns ?? 0)),
    gauntletWins: Math.max(0, Number(profile?.gauntletWins ?? 0)),
    gauntletLosses: Math.max(0, Number(profile?.gauntletLosses ?? 0)),
    gauntletRivalsDefeated: Math.max(0, Number(profile?.gauntletRivalsDefeated ?? 0))
  };
}

function appendBoundedTimestamp(list, timestamp, limit = 10) {
  const next = Array.isArray(list) ? [...list, timestamp] : [timestamp];
  return next.slice(-limit);
}

function normalizeGauntletClaimedMilestoneStreaks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((entry) => Math.max(0, Math.floor(Number(entry ?? 0) || 0)))
      .filter((entry) => entry > 0)
  )].sort((a, b) => a - b);
}

function applyXpAwardToProfile(profile, xpAmount, tokenAmount = 0) {
  const safeTokenAmount = Math.max(0, Number(tokenAmount ?? 0) || 0);
  const levelBefore = Math.max(
    1,
    Number(profile?.playerLevel ?? getLevelProgress(profile).playerLevel ?? 1)
  );
  const xpAwardResult = applyXpWithMaxLevelFallback({
    currentXp: profile?.playerXP ?? 0,
    xpToAward: xpAmount
  });

  let nextProfile = {
    ...profile,
    tokens: Math.max(0, Number(profile?.tokens ?? 0) + safeTokenAmount + xpAwardResult.convertedTokens),
    playerXP: xpAwardResult.nextXp,
    playerLevel: levelBefore
  };

  const levelAfterGain = Math.max(levelBefore, xpAwardResult.levelAfter);
  nextProfile = {
    ...nextProfile,
    playerLevel: levelAfterGain
  };

  const levelRewardResult = applyLevelRewardsForLevelChange(nextProfile, {
    fromLevel: levelBefore,
    toLevel: levelAfterGain
  });

  return {
    profile: levelRewardResult.profile,
    xpDelta: xpAwardResult.appliedXp,
    xpConversionTokenBonus: xpAwardResult.convertedTokens,
    overflowXp: xpAwardResult.overflowXp,
    tokenDelta: safeTokenAmount + xpAwardResult.convertedTokens,
    levelBefore,
    levelAfter: Math.max(levelAfterGain, Number(levelRewardResult.profile?.playerLevel ?? levelAfterGain)),
    levelRewards: levelRewardResult.grantedRewards,
    levelRewardTokenDelta: levelRewardResult.tokenDelta
  };
}

function applyGauntletMilestoneRewards(
  profile,
  { currentStreak = 0, claimedMilestoneStreaks = [] } = {}
) {
  const safeCurrentStreak = Math.max(0, Math.floor(Number(currentStreak ?? 0) || 0));
  const alreadyClaimed = new Set(normalizeGauntletClaimedMilestoneStreaks(claimedMilestoneStreaks));
  const eligibleMilestones = [];
  for (
    let cycleStart = 0;
    cycleStart < safeCurrentStreak;
    cycleStart += GAUNTLET_MILESTONE_CYCLE_LENGTH
  ) {
    for (const entry of GAUNTLET_MILESTONE_REWARDS) {
      const absoluteStreak = cycleStart + entry.streak;
      if (absoluteStreak > safeCurrentStreak) {
        continue;
      }
      eligibleMilestones.push({
        ...entry,
        streak: absoluteStreak
      });
    }
  }
  const milestonesToGrant = eligibleMilestones.filter((entry) => !alreadyClaimed.has(entry.streak));

  if (milestonesToGrant.length === 0) {
    return {
      profile,
      claimedMilestoneStreaks: normalizeGauntletClaimedMilestoneStreaks(claimedMilestoneStreaks),
      milestoneRewards: [],
      xpDelta: 0,
      tokenDelta: 0,
      xpConversionTokenBonus: 0,
      overflowXp: 0,
      chestGrants: [],
      levelBefore: Math.max(1, Number(profile?.playerLevel ?? getLevelProgress(profile).level ?? 1)),
      levelAfter: Math.max(1, Number(profile?.playerLevel ?? getLevelProgress(profile).level ?? 1)),
      levelRewards: [],
      levelRewardTokenDelta: 0
    };
  }

  const xpDelta = milestonesToGrant.reduce((sum, entry) => sum + Math.max(0, Number(entry.xp ?? 0)), 0);
  const tokenDelta = milestonesToGrant.reduce((sum, entry) => sum + Math.max(0, Number(entry.tokens ?? 0)), 0);
  const chestGrants = milestonesToGrant.flatMap((entry) =>
    (Array.isArray(entry.chests) ? entry.chests : []).map((chest) => ({
      chestType: String(chest?.chestType ?? DEFAULT_CHEST_TYPE).trim() || DEFAULT_CHEST_TYPE,
      amount: Math.max(0, Math.floor(Number(chest?.amount ?? 0) || 0))
    })).filter((chest) => chest.amount > 0)
  );

  const xpAwardSummary = applyXpAwardToProfile(profile, xpDelta, tokenDelta);
  let nextProfile = xpAwardSummary.profile;

  for (const chestGrant of chestGrants) {
    nextProfile = grantChest(nextProfile, chestGrant);
  }

  const nextClaimedMilestoneStreaks = normalizeGauntletClaimedMilestoneStreaks([
    ...alreadyClaimed,
    ...milestonesToGrant.map((entry) => entry.streak)
  ]);

  return {
    profile: nextProfile,
    claimedMilestoneStreaks: nextClaimedMilestoneStreaks,
    milestoneRewards: milestonesToGrant.map((entry) => ({
      streak: entry.streak,
      xp: Math.max(0, Number(entry.xp ?? 0)),
      tokens: Math.max(0, Number(entry.tokens ?? 0)),
      chests: (Array.isArray(entry.chests) ? entry.chests : []).map((chest) => ({
        chestType: String(chest?.chestType ?? DEFAULT_CHEST_TYPE).trim() || DEFAULT_CHEST_TYPE,
        amount: Math.max(0, Math.floor(Number(chest?.amount ?? 0) || 0)),
        chestLabel: getChestLabel(chest?.chestType ?? DEFAULT_CHEST_TYPE)
      }))
    })),
    xpDelta: xpAwardSummary.xpDelta,
    tokenDelta: xpAwardSummary.tokenDelta,
    xpConversionTokenBonus: xpAwardSummary.xpConversionTokenBonus,
    overflowXp: xpAwardSummary.overflowXp,
    chestGrants,
    levelBefore: xpAwardSummary.levelBefore,
    levelAfter: Math.max(xpAwardSummary.levelAfter, Number(nextProfile?.playerLevel ?? xpAwardSummary.levelAfter)),
    levelRewards: xpAwardSummary.levelRewards,
    levelRewardTokenDelta: xpAwardSummary.levelRewardTokenDelta
  };
}

function createZeroMatchStats(matchStats = {}) {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    featuredRivalWins: 0,
    matchesUsingAllElements: 0,
    quickWins: 0,
    timeLimitWins: 0,
    ...Object.fromEntries(
      Object.keys(matchStats ?? {}).map((key) => [key, 0])
    )
  };
}

function normalizeSettlementKey(settlementKey) {
  const normalized = String(settlementKey ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAppliedSettlementKeys(keys, limit = 50) {
  if (!Array.isArray(keys)) {
    return [];
  }

  return keys
    .map((entry) => normalizeSettlementKey(entry))
    .filter(Boolean)
    .slice(-limit);
}

function sumCapturedCards(matchState, perspective = "p1") {
  let total = 0;
  for (const round of matchState?.history ?? []) {
    if (round?.result !== perspective) {
      continue;
    }

    const explicitCaptured = Number(round?.capturedOpponentCards);
    total += Number.isFinite(explicitCaptured) && explicitCaptured >= 0
      ? safeRuntimeCount(explicitCaptured, 0)
      : Math.max(0, Math.floor(safeRuntimeCount(round?.capturedCards ?? 0, 0) / 2));
  }

  return total;
}

function classifyLongestMatchMode(matchState = {}) {
  const mode = String(matchState?.mode ?? "").trim().toLowerCase();
  if (mode === "online_pvp") {
    return "online_pvp";
  }
  if (mode === "local_pvp") {
    return "local_pvp";
  }
  if (String(matchState?.gauntletRivalId ?? "").trim()) {
    return "gauntlet";
  }
  if (String(matchState?.featuredRivalId ?? "").trim()) {
    return "featured_rival";
  }
  return "pve";
}

function classifyLongestMatchResult(matchState = {}, perspective = "p1") {
  const winner = String(matchState?.winner ?? "").trim().toLowerCase();
  const endReason = String(matchState?.endReason ?? "").trim().toLowerCase();
  const timedOut = endReason === "time_limit";

  if (!winner || winner === "draw") {
    return timedOut ? "timer_draw" : "draw";
  }

  if (winner === perspective) {
    return timedOut ? "timer_win" : "win";
  }

  return timedOut ? "timer_loss" : "loss";
}

function deriveLongestMatchOpponent(matchState = {}) {
  const gauntletRivalId = String(matchState?.gauntletRivalId ?? "").trim().toLowerCase() || null;
  if (gauntletRivalId) {
    const rival = getGauntletRivalById(gauntletRivalId);
    return {
      opponentId: gauntletRivalId,
      opponentName: rival?.displayName ?? null
    };
  }

  const featuredRivalId = String(matchState?.featuredRivalId ?? "").trim().toLowerCase() || null;
  if (featuredRivalId) {
    return {
      opponentId: featuredRivalId,
      opponentName: FEATURED_RIVAL_PUBLIC_NAMES[featuredRivalId] ?? null
    };
  }

  if (String(matchState?.mode ?? "").trim().toLowerCase() === "pve") {
    return {
      opponentId: null,
      opponentName: "Elemental AI"
    };
  }

  return {
    opponentId: null,
    opponentName: null
  };
}

function buildLongestMatchCandidate({
  matchState,
  perspective = "p1",
  practiceMode = false,
  nowMs = Date.now()
} = {}) {
  if (practiceMode || !matchState || matchState.status !== "completed") {
    return null;
  }

  const rounds = safeRuntimeCount(matchState.round, 0);
  if (rounds <= 0) {
    return null;
  }

  const opponent = deriveLongestMatchOpponent(matchState);
  const opponentPerspective = perspective === "p2" ? "p1" : "p2";

  return {
    rounds,
    mode: classifyLongestMatchMode(matchState),
    opponentId: opponent.opponentId,
    opponentName: opponent.opponentName,
    result: classifyLongestMatchResult(matchState, perspective),
    capturedFor: sumCapturedCards(matchState, perspective),
    capturedAgainst: sumCapturedCards(matchState, opponentPerspective),
    achievedAt: new Date(nowMs).toISOString()
  };
}

function classifyLatestBattleMode(matchState = {}) {
  const mode = String(matchState?.mode ?? "").trim().toLowerCase();
  if (mode === "online_pvp") {
    return "online";
  }
  if (mode === "local_pvp") {
    return "localHotseat";
  }
  if (String(matchState?.gauntletRivalId ?? "").trim() || Boolean(matchState?.gauntletMode)) {
    return "gauntlet";
  }
  if (String(matchState?.featuredRivalId ?? "").trim()) {
    return "featuredRival";
  }
  return "pve";
}

function classifyLatestBattleResult(matchState = {}, perspective = "p1") {
  const winner = String(matchState?.winner ?? "").trim().toLowerCase();
  if (!winner) {
    return null;
  }
  if (winner === "draw") {
    return "draw";
  }
  return winner === perspective ? "win" : "loss";
}

function resolveLatestBattleIdentity(matchState = {}, perspective = "p1", context = {}) {
  const mode = classifyLatestBattleMode(matchState);
  const normalizeText = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  };

  if (mode === "online") {
    const opponentUsername =
      normalizeText(context.opponentUsername) ??
      normalizeText(
        perspective === "p2"
          ? matchState?.hostUsername ?? matchState?.players?.p1?.username
          : matchState?.guestUsername ?? matchState?.players?.p2?.username
      );
    return {
      opponentName: normalizeText(context.opponentName) ?? opponentUsername,
      opponentUsername,
      opponentUserId: normalizeText(context.opponentUserId)
    };
  }

  if (mode === "featuredRival") {
    return {
      rivalName:
        normalizeText(context.rivalName) ??
        FEATURED_RIVAL_PUBLIC_NAMES[String(matchState?.featuredRivalId ?? "").trim().toLowerCase()] ??
        null
    };
  }

  if (mode === "gauntlet") {
    const gauntletRivalId = String(matchState?.gauntletRivalId ?? "").trim().toLowerCase();
    return {
      rivalName:
        getGauntletRivalById(gauntletRivalId)?.displayName ??
        normalizeText(context.rivalName) ??
        null
    };
  }

  if (mode === "localHotseat") {
    return {
      opponentName:
        normalizeText(context.opponentName) ??
        (perspective === "p2" ? "Player 1" : "Player 2")
    };
  }

  return {
    opponentName: normalizeText(context.opponentName) ?? "Elemental AI"
  };
}

function buildLatestBattleSummary({
  matchState,
  perspective = "p1",
  matchStats = null,
  context = null,
  nowMs = Date.now()
} = {}) {
  if (!matchState || matchState.status !== "completed") {
    return null;
  }

  const result = classifyLatestBattleResult(matchState, perspective);
  if (!result) {
    return null;
  }

  const rounds = safeRuntimeCount(matchState.round, 0);
  const warsEntered = Number(matchStats?.warsEntered);
  const mode = classifyLatestBattleMode(matchState);
  const identity = resolveLatestBattleIdentity(matchState, perspective, context ?? {});
  const summary = {
    mode,
    result,
    completedAt: new Date(nowMs).toISOString(),
    rounds: rounds > 0 ? rounds : null,
    warsEntered: Number.isFinite(warsEntered) && warsEntered >= 0 ? Math.floor(warsEntered) : null
  };

  if (mode === "online") {
    return {
      ...summary,
      opponentName: identity.opponentName,
      opponentUsername: identity.opponentUsername,
      opponentUserId: identity.opponentUserId
    };
  }

  if (mode === "featuredRival" || mode === "gauntlet") {
    return {
      ...summary,
      rivalName: identity.rivalName
    };
  }

  return {
    ...summary,
    opponentName: identity.opponentName
  };
}

function applyLatestBattleSummary(profile, latestBattle) {
  if (!profile || !latestBattle) {
    return profile;
  }

  return {
    ...profile,
    latestBattle
  };
}

const RECENT_BATTLE_DEDUPE_WINDOW_MS = 10000;

function getRecentBattleSignature(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return JSON.stringify({
    mode: entry.mode ?? null,
    result: entry.result ?? null,
    opponentName: entry.opponentName ?? null,
    opponentUsername: entry.opponentUsername ?? null,
    opponentUserId: entry.opponentUserId ?? null,
    rivalName: entry.rivalName ?? null,
    rounds: entry.rounds ?? null,
    warsEntered: entry.warsEntered ?? null
  });
}

function getRecentBattleCompletedAtMs(entry) {
  const completedAt = String(entry?.completedAt ?? "").trim();
  if (!completedAt) {
    return null;
  }

  const parsed = Date.parse(completedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function areRecentBattleEntriesEquivalent(a, b) {
  if (!a || !b) {
    return false;
  }

  if (JSON.stringify(a) === JSON.stringify(b)) {
    return true;
  }

  const signatureA = getRecentBattleSignature(a);
  const signatureB = getRecentBattleSignature(b);
  if (!signatureA || signatureA !== signatureB) {
    return false;
  }

  const completedAtA = getRecentBattleCompletedAtMs(a);
  const completedAtB = getRecentBattleCompletedAtMs(b);
  if (!Number.isFinite(completedAtA) || !Number.isFinite(completedAtB)) {
    return false;
  }

  return Math.abs(completedAtA - completedAtB) <= RECENT_BATTLE_DEDUPE_WINDOW_MS;
}

function applyRecentBattleSummary(profile, latestBattle, limit = 5) {
  if (!profile || !latestBattle) {
    return profile;
  }

  const existingRecentBattles = Array.isArray(profile.recentBattles) ? profile.recentBattles : [];
  const dedupedRecentBattles = existingRecentBattles.filter(
    (entry) => !areRecentBattleEntriesEquivalent(entry, latestBattle)
  );
  const nextRecentBattles = [latestBattle, ...dedupedRecentBattles].slice(0, limit);

  return {
    ...profile,
    latestBattle: nextRecentBattles[0] ?? latestBattle,
    recentBattles: nextRecentBattles
  };
}

function normalizeRecentOpponentDisplaySnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      avatar: null,
      title: null
    };
  }

  const normalizeOptionalId = (id) => {
    const normalized = String(id ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  };

  return {
    avatar: normalizeOptionalId(value.avatar),
    title: normalizeOptionalId(value.title)
  };
}

function applyRecentOpponentSummary(profile, latestBattle, context = null, settlementKey = null) {
  if (!profile || latestBattle?.mode !== "online" || !context || typeof context !== "object") {
    return profile;
  }

  const ownerProfileKey = String(profile.username ?? "").trim();
  const opponentProfileKey = String(context.opponentProfileKey ?? "").trim();
  if (!ownerProfileKey || !opponentProfileKey || ownerProfileKey === opponentProfileKey) {
    return profile;
  }

  const lastCompletedAt = String(latestBattle.completedAt ?? "").trim();
  if (!Number.isFinite(Date.parse(lastCompletedAt))) {
    return profile;
  }

  const entry = {
    opponentProfileKey,
    opponentUsername: String(context.opponentUsername ?? opponentProfileKey).trim() || opponentProfileKey,
    displayName:
      String(context.opponentName ?? context.opponentUsername ?? opponentProfileKey).trim() ||
      opponentProfileKey,
    latestResult: latestBattle.result,
    lastCompletedAt,
    lastSettlementKey: String(settlementKey ?? "").trim() || null,
    displayCosmetics: normalizeRecentOpponentDisplaySnapshot(context.opponentDisplayCosmetics)
  };
  const existingOpponents = normalizeRecentOpponents(profile.recentOpponents, ownerProfileKey);
  const nextOpponents = normalizeRecentOpponents(
    [
      entry,
      ...existingOpponents.filter((opponent) => opponent.opponentProfileKey !== opponentProfileKey)
    ],
    ownerProfileKey
  );

  return {
    ...profile,
    recentOpponents: nextOpponents
  };
}

function normalizeBloodMatchCombatantSummary(summary = {}, combatantId) {
  const combatant = summary?.combatants?.[combatantId] ?? {};
  return {
    handCount: safeRuntimeCount(combatant.handCount, 0),
    capturedCount: safeRuntimeCount(combatant.capturedCount, 0),
    eliminated: Boolean(combatant.eliminated)
  };
}

function normalizeBloodMatchHistory(summary = {}) {
  return (Array.isArray(summary?.history) ? summary.history : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      type: String(entry?.type ?? "").trim(),
      classificationId: String(entry?.classificationId ?? "").trim(),
      reason: String(entry?.reason ?? "").trim(),
      winnerId: String(entry?.winnerId ?? "").trim(),
      activeCombatantIds: Array.isArray(entry?.activeCombatantIds) ? [...entry.activeCombatantIds] : [],
      excludedCombatantIds: Array.isArray(entry?.excludedCombatantIds) ? [...entry.excludedCombatantIds] : []
    }));
}

function isBloodMatchWarEvent(entry = {}) {
  const type = String(entry?.type ?? "").toLowerCase();
  const classificationId = String(entry?.classificationId ?? "").toLowerCase();
  return type.includes("war") || classificationId.includes("war");
}

function isBloodMatchThreeWayWarEvent(entry = {}) {
  const type = String(entry?.type ?? "").toLowerCase();
  const activeIds = Array.isArray(entry?.activeCombatantIds) ? entry.activeCombatantIds : [];
  return type === "three_way_war" || activeIds.length >= 3;
}

function deriveBloodMatchProfileStats(summary = {}) {
  const terminal = summary?.terminalResult && typeof summary.terminalResult === "object"
    ? summary.terminalResult
    : {};
  const winnerId = String(summary?.winnerId ?? terminal?.winnerId ?? "").trim();
  const result = String(terminal?.result ?? "").trim();
  const endReason = String(summary?.endReason ?? terminal?.endReason ?? terminal?.reason ?? "").trim();
  const player = normalizeBloodMatchCombatantSummary(summary, "player");
  const vampire = normalizeBloodMatchCombatantSummary(summary, "vampire");
  const lycan = normalizeBloodMatchCombatantSummary(summary, "lycan");
  const timeoutWin = endReason === "timeout_lead";
  const bothRivalsEliminated = vampire.eliminated && lycan.eliminated;
  const playerWon = (winnerId === "player" || result === "player_win") && (timeoutWin || bothRivalsEliminated);
  const playerLost = !playerWon;
  const history = normalizeBloodMatchHistory(summary);
  const warEvents = history.filter(isBloodMatchWarEvent);
  const threeWayWars = history.filter(isBloodMatchThreeWayWarEvent).length;
  const twoWayWars = Math.max(0, warEvents.length - threeWayWars);
  const warsWon = warEvents.filter((entry) => entry.winnerId === "player").length;
  const warsLost = warEvents.filter((entry) => entry.winnerId && entry.winnerId !== "player").length;
  const threeWayWarsWon = warEvents.filter(
    (entry) => entry.winnerId === "player" && isBloodMatchThreeWayWarEvent(entry)
  ).length;
  const bloodFeudWarsWon = warEvents.filter(
    (entry) =>
      entry.winnerId === "player" &&
      Array.isArray(entry.activeCombatantIds) &&
      entry.activeCombatantIds.includes("player") &&
      (entry.activeCombatantIds.includes("vampire") || entry.activeCombatantIds.includes("lycan"))
  ).length;
  const aiEliminationWin = playerWon && (vampire.eliminated || lycan.eliminated);
  const doubleEliminationWin = playerWon && vampire.eliminated && lycan.eliminated;
  const validTimeoutWin = playerWon && timeoutWin;
  const timeoutLoss = playerLost && endReason === "timeout_tie_or_deficit";

  return {
    bloodMatchMatchesPlayed: 1,
    bloodMatchWins: playerWon ? 1 : 0,
    bloodMatchLosses: playerLost ? 1 : 0,
    bloodMatchCurrentWinStreak: playerWon ? 1 : 0,
    bloodMatchBestWinStreak: playerWon ? 1 : 0,
    bloodMatchEliminationWins: aiEliminationWin ? 1 : 0,
    bloodMatchTimeoutWins: validTimeoutWin ? 1 : 0,
    bloodMatchTimeoutLosses: timeoutLoss ? 1 : 0,
    bloodMatchDoubleEliminationWins: doubleEliminationWin ? 1 : 0,
    bloodMatchVampireEliminations: vampire.eliminated ? 1 : 0,
    bloodMatchLycanEliminations: lycan.eliminated ? 1 : 0,
    bloodMatchPlayerEliminations: player.eliminated ? 1 : 0,
    bloodMatchTwoWayWars: twoWayWars,
    bloodMatchThreeWayWars: threeWayWars,
    bloodMatchWarsWon: warsWon,
    bloodMatchWarsLost: warsLost,
    bloodMatchThreeWayWarsWon: threeWayWarsWon,
    bloodMatchBloodFeudWarsWon: bloodFeudWarsWon,
    bloodMatchCardsCaptured: player.capturedCount,
    bloodMatchHighestHandCount: player.handCount,
    bloodMatchLowestHandCount: player.handCount,
    bloodMatchComebackWins:
      playerWon && history.some((entry) => entry.winnerId && entry.winnerId !== "player") ? 1 : 0,
    bloodMatchOneCardWins: playerWon && player.handCount <= 1 ? 1 : 0,
    bloodMatchNoWarWins: playerWon && warEvents.length === 0 ? 1 : 0,
    playerHandAtEnd: player.handCount,
    vampireHandAtEnd: vampire.handCount,
    lycanHandAtEnd: lycan.handCount,
    endReason,
    winnerId: playerWon ? "player" : winnerId || null
  };
}

function applyBloodMatchStatsToProfile(profile, stats = {}) {
  const defaults = createDefaultBloodMatchStats();
  const nextProfile = { ...profile };
  for (const key of Object.keys(defaults)) {
    const current = safeRuntimeCount(nextProfile[key], defaults[key]);
    const delta = safeRuntimeCount(stats[key], 0);
    if (key === "bloodMatchCurrentWinStreak") {
      nextProfile[key] = stats.bloodMatchWins > 0 ? current + 1 : 0;
    } else if (key === "bloodMatchBestWinStreak") {
      const currentStreak = safeRuntimeCount(nextProfile.bloodMatchCurrentWinStreak, 0);
      nextProfile[key] = Math.max(current, currentStreak);
    } else if (key === "bloodMatchHighestHandCount") {
      nextProfile[key] = Math.max(current, delta);
    } else if (key === "bloodMatchLowestHandCount") {
      nextProfile[key] = current > 0 ? Math.min(current, delta) : delta;
    } else {
      nextProfile[key] = current + delta;
    }
  }
  return nextProfile;
}

function buildBloodMatchLatestBattleSummary(summary = {}, stats = {}, nowMs = Date.now()) {
  const result = stats.bloodMatchWins > 0 ? "win" : "loss";
  return {
    mode: "bloodMatch",
    displayMode: "Blood Match",
    result,
    completedAt: new Date(nowMs).toISOString(),
    rounds: safeRuntimeCount(summary?.round, 0),
    warsEntered:
      safeRuntimeCount(stats.bloodMatchTwoWayWars, 0) +
      safeRuntimeCount(stats.bloodMatchThreeWayWars, 0),
    rivalName: BLOOD_MATCH_RIVAL_NAME,
    endReason: stats.endReason || null,
    playerCardsCaptured: safeRuntimeCount(stats.bloodMatchCardsCaptured, 0),
    playerHandAtEnd: safeRuntimeCount(stats.playerHandAtEnd, 0),
    vampireHandAtEnd: safeRuntimeCount(stats.vampireHandAtEnd, 0),
    lycanHandAtEnd: safeRuntimeCount(stats.lycanHandAtEnd, 0),
    twoWayWars: safeRuntimeCount(stats.bloodMatchTwoWayWars, 0),
    threeWayWars: safeRuntimeCount(stats.bloodMatchThreeWayWars, 0)
  };
}

function buildBloodMatchLongestMatchCandidate(summary = {}, stats = {}, nowMs = Date.now()) {
  const rounds = safeRuntimeCount(summary?.round, 0);
  if (rounds <= 0) {
    return null;
  }

  const playerWon = safeRuntimeCount(stats.bloodMatchWins, 0) > 0;
  const endReason = String(stats.endReason ?? summary?.endReason ?? "").trim();
  const timedOut = endReason === "timeout_lead" || endReason === "timeout_tie_or_deficit";

  return {
    rounds,
    mode: "blood_match",
    opponentId: "blood_match",
    opponentName: BLOOD_MATCH_RIVAL_NAME,
    result: timedOut ? (playerWon ? "timer_win" : "timer_loss") : playerWon ? "win" : "loss",
    capturedFor: safeRuntimeCount(stats.bloodMatchCardsCaptured, 0),
    capturedAgainst: null,
    achievedAt: new Date(nowMs).toISOString()
  };
}

function getBloodMatchLossParticipationXp() {
  return buildXpBreakdown({
    isCompleted: true,
    isQuit: false,
    didWin: false,
    warsWon: 0
  }).total;
}

function applyLongestMatchCandidate(profile, candidate) {
  if (!candidate || !profile) {
    return profile;
  }

  const currentRounds = safeRuntimeCount(profile?.longestMatch?.rounds, 0);
  if (currentRounds >= candidate.rounds) {
    return profile;
  }

  return {
    ...profile,
    longestMatch: candidate
  };
}

function appendAppliedSettlementKey(keys, settlementKey, limit = 50) {
  const normalizedKey = normalizeSettlementKey(settlementKey);
  if (!normalizedKey) {
    return normalizeAppliedSettlementKeys(keys, limit);
  }

  const existing = normalizeAppliedSettlementKeys(keys, limit).filter((entry) => entry !== normalizedKey);
  return [...existing, normalizedKey].slice(-limit);
}

function getOwnedCosmeticIds(profile, type) {
  return Array.isArray(profile?.ownedCosmetics?.[type]) ? profile.ownedCosmetics[type].filter(Boolean) : [];
}

function chooseRandomOwnedId(profile, type, currentId) {
  const ownedIds = getOwnedCosmeticIds(profile, type).filter((id) => getCosmeticDefinition(type, id));
  if (ownedIds.length === 0) {
    return currentId ?? null;
  }

  const pool = ownedIds.length > 1 ? ownedIds.filter((id) => id !== currentId) : ownedIds;
  const safePool = pool.length > 0 ? pool : ownedIds;
  const index = Math.floor(Math.random() * safePool.length);
  return safePool[index] ?? currentId ?? null;
}

function chooseRandomOwnedVariantIds(profile, currentSelection = null) {
  const nextSelection = {
    fire: currentSelection?.fire ?? null,
    water: currentSelection?.water ?? null,
    earth: currentSelection?.earth ?? null,
    wind: currentSelection?.wind ?? null
  };
  const ownedIds = getOwnedCosmeticIds(profile, "elementCardVariant");

  for (const element of ["fire", "water", "earth", "wind"]) {
    const matchingIds = ownedIds.filter((id) => getCosmeticDefinition("elementCardVariant", id)?.element === element);
    if (matchingIds.length === 0) {
      continue;
    }

    const currentId = currentSelection?.[element] ?? null;
    const pool = matchingIds.length > 1 ? matchingIds.filter((id) => id !== currentId) : matchingIds;
    const safePool = pool.length > 0 ? pool : matchingIds;
    const index = Math.floor(Math.random() * safePool.length);
    nextSelection[element] = safePool[index] ?? currentId;
  }

  return nextSelection;
}

// Runtime persistence boundaries should only coerce malformed values enough to
// protect downstream systems. Valid fields must pass through unchanged.
function safeRuntimeCount(value, fallback = 0, { min = 0 } = {}) {
  // Treat nullish/blank runtime counters as malformed so the caller-provided
  // fallback wins instead of silently coercing null -> 0.
  if (value == null || value === "") {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.floor(numeric));
}

// Match history drives existing stat/challenge evaluation. Repair only the
// malformed pieces so valid runtime match data reaches downstream systems
// unchanged.
function guardRuntimeMatchStatePayload(matchState) {
  if (!matchState || typeof matchState !== "object" || Array.isArray(matchState)) {
    console.warn("[RuntimeGuard] repaired malformed match result payload");
    return {
      value: {
        status: "completed",
        endReason: null,
        winner: null,
        mode: null,
        round: 0,
        history: []
      },
      repaired: true
    };
  }

  const safeHistory = Array.isArray(matchState.history)
    ? matchState.history
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => ({
          ...entry,
          warClashes: safeRuntimeCount(entry.warClashes, 0),
          capturedOpponentCards:
            entry?.capturedOpponentCards == null
              ? entry?.capturedOpponentCards ?? undefined
              : safeRuntimeCount(entry.capturedOpponentCards, 0),
          result: ["p1", "p2", "draw", "none"].includes(entry.result) ? entry.result : "none",
          p1Card: typeof entry.p1Card === "string" ? entry.p1Card : null,
          p2Card: typeof entry.p2Card === "string" ? entry.p2Card : null
        }))
    : [];

  const nextMatchState = {
    ...matchState,
    status: "completed",
    endReason: matchState.endReason ?? null,
    winner: ["p1", "p2", "draw"].includes(matchState.winner) ? matchState.winner : null,
    mode: typeof matchState.mode === "string" ? matchState.mode : null,
    round: safeRuntimeCount(matchState.round, safeHistory.length),
    history: safeHistory
  };

  const repaired = JSON.stringify(nextMatchState) !== JSON.stringify(matchState);
  if (repaired) {
    console.warn("[RuntimeGuard] repaired malformed match result payload");
  }

  return {
    value: repaired ? nextMatchState : matchState,
    repaired
  };
}

// Result/stat application is the last runtime boundary before persistence. Keep
// valid match summaries intact while containing malformed counters/history
// fragments before they reach stats, challenges, or saves.
function containRuntimeMatchSummaryState(matchState) {
  const guarded = guardRuntimeMatchStatePayload(matchState);
  if (guarded.repaired) {
    console.warn("[RuntimeInvariant] contained malformed match summary state");
  }

  return guarded;
}

// Stat writes must resolve to a known mode bucket. Repair malformed counters,
// fall back to the current runtime mode when available, and skip the write if
// a safe mode still cannot be resolved.
export function guardRuntimeStatWritePayload({
  mode,
  fallbackMode = null,
  matchStats
} = {}) {
  const resolvedMode = VALID_RUNTIME_MODES.has(mode)
    ? mode
    : VALID_RUNTIME_MODES.has(fallbackMode)
      ? fallbackMode
      : null;

  const nextStats = {
    gamesPlayed: safeRuntimeCount(matchStats?.gamesPlayed, 1),
    wins: safeRuntimeCount(matchStats?.wins, 0),
    losses: safeRuntimeCount(matchStats?.losses, 0),
    warsEntered: safeRuntimeCount(matchStats?.warsEntered, 0),
    warsWon: safeRuntimeCount(matchStats?.warsWon, 0),
    longestWar: safeRuntimeCount(matchStats?.longestWar, 0),
    cardsCaptured: safeRuntimeCount(matchStats?.cardsCaptured, 0),
    featuredRivalWins: safeRuntimeCount(matchStats?.featuredRivalWins, 0),
    matchesUsingAllElements: safeRuntimeCount(matchStats?.matchesUsingAllElements, 0),
    quickWins: safeRuntimeCount(matchStats?.quickWins, 0),
    timeLimitWins: safeRuntimeCount(matchStats?.timeLimitWins, 0)
  };

  const repaired =
    JSON.stringify(nextStats) !== JSON.stringify(matchStats ?? {}) ||
    mode !== resolvedMode;

  if (resolvedMode && repaired) {
    console.warn("[RuntimeInvariant] contained malformed stat delta");
  }

  return {
    mode: resolvedMode,
    matchStats: nextStats,
    repaired,
    skipped: resolvedMode === null
  };
}

function validateUniquePurchaseConfiguration({
  profile,
  definition,
  record,
  type,
  cosmeticId
}) {
  if (!profile) {
    throw new Error("Buyer profile is missing.");
  }
  if (!definition || definition.rarity !== "Unique") {
    throw new Error(`Unique cosmetic '${String(cosmeticId ?? "")}' was not found.`);
  }
  if (!record || !["approved", "assigned", "granted"].includes(record.status)) {
    throw new Error("Unique cosmetic is not configured or approved.");
  }
  if (record.shopEligible !== true || record.shopListed !== true || record.storeHidden) {
    throw new Error("Unique cosmetic is not available.");
  }
  if (record.grantOnly) {
    throw new Error("Unique cosmetic is grant-only and cannot be purchased.");
  }
  if (!Number.isInteger(record.price) || record.price < 0) {
    throw new Error("Unique cosmetic price is missing or invalid.");
  }
  if (!["unlimited", "limited"].includes(record.saleLimitMode)) {
    throw new Error("Unique cosmetic sale limit mode is invalid.");
  }
  if (record.saleLimitMode === "limited") {
    if (!Number.isInteger(record.saleLimitTotal) || record.saleLimitTotal <= 0) {
      throw new Error("Unique cosmetic limited inventory is invalid.");
    }
    if (record.saleLimitSold >= record.saleLimitTotal) {
      throw new Error("Sold Out");
    }
  }
  if (profile.ownedCosmetics?.[type]?.includes(cosmeticId)) {
    throw new Error("Already Owned");
  }
  if (Number(profile.tokens ?? 0) < record.price) {
    throw new Error("Not enough tokens");
  }
}

function buildUniqueRoyaltyPlan({ record, price, recipientProfile, transactionId }) {
  const royalty = record?.royalty ?? {};
  if (royalty.enabled !== true) {
    return {
      enabled: false,
      recipientUsername: null,
      tokenPercent: 0,
      amount: 0,
      status: "none"
    };
  }
  const recipientUsername = String(royalty.recipientUsername ?? "").trim();
  const tokenPercent = Number(royalty.tokenPercent);
  if (!recipientUsername || !recipientProfile) {
    throw new Error("Configured royalty recipient is invalid.");
  }
  if (
    !Number.isFinite(tokenPercent) ||
    tokenPercent <= 0 ||
    tokenPercent > MAX_UNIQUE_ROYALTY_TOKEN_PERCENT
  ) {
    throw new Error("Configured royalty token percent is invalid.");
  }
  if (!Number.isInteger(price) || price < 0) {
    throw new Error("Unique cosmetic price is missing or invalid.");
  }
  const amount = Math.min(price, Math.floor((price * tokenPercent) / 100));
  return {
    enabled: true,
    recipientUsername,
    tokenPercent,
    amount,
    status: amount > 0 ? "paid" : "skipped",
    transactionId
  };
}

function getOwnedCollectionPackCosmeticIds(profile) {
  return Object.values(profile?.ownedCosmetics ?? {})
    .flatMap((ids) => (Array.isArray(ids) ? ids : []))
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
}

function profileOwnsAllCosmetics(profile, cosmeticIds = []) {
  const owned = new Set(getOwnedCollectionPackCosmeticIds(profile));
  return (Array.isArray(cosmeticIds) ? cosmeticIds : []).every((cosmeticId) =>
    owned.has(String(cosmeticId ?? "").trim())
  );
}

function validateCollectionPackPurchaseWindow(
  pack,
  { now = new Date().toISOString(), allowReservedLimitedSale = false } = {}
) {
  if (!pack) {
    throw new Error("Collection Pack not found.");
  }
  if (pack.active !== true) {
    throw new Error("Collection Pack is inactive.");
  }
  if (pack.visible !== true) {
    throw new Error("Collection Pack is not visible.");
  }

  const nowMs = Date.parse(now);
  if (pack.startsAt && nowMs < Date.parse(pack.startsAt)) {
    throw new Error("Collection Pack is not available yet.");
  }
  if (pack.endsAt && nowMs > Date.parse(pack.endsAt)) {
    throw new Error("Collection Pack has expired.");
  }
  if (
    pack.saleLimitMode === "limited" &&
    (allowReservedLimitedSale ? pack.soldCount > pack.saleLimitTotal : pack.soldCount >= pack.saleLimitTotal)
  ) {
    throw new Error("Sold Out");
  }
}

function isCollectionPackInPlayerWindow(pack, { now = new Date().toISOString() } = {}) {
  if (!pack || pack.active !== true || pack.visible !== true) {
    return false;
  }

  const nowMs = Date.parse(now);
  if (pack.startsAt && nowMs < Date.parse(pack.startsAt)) {
    return false;
  }
  if (pack.endsAt && nowMs > Date.parse(pack.endsAt)) {
    return false;
  }
  return true;
}

function isCollectionPackSoldOut(pack) {
  return (
    pack?.saleLimitMode === "limited" &&
    Number.isInteger(pack.saleLimitTotal) &&
    Number(pack.soldCount ?? 0) >= pack.saleLimitTotal
  );
}

function sanitizeCollectionPackDeal(pack, pricePlan) {
  const soldOut = isCollectionPackSoldOut(pack);
  const remainingPurchases =
    pack.saleLimitMode === "limited"
      ? Math.max(0, Number(pack.saleLimitTotal ?? 0) - Number(pack.soldCount ?? 0))
      : null;

  return {
    packId: pack.packId,
    name: pack.name,
    description: pack.description,
    image: pack.image,
    includedCosmeticIds: [...pack.cosmeticIds],
    includedItemCount: pack.cosmeticIds.length,
    ownedItemCount: Math.max(0, pack.cosmeticIds.length - pricePlan.remainingCosmeticIds.length),
    remainingCosmeticIds: [...pricePlan.remainingCosmeticIds],
    remainingItemCount: pricePlan.remainingCosmeticIds.length,
    remainingNormalValue: pricePlan.remainingNormalValue,
    discountPercent: pricePlan.discountPercent,
    savings: pricePlan.savings,
    finalPrice: pricePlan.finalPrice,
    status: pricePlan.status === "complete" ? "complete" : soldOut ? "sold_out" : "available",
    saleLimitMode: pack.saleLimitMode,
    saleLimitTotal: pack.saleLimitMode === "limited" ? pack.saleLimitTotal : null,
    soldCount: pack.saleLimitMode === "limited" ? pack.soldCount : null,
    remainingPurchases
  };
}

export class StateCoordinator {
  constructor(options = {}) {
    this.profiles = new ProfileSystem(options);
    this.saves = new SaveSystem(options);
    this.settings = new SettingsService(options);
    this.specialCosmeticRegistry =
      options.specialCosmeticRegistryStore ?? new SpecialCosmeticRegistryStore(options);
    this.storePurchaseLedger =
      options.storePurchaseLedgerStore ?? new StorePurchaseLedgerStore(options);
    this.collectionPackStore =
      options.collectionPackStore ?? new CollectionPackStore(options);
    this.adminGrantStore =
      options.adminGrantStore ?? new AdminGrantStore(options);
    this.uniquePurchaseQueue = Promise.resolve();
    this.collectionPackPurchaseQueue = Promise.resolve();
    this.random = typeof options.random === "function" ? options.random : Math.random;
    this.getActiveBoostEvent =
      typeof options.getActiveBoostEvent === "function"
        ? options.getActiveBoostEvent
        : async () => null;
    this.matchPersistenceQueue = Promise.resolve();
  }

  runMatchPersistence(task) {
    const run = this.matchPersistenceQueue.then(task, task);
    this.matchPersistenceQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  runUniquePurchaseTransaction(task) {
    const run = this.uniquePurchaseQueue.then(task, task);
    this.uniquePurchaseQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  runCollectionPackPurchaseTransaction(task) {
    const run = this.collectionPackPurchaseQueue.then(task, task);
    this.collectionPackPurchaseQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async listCollectionPacksForAdmin() {
    return this.collectionPackStore.listPacks();
  }

  async getCollectionPackForAdmin(packId) {
    const pack = await this.collectionPackStore.getPack(packId);
    if (!pack) {
      throw new Error(`Collection Pack '${String(packId ?? "").trim()}' was not found.`);
    }
    return pack;
  }

  async upsertCollectionPackForAdmin(draft = {}) {
    const safeDraft = draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
    const packId = String(safeDraft.packId ?? safeDraft.id ?? "").trim();
    if (!packId) {
      throw new Error("packId is required.");
    }

    const existing = await this.collectionPackStore.getPack(packId);
    const allowedFields = [
      "packId",
      "name",
      "description",
      "image",
      "cosmeticIds",
      "discountPercent",
      "active",
      "visible",
      "startsAt",
      "endsAt",
      "saleLimitMode",
      "saleLimitTotal",
      "sortPriority",
      "adminNotes"
    ];
    const config = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(safeDraft, field)) {
        config[field] = safeDraft[field];
      }
    }

    return this.collectionPackStore.upsertPack({
      ...config,
      packId,
      soldCount: existing?.soldCount ?? 0
    });
  }

  async previewCollectionPackForAdmin({ draft = {}, username = null } = {}) {
    const normalized = this.collectionPackStore.validateDraft(draft);
    const safeUsername = String(username ?? "").trim();
    const profile = safeUsername ? await this.profiles.getProfile(safeUsername) : null;
    const ownedCosmeticIds = profile ? getOwnedCollectionPackCosmeticIds(profile) : [];
    const totalPlan = calculateCollectionPackPriceForOwnedCosmetics(normalized, [], {
      now: this.collectionPackStore.now()
    });
    const playerPlan = calculateCollectionPackPriceForOwnedCosmetics(
      normalized,
      ownedCosmeticIds,
      { now: this.collectionPackStore.now() }
    );

    return {
      packId: normalized.packId,
      includedCosmeticIds: normalized.cosmeticIds,
      totalNormalValue: totalPlan.remainingNormalValue,
      discountPercent: playerPlan.discountPercent,
      savings: playerPlan.savings,
      finalPrice: playerPlan.finalPrice,
      remainingCosmeticIds: playerPlan.remainingCosmeticIds,
      status: playerPlan.status
    };
  }

  async listEligibleCollectionPackCosmeticsForAdmin() {
    return listEligibleCollectionPackCosmetics({ catalog: COSMETIC_CATALOG });
  }

  buildCosmeticsView(profile, specialRecords = []) {
    const snapshot = buildAuthoritativeCosmeticSnapshot(profile);
    const randomizeAfterEachMatch = normalizeCosmeticRandomizationPreferences(snapshot.preferences);
    return {
      authority: "server",
      source: "stateCoordinator",
      snapshot,
      equipped: snapshot.equipped,
      owned: snapshot.owned,
      catalog: mergePublicSpecialCosmeticMetadata(
        getCosmeticCatalogForProfile(profile),
        specialRecords
      ),
      preferences: {
        randomizeBackgroundEachMatch: Boolean(randomizeAfterEachMatch.background),
        randomizeAfterEachMatch
      },
      loadouts: getCosmeticLoadoutsForProfile(profile)
    };
  }

  async ensureUniqueCosmeticAcquisitions(username) {
    const safeUsername = String(username ?? "").trim();
    if (!safeUsername) {
      throw new Error("username is required for Unique cosmetic acquisition backfill.");
    }
    const profile = await this.profiles.ensureProfile(safeUsername);
    const currentMap = profile?.uniqueCosmeticAcquisitions ?? {};
    const missing = [];

    for (const [type, definitions] of Object.entries(COSMETIC_CATALOG)) {
      for (const definition of definitions) {
        if (
          definition?.rarity !== "Unique" ||
          !profile?.ownedCosmetics?.[type]?.includes(definition.id)
        ) {
          continue;
        }
        const key = buildUniqueCosmeticAcquisitionKey(type, definition.id);
        if (key && !currentMap[key]) {
          missing.push({ key, type, cosmeticId: definition.id });
        }
      }
    }
    if (missing.length === 0) {
      return profile;
    }

    const [purchases, grants] = await Promise.all([
      this.storePurchaseLedger.listEntries(),
      this.adminGrantStore.listEntries()
    ]);
    const normalizedUsername = safeUsername.toLowerCase();
    const timestampValue = (value) => {
      const parsed = Date.parse(String(value ?? ""));
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };
    const backfillEntries = {};

    for (const item of missing) {
      const evidence = [];
      for (const entry of purchases) {
        if (
          entry?.status === "completed" &&
          String(entry?.buyerUsername ?? "").trim().toLowerCase() === normalizedUsername &&
          entry?.cosmeticType === item.type &&
          entry?.cosmeticId === item.cosmeticId
        ) {
          evidence.push({
            source: "store_purchase",
            acquiredAt: entry.completedAt ?? entry.timestamp ?? null
          });
        }
      }
      for (const entry of grants) {
        if (
          String(entry?.status ?? "").trim() === "success" &&
          String(entry?.grantType ?? "").trim() === "special_cosmetic_grant" &&
          String(entry?.targetUsername ?? "").trim().toLowerCase() === normalizedUsername &&
          entry?.payload?.cosmetic?.type === item.type &&
          entry?.payload?.cosmetic?.cosmeticId === item.cosmeticId
        ) {
          evidence.push({
            source: "granted",
            acquiredAt: entry.timestamp ?? null
          });
        }
      }
      evidence.sort(
        (left, right) => timestampValue(left.acquiredAt) - timestampValue(right.acquiredAt)
      );
      backfillEntries[item.key] = evidence[0] ?? { source: "legacy_unknown" };
    }

    return this.profiles.updateProfile(safeUsername, (current) => ({
      ...current,
      uniqueCosmeticAcquisitions: {
        ...(current?.uniqueCosmeticAcquisitions ?? {}),
        ...Object.fromEntries(
          Object.entries(backfillEntries).filter(
            ([key]) => !current?.uniqueCosmeticAcquisitions?.[key]
          )
        )
      }
    }));
  }

  async buildCosmeticsViewWithSpecialMetadata(profile) {
    const records = await this.specialCosmeticRegistry.listRecords();
    return this.buildCosmeticsView(profile, records);
  }

  async claimDailyLoginReward(username, nowMs = Date.now(), { random = Math.random } = {}) {
    const profileBefore = await this.profiles.ensureProfile(username);
    const statusBefore = getDailyLoginStatus(profileBefore, nowMs);
    const claimDate = statusBefore.loginDayKey;

    console.info("[DailyLogin] evaluate", {
      username,
      nowMs,
      resetWindowKey: statusBefore.loginDayKey,
      lastDailyLoginClaimDate: statusBefore.lastDailyLoginClaimDate,
      eligible: statusBefore.eligible
    });

    if (profileBefore.lastDailyLoginClaimDate === claimDate) {
      console.info("[DailyLogin] grant_skipped", {
        username,
        resetWindowKey: statusBefore.loginDayKey,
        granted: false
      });
      return {
        granted: false,
        eligible: statusBefore.eligible,
        profile: profileBefore,
        dailyLoginStatus: statusBefore,
        streakDay: getSafeDailyLoginStreakDay(profileBefore),
        rewardSummary: null,
        rewardTokens: 0,
        rewardXp: 0,
        chestAwarded: null,
        chestGrants: [],
        xpConversionTokenBonus: 0,
        overflowXp: 0,
        xpBreakdown: { lines: [], total: 0 },
        levelBefore: profileBefore.playerLevel ?? 1,
        levelAfter: profileBefore.playerLevel ?? 1,
        levelRewards: [],
        levelRewardTokenDelta: 0
      };
    }

    const previousWindowKey = getPreviousDailyLoginDateKey(nowMs);
    const priorStreakDay = getSafeDailyLoginStreakDay(profileBefore);
    const streakDay =
      profileBefore.lastDailyLoginClaimDate === previousWindowKey
        ? priorStreakDay >= DAILY_LOGIN_STREAK_MAX_DAY
          ? 1
          : Math.max(1, priorStreakDay + 1)
        : 1;
    const rewardPlan = getDailyLoginRewardForDay(streakDay);
    const rewardTokens = Number(rewardPlan?.tokens ?? 0) || 0;
    const rewardXp = Number(rewardPlan?.xp ?? 0) || 0;
    let xpAwardSummary = applyXpAwardToProfile(
      profileBefore,
      rewardXp,
      rewardTokens
    );
    let workingProfile = xpAwardSummary.profile;
    let chestAwarded = null;
    const chestGrants = [];

    const chestRolls = Array.isArray(rewardPlan?.chestRolls) ? rewardPlan.chestRolls : [];
    if (chestRolls.length > 0) {
      const chestRollValue = typeof random === "function" ? Number(random()) : Math.random();
      let chanceBand = 0;
      for (const roll of chestRolls) {
        chanceBand += Math.max(0, Number(roll?.chance ?? 0) || 0);
        if (chestRollValue >= chanceBand) {
          continue;
        }
        const chestType = String(roll?.chestType ?? "").trim() || DEFAULT_CHEST_TYPE;
        workingProfile = grantChest(workingProfile, { chestType, amount: 1 });
        chestAwarded = {
          chestType,
          chestLabel: getChestLabel(chestType),
          amount: 1
        };
        chestGrants.push({ chestType, amount: 1 });
        break;
      }
    }

    const committedCandidateProfile = {
      ...workingProfile,
      lastDailyLoginClaimDate: claimDate,
      dailyLoginStreakDay: streakDay
    };

    const committedProfile = await this.profiles.updateProfile(username, committedCandidateProfile);
    const statusAfter = getDailyLoginStatus(committedProfile, nowMs);

    console.info("[DailyLogin] grant_applied", {
      username,
      resetWindowKey: statusAfter.loginDayKey,
      granted: true,
      streakDay,
      rewardTokens,
      rewardXp: xpAwardSummary.xpDelta,
      chestAwarded: chestAwarded?.chestType ?? null,
      nextResetAt: statusAfter.nextResetAt
    });

    return {
      granted: true,
      eligible: statusAfter.eligible,
      profile: committedProfile,
      dailyLoginStatus: statusAfter,
      streakDay,
      rewardSummary: {
        day: streakDay,
        tokens: rewardTokens,
        xp: rewardXp,
        chestAwarded
      },
      rewardTokens,
      rewardXp: xpAwardSummary.xpDelta,
      chestAwarded,
      chestGrants,
      xpConversionTokenBonus: xpAwardSummary.xpConversionTokenBonus,
      overflowXp: xpAwardSummary.overflowXp,
      xpBreakdown: {
        lines:
          xpAwardSummary.xpDelta > 0
            ? [{ key: "daily_login", label: `Daily Login Day ${streakDay}`, amount: xpAwardSummary.xpDelta }]
            : [],
        total: xpAwardSummary.xpDelta
      },
      levelBefore: xpAwardSummary.levelBefore,
      levelAfter: committedProfile.playerLevel ?? xpAwardSummary.levelAfter,
      levelRewards: xpAwardSummary.levelRewards,
      levelRewardTokenDelta: xpAwardSummary.levelRewardTokenDelta
    };
  }

  async recordBloodMatchResult({
    username,
    summary,
    settlementKey = null,
    nowMs = Date.now()
  } = {}) {
    return this.runMatchPersistence(async () => {
      if (!username) {
        throw new Error("username is required to record Blood Match results.");
      }
      if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        throw new Error("Blood Match summary is required.");
      }
      if (String(summary.status ?? "").trim() !== "completed") {
        throw new Error("Blood Match must be completed before recording results.");
      }

      const effectiveSettlementKey = normalizeSettlementKey(settlementKey);
      if (!effectiveSettlementKey) {
        throw new Error("Blood Match settlementKey is required.");
      }
      const existingSaves = await this.saves.listMatchResults();
      const duplicateSave = effectiveSettlementKey
        ? existingSaves.find(
            (entry) =>
              entry?.username === username &&
              entry?.mode === "bloodMatch" &&
              entry?.settlementKey === effectiveSettlementKey
          ) ?? null
        : null;
      if (duplicateSave) {
        const committedProfile = await this.profiles.ensureProfile(username);
        return {
          duplicate: true,
          profile: committedProfile,
          save: duplicateSave,
          stats: duplicateSave.stats ?? {},
          dailyChallenges: getDailyChallengesView(committedProfile).view.daily,
          weeklyChallenges: getDailyChallengesView(committedProfile).view.weekly,
          xp: getLevelProgress(committedProfile),
          tokenDelta: 0,
          matchTokenDelta: 0,
          matchXpDelta: 0,
          xpDelta: 0,
          xpConversionTokenBonus: 0,
          overflowXp: 0,
          xpBreakdown: { lines: [], total: 0 },
          levelBefore: committedProfile.playerLevel ?? 1,
          levelAfter: committedProfile.playerLevel ?? 1,
          levelRewards: [],
          levelRewardTokenDelta: 0,
          profileAchievements: buildAchievementView(committedProfile),
          unlockedAchievements: [],
          chestGrants: []
        };
      }

      const profileBefore = await this.profiles.ensureProfile(username);
      const bloodMatchStats = deriveBloodMatchProfileStats(summary);
      const playerWon = bloodMatchStats.bloodMatchWins > 0;
      let workingProfile = applyBloodMatchStatsToProfile(profileBefore, bloodMatchStats);
      workingProfile = applyLongestMatchCandidate(
        workingProfile,
        buildBloodMatchLongestMatchCandidate(summary, bloodMatchStats, nowMs)
      );
      const baseXpDelta = playerWon ? BLOOD_MATCH_WIN_XP : getBloodMatchLossParticipationXp();
      const baseTokenDelta = playerWon ? BLOOD_MATCH_WIN_TOKENS : BLOOD_MATCH_LOSS_TOKENS;
      const xpAwardSummary = applyXpAwardToProfile(
        workingProfile,
        baseXpDelta,
        baseTokenDelta
      );
      workingProfile = xpAwardSummary.profile;
      const chestGrants = [];
      if (
        rollBasicChest(playerWon ? "win" : "loss", {
          mode: "pve",
          difficulty: "normal",
          random: this.random
        })
      ) {
        workingProfile = grantChest(workingProfile, { amount: 1 });
        chestGrants.push({ chestType: DEFAULT_CHEST_TYPE, amount: 1 });
      }
      const latestBattle = buildBloodMatchLatestBattleSummary(summary, bloodMatchStats, nowMs);
      workingProfile = applyRecentBattleSummary(workingProfile, latestBattle);
      const unlockedDefinitions = evaluateBloodMatchAchievements({
        profileBefore,
        profileAfter: workingProfile,
        bloodMatchStats
      });
      const withAchievements = applyAchievementUnlocks(workingProfile, unlockedDefinitions);
      workingProfile = withAchievements.profile;
      const unlockEvents = withAchievements.unlockEvents;

      await this.profiles.updateProfile(username, workingProfile);
      const committedProfile = await this.profiles.getProfile(username);
      if (!committedProfile) {
        throw new Error(`Failed to reload committed profile for ${username}.`);
      }

      const matchXpDelta = xpAwardSummary.xpDelta;
      const matchTokenDelta = baseTokenDelta;
      const saveEntry = {
        id: `save-${Date.now()}`,
        recordedAt: new Date(nowMs).toISOString(),
        username,
        perspective: "player",
        mode: "bloodMatch",
        settlementKey: effectiveSettlementKey,
        winner: bloodMatchStats.winnerId ?? null,
        rounds: safeRuntimeCount(summary.round, 0),
        endReason: bloodMatchStats.endReason || null,
        stats: bloodMatchStats,
        unlockedAchievements: unlockEvents,
        grantedCosmetics: [],
        chestGrants,
        dailyRewards: [],
        weeklyRewards: [],
        tokenDelta: xpAwardSummary.tokenDelta,
        xpConversionTokenBonus: xpAwardSummary.xpConversionTokenBonus ?? 0,
        overflowXp: xpAwardSummary.overflowXp ?? 0,
        matchTokenDelta,
        challengeTokenDelta: 0,
        matchXpDelta,
        challengeXpDelta: 0,
        xpDelta: matchXpDelta,
        xpBreakdown: {
          lines:
            matchXpDelta > 0
              ? [{ key: "blood_match", label: "Blood Match", amount: matchXpDelta }]
              : [],
          total: matchXpDelta
        },
        boostDisplay: null,
        levelRewards: xpAwardSummary.levelRewards,
        levelRewardTokenDelta: xpAwardSummary.levelRewardTokenDelta,
        latestBattle
      };

      await this.saves.appendMatchResult(saveEntry);

      return {
        profile: committedProfile,
        cosmetics: {
          equipped: committedProfile.equippedCosmetics,
          owned: committedProfile.ownedCosmetics,
          catalog: getCosmeticCatalogForProfile(committedProfile)
        },
        profileAchievements: buildAchievementView(committedProfile),
        unlockedAchievements: unlockEvents,
        grantedCosmetics: [],
        chestGrants,
        dailyChallenges: getDailyChallengesView(committedProfile).view.daily,
        weeklyChallenges: getDailyChallengesView(committedProfile).view.weekly,
        xp: getLevelProgress(committedProfile),
        dailyRewards: [],
        weeklyRewards: [],
        tokenDelta: xpAwardSummary.tokenDelta,
        xpConversionTokenBonus: xpAwardSummary.xpConversionTokenBonus ?? 0,
        overflowXp: xpAwardSummary.overflowXp ?? 0,
        matchTokenDelta,
        challengeTokenDelta: 0,
        matchXpDelta,
        challengeXpDelta: 0,
        xpDelta: matchXpDelta,
        xpBreakdown: saveEntry.xpBreakdown,
        boostDisplay: null,
        levelBefore: xpAwardSummary.levelBefore,
        levelAfter: xpAwardSummary.levelAfter,
        levelRewards: xpAwardSummary.levelRewards,
        levelRewardTokenDelta: xpAwardSummary.levelRewardTokenDelta,
        save: saveEntry,
        stats: bloodMatchStats
      };
    });
  }

  async recordMatchResult({
    username,
    matchState,
    perspective = "p1",
    settlementKey = null,
    latestBattleContext = null,
    rewardPolicy = null,
    nowMs = Date.now()
  }) {
    return this.runMatchPersistence(async () => {
      if (!username) {
        throw new Error("username is required to record match results.");
      }

      if (!matchState || matchState.status !== "completed") {
        throw new Error("matchState must be completed before recording results.");
      }

      const safeMatchState = containRuntimeMatchSummaryState(matchState).value;
      const profileBefore = await this.profiles.ensureProfile(username);
      const derivedMatchStats = deriveMatchStats(safeMatchState, perspective);
      const localHotseatPolicy =
        String(safeMatchState.mode ?? "").trim().toLowerCase() === "local_pvp" &&
        String(rewardPolicy?.type ?? "").trim().toLowerCase() === "local_hotseat_casual";
      const localPvpRewardTracking = localHotseatPolicy
        ? getLocalPvpRewardTracking(profileBefore, nowMs)
        : null;
      const localHotseatRewardEligible = !localHotseatPolicy || localPvpRewardTracking?.rewardEligible === true;
      const practiceMode =
        String(safeMatchState.mode ?? "") === "pve" &&
        String(safeMatchState.difficulty ?? "").trim().toLowerCase() === "easy";
      const statWrite = guardRuntimeStatWritePayload({
        mode: safeMatchState.mode,
        fallbackMode: "pve",
        matchStats: practiceMode ? createZeroMatchStats(derivedMatchStats) : derivedMatchStats
      });
      const matchStats = statWrite.matchStats;
      const mode = statWrite.mode ?? "pve";
      const effectiveSettlementKey = normalizeSettlementKey(settlementKey);
      const existingSaves = await this.saves.listMatchResults();
      const duplicateSave = effectiveSettlementKey
        ? existingSaves.find(
            (entry) =>
              entry?.username === username &&
              entry?.mode === mode &&
              entry?.settlementKey === effectiveSettlementKey
          ) ?? null
        : null;
      if (duplicateSave) {
        if (
          duplicateSave.winner !== safeMatchState.winner ||
          safeRuntimeCount(duplicateSave.rounds, 0) !== safeRuntimeCount(safeMatchState.round, 0)
        ) {
          console.warn("[RuntimeEdgeGuard] contained stale runtime payload");
        }
        console.warn("[RuntimeEdgeGuard] skipped duplicate stat/result application");
        const committedProfile = await this.profiles.ensureProfile(username);
        return {
          duplicate: true,
          profile: committedProfile,
          save: duplicateSave,
          stats: duplicateSave.stats ?? matchStats,
          dailyChallenges: getDailyChallengesView(committedProfile).view.daily,
          weeklyChallenges: getDailyChallengesView(committedProfile).view.weekly,
          xp: getLevelProgress(committedProfile),
          dailyRewards: [],
          weeklyRewards: [],
          tokenDelta: 0,
          matchTokenDelta: 0,
          challengeTokenDelta: 0,
          matchXpDelta: 0,
          challengeXpDelta: 0,
          xpDelta: 0,
          xpConversionTokenBonus: 0,
          overflowXp: 0,
          xpBreakdown: { lines: [], total: 0 },
          levelBefore: committedProfile.playerLevel ?? 1,
          levelAfter: committedProfile.playerLevel ?? 1,
          levelRewards: [],
          levelRewardTokenDelta: 0
        };
      }
      const achievementsDisabledForMatch = practiceMode || localHotseatPolicy;

      console.info("[StateCoordinator] recordMatchResult:before", {
        mode,
        perspective,
        ...profileCommitSnapshot(profileBefore)
      });

      const profileWithStats = practiceMode
        ? profileBefore
        : statWrite.skipped
        ? (console.warn("[RuntimeGuard] skipped stat write due to unresolved mode"),
          profileBefore)
        : await this.profiles.applyMatchStats(username, matchStats, mode, {
            resetWinStreakOnDraw: true
          });

      console.info("[StateCoordinator] recordMatchResult:after-stats", {
        mode,
        perspective,
        matchStats,
        ...profileCommitSnapshot(profileWithStats)
      });

      const isQuitForfeit = String(safeMatchState.endReason ?? "") === "quit_forfeit";
      const activeBoostEvent = await this.getActiveBoostEvent();

      const challengeResult = applyDailyChallengesForMatch({
        profile: profileWithStats,
        matchState: safeMatchState,
        perspective,
        matchStats,
        options: {
          includeMatchRewards: !practiceMode && localHotseatRewardEligible,
          practiceMode,
          boostEvent: activeBoostEvent,
          allowChallengeProgress: localHotseatRewardEligible,
          allowCompletionChests: !localHotseatPolicy,
          localPvpWhitelistOnly: localHotseatPolicy
        },
        nowMs
      });

      let workingProfile = challengeResult.profile;
      const featuredRivalRewardResult = practiceMode
        ? {
            profile: workingProfile,
            reward: {
              rivalId: null,
              granted: false,
              xpDelta: 0,
              tokenDelta: 0,
              xpConversionTokenBonus: 0,
              overflowXp: 0,
              label: null,
              rewardDateKey: null
            }
          }
        : maybeApplyFeaturedRivalWinReward(workingProfile, {
            matchState: safeMatchState,
            perspective
          });
      workingProfile = featuredRivalRewardResult.profile;
      const featuredRivalReward = featuredRivalRewardResult.reward;
      const featuredRivalXpDelta = Math.max(0, Number(featuredRivalReward.xpDelta ?? 0));
      const featuredRivalTokenDelta = Math.max(0, Number(featuredRivalReward.tokenDelta ?? 0));
      const featuredRivalXpConversionTokenBonus = Math.max(
        0,
        Number(featuredRivalReward.xpConversionTokenBonus ?? 0)
      );
      if (featuredRivalXpDelta > 0) {
        challengeResult.xpBreakdown = {
          ...challengeResult.xpBreakdown,
          lines: [
            ...challengeResult.xpBreakdown.lines,
            {
              key: `featured_rival_${featuredRivalReward.rivalId}_daily_win_bonus`,
              label: featuredRivalReward.label,
              amount: featuredRivalXpDelta
            }
          ],
          total: Math.max(0, Number(challengeResult.xpBreakdown.total ?? 0)) + featuredRivalXpDelta
        };
      }
      challengeResult.tokenDelta += featuredRivalTokenDelta + featuredRivalXpConversionTokenBonus;
      challengeResult.xpDelta += featuredRivalXpDelta;
      challengeResult.xpConversionTokenBonus = Math.max(
        0,
        Number(challengeResult.xpConversionTokenBonus ?? 0)
      ) + featuredRivalXpConversionTokenBonus;
      challengeResult.overflowXp = Math.max(0, Number(challengeResult.overflowXp ?? 0)) +
        Math.max(0, Number(featuredRivalReward.overflowXp ?? 0));
      challengeResult.levelAfter = deriveLevelFromXp(Math.max(0, Number(workingProfile.playerXP ?? 0)));
      const streakChestGrantResult = practiceMode || localHotseatPolicy
        ? { profile: workingProfile }
        : applyWinStreakChestGrants(workingProfile, {
            previousWinStreak: profileBefore?.winStreak ?? 0,
            nextWinStreak: profileWithStats?.winStreak ?? workingProfile?.winStreak ?? 0
          });
      workingProfile = streakChestGrantResult.profile;
      const levelRewardResult = practiceMode
        ? { profile: workingProfile, grantedRewards: [], tokenDelta: 0 }
        : applyLevelRewardsForLevelChange(workingProfile, {
            fromLevel: challengeResult.levelBefore,
            toLevel: challengeResult.levelAfter
          });
      workingProfile = levelRewardResult.profile;

      const matchOutcome =
        safeMatchState.winner === perspective
          ? "win"
          : safeMatchState.winner === "draw"
            ? "draw"
            : safeMatchState.winner
              ? "loss"
              : null;

      if (
        !practiceMode &&
        !localHotseatPolicy &&
        rollBasicChest(matchOutcome, {
          mode,
          difficulty: safeMatchState.difficulty,
          random: this.random
        })
      ) {
        workingProfile = grantChest(workingProfile, { amount: 1 });
      }

      let unlockEvents = [];
      let grantedRewards = [];

      if (!isQuitForfeit && !achievementsDisabledForMatch) {
        const unlockedDefinitions = evaluateAchievements({
          profileBefore,
          profileAfter: workingProfile,
          matchState: safeMatchState,
          perspective,
          matchStats
        });

        const withAchievements = applyAchievementUnlocks(workingProfile, unlockedDefinitions);
        const withCosmetics = applyAchievementCosmeticRewards(
          withAchievements.profile,
          withAchievements.unlockEvents
        );
        const withTokens = applyAchievementTokenRewards(
          withCosmetics.profile,
          withAchievements.unlockEvents
        );

        workingProfile = withTokens.profile;
        unlockEvents = withAchievements.unlockEvents;
        grantedRewards = withCosmetics.grantedRewards;
      }

      if (localHotseatPolicy) {
        workingProfile = {
          ...workingProfile,
          localPvpRewardTracking: buildNextLocalPvpRewardTracking(profileBefore, {
            rewardedMatchApplied: localHotseatRewardEligible,
            nowMs
          })
        };
      }

      workingProfile = applyLongestMatchCandidate(
        workingProfile,
        buildLongestMatchCandidate({
          matchState: safeMatchState,
          perspective,
          practiceMode,
          nowMs
        })
      );
      const latestBattle = buildLatestBattleSummary({
        matchState: safeMatchState,
        perspective,
        matchStats,
        context: latestBattleContext,
        nowMs
      });
      workingProfile = applyRecentBattleSummary(workingProfile, latestBattle);

      const shouldPersistProfile = !profilesEqual(workingProfile, profileWithStats);
      if (shouldPersistProfile) {
        await this.profiles.updateProfile(username, workingProfile);
      }

      const committedProfile = await this.profiles.getProfile(username);

      if (!committedProfile) {
        throw new Error(`Failed to reload committed profile for ${username}.`);
      }

      console.info("[StateCoordinator] recordMatchResult:committed", {
        mode,
        perspective,
        shouldPersistProfile,
        ...profileCommitSnapshot(committedProfile)
      });

      const saveEntry = {
        id: `save-${Date.now()}`,
        recordedAt: new Date().toISOString(),
        username,
        perspective,
        mode,
        settlementKey: effectiveSettlementKey,
        winner: safeMatchState.winner,
        rounds: safeMatchState.round,
        endReason: safeMatchState.endReason ?? null,
        stats: matchStats,
        unlockedAchievements: unlockEvents,
        grantedCosmetics: grantedRewards,
        dailyRewards: challengeResult.rewards.daily,
        weeklyRewards: challengeResult.rewards.weekly,
        tokenDelta: challengeResult.tokenDelta,
        xpConversionTokenBonus: challengeResult.xpConversionTokenBonus ?? 0,
        overflowXp: challengeResult.overflowXp ?? 0,
        featuredRivalReward,
        matchTokenDelta: challengeResult.matchTokenDelta,
        challengeTokenDelta: challengeResult.challengeTokenDelta,
        matchXpDelta: challengeResult.matchXpDelta,
        challengeXpDelta: challengeResult.challengeXpDelta,
        xpDelta: challengeResult.xpDelta,
        xpBreakdown: challengeResult.xpBreakdown,
        boostDisplay: challengeResult.boostDisplay,
        levelRewards: levelRewardResult.grantedRewards,
        levelRewardTokenDelta: levelRewardResult.tokenDelta,
        history: safeMatchState.history
      };

      await this.saves.appendMatchResult(saveEntry);

      return {
        profile: committedProfile,
        cosmetics: {
          equipped: committedProfile.equippedCosmetics,
          owned: committedProfile.ownedCosmetics,
          catalog: getCosmeticCatalogForProfile(committedProfile)
        },
        profileAchievements: buildAchievementView(committedProfile),
        unlockedAchievements: unlockEvents,
        grantedCosmetics: grantedRewards,
        dailyChallenges: getDailyChallengesView(committedProfile).view.daily,
        weeklyChallenges: getDailyChallengesView(committedProfile).view.weekly,
        xp: getLevelProgress(committedProfile),
        dailyRewards: challengeResult.rewards.daily,
        weeklyRewards: challengeResult.rewards.weekly,
        tokenDelta: challengeResult.tokenDelta,
        xpConversionTokenBonus: challengeResult.xpConversionTokenBonus ?? 0,
        overflowXp: challengeResult.overflowXp ?? 0,
        featuredRivalReward,
        matchTokenDelta: challengeResult.matchTokenDelta,
        challengeTokenDelta: challengeResult.challengeTokenDelta,
        matchXpDelta: challengeResult.matchXpDelta,
        challengeXpDelta: challengeResult.challengeXpDelta,
        xpDelta: challengeResult.xpDelta,
        xpBreakdown: challengeResult.xpBreakdown,
        boostDisplay: challengeResult.boostDisplay,
        levelBefore: challengeResult.levelBefore,
        levelAfter: challengeResult.levelAfter,
        levelRewards: levelRewardResult.grantedRewards,
        levelRewardTokenDelta: levelRewardResult.tokenDelta,
        localPvpRewardStatus: localHotseatPolicy
          ? {
              rewardWindowKey: localPvpRewardTracking?.rewardWindowKey ?? getLocalPvpRewardWindowKey(nowMs),
              rewardCap: localPvpRewardTracking?.rewardCap ?? LOCAL_PVP_DAILY_REWARD_CAP,
              rewardedMatches: workingProfile?.localPvpRewardTracking?.rewardedMatches ?? 0,
              rewardEligible: localHotseatRewardEligible,
              capped: !localHotseatRewardEligible,
              chestsAwarded: false,
              challengeWhitelistApplied: true
            }
          : null,
        save: saveEntry,
        stats: matchStats
      };
    });
  }

  async recordLocalHotseatResult({
    username,
    matchState,
    perspective = "p1",
    settlementKey = null,
    latestBattleContext = null,
    nowMs = Date.now()
  }) {
    return this.recordMatchResult({
      username,
      matchState,
      perspective,
      settlementKey,
      latestBattleContext,
      rewardPolicy: {
        type: "local_hotseat_casual"
      },
      nowMs
    });
  }

  async recordOnlineMatchResult({
    username,
    matchState,
    perspective = "p1",
    settlementKey,
    latestBattleContext = null,
    nowMs = Date.now()
  }) {
    return this.runMatchPersistence(async () => {
      if (!username) {
        throw new Error("username is required to record online match results.");
      }

      if (!matchState || matchState.status !== "completed") {
        throw new Error("matchState must be completed before recording online results.");
      }

      const safeMatchState = containRuntimeMatchSummaryState(matchState).value;
      const statWrite = guardRuntimeStatWritePayload({
        mode: safeMatchState.mode,
        fallbackMode: "online_pvp",
        matchStats: deriveMatchStats(safeMatchState, perspective)
      });
      const mode = statWrite.mode ?? "online_pvp";
      const effectiveSettlementKey = String(settlementKey ?? "").trim();
      const existingSaves = await this.saves.listMatchResults();
      const duplicateSave = effectiveSettlementKey
        ? existingSaves.find(
            (entry) =>
              entry?.username === username &&
              entry?.mode === mode &&
              entry?.settlementKey === effectiveSettlementKey
          ) ?? null
        : null;

      if (duplicateSave) {
        if (
          duplicateSave.winner !== safeMatchState.winner ||
          safeRuntimeCount(duplicateSave.rounds, 0) !== safeRuntimeCount(safeMatchState.round, 0)
        ) {
          console.warn("[RuntimeEdgeGuard] contained stale runtime payload");
        }
        console.warn("[RuntimeEdgeGuard] skipped duplicate stat/result application");
        const committedProfile = await this.profiles.ensureProfile(username);
        return {
          duplicate: true,
          profile: committedProfile,
          save: duplicateSave,
          stats: duplicateSave.stats ?? statWrite.matchStats
        };
      }

      const matchStats = {
        ...statWrite.matchStats,
        matchesUsingAllElements: 0,
        quickWins: 0,
        timeLimitWins: 0
      };
      const profileBefore = await this.profiles.ensureProfile(username);
      const profileWithStats = statWrite.skipped
        ? (console.warn("[RuntimeGuard] skipped stat write due to unresolved mode"),
          profileBefore)
        : await this.profiles.applyMatchStats(username, matchStats, mode, {
            resetWinStreakOnDraw: true
          });
      const challengeResult = applyDailyChallengesForMatch({
        profile: profileWithStats,
        matchState: safeMatchState,
        perspective,
        matchStats,
        options: {
          includeMatchRewards: false
        }
      });

      let workingProfile = challengeResult.profile;
      const streakChestGrantResult = applyWinStreakChestGrants(workingProfile, {
        previousWinStreak: profileBefore?.winStreak ?? 0,
        nextWinStreak: profileWithStats?.winStreak ?? workingProfile?.winStreak ?? 0
      });
      workingProfile = streakChestGrantResult.profile;
      const levelRewardResult = applyLevelRewardsForLevelChange(workingProfile, {
        fromLevel: challengeResult.levelBefore,
        toLevel: challengeResult.levelAfter
      });
      workingProfile = levelRewardResult.profile;
      workingProfile = applyLongestMatchCandidate(
        workingProfile,
        buildLongestMatchCandidate({
          matchState: safeMatchState,
          perspective
        })
      );
      const latestBattle = buildLatestBattleSummary({
        matchState: safeMatchState,
        perspective,
        matchStats,
        context: latestBattleContext,
        nowMs
      });
      workingProfile = applyRecentBattleSummary(workingProfile, latestBattle);
      workingProfile = applyRecentOpponentSummary(
        workingProfile,
        latestBattle,
        latestBattleContext,
        effectiveSettlementKey
      );

      const isQuitForfeit = String(safeMatchState.endReason ?? "") === "quit_forfeit";
      let unlockEvents = [];
      let grantedRewards = [];

      if (!isQuitForfeit) {
        const unlockedDefinitions = evaluateAchievements({
          profileBefore,
          profileAfter: workingProfile,
          matchState: safeMatchState,
          perspective,
          matchStats
        });

        const withAchievements = applyAchievementUnlocks(workingProfile, unlockedDefinitions);
        const withCosmetics = applyAchievementCosmeticRewards(
          withAchievements.profile,
          withAchievements.unlockEvents
        );
        const withTokens = applyAchievementTokenRewards(
          withCosmetics.profile,
          withAchievements.unlockEvents
        );

        workingProfile = withTokens.profile;
        unlockEvents = withAchievements.unlockEvents;
        grantedRewards = withCosmetics.grantedRewards;
      }

      const shouldPersistProfile = !profilesEqual(workingProfile, profileWithStats);
      if (shouldPersistProfile) {
        await this.profiles.updateProfile(username, workingProfile);
      }

      const profile = await this.profiles.getProfile(username);
      if (!profile) {
        throw new Error(`Failed to reload committed online profile for ${username}.`);
      }

      const saveEntry = {
        id: `save-${Date.now()}`,
        recordedAt: new Date().toISOString(),
        username,
        perspective,
        mode,
        settlementKey: effectiveSettlementKey || null,
        winner: safeMatchState.winner,
        rounds: safeMatchState.round,
        endReason: safeMatchState.endReason ?? null,
        stats: matchStats,
        unlockedAchievements: unlockEvents,
        grantedCosmetics: grantedRewards,
        dailyRewards: challengeResult.rewards.daily,
        weeklyRewards: challengeResult.rewards.weekly,
        tokenDelta: challengeResult.tokenDelta,
        xpConversionTokenBonus: challengeResult.xpConversionTokenBonus ?? 0,
        overflowXp: challengeResult.overflowXp ?? 0,
        matchTokenDelta: 0,
        challengeTokenDelta: challengeResult.challengeTokenDelta,
        challengeXpDelta: challengeResult.challengeXpDelta,
        xpDelta: challengeResult.xpDelta,
        xpBreakdown: challengeResult.xpBreakdown,
        levelRewards: levelRewardResult.grantedRewards,
        levelRewardTokenDelta: levelRewardResult.tokenDelta,
        history: safeMatchState.history
      };

      await this.saves.appendMatchResult(saveEntry);

      return {
        duplicate: false,
        profile,
        save: saveEntry,
        stats: matchStats,
        profileAchievements: buildAchievementView(profile),
        unlockedAchievements: unlockEvents,
        grantedCosmetics: grantedRewards,
        dailyChallenges: getDailyChallengesView(profile).view.daily,
        weeklyChallenges: getDailyChallengesView(profile).view.weekly,
        dailyRewards: challengeResult.rewards.daily,
        weeklyRewards: challengeResult.rewards.weekly,
        tokenDelta: challengeResult.tokenDelta,
        xpConversionTokenBonus: challengeResult.xpConversionTokenBonus ?? 0,
        overflowXp: challengeResult.overflowXp ?? 0,
        challengeTokenDelta: challengeResult.challengeTokenDelta,
        challengeXpDelta: challengeResult.challengeXpDelta,
        xpDelta: challengeResult.xpDelta,
        xpBreakdown: challengeResult.xpBreakdown,
        levelBefore: challengeResult.levelBefore,
        levelAfter: challengeResult.levelAfter,
        levelRewards: levelRewardResult.grantedRewards,
        levelRewardTokenDelta: levelRewardResult.tokenDelta
      };
    });
  }

  async recordGauntletStats({
    username,
    runStarted = false,
    matchWon = false,
    runEndedWithLoss = false,
    currentStreak = 0,
    claimedMilestoneStreaks = [],
    matchState = null,
    latestBattleContext = null,
    battleReportAlreadyRecorded = false,
    perspective = "p1",
    nowMs = Date.now()
  } = {}) {
    return this.runMatchPersistence(async () => {
      if (!username) {
        throw new Error("username is required to record gauntlet stats.");
      }

      const safeCurrentStreak = Math.max(0, Math.floor(Number(currentStreak ?? 0) || 0));
      const normalizedClaimedMilestoneStreaks =
        normalizeGauntletClaimedMilestoneStreaks(claimedMilestoneStreaks);
      let gauntletRewardSummary = {
        claimedMilestoneStreaks: normalizedClaimedMilestoneStreaks,
        milestoneRewards: [],
        xpDelta: 0,
        tokenDelta: 0,
        xpConversionTokenBonus: 0,
        overflowXp: 0,
        chestGrants: [],
        levelBefore: 1,
        levelAfter: 1,
        levelRewards: [],
        levelRewardTokenDelta: 0
      };
      const profile = await this.profiles.updateProfile(username, (current) => {
        const nextRuns = Math.max(0, Number(current?.gauntletRuns ?? 0)) + (runStarted ? 1 : 0);
        const nextWins = Math.max(0, Number(current?.gauntletWins ?? 0)) + (matchWon ? 1 : 0);
        const nextLosses =
          Math.max(0, Number(current?.gauntletLosses ?? 0)) + (runEndedWithLoss ? 1 : 0);
        const nextRivalsDefeated =
          Math.max(0, Number(current?.gauntletRivalsDefeated ?? 0)) + (matchWon ? 1 : 0);
        const nextBestStreak = matchWon
          ? Math.max(Math.max(0, Number(current?.gauntletBestStreak ?? 0)), safeCurrentStreak)
          : Math.max(0, Number(current?.gauntletBestStreak ?? 0));

        let nextProfile = {
          ...current,
          gauntletBestStreak: nextBestStreak,
          gauntletRuns: nextRuns,
          gauntletWins: nextWins,
          gauntletLosses: nextLosses,
          gauntletRivalsDefeated: nextRivalsDefeated
        };

        if (matchWon) {
          gauntletRewardSummary = applyGauntletMilestoneRewards(nextProfile, {
            currentStreak: safeCurrentStreak,
            claimedMilestoneStreaks: normalizedClaimedMilestoneStreaks
          });
          nextProfile = gauntletRewardSummary.profile;
        } else {
          gauntletRewardSummary = {
            claimedMilestoneStreaks: normalizedClaimedMilestoneStreaks,
            milestoneRewards: [],
            xpDelta: 0,
            tokenDelta: 0,
            xpConversionTokenBonus: 0,
            overflowXp: 0,
            chestGrants: [],
            levelBefore: Math.max(1, Number(nextProfile?.playerLevel ?? getLevelProgress(nextProfile).level ?? 1)),
            levelAfter: Math.max(1, Number(nextProfile?.playerLevel ?? getLevelProgress(nextProfile).level ?? 1)),
            levelRewards: [],
            levelRewardTokenDelta: 0
          };
        }

        const latestBattle = buildLatestBattleSummary({
          matchState,
          perspective,
          matchStats: matchState ? deriveMatchStats(matchState, perspective) : null,
          context: latestBattleContext,
          nowMs
        });
        if (latestBattle && !battleReportAlreadyRecorded) {
          nextProfile = applyRecentBattleSummary(nextProfile, latestBattle);
        }

        return nextProfile;
      });

      return {
        profile,
        gauntletStats: buildGauntletStatsSnapshot(profile),
        claimedMilestoneStreaks: gauntletRewardSummary.claimedMilestoneStreaks,
        milestoneRewards: gauntletRewardSummary.milestoneRewards,
        xpDelta: gauntletRewardSummary.xpDelta,
        tokenDelta: gauntletRewardSummary.tokenDelta,
        xpConversionTokenBonus: gauntletRewardSummary.xpConversionTokenBonus ?? 0,
        overflowXp: gauntletRewardSummary.overflowXp ?? 0,
        chestGrants: gauntletRewardSummary.chestGrants,
        levelBefore: gauntletRewardSummary.levelBefore,
        levelAfter: gauntletRewardSummary.levelAfter,
        levelRewards: gauntletRewardSummary.levelRewards,
        levelRewardTokenDelta: gauntletRewardSummary.levelRewardTokenDelta
      };
    });
  }

  async getAchievements(username) {
    const profile = await this.profiles.ensureProfile(username);
    return {
      achievements: buildAchievementCatalog(profile)
    };
  }

  async getDailyChallenges(username, nowMs = Date.now()) {
    const profile = await this.profiles.ensureProfile(username);
    const result = getDailyChallengesView(profile, nowMs);

    const nextProfile = result.didReset
      ? await this.profiles.updateProfile(username, result.profile)
      : profile;

    const nextView = getDailyChallengesView(nextProfile, nowMs);

    return {
      daily: nextView.view.daily,
      weekly: nextView.view.weekly,
      dailyLogin: getDailyLoginStatus(nextProfile, nowMs),
      tokens: nextProfile.tokens ?? 0,
      xp: nextView.level
    };
  }

  async getStore(username) {
    const profile = await this.ensureUniqueCosmeticAcquisitions(username);
    const records = await this.specialCosmeticRegistry.listRecords();
    return getStoreViewForProfile(profile, { specialRecords: records });
  }

  async getCollectionPackDeals(username) {
    const safeUsername = String(username ?? "").trim();
    if (!safeUsername) {
      throw new Error("username is required for Collection Pack deals.");
    }

    const profile = await this.profiles.getProfile(safeUsername);
    const ownedCosmeticIds = getOwnedCollectionPackCosmeticIds(profile);
    const now = this.collectionPackStore.now();
    const packs = await this.collectionPackStore.listPacks();

    return packs
      .filter((pack) => isCollectionPackInPlayerWindow(pack, { now }))
      .map((pack) => {
        const pricePlan = calculateCollectionPackPriceForOwnedCosmetics(
          pack,
          ownedCosmeticIds,
          { now }
        );
        return sanitizeCollectionPackDeal(pack, pricePlan);
      });
  }

  async getDailyElementChestStatus(username, nowMs = Date.now()) {
    const profile = await this.profiles.ensureProfile(username);
    return getDailyElementChestStatus(profile, nowMs);
  }

  async acknowledgeAnnouncement({ username, key }) {
    const safeKey = String(key ?? "").trim();
    if (!safeKey) {
      throw new Error("Announcement key is required.");
    }

    const profile = await this.profiles.updateProfile(username, (current) => ({
      ...current,
      seenAnnouncements: {
        ...(current?.seenAnnouncements ?? {}),
        [safeKey]: true
      }
    }));

    return {
      key: safeKey,
      seen: Boolean(profile?.seenAnnouncements?.[safeKey]),
      profile
    };
  }

  async resolveUniqueRoyaltyPlan({ record, price, transactionId }) {
    const recipientUsername = String(record?.royalty?.recipientUsername ?? "").trim();
    const recipientProfile =
      record?.royalty?.enabled === true && recipientUsername
        ? await this.profiles.getProfile(recipientUsername)
        : null;
    return buildUniqueRoyaltyPlan({
      record,
      price,
      recipientProfile,
      transactionId
    });
  }

  async applyUniquePurchaseProfiles({
    buyerUsername,
    type,
    cosmeticId,
    price,
    transactionId,
    royaltyPlan
  }) {
    let purchaseResult = null;
    const recipientUsername = royaltyPlan.amount > 0
      ? royaltyPlan.recipientUsername
      : buyerUsername;
    const committed = await this.profiles.updateProfilesAtomically(
      [buyerUsername, recipientUsername],
      (profiles) => {
        const buyerCurrent = profiles[buyerUsername];
        const recipientCurrent = profiles[recipientUsername];
        const alreadyPaid = recipientCurrent.storeRoyaltyPayouts?.appliedTransactionIds?.includes(
          transactionId
        );
        purchaseResult = buyConfiguredUniqueStoreItem(buyerCurrent, {
          type,
          cosmeticId,
          price
        });

        let buyerNext = purchaseResult.profile;
        let recipientNext = recipientCurrent;
        if (royaltyPlan.amount > 0 && !alreadyPaid) {
          const appliedTransactionIds = [
            ...(recipientCurrent.storeRoyaltyPayouts?.appliedTransactionIds ?? []),
            transactionId
          ].slice(-100);
          recipientNext = {
            ...recipientCurrent,
            tokens: Math.max(0, Number(recipientCurrent.tokens ?? 0)) + royaltyPlan.amount,
            storeRoyaltyPayouts: { appliedTransactionIds }
          };
          if (recipientUsername === buyerUsername) {
            buyerNext = {
              ...buyerNext,
              tokens: Math.max(0, Number(buyerNext.tokens ?? 0)) + royaltyPlan.amount,
              storeRoyaltyPayouts: { appliedTransactionIds }
            };
          }
        }

        return recipientUsername === buyerUsername
          ? { [buyerUsername]: buyerNext }
          : {
              [buyerUsername]: buyerNext,
              [recipientUsername]: recipientNext
            };
      }
    );

    return {
      profile: committed[buyerUsername],
      recipientProfile: royaltyPlan.amount > 0
        ? committed[royaltyPlan.recipientUsername]
        : null,
      purchaseResult
    };
  }

  async queueUniqueRoyaltyNotice({
    transactionId,
    recipientUsername,
    amount,
    cosmeticName
  }) {
    if (!recipientUsername || amount <= 0) {
      return "none";
    }
    const noticeTransactionId = `royalty:${transactionId}`;
    const start = await this.adminGrantStore.beginTransaction({
      transactionId: noticeTransactionId,
      timestamp: new Date().toISOString(),
      adminId: "store_purchase_authority",
      targetUsername: recipientUsername,
      grantType: "unique_store_royalty",
      payload: {
        xp: 0,
        tokens: amount,
        chests: [],
        cosmetic: null,
        noticeMessage:
          `EleMintz has sent you ${amount} Tokens from purchases of Unique cosmetic: ${cosmeticName}.`
      }
    });
    if (!start.duplicate) {
      await this.adminGrantStore.finalizeTransaction({
        transactionId: noticeTransactionId,
        status: "success",
        result: {
          noticeMessage:
            `EleMintz has sent you ${amount} Tokens from purchases of Unique cosmetic: ${cosmeticName}.`
        },
        confirmationStatus: "player_offline",
        error: null
      });
    }
    return "queued";
  }

  async completeUniqueStorePurchase({ username, type, cosmeticId, transactionId }) {
    const safeTransactionId = normalizeStorePurchaseTransactionId(transactionId);
    if (!safeTransactionId) {
      throw new Error("A valid transactionId is required for Unique purchases.");
    }

    return this.runUniquePurchaseTransaction(async () => {
      const existing = await this.storePurchaseLedger.getByTransactionId(safeTransactionId);
      if (existing) {
        if (
          existing.buyerUsername !== username ||
          existing.cosmeticType !== type ||
          existing.cosmeticId !== cosmeticId
        ) {
          throw new Error("transactionId was already used for a different Store purchase.");
        }

        await this.storePurchaseLedger.markDuplicate(safeTransactionId);
        if (existing.status === "completed") {
          const profile = await this.profiles.getProfile(username);
          return {
            profile,
            purchase: {
              ...(existing.result?.purchase ?? {}),
              duplicate: true
            },
            tracking: existing.result?.tracking ?? null,
            royalty: existing.result?.royalty ?? null,
            transaction: {
              transactionId: safeTransactionId,
              status: "completed",
              duplicate: true
            },
            store: await this.getStore(username)
          };
        }
        if (existing.status === "rejected" || existing.status === "failed") {
          throw new Error(existing.error?.message ?? "Purchase failed; try again");
        }
        if (existing.status === "processing") {
          const profileBefore = await this.profiles.getProfile(username);
          const record = await this.specialCosmeticRegistry.getRecord(cosmeticId);
          const definition = getCosmeticDefinition(type, cosmeticId);
          if (!profileBefore || !record || !definition) {
            throw new Error("Purchase failed; try again");
          }
          const royaltyPlan = {
            enabled: existing.royaltyEnabled,
            recipientUsername: existing.royaltyRecipientUsername,
            tokenPercent: existing.royaltyTokenPercent,
            amount: existing.royaltyAmount,
            status: existing.royaltyAmount > 0 ? "paid" : existing.royaltyStatus === "skipped" ? "skipped" : "none"
          };

          if (profileBefore.ownedCosmetics?.[type]?.includes(cosmeticId)) {
            if (royaltyPlan.amount > 0) {
              const recipientProfile = await this.profiles.getProfile(
                royaltyPlan.recipientUsername
              );
              if (
                !recipientProfile?.storeRoyaltyPayouts?.appliedTransactionIds?.includes(
                  safeTransactionId
                )
              ) {
                throw new Error("Purchase recovery requires royalty payout review.");
              }
            }
            const royaltyNotificationStatus = await this.queueUniqueRoyaltyNotice({
              transactionId: safeTransactionId,
              recipientUsername: royaltyPlan.recipientUsername,
              amount: royaltyPlan.amount,
              cosmeticName: definition.name
            });
            const recoveredResult = {
              purchase: {
                status: "purchased",
                type,
                cosmeticId,
                price: existing.price,
                tokensLeft: profileBefore.tokens,
                duplicate: true
              },
              tracking: null,
              royalty: {
                enabled: royaltyPlan.enabled,
                recipientUsername: royaltyPlan.recipientUsername,
                tokenPercent: royaltyPlan.tokenPercent,
                amount: royaltyPlan.amount,
                status: royaltyPlan.status,
                notificationStatus: royaltyNotificationStatus
              }
            };
            await this.storePurchaseLedger.finalizeTransaction({
              transactionId: safeTransactionId,
              status: "completed",
              result: recoveredResult,
              updates: {
                royaltyStatus: royaltyPlan.status,
                royaltyPaidAt: royaltyPlan.amount > 0 ? new Date().toISOString() : null,
                royaltyNotificationStatus
              }
            });
            return {
              profile: profileBefore,
              ...recoveredResult,
              transaction: {
                transactionId: safeTransactionId,
                status: "completed",
                duplicate: true
              },
              store: await this.getStore(username)
            };
          }

          let reservation = {
            record,
            saleLimitSoldBefore: existing.saleLimitSoldBefore,
            saleLimitSoldAfter: existing.saleLimitSoldAfter
          };
          if (
            existing.saleLimitMode === "limited" &&
            record.saleLimitSold === existing.saleLimitSoldBefore
          ) {
            reservation = await this.specialCosmeticRegistry.reserveTokenPurchase(cosmeticId);
          } else if (
            existing.saleLimitMode === "limited" &&
            record.saleLimitSold !== existing.saleLimitSoldAfter
          ) {
            throw new Error("Purchase failed; inventory state requires review.");
          }

          let recoveredPurchase = null;
          let recoveredProfileCommitted = false;
          try {
            const appliedProfiles = await this.applyUniquePurchaseProfiles({
              buyerUsername: username,
              type,
              cosmeticId,
              price: existing.price,
              transactionId: safeTransactionId,
              royaltyPlan
            });
            const profile = appliedProfiles.profile;
            recoveredPurchase = appliedProfiles.purchaseResult;
            recoveredProfileCommitted = true;
            const royaltyNotificationStatus = await this.queueUniqueRoyaltyNotice({
              transactionId: safeTransactionId,
              recipientUsername: royaltyPlan.recipientUsername,
              amount: royaltyPlan.amount,
              cosmeticName: definition.name
            });
            const recoveredResult = {
              purchase: {
                ...recoveredPurchase.purchase,
                duplicate: true
              },
              tracking: recoveredPurchase.tracking,
              royalty: {
                enabled: royaltyPlan.enabled,
                recipientUsername: royaltyPlan.recipientUsername,
                tokenPercent: royaltyPlan.tokenPercent,
                amount: royaltyPlan.amount,
                status: royaltyPlan.status,
                notificationStatus: royaltyNotificationStatus
              }
            };
            await this.storePurchaseLedger.finalizeTransaction({
              transactionId: safeTransactionId,
              status: "completed",
              result: recoveredResult,
              updates: {
                royaltyStatus: royaltyPlan.status,
                royaltyPaidAt: royaltyPlan.amount > 0 ? new Date().toISOString() : null,
                royaltyNotificationStatus
              }
            });
            return {
              profile,
              ...recoveredResult,
              transaction: {
                transactionId: safeTransactionId,
                status: "completed",
                duplicate: true
              },
              store: await this.getStore(username)
            };
          } catch (error) {
            if (!recoveredProfileCommitted && reservation.record.saleLimitMode === "limited") {
              await this.specialCosmeticRegistry.rollbackTokenPurchaseReservation({
                cosmeticId,
                saleLimitSoldBefore: reservation.saleLimitSoldBefore,
                saleLimitSoldAfter: reservation.saleLimitSoldAfter
              });
            }
            throw error;
          }
        }
      }

      const definition = getCosmeticDefinition(type, cosmeticId);
      const profileBefore = await this.profiles.getProfile(username);
      const record = await this.specialCosmeticRegistry.getRecord(cosmeticId);
      let royaltyPlan = null;

      try {
        validateUniquePurchaseConfiguration({
          profile: profileBefore,
          definition,
          record,
          type,
          cosmeticId
        });
        royaltyPlan = await this.resolveUniqueRoyaltyPlan({
          record,
          price: record.price,
          transactionId: safeTransactionId
        });
      } catch (error) {
        const begun = await this.storePurchaseLedger.beginTransaction({
          transactionId: safeTransactionId,
          buyerUsername: username,
          cosmeticType: type,
          cosmeticId,
          price: record?.price ?? null,
          saleLimitMode: record?.saleLimitMode ?? "unlimited",
          saleLimitSoldBefore: record?.saleLimitSold ?? 0,
          saleLimitSoldAfter: record?.saleLimitSold ?? 0,
          royaltyEnabled: record?.royalty?.enabled === true,
          royaltyRecipientUsername: record?.royalty?.recipientUsername ?? null,
          royaltyTokenPercent: record?.royalty?.tokenPercent ?? 0,
          royaltyAmount: 0,
          royaltyStatus: "failed"
        });
        if (!begun.duplicate) {
          await this.storePurchaseLedger.finalizeTransaction({
            transactionId: safeTransactionId,
            status: "rejected",
            error: {
              code: "UNIQUE_PURCHASE_REJECTED",
              message: String(error?.message ?? "Unique purchase rejected.")
            }
          });
        }
        throw error;
      }

      const expectedSoldAfter =
        record.saleLimitMode === "limited" ? record.saleLimitSold + 1 : record.saleLimitSold;
      const begun = await this.storePurchaseLedger.beginTransaction({
        transactionId: safeTransactionId,
        buyerUsername: username,
        cosmeticType: type,
        cosmeticId,
        price: record.price,
        saleLimitMode: record.saleLimitMode,
        saleLimitSoldBefore: record.saleLimitSold,
        saleLimitSoldAfter: expectedSoldAfter,
        royaltyEnabled: royaltyPlan.enabled,
        royaltyRecipientUsername: royaltyPlan.recipientUsername,
        royaltyTokenPercent: royaltyPlan.tokenPercent,
        royaltyAmount: royaltyPlan.amount,
        royaltyStatus: royaltyPlan.amount > 0 ? "pending" : royaltyPlan.status,
        royaltyNotificationStatus: royaltyPlan.amount > 0 ? "pending" : "none"
      });
      if (begun.duplicate) {
        throw new Error("Purchase failed; try again");
      }

      let reservation = null;
      let purchaseResult = null;
      let profileCommitted = false;
      try {
        reservation = await this.specialCosmeticRegistry.reserveTokenPurchase(cosmeticId);
        const appliedProfiles = await this.applyUniquePurchaseProfiles({
          buyerUsername: username,
          type,
          cosmeticId,
          price: reservation.record.price,
          transactionId: safeTransactionId,
          royaltyPlan
        });
        const profile = appliedProfiles.profile;
        purchaseResult = appliedProfiles.purchaseResult;
        profileCommitted = true;
        const royaltyNotificationStatus = await this.queueUniqueRoyaltyNotice({
          transactionId: safeTransactionId,
          recipientUsername: royaltyPlan.recipientUsername,
          amount: royaltyPlan.amount,
          cosmeticName: definition.name
        });

        const ledgerResult = {
          purchase: purchaseResult.purchase,
          tracking: purchaseResult.tracking,
          royalty: {
            enabled: royaltyPlan.enabled,
            recipientUsername: royaltyPlan.recipientUsername,
            tokenPercent: royaltyPlan.tokenPercent,
            amount: royaltyPlan.amount,
            status: royaltyPlan.status,
            notificationStatus: royaltyNotificationStatus
          }
        };
        await this.storePurchaseLedger.finalizeTransaction({
          transactionId: safeTransactionId,
          status: "completed",
          result: ledgerResult,
          updates: {
            royaltyStatus: royaltyPlan.status,
            royaltyPaidAt: royaltyPlan.amount > 0 ? new Date().toISOString() : null,
            royaltyNotificationStatus
          }
        });

        return {
          profile,
          ...ledgerResult,
          transaction: {
            transactionId: safeTransactionId,
            status: "completed",
            duplicate: false
          },
          store: await this.getStore(username)
        };
      } catch (error) {
        if (!profileCommitted && reservation?.record?.saleLimitMode === "limited") {
          await this.specialCosmeticRegistry.rollbackTokenPurchaseReservation({
            cosmeticId,
            saleLimitSoldBefore: reservation.saleLimitSoldBefore,
            saleLimitSoldAfter: reservation.saleLimitSoldAfter
          });
        }

        if (!profileCommitted) {
          await this.storePurchaseLedger.finalizeTransaction({
            transactionId: safeTransactionId,
            status: "rejected",
            error: {
              code: "UNIQUE_PURCHASE_REJECTED",
              message: String(error?.message ?? "Unique purchase rejected.")
            }
          });
        }
        throw error;
      }
    });
  }

  async buyStoreItem({ username, type, cosmeticId, transactionId = null }) {
    const definition = getCosmeticDefinition(type, cosmeticId);
    if (definition?.rarity === "Unique") {
      return this.completeUniqueStorePurchase({
        username,
        type,
        cosmeticId,
        transactionId
      });
    }

    let purchaseResult = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      purchaseResult = buyStoreItem(current, { type, cosmeticId });
      return purchaseResult.profile;
    });

    return {
      profile,
      purchase: purchaseResult?.purchase,
      tracking: purchaseResult?.tracking,
      store: getStoreViewForProfile(profile)
    };
  }

  async buyCollectionPack({ username, packId, transactionId }) {
    const result = await this.completeCollectionPackPurchase({ username, packId, transactionId });
    return {
      ...result,
      deals: await this.getCollectionPackDeals(username)
    };
  }

  async completeCollectionPackPurchase({ username, packId, transactionId }) {
    const safeUsername = String(username ?? "").trim();
    const safePackId = String(packId ?? "").trim();
    const safeTransactionId = normalizeStorePurchaseTransactionId(transactionId);
    if (!safeUsername) {
      throw new Error("username is required for Collection Pack purchases.");
    }
    if (!safePackId) {
      throw new Error("packId is required for Collection Pack purchases.");
    }
    if (!safeTransactionId) {
      throw new Error("A valid transactionId is required for Collection Pack purchases.");
    }

    return this.runCollectionPackPurchaseTransaction(async () => {
      const existing = await this.storePurchaseLedger.getByTransactionId(safeTransactionId);
      if (existing) {
        if (
          existing.purchaseKind !== "collection_pack" ||
          existing.buyerUsername !== safeUsername ||
          existing.packId !== safePackId
        ) {
          throw new Error("transactionId was already used for a different Store purchase.");
        }

        await this.storePurchaseLedger.markDuplicate(safeTransactionId);
        if (existing.status === "completed") {
          const profile = await this.profiles.getProfile(safeUsername);
          return {
            profile,
            purchase: {
              ...(existing.result?.purchase ?? {}),
              duplicate: true
            },
            tracking: existing.result?.tracking ?? null,
            transaction: {
              transactionId: safeTransactionId,
              status: "completed",
              duplicate: true
            },
            store: getStoreViewForProfile(profile)
          };
        }
        if (existing.status === "rejected" || existing.status === "failed") {
          throw new Error(existing.error?.message ?? "Collection Pack purchase failed; try again");
        }
        if (existing.status === "processing") {
          const profile = await this.profiles.getProfile(safeUsername);
          if (profileOwnsAllCosmetics(profile, existing.grantedCosmeticIds)) {
            const recoveredResult = {
              purchase: {
                status: "purchased",
                kind: "collection_pack",
                packId: safePackId,
                cosmeticIds: existing.grantedCosmeticIds,
                grantedCosmeticIds: existing.grantedCosmeticIds,
                remainingNormalValue: existing.remainingNormalValue,
                discountPercent: existing.discountPercent,
                savings: existing.savings,
                price: existing.price,
                tokensLeft: profile.tokens,
                duplicate: true
              },
              tracking: null
            };
            await this.storePurchaseLedger.finalizeTransaction({
              transactionId: safeTransactionId,
              status: "completed",
              result: recoveredResult
            });
            return {
              profile,
              ...recoveredResult,
              transaction: {
                transactionId: safeTransactionId,
                status: "completed",
                duplicate: true
              },
              store: getStoreViewForProfile(profile)
            };
          }

          if (existing.saleLimitMode === "limited") {
            await this.collectionPackStore.rollbackPackPurchaseReservation({
              packId: safePackId,
              soldCountBefore: existing.saleLimitSoldBefore,
              soldCountAfter: existing.saleLimitSoldAfter
            });
          }
          await this.storePurchaseLedger.finalizeTransaction({
            transactionId: safeTransactionId,
            status: "rejected",
            error: {
              code: "COLLECTION_PACK_PURCHASE_REJECTED",
              message: "Collection Pack purchase recovery rolled back before profile settlement."
            }
          });
          throw new Error("Collection Pack purchase failed; try again");
        }
      }

      const now = this.collectionPackStore.now();
      const pack = await this.collectionPackStore.getPack(safePackId);
      validateCollectionPackPurchaseWindow(pack, { now });

      const expectedSoldAfter =
        pack.saleLimitMode === "limited" ? pack.soldCount + 1 : pack.soldCount;
      const begun = await this.storePurchaseLedger.beginTransaction({
        transactionId: safeTransactionId,
        purchaseKind: "collection_pack",
        buyerUsername: safeUsername,
        packId: safePackId,
        grantedCosmeticIds: [],
        remainingNormalValue: 0,
        discountPercent: 0,
        savings: 0,
        price: 0,
        saleLimitMode: pack.saleLimitMode,
        saleLimitSoldBefore: pack.soldCount,
        saleLimitSoldAfter: expectedSoldAfter,
        royaltyStatus: "none"
      });
      if (begun.duplicate) {
        throw new Error("Collection Pack purchase failed; try again");
      }

      let reservation = null;
      let profileCommitted = false;
      let purchaseResult = null;
      let settledPricePlan = null;
      try {
        reservation = await this.collectionPackStore.reservePackPurchase(safePackId);
        validateCollectionPackPurchaseWindow(reservation.record, {
          now,
          allowReservedLimitedSale: true
        });
        const profile = await this.profiles.updateProfile(safeUsername, (current) => {
          settledPricePlan = calculateCollectionPackPriceForOwnedCosmetics(
            reservation.record,
            getOwnedCollectionPackCosmeticIds(current),
            { now }
          );
          if (
            settledPricePlan.status === "complete" ||
            settledPricePlan.remainingCosmeticIds.length === 0
          ) {
            throw new Error("Collection Pack is already complete for this player.");
          }
          if (Number(current.tokens ?? 0) < settledPricePlan.finalPrice) {
            throw new Error(
              `Insufficient tokens. Need ${settledPricePlan.finalPrice}, have ${current.tokens}.`
            );
          }
          purchaseResult = buyCollectionPackItems(current, {
            packId: safePackId,
            remainingCosmeticIds: settledPricePlan.remainingCosmeticIds,
            price: settledPricePlan.finalPrice
          });
          return purchaseResult.profile;
        });
        profileCommitted = true;

        const ledgerResult = {
          purchase: {
            ...purchaseResult.purchase,
            grantedCosmeticIds: settledPricePlan.remainingCosmeticIds,
            remainingNormalValue: settledPricePlan.remainingNormalValue,
            discountPercent: settledPricePlan.discountPercent,
            savings: settledPricePlan.savings
          },
          tracking: purchaseResult.tracking
        };
        await this.storePurchaseLedger.finalizeTransaction({
          transactionId: safeTransactionId,
          status: "completed",
          result: ledgerResult,
          updates: {
            grantedCosmeticIds: settledPricePlan.remainingCosmeticIds,
            remainingNormalValue: settledPricePlan.remainingNormalValue,
            discountPercent: settledPricePlan.discountPercent,
            savings: settledPricePlan.savings,
            price: settledPricePlan.finalPrice,
            saleLimitMode: reservation.record.saleLimitMode,
            saleLimitSoldBefore: reservation.soldCountBefore,
            saleLimitSoldAfter: reservation.soldCountAfter
          }
        });

        return {
          profile,
          ...ledgerResult,
          transaction: {
            transactionId: safeTransactionId,
            status: "completed",
            duplicate: false
          },
          store: getStoreViewForProfile(profile)
        };
      } catch (error) {
        if (!profileCommitted && reservation?.record?.saleLimitMode === "limited") {
          await this.collectionPackStore.rollbackPackPurchaseReservation({
            packId: safePackId,
            soldCountBefore: reservation.soldCountBefore,
            soldCountAfter: reservation.soldCountAfter
          });
        }
        if (!profileCommitted) {
          await this.storePurchaseLedger.finalizeTransaction({
            transactionId: safeTransactionId,
            status: "rejected",
            error: {
              code: "COLLECTION_PACK_PURCHASE_REJECTED",
              message: String(error?.message ?? "Collection Pack purchase rejected.")
            }
          });
        }
        throw error;
      }
    });
  }

  async grantSupporterPass(username) {
    let supportResult = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      supportResult = grantSupporterPass(current);
      return supportResult.profile;
    });

    return {
      profile,
      granted: supportResult?.granted ?? [],
      store: getStoreViewForProfile(profile)
    };
  }

  async grantFounderStatus(username) {
    let founderResult = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      founderResult = grantFounderStatus(current);
      return founderResult.profile;
    });

    return {
      profile,
      founderStatusActive: Boolean(founderResult?.founderStatusActive ?? profile?.supporterPass),
      supporterPassActivated: Boolean(founderResult?.supporterPassActivated),
      grantedItems: founderResult?.granted ?? [],
      skippedItems: founderResult?.skipped ?? [],
      store: getStoreViewForProfile(profile)
    };
  }

  async grantChest({ username, chestType = "basic", amount = 1 }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      grantChest(current, { chestType, amount })
    );

    return {
      profile,
      chests: profile.chests,
      granted: {
        chestType,
        amount
      }
    };
  }

  async applyAdminGrant({
    username,
    xp = 0,
    tokens = 0,
    chests = [],
    cosmetic = null
  }) {
    const safeUsername = String(username ?? "").trim();
    if (!safeUsername) {
      throw new Error("username is required for admin grants.");
    }

    const safeXp = Math.max(0, Math.floor(Number(xp ?? 0) || 0));
    const safeTokens = Math.max(0, Math.floor(Number(tokens ?? 0) || 0));
    const normalizedChests = (Array.isArray(chests) ? chests : [])
      .map((entry) => ({
        chestType: String(entry?.chestType ?? "").trim(),
        amount: Math.max(0, Math.floor(Number(entry?.amount ?? 0) || 0))
      }))
      .filter((entry) => entry.amount > 0);
    const normalizedCosmetic =
      cosmetic && typeof cosmetic === "object"
        ? {
            type: String(cosmetic.type ?? "").trim(),
            cosmeticId: String(cosmetic.cosmeticId ?? "").trim()
          }
        : null;

    for (const entry of normalizedChests) {
      if (!VALID_ADMIN_CHEST_TYPES.has(entry.chestType)) {
        throw new Error(`Unsupported chest type '${entry.chestType}'.`);
      }
    }

    if (normalizedCosmetic && (!normalizedCosmetic.type || !normalizedCosmetic.cosmeticId)) {
      throw new Error("Both cosmetic type and cosmeticId are required for cosmetic grants.");
    }

    if (safeXp <= 0 && safeTokens <= 0 && normalizedChests.length === 0 && !normalizedCosmetic) {
      throw new Error("At least one admin reward value is required.");
    }

    let grantSummary = null;
    const profile = await this.profiles.updateProfile(safeUsername, (current) => {
      const xpAwardSummary = applyXpAwardToProfile(current, safeXp, safeTokens);
      let nextProfile = xpAwardSummary.profile;

      for (const entry of normalizedChests) {
        nextProfile = grantChest(nextProfile, {
          chestType: entry.chestType,
          amount: entry.amount
        });
      }

      let cosmeticGrant = null;
      if (normalizedCosmetic) {
        const cosmeticResult = grantCosmeticItem(nextProfile, normalizedCosmetic);
        nextProfile = cosmeticResult.profile;
        cosmeticGrant = cosmeticResult.grant;
      }

      grantSummary = {
        xpDelta: xpAwardSummary.xpDelta,
        tokenDelta: xpAwardSummary.tokenDelta,
        xpConversionTokenBonus: xpAwardSummary.xpConversionTokenBonus,
        overflowXp: xpAwardSummary.overflowXp,
        chestGrants: normalizedChests,
        cosmeticGrant,
        levelBefore: xpAwardSummary.levelBefore,
        levelAfter: Math.max(xpAwardSummary.levelAfter, Number(nextProfile?.playerLevel ?? xpAwardSummary.levelAfter)),
        levelRewards: xpAwardSummary.levelRewards,
        levelRewardTokenDelta: xpAwardSummary.levelRewardTokenDelta
      };

      return nextProfile;
    });

    return {
      profile,
      xp: getLevelProgress(profile),
      xpDelta: grantSummary?.xpDelta ?? safeXp,
      tokenDelta: grantSummary?.tokenDelta ?? safeTokens,
      xpConversionTokenBonus: grantSummary?.xpConversionTokenBonus ?? 0,
      overflowXp: grantSummary?.overflowXp ?? 0,
      chestGrants: grantSummary?.chestGrants ?? normalizedChests,
      cosmeticGrant: grantSummary?.cosmeticGrant ?? null,
      levelBefore: grantSummary?.levelBefore ?? Number(profile?.playerLevel ?? 1),
      levelAfter: grantSummary?.levelAfter ?? Number(profile?.playerLevel ?? 1),
      levelRewards: grantSummary?.levelRewards ?? [],
      levelRewardTokenDelta: grantSummary?.levelRewardTokenDelta ?? 0
    };
  }

  async grantSpecialCosmetic({ username, type, cosmeticId }) {
    const safeUsername = String(username ?? "").trim();
    const safeType = String(type ?? "").trim();
    const safeCosmeticId = String(cosmeticId ?? "").trim();
    if (!safeUsername) {
      throw new Error("username is required for special cosmetic grants.");
    }
    if (!safeType || !safeCosmeticId) {
      throw new Error("type and cosmeticId are required for special cosmetic grants.");
    }

    await this.ensureUniqueCosmeticAcquisitions(safeUsername);
    let cosmeticGrant = null;
    const profile = await this.profiles.updateProfile(safeUsername, (current) => {
      if (current?.ownedCosmetics?.[safeType]?.includes(safeCosmeticId)) {
        cosmeticGrant = {
          status: "already_owned",
          type: safeType,
          cosmeticId: safeCosmeticId
        };
        return current;
      }
      const result = grantCosmeticItem(current, {
        type: safeType,
        cosmeticId: safeCosmeticId
      });
      cosmeticGrant = result.grant;
      return preserveUniqueCosmeticAcquisition(result.profile, {
        type: safeType,
        cosmeticId: safeCosmeticId,
        source: "granted"
      });
    });

    return {
      profile,
      cosmeticGrant
    };
  }

  async grantOnlineMatchRewards({ username, tokens = 0, xp = 0, basicChests = 0 }) {
    const safeTokens = Math.max(0, Number(tokens ?? 0));
    const safeXp = Math.max(0, Number(xp ?? 0));
    const safeBasicChests = Math.max(0, Number(basicChests ?? 0));
    let rewardSummary = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      const xpAwardResult = applyXpWithMaxLevelFallback({
        currentXp: current?.playerXP ?? 0,
        xpToAward: safeXp
      });
      let nextProfile = {
        ...current,
        tokens:
          Math.max(0, Number(current?.tokens ?? 0) + safeTokens) +
          xpAwardResult.convertedTokens,
        playerXP: xpAwardResult.nextXp,
        playerLevel: xpAwardResult.levelAfter
      };

      if (safeBasicChests > 0) {
        nextProfile = grantChest(nextProfile, {
          chestType: "basic",
          amount: safeBasicChests
        });
      }

      rewardSummary = {
        xpDelta: xpAwardResult.appliedXp,
        tokenDelta: safeTokens + xpAwardResult.convertedTokens,
        xpConversionTokenBonus: xpAwardResult.convertedTokens,
        overflowXp: xpAwardResult.overflowXp,
        levelBefore: xpAwardResult.levelBefore,
        levelAfter: xpAwardResult.levelAfter,
        levelRewards: [],
        levelRewardTokenDelta: 0
      };

      return nextProfile;
    });

    return {
      profile,
      rewards: {
        tokens: rewardSummary?.tokenDelta ?? safeTokens,
        xp: rewardSummary?.xpDelta ?? safeXp,
        xpConversionTokenBonus: rewardSummary?.xpConversionTokenBonus ?? 0,
        overflowXp: rewardSummary?.overflowXp ?? 0,
        basicChests: safeBasicChests
      },
      levelBefore: rewardSummary?.levelBefore ?? Number(profile?.playerLevel ?? 1),
      levelAfter: rewardSummary?.levelAfter ?? Number(profile?.playerLevel ?? 1),
      levelRewards: rewardSummary?.levelRewards ?? [],
      levelRewardTokenDelta: rewardSummary?.levelRewardTokenDelta ?? 0
    };
  }

  async applyOnlineRewardSettlementDecision({
    username,
    settlementKey,
    rewardDecision,
    participantRole = "host"
  }) {
    return this.runMatchPersistence(async () => {
      if (!username) {
        throw new Error("username is required to apply online reward settlements.");
      }

      const effectiveSettlementKey = normalizeSettlementKey(settlementKey);
      if (!effectiveSettlementKey) {
        throw new Error("settlementKey is required to apply online reward settlements.");
      }

      const normalizedRole = participantRole === "guest" ? "guest" : "host";
      const participantUsernameKey = normalizedRole === "guest" ? "guestUsername" : "hostUsername";
      const participantProfileKey = normalizedRole === "guest" ? "guestProfileKey" : "hostProfileKey";
      const expectedUsername = String(rewardDecision?.participants?.[participantUsernameKey] ?? "").trim();
      const expectedProfileKey = String(rewardDecision?.participants?.[participantProfileKey] ?? "").trim();

      if (
        (expectedProfileKey || expectedUsername) &&
        username !== expectedProfileKey &&
        username !== expectedUsername
      ) {
        throw new Error(`Reward settlement participant mismatch for ${username}.`);
      }

      const selectedRewards =
        normalizedRole === "guest"
          ? rewardDecision?.rewards?.guest ?? null
          : rewardDecision?.rewards?.host ?? null;

      if (!selectedRewards || typeof selectedRewards !== "object") {
        throw new Error(`Reward settlement rewards are missing for ${normalizedRole}.`);
      }

      const safeTokens = Math.max(0, Number(selectedRewards.tokens ?? 0));
      const safeXp = Math.max(0, Number(selectedRewards.xp ?? 0));
      const safeBasicChests = Math.max(0, Number(selectedRewards.basicChests ?? 0));
      let duplicate = false;
      let rewardSummary = null;

      const profile = await this.profiles.updateProfile(username, (current) => {
        const appliedSettlementKeys = normalizeAppliedSettlementKeys(
          current?.onlineRewardSettlements?.appliedSettlementKeys
        );

        if (appliedSettlementKeys.includes(effectiveSettlementKey)) {
          duplicate = true;
          return current;
        }

        const xpAwardResult = applyXpWithMaxLevelFallback({
          currentXp: current?.playerXP ?? 0,
          xpToAward: safeXp
        });
        let nextProfile = {
          ...current,
          tokens:
            Math.max(0, Number(current?.tokens ?? 0) + safeTokens) +
            xpAwardResult.convertedTokens,
          playerXP: xpAwardResult.nextXp,
          playerLevel: xpAwardResult.levelAfter
        };

        if (safeBasicChests > 0) {
          nextProfile = grantChest(nextProfile, {
            chestType: "basic",
            amount: safeBasicChests
          });
        }

        rewardSummary = {
          xpDelta: xpAwardResult.appliedXp,
          tokenDelta: safeTokens + xpAwardResult.convertedTokens,
          xpConversionTokenBonus: xpAwardResult.convertedTokens,
          overflowXp: xpAwardResult.overflowXp,
          levelBefore: xpAwardResult.levelBefore,
          levelAfter: xpAwardResult.levelAfter,
          levelRewards: [],
          levelRewardTokenDelta: 0
        };

        return {
          ...nextProfile,
          onlineRewardSettlements: {
            ...(nextProfile.onlineRewardSettlements ?? {}),
            appliedSettlementKeys: appendAppliedSettlementKey(
              appliedSettlementKeys,
              effectiveSettlementKey
            )
          }
        };
      });

      return {
        duplicate,
        settlementKey: effectiveSettlementKey,
        profile,
        rewards: {
          tokens: duplicate ? 0 : rewardSummary?.tokenDelta ?? Math.max(0, safeTokens),
          xp: duplicate ? 0 : rewardSummary?.xpDelta ?? Math.max(0, safeXp),
          xpConversionTokenBonus: duplicate ? 0 : rewardSummary?.xpConversionTokenBonus ?? 0,
          overflowXp: duplicate ? 0 : rewardSummary?.overflowXp ?? 0,
          basicChests: safeBasicChests
        },
        xpConversionTokenBonus: duplicate ? 0 : rewardSummary?.xpConversionTokenBonus ?? 0,
        overflowXp: duplicate ? 0 : rewardSummary?.overflowXp ?? 0,
        levelBefore: duplicate ? Number(profile?.playerLevel ?? 1) : rewardSummary?.levelBefore ?? Number(profile?.playerLevel ?? 1),
        levelAfter: duplicate ? Number(profile?.playerLevel ?? 1) : rewardSummary?.levelAfter ?? Number(profile?.playerLevel ?? 1),
        levelRewards: duplicate ? [] : rewardSummary?.levelRewards ?? [],
        levelRewardTokenDelta: duplicate ? 0 : rewardSummary?.levelRewardTokenDelta ?? 0
      };
    });
  }

  async openChest({ username, chestType = "basic" }) {
    let openResult = null;
    let levelBefore = 1;
    let levelAfter = 1;
    let levelRewards = [];

    const profile = await this.profiles.updateProfile(username, (current) => {
      levelBefore = Math.max(1, Number(current?.playerLevel ?? getLevelProgress(current).level ?? 1));
      openResult = openChest(current, { chestType, random: this.random });
      levelAfter = Math.max(1, Number(openResult?.profile?.playerLevel ?? getLevelProgress(openResult?.profile).level ?? levelBefore));
      levelRewards = [];
      return openResult.profile;
    });

    return {
      profile,
      chests: profile.chests,
      chestType: openResult?.chestType ?? chestType,
      consumed: openResult?.consumed ?? 0,
      remaining: openResult?.remaining ?? 0,
      rewards: openResult?.rewards ?? {
        xp: 0,
        tokens: 0,
        cosmetic: null,
        xpConversionTokenBonus: 0,
        overflowXp: 0
      },
      levelBefore,
      levelAfter,
      levelRewards
    };
  }

  async openDailyElementChest({ username, openType = "free", nowMs = Date.now() }) {
    let openResult = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      openResult = openDailyElementChest(current, {
        openType,
        nowMs,
        random: this.random
      });
      return openResult.profile;
    });

    return {
      ...openResult,
      profile,
      dailyElementChest: profile.dailyElementChest,
      status: getDailyElementChestStatus(profile, nowMs)
    };
  }

  async acknowledgeMilestoneChestReward({ username, level = null }) {
    let noticeResult = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      noticeResult = acknowledgeMilestoneChestReward(current, level);
      return noticeResult;
    });

    return {
      profile,
      pendingMilestoneChestRewardLevel: profile?.pendingMilestoneChestRewardLevel ?? null
    };
  }

  async equipCosmetic({ username, type, cosmeticId }) {
    const profile = await this.profiles.equipCosmetic(username, type, cosmeticId);

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async getCosmetics(username) {
    const profile = await this.ensureUniqueCosmeticAcquisitions(username);
    return this.buildCosmeticsViewWithSpecialMetadata(profile);
  }

  async updateCosmeticPreferences({ username, patch = {} }) {
    const profile = await this.profiles.updateProfile(username, (current) => ({
      ...current,
      cosmeticRandomizeAfterMatch: normalizeCosmeticRandomizationPreferences(
        {
          ...current?.cosmeticRandomizeAfterMatch,
          ...(patch.randomizeAfterEachMatch ?? {}),
          ...(Object.prototype.hasOwnProperty.call(patch, "randomizeBackgroundEachMatch")
            ? { background: Boolean(patch.randomizeBackgroundEachMatch) }
            : {})
        },
        {
          legacyBackgroundEnabled: Boolean(
            patch.randomizeBackgroundEachMatch ?? current.randomizeBackgroundEachMatch
          )
        }
      ),
      randomizeBackgroundEachMatch: Boolean(
        patch.randomizeAfterEachMatch?.background ??
          patch.randomizeBackgroundEachMatch ??
          current?.cosmeticRandomizeAfterMatch?.background ??
          current.randomizeBackgroundEachMatch
      )
    }));

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async randomizeOwnedCosmetics({ username, categories = [] }) {
    const requested = Array.isArray(categories) ? categories.filter((type) => RANDOMIZABLE_COSMETIC_TYPES.includes(type)) : [];
    const uniqueCategories = [...new Set(requested)];
    const profile = await this.profiles.updateProfile(username, (current) => {
      if (uniqueCategories.length === 0) {
        return current;
      }

      const equipped = {
        ...current.equippedCosmetics,
        elementCardVariant: {
          ...current?.equippedCosmetics?.elementCardVariant
        }
      };

      for (const type of uniqueCategories) {
        if (type === "elementCardVariant") {
          equipped.elementCardVariant = chooseRandomOwnedVariantIds(current, equipped.elementCardVariant);
          continue;
        }

        const nextId = chooseRandomOwnedId(current, type, equipped[type]);
        if (nextId) {
          equipped[type] = nextId;
        }
      }

      return {
        ...current,
        equippedCosmetics: equipped,
        cosmetics: {
          ...current.cosmetics,
          avatar: equipped.avatar,
          cardBack: equipped.cardBack,
          background: equipped.background,
          badge: equipped.badge
        },
        title: equipped.title
      };
    });

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async saveCosmeticLoadout({ username, slotIndex }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      saveCosmeticLoadout(current, slotIndex)
    );

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async applyCosmeticLoadout({ username, slotIndex }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      applyCosmeticLoadout(current, slotIndex)
    );

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async renameCosmeticLoadout({ username, slotIndex, name }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      renameCosmeticLoadout(current, slotIndex, name)
    );

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async updateProfileShowcaseSlot({ username, slotIndex, cosmetic = null }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      updateProfileShowcaseSlot(current, { slotIndex, cosmetic })
    );

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async claimCollectionAlbumReward({ username, albumId }) {
    let claimResult = null;
    const profile = await this.profiles.updateProfile(username, (current) => {
      claimResult = claimCollectionAlbumReward(current, albumId);
      return claimResult.profile;
    });

    return {
      profile,
      reward: claimResult?.reward ?? null,
      duplicate: Boolean(claimResult?.duplicate),
      album: claimResult?.album ?? null,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile)
    };
  }

  async acknowledgeLoadoutUnlocks(username) {
    let noticeResult = null;
    const profile = await this.profiles.updateProfile(username, (current) => {
      noticeResult = acknowledgeUnlockedLoadoutSlots(current);
      return noticeResult.profile;
    });

    return {
      profile,
      cosmetics: await this.buildCosmeticsViewWithSpecialMetadata(profile),
      newlyUnlockedSlots: noticeResult?.newlyUnlockedSlots ?? [],
      nextUnlockLevel: noticeResult?.nextUnlockLevel ?? null
    };
  }

  async recordOnlineLiveMatchDisconnect({ username, occurredAt = new Date().toISOString() }) {
    if (!username) {
      return null;
    }

    return this.profiles.updateProfile(username, (current) => ({
      ...current,
      onlineDisconnectTracking: {
        ...(current.onlineDisconnectTracking ?? {}),
        totalLiveMatchDisconnects: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalLiveMatchDisconnects ?? 0) + 1
        ),
        totalReconnectTimeoutExpirations: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalReconnectTimeoutExpirations ?? 0)
        ),
        totalSuccessfulReconnectResumes: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalSuccessfulReconnectResumes ?? 0)
        ),
        recentDisconnectTimestamps: appendBoundedTimestamp(
          current.onlineDisconnectTracking?.recentDisconnectTimestamps,
          occurredAt
        ),
        recentExpirationTimestamps: Array.isArray(
          current.onlineDisconnectTracking?.recentExpirationTimestamps
        )
          ? current.onlineDisconnectTracking.recentExpirationTimestamps
          : []
      }
    }));
  }

  async recordOnlineReconnectResume({ username }) {
    if (!username) {
      return null;
    }

    return this.profiles.updateProfile(username, (current) => ({
      ...current,
      onlineDisconnectTracking: {
        ...(current.onlineDisconnectTracking ?? {}),
        totalLiveMatchDisconnects: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalLiveMatchDisconnects ?? 0)
        ),
        totalReconnectTimeoutExpirations: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalReconnectTimeoutExpirations ?? 0)
        ),
        totalSuccessfulReconnectResumes: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalSuccessfulReconnectResumes ?? 0) + 1
        ),
        recentDisconnectTimestamps: Array.isArray(
          current.onlineDisconnectTracking?.recentDisconnectTimestamps
        )
          ? current.onlineDisconnectTracking.recentDisconnectTimestamps
          : [],
        recentExpirationTimestamps: Array.isArray(
          current.onlineDisconnectTracking?.recentExpirationTimestamps
        )
          ? current.onlineDisconnectTracking.recentExpirationTimestamps
          : []
      }
    }));
  }

  async recordOnlineReconnectTimeoutExpiration({
    username,
    occurredAt = new Date().toISOString()
  }) {
    if (!username) {
      return null;
    }

    return this.profiles.updateProfile(username, (current) => ({
      ...current,
      onlineDisconnectTracking: {
        ...(current.onlineDisconnectTracking ?? {}),
        totalLiveMatchDisconnects: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalLiveMatchDisconnects ?? 0)
        ),
        totalReconnectTimeoutExpirations: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalReconnectTimeoutExpirations ?? 0) + 1
        ),
        totalSuccessfulReconnectResumes: Math.max(
          0,
          Number(current.onlineDisconnectTracking?.totalSuccessfulReconnectResumes ?? 0)
        ),
        recentDisconnectTimestamps: Array.isArray(
          current.onlineDisconnectTracking?.recentDisconnectTimestamps
        )
          ? current.onlineDisconnectTracking.recentDisconnectTimestamps
          : [],
        recentExpirationTimestamps: appendBoundedTimestamp(
          current.onlineDisconnectTracking?.recentExpirationTimestamps,
          occurredAt
        )
      }
    }));
  }
}
