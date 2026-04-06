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
import { buyStoreItem, getStoreViewForProfile, grantSupporterPass } from "./storeSystem.js";
import {
  acknowledgeMilestoneChestReward,
  applyWinStreakChestGrants,
  grantChest,
  openChest
} from "./chestSystem.js";
import {
  applyDailyChallengesForMatch,
  getDailyChallengesView,
  getDailyResetWindow
} from "./dailyChallengesSystem.js";
import { applyLevelRewardsForLevelChange, getLevelProgress } from "./levelRewardsSystem.js";
import { rollBasicChest } from "../shared/basicChestDrop.js";

const DAILY_LOGIN_TOKENS = 5;
const DAILY_LOGIN_XP = 2;
const VALID_RUNTIME_MODES = new Set(["pve", "local_pvp", "online_pvp"]);
const VALID_ADMIN_CHEST_TYPES = new Set(["basic", "milestone", "epic", "legendary"]);

function profilesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getDailyLoginDateKey(nowMs = Date.now()) {
  const { lastResetMs } = getDailyResetWindow(nowMs);
  return new Date(lastResetMs).toISOString();
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
    eligible,
    nextResetAt: new Date(resetWindow.nextResetMs).toISOString(),
    msUntilReset: Math.max(0, resetWindow.nextResetMs - nowMs)
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
    tokens: profile?.tokens ?? 0,
    playerXP: profile?.playerXP ?? 0,
    playerLevel: profile?.playerLevel ?? 1,
    achievements: Object.keys(profile?.achievements ?? {}).length
  };
}

