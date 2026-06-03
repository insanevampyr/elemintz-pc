import { ProfileSystem } from "./profileSystem.js";
import { SaveSystem } from "./saveSystem.js";
import { SettingsService } from "./settingsService.js";
import {
  applyAchievementTokenRewards,
  applyAchievementUnlocks,
  buildAchievementCatalog,
  buildAchievementView,
  evaluateAchievements
} from "./achievementSystem.js";
import {
  acknowledgeUnlockedLoadoutSlots,
  applyAchievementCosmeticRewards,
  applyCosmeticLoadout,
  buildAuthoritativeCosmeticSnapshot,
  getCosmeticCatalogForProfile,
  getCosmeticDefinition,
  getCosmeticLoadoutsForProfile,
  normalizeCosmeticRandomizationPreferences,
  renameCosmeticLoadout,
  RANDOMIZABLE_COSMETIC_TYPES,
  saveCosmeticLoadout
} from "./cosmeticSystem.js";
import { deriveMatchStats } from "./statsTracking.js";
import {
  buyStoreItem,
  getStoreViewForProfile,
  grantCosmeticItem,
  grantFounderStatus,
  grantSupporterPass
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
  applyLevelRewardsForLevelChange,
  applyXpWithMaxLevelFallback,
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
    tokens: 0,
    chestRolls: Object.freeze([
      Object.freeze({ chestType: LEGENDARY_CHEST_TYPE, chance: 0.01 }),
      Object.freeze({ chestType: EPIC_CHEST_TYPE, chance: 0.08 })
    ])
  })
]);
const DAILY_LOGIN_STREAK_MAX_DAY = DAILY_LOGIN_STREAK_REWARDS.length;
const FEATURED_RIVAL_DAILY_WIN_REWARD_CONFIGS = {
  crownfire_duelist: {
    xpDelta: 30,
    tokenDelta: 15,
    label: "Crownfire First Win Bonus"
  }
};
const FEATURED_RIVAL_PUBLIC_NAMES = Object.freeze({
  crownfire_duelist: "Crownfire Duelist"
});
const VALID_RUNTIME_MODES = new Set(["pve", "local_pvp", "online_pvp"]);
const VALID_ADMIN_CHEST_TYPES = new Set(["basic", "milestone", "epic", "legendary"]);
const GAUNTLET_MILESTONE_REWARDS = Object.freeze([
  Object.freeze({ streak: 3, tokens: 25 }),
  Object.freeze({ streak: 5, chests: Object.freeze([{ chestType: DEFAULT_CHEST_TYPE, amount: 1 }]) }),
  Object.freeze({ streak: 10, chests: Object.freeze([{ chestType: MILESTONE_CHEST_TYPE, amount: 1 }]) }),
  Object.freeze({ streak: 15, xp: 100, tokens: 75 }),
  Object.freeze({ streak: 20, chests: Object.freeze([{ chestType: EPIC_CHEST_TYPE, amount: 1 }]) })
]);
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
  const milestonesToGrant = GAUNTLET_MILESTONE_REWARDS.filter(
    (entry) => safeCurrentStreak >= entry.streak && !alreadyClaimed.has(entry.streak)
  );

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

