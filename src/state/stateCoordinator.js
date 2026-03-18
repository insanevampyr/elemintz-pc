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
import { grantChest, openChest } from "./chestSystem.js";
import {
  applyDailyChallengesForMatch,
  getDailyChallengesView,
  getDailyResetWindow
} from "./dailyChallengesSystem.js";
import { applyLevelRewardsForLevelChange, getLevelProgress } from "./levelRewardsSystem.js";

const DAILY_LOGIN_TOKENS = 5;
const DAILY_LOGIN_XP = 2;
const MATCH_WIN_CHEST_CHANCE = 0.1;
const MATCH_LOSS_CHEST_CHANCE = 0.02;

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

export class StateCoordinator {
  constructor(options = {}) {
    this.profiles = new ProfileSystem(options);
    this.saves = new SaveSystem(options);
    this.settings = new SettingsService(options);
    this.random = typeof options.random === "function" ? options.random : Math.random;
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
    if (!username) {
      throw new Error("username is required to record match results.");
    }

    if (!matchState || matchState.status !== "completed") {
      throw new Error("matchState must be completed before recording results.");
    }

    const profileBefore = await this.profiles.ensureProfile(username);
    const matchStats = deriveMatchStats(matchState, perspective);
    const mode = matchState.mode ?? "pve";
    const achievementsDisabledForMatch =
      mode === "pve" && String(matchState.difficulty ?? "") === "easy";

    console.info("[StateCoordinator] recordMatchResult:before", {
      mode,
      perspective,
      ...profileCommitSnapshot(profileBefore)
    });

    const profileWithStats = await this.profiles.applyMatchStats(username, matchStats, mode);

    console.info("[StateCoordinator] recordMatchResult:after-stats", {
      mode,
      perspective,
      matchStats,
      ...profileCommitSnapshot(profileWithStats)
    });

    const isQuitForfeit = String(matchState.endReason ?? "") === "quit_forfeit";

    const challengeResult = applyDailyChallengesForMatch({
      profile: profileWithStats,
      matchState,
      perspective,
      matchStats
    });

    let workingProfile = challengeResult.profile;
    const levelRewardResult = applyLevelRewardsForLevelChange(workingProfile, {
      fromLevel: challengeResult.levelBefore,
      toLevel: challengeResult.levelAfter
    });
    workingProfile = levelRewardResult.profile;

    const didWin = matchState.winner === perspective;
    const didLose = matchState.winner && matchState.winner !== "draw" && matchState.winner !== perspective;
    const matchChestChance = didWin
      ? MATCH_WIN_CHEST_CHANCE
      : didLose
        ? MATCH_LOSS_CHEST_CHANCE
        : 0;

    if (matchChestChance > 0 && this.random() < matchChestChance) {
      workingProfile = grantChest(workingProfile, { amount: 1 });
    }

    let unlockEvents = [];
    let grantedRewards = [];

    if (!isQuitForfeit && !achievementsDisabledForMatch) {
      const unlockedDefinitions = evaluateAchievements({
        profileBefore,
        profileAfter: workingProfile,
        matchState,
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
      winner: matchState.winner,
      rounds: matchState.round,
      endReason: matchState.endReason ?? null,
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
      history: matchState.history
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
}