function appendBoundedTimestamp(list, timestamp, limit = 10) {
  const next = Array.isArray(list) ? [...list, timestamp] : [timestamp];
  return next.slice(-limit);
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

  async claimDailyLoginReward(username, nowMs = Date.now()) {
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
        profile: profileBefore,
        dailyLoginStatus: statusBefore,
        rewardTokens: 0,
        rewardXp: 0,
        xpBreakdown: { lines: [], total: 0 },
        levelBefore: profileBefore.playerLevel ?? 1,
        levelAfter: profileBefore.playerLevel ?? 1,
        levelRewards: [],
        levelRewardTokenDelta: 0
      };
    }

    const previousXp = Math.max(0, Number(profileBefore.playerXP ?? 0));
    const levelBefore = profileBefore.playerLevel ?? 1;
    let workingProfile = {
      ...profileBefore,
      tokens: Math.max(0, Number(profileBefore.tokens ?? 0) + DAILY_LOGIN_TOKENS),
      playerXP: previousXp + DAILY_LOGIN_XP,
      playerLevel: levelBefore,
      lastDailyLoginClaimDate: claimDate
    };

    const levelAfterLogin = Math.max(levelBefore, getLevelProgress(workingProfile).level);
    workingProfile = {
      ...workingProfile,
      playerLevel: levelAfterLogin
    };

    const levelRewardResult = applyLevelRewardsForLevelChange(workingProfile, {
      fromLevel: levelBefore,
      toLevel: levelAfterLogin
    });

    const committedProfile = await this.profiles.updateProfile(username, levelRewardResult.profile);
    const statusAfter = getDailyLoginStatus(committedProfile, nowMs);

    console.info("[DailyLogin] grant_applied", {
      username,
      resetWindowKey: statusAfter.loginDayKey,
      granted: true,
      rewardTokens: DAILY_LOGIN_TOKENS,
      rewardXp: DAILY_LOGIN_XP,
      nextResetAt: statusAfter.nextResetAt
    });

    return {
      granted: true,
      profile: committedProfile,
      dailyLoginStatus: statusAfter,
      rewardTokens: DAILY_LOGIN_TOKENS,
      rewardXp: DAILY_LOGIN_XP,
      xpBreakdown: {
        lines: [{ key: "daily_login", label: "Daily Login", amount: DAILY_LOGIN_XP }],
        total: DAILY_LOGIN_XP
      },
      levelBefore,
      levelAfter: committedProfile.playerLevel ?? levelAfterLogin,
      levelRewards: levelRewardResult.grantedRewards,
      levelRewardTokenDelta: levelRewardResult.tokenDelta
    };
  }

  async recordMatchResult({ username, matchState, perspective = "p1" }) {
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
      const statWrite = guardRuntimeStatWritePayload({
        mode: safeMatchState.mode,
        fallbackMode: "pve",
        matchStats: derivedMatchStats
      });
      const matchStats = statWrite.matchStats;
      const mode = statWrite.mode ?? "pve";
      const achievementsDisabledForMatch =
        mode === "pve" && String(safeMatchState.difficulty ?? "") === "easy";

      console.info("[StateCoordinator] recordMatchResult:before", {
        mode,
        perspective,
        ...profileCommitSnapshot(profileBefore)
      });

      const profileWithStats = statWrite.skipped
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

      const challengeResult = applyDailyChallengesForMatch({
        profile: profileWithStats,
        matchState: safeMatchState,
        perspective,
        matchStats
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

      const matchOutcome =
        safeMatchState.winner === perspective
          ? "win"
          : safeMatchState.winner === "draw"
            ? "draw"
            : safeMatchState.winner
              ? "loss"
              : null;

      if (
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
        winner: safeMatchState.winner,
        rounds: safeMatchState.round,
        endReason: safeMatchState.endReason ?? null,
        stats: matchStats,
        unlockedAchievements: unlockEvents,
        grantedCosmetics: grantedRewards,
        dailyRewards: challengeResult.rewards.daily,
        weeklyRewards: challengeResult.rewards.weekly,
        tokenDelta: challengeResult.tokenDelta,
        matchTokenDelta: challengeResult.matchTokenDelta,
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
        matchTokenDelta: challengeResult.matchTokenDelta,
        challengeTokenDelta: challengeResult.challengeTokenDelta,
        challengeXpDelta: challengeResult.challengeXpDelta,
        xpDelta: challengeResult.xpDelta,
        xpBreakdown: challengeResult.xpBreakdown,
        levelBefore: challengeResult.levelBefore,
        levelAfter: challengeResult.levelAfter,
        levelRewards: levelRewardResult.grantedRewards,
        levelRewardTokenDelta: levelRewardResult.tokenDelta,
        save: saveEntry,
        stats: matchStats
      };
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
    chests = []
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

    for (const entry of normalizedChests) {
      if (!VALID_ADMIN_CHEST_TYPES.has(entry.chestType)) {
        throw new Error(`Unsupported chest type '${entry.chestType}'.`);
      }
    }

    if (safeXp <= 0 && safeTokens <= 0 && normalizedChests.length === 0) {
      throw new Error("At least one admin reward value is required.");
    }

    let grantSummary = null;
    const profile = await this.profiles.updateProfile(safeUsername, (current) => {
      const levelBefore = Math.max(1, Number(current?.playerLevel ?? getLevelProgress(current).playerLevel ?? 1));
      let nextProfile = {
        ...current,
        tokens: Math.max(0, Number(current?.tokens ?? 0) + safeTokens),
        playerXP: Math.max(0, Number(current?.playerXP ?? 0) + safeXp),
        playerLevel: levelBefore
      };

      const levelAfterGain = Math.max(levelBefore, getLevelProgress(nextProfile).playerLevel);
      nextProfile = {
        ...nextProfile,
        playerLevel: levelAfterGain
      };

      const levelRewardResult = applyLevelRewardsForLevelChange(nextProfile, {
        fromLevel: levelBefore,
        toLevel: levelAfterGain
      });
      nextProfile = levelRewardResult.profile;

      for (const entry of normalizedChests) {
        nextProfile = grantChest(nextProfile, {
          chestType: entry.chestType,
          amount: entry.amount
        });
      }

      grantSummary = {
        xpDelta: safeXp,
        tokenDelta: safeTokens,
        chestGrants: normalizedChests,
        levelBefore,
        levelAfter: Math.max(levelAfterGain, Number(nextProfile?.playerLevel ?? levelAfterGain)),
        levelRewards: levelRewardResult.grantedRewards,
        levelRewardTokenDelta: levelRewardResult.tokenDelta
      };

      return nextProfile;
    });

    return {
      profile,
      xp: getLevelProgress(profile),
      xpDelta: grantSummary?.xpDelta ?? safeXp,
      tokenDelta: grantSummary?.tokenDelta ?? safeTokens,
      chestGrants: grantSummary?.chestGrants ?? normalizedChests,
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

    const profile = await this.profiles.updateProfile(username, (current) => {
      let nextProfile = {
        ...current,
        tokens: Math.max(0, Number(current.tokens ?? 0) + safeTokens),
        playerXP: Math.max(0, Number(current.playerXP ?? 0) + safeXp)
      };

      if (safeBasicChests > 0) {
        nextProfile = grantChest(nextProfile, {
          chestType: "basic",
          amount: safeBasicChests
        });
      }

      return nextProfile;
    });

    return {
      profile,
      rewards: {
        tokens: safeTokens,
        xp: safeXp,
        basicChests: safeBasicChests
      }
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

      const profile = await this.profiles.updateProfile(username, (current) => {
        const appliedSettlementKeys = normalizeAppliedSettlementKeys(
          current?.onlineRewardSettlements?.appliedSettlementKeys
        );

        if (appliedSettlementKeys.includes(effectiveSettlementKey)) {
          duplicate = true;
          return current;
        }

        let nextProfile = {
          ...current,
          tokens: Math.max(0, Number(current.tokens ?? 0) + safeTokens),
          playerXP: Math.max(0, Number(current.playerXP ?? 0) + safeXp)
        };

        if (safeBasicChests > 0) {
          nextProfile = grantChest(nextProfile, {
            chestType: "basic",
            amount: safeBasicChests
          });
        }

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
          tokens: safeTokens,
          xp: safeXp,
          basicChests: safeBasicChests
        }
      };
    });
  }

  async openChest({ username, chestType = "basic" }) {
    let openResult = null;

    const profile = await this.profiles.updateProfile(username, (current) => {
      openResult = openChest(current, { chestType, random: this.random });
      return openResult.profile;
    });

    return {
      profile,
      chests: profile.chests,
      chestType: openResult?.chestType ?? chestType,
      consumed: openResult?.consumed ?? 0,
      remaining: openResult?.remaining ?? 0,
      rewards: openResult?.rewards ?? { xp: 0, tokens: 0, cosmetic: null }
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