export class StateCoordinator {
  constructor(options = {}) {
    this.profiles = new ProfileSystem(options);
    this.saves = new SaveSystem(options);
    this.settings = new SettingsService(options);
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

  buildCosmeticsView(profile) {
    const snapshot = buildAuthoritativeCosmeticSnapshot(profile);
    const randomizeAfterEachMatch = normalizeCosmeticRandomizationPreferences(snapshot.preferences);
    return {
      authority: "server",
      source: "stateCoordinator",
      snapshot,
      equipped: snapshot.equipped,
      owned: snapshot.owned,
      catalog: getCosmeticCatalogForProfile(profile),
      preferences: {
        randomizeBackgroundEachMatch: Boolean(randomizeAfterEachMatch.background),
        randomizeAfterEachMatch
      },
      loadouts: getCosmeticLoadoutsForProfile(profile)
    };
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
    const hasChestBranch = Array.isArray(rewardPlan?.chestRolls) && rewardPlan.chestRolls.length > 0;
    let xpAwardSummary = applyXpAwardToProfile(
      profileBefore,
      hasChestBranch ? 0 : Number(rewardPlan?.xp ?? 0) || 0,
      Number(rewardPlan?.tokens ?? 0) || 0
    );
    let workingProfile = xpAwardSummary.profile;
    let chestAwarded = null;
    const chestGrants = [];

    for (const roll of rewardPlan?.chestRolls ?? []) {
      if ((typeof random === "function" ? random() : Math.random()) < Number(roll?.chance ?? 0)) {
        const chestType = String(roll?.chestType ?? "").trim() || DEFAULT_CHEST_TYPE;
        workingProfile = grantChest(workingProfile, { chestType, amount: 1 });
        chestAwarded = {
          chestType,
          chestLabel: getChestLabel(chestType),
          amount: 1
        };
        chestGrants.push({ chestType, amount: 1 });
        xpAwardSummary = applyXpAwardToProfile(profileBefore, 0, Number(rewardPlan?.tokens ?? 0) || 0);
        break;
      }
    }

    if (!chestAwarded && hasChestBranch && Number(rewardPlan?.xp ?? 0) > 0) {
      xpAwardSummary = applyXpAwardToProfile(
        profileBefore,
        Number(rewardPlan?.xp ?? 0) || 0,
        Number(rewardPlan?.tokens ?? 0) || 0
      );
      workingProfile = xpAwardSummary.profile;
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
      rewardTokens: Number(rewardPlan?.tokens ?? 0) || 0,
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
        tokens: Number(rewardPlan?.tokens ?? 0) || 0,
        xp: chestAwarded ? 0 : Number(rewardPlan?.xp ?? 0) || 0,
        chestAwarded
      },
      rewardTokens: Number(rewardPlan?.tokens ?? 0) || 0,
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

  async recordMatchResult({
    username,
    matchState,
    perspective = "p1",
    settlementKey = null,
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

  async recordLocalHotseatResult({ username, matchState, perspective = "p1", settlementKey = null, nowMs = Date.now() }) {
    return this.recordMatchResult({
      username,
      matchState,
      perspective,
      settlementKey,
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
    settlementKey
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
    claimedMilestoneStreaks = []
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
    const profile = await this.profiles.ensureProfile(username);
    return getStoreViewForProfile(profile);
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

  async buyStoreItem({ username, type, cosmeticId }) {
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
      const expectedUsername = String(
        rewardDecision?.participants?.[participantUsernameKey] ?? ""
      ).trim();

      if (expectedUsername && expectedUsername !== username) {
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
      cosmetics: this.buildCosmeticsView(profile)
    };
  }

  async getCosmetics(username) {
    const profile = await this.profiles.ensureProfile(username);

    return this.buildCosmeticsView(profile);
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
      cosmetics: this.buildCosmeticsView(profile)
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
      cosmetics: this.buildCosmeticsView(profile)
    };
  }

  async saveCosmeticLoadout({ username, slotIndex }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      saveCosmeticLoadout(current, slotIndex)
    );

    return {
      profile,
      cosmetics: this.buildCosmeticsView(profile)
    };
  }

  async applyCosmeticLoadout({ username, slotIndex }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      applyCosmeticLoadout(current, slotIndex)
    );

    return {
      profile,
      cosmetics: this.buildCosmeticsView(profile)
    };
  }

  async renameCosmeticLoadout({ username, slotIndex, name }) {
    const profile = await this.profiles.updateProfile(username, (current) =>
      renameCosmeticLoadout(current, slotIndex, name)
    );

    return {
      profile,
      cosmetics: this.buildCosmeticsView(profile)
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
      cosmetics: this.buildCosmeticsView(profile),
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
