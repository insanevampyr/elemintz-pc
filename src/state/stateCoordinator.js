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
  getCosmeticCatalogForProfile,
  getCosmeticLoadoutsForProfile,
  renameCosmeticLoadout,
  saveCosmeticLoadout
} from "./cosmeticSystem.js";
import { deriveMatchStats } from "./statsTracking.js";
import { buyStoreItem, getStoreViewForProfile, grantSupporterPass } from "./storeSystem.js";
import { acknowledgeMilestoneChestReward, grantChest, openChest } from "./chestSystem.js";
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
          capturedOpponentCards: safeRuntimeCount(entry.capturedOpponentCards, 0),
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

function buildRuntimeResultSignature({ username, perspective = "p1", matchState, modeOverride = null }) {
  const history = Array.isArray(matchState?.history)
    ? matchState.history
        .map(
          (entry) =>
            [
              safeRuntimeCount(entry?.round, 0),
              entry?.result ?? "",
              entry?.p1Card ?? "",
              entry?.p2Card ?? "",
              safeRuntimeCount(entry?.warClashes, 0),
              safeRuntimeCount(entry?.capturedOpponentCards, 0)
            ].join(":")
        )
        .join("|")
    : "";

  return [
    username ?? "",
    perspective,
    modeOverride ?? matchState?.mode ?? "",
    matchState?.winner ?? "",
    matchState?.endReason ?? "",
    safeRuntimeCount(matchState?.round, 0),
    history
  ].join("#");
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
    this.runtimeResultGuardCache = new Map();
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
    return {
      equipped: profile.equippedCosmetics,
      owned: profile.ownedCosmetics,
      catalog: getCosmeticCatalogForProfile(profile),
      preferences: {
        randomizeBackgroundEachMatch: Boolean(profile.randomizeBackgroundEachMatch)
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
      const runtimeSignature = buildRuntimeResultSignature({
        username,
        perspective,
        matchState: safeMatchState
      });
      const cachedResult = this.runtimeResultGuardCache.get(runtimeSignature);
      if (cachedResult) {
        console.warn("[RuntimeEdgeGuard] skipped duplicate stat/result application");
        return cachedResult;
      }
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
        : await this.profiles.applyMatchStats(username, matchStats, mode);

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

      const result = {
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
      this.runtimeResultGuardCache.set(runtimeSignature, result);
      return result;
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
      const runtimeSignature = buildRuntimeResultSignature({
        username,
        perspective,
        matchState: safeMatchState,
        modeOverride: "online_pvp"
      });
      const cachedResult = this.runtimeResultGuardCache.get(runtimeSignature);
      if (cachedResult) {
        console.warn("[RuntimeEdgeGuard] skipped duplicate stat/result application");
        return cachedResult;
      }
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

      const result = {
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
      this.runtimeResultGuardCache.set(runtimeSignature, result);
      return result;
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
      randomizeBackgroundEachMatch: Boolean(
        patch.randomizeBackgroundEachMatch ?? current.randomizeBackgroundEachMatch
      )
    }));

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
