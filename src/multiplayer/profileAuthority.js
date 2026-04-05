import { StateCoordinator } from "../state/stateCoordinator.js";
import { buildAuthoritativeCosmeticSnapshot } from "../state/cosmeticSystem.js";
import { getLevelProgress } from "../state/levelRewardsSystem.js";

function normalizeAuthorityUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuthorityAccountId(accountId) {
  const normalized = String(accountId ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function summarizeMatchOutcome(result, perspective) {
  const winner = String(result?.winner ?? "").trim();
  if (!winner || winner === "draw") {
    return "draw";
  }

  if (winner === perspective) {
    return "win";
  }

  return "loss";
}

function buildSnapshotCosmetics(profile) {
  const snapshot = buildAuthoritativeCosmeticSnapshot(profile);

  return {
    authority: "server",
    source: "profileAuthority",
    snapshot,
    equipped: snapshot.equipped,
    owned: snapshot.owned,
    loadouts: snapshot.loadouts,
    preferences: snapshot.preferences
  };
}

function buildSnapshotStats(profile) {
  return {
    summary: {
      wins: Number(profile?.wins ?? 0),
      losses: Number(profile?.losses ?? 0),
      gamesPlayed: Number(profile?.gamesPlayed ?? 0),
      warsEntered: Number(profile?.warsEntered ?? 0),
      warsWon: Number(profile?.warsWon ?? 0),
      cardsCaptured: Number(profile?.cardsCaptured ?? 0)
    },
    modes: profile?.modeStats ?? null
  };
}

function buildProfileSnapshot({ profile, challenges }) {
  const cosmetics = buildSnapshotCosmetics(profile);
  const stats = buildSnapshotStats(profile);
  const currency = {
    tokens: Number(profile?.tokens ?? 0)
  };

  return {
    authority: "server",
    source: "multiplayer",
    username: profile?.username ?? null,
    profile: {
      ...profile,
      username: profile?.username ?? null,
      tokens: currency.tokens,
      equippedCosmetics: cosmetics.equipped,
      ownedCosmetics: cosmetics.owned,
      cosmeticLoadouts: cosmetics.loadouts,
      cosmeticRandomizeAfterMatch: cosmetics.preferences,
      modeStats: stats.modes
    },
    cosmetics,
    stats,
    currency,
    progression: {
      xp: getLevelProgress(profile),
      dailyChallenges: challenges?.daily ?? null,
      weeklyChallenges: challenges?.weekly ?? null,
      dailyLogin: challenges?.dailyLogin ?? null
    }
  };
}

export class MultiplayerProfileAuthority {
  constructor({ coordinator = null, logger = console, ...options } = {}) {
    this.coordinator = coordinator ?? new StateCoordinator(options);
    this.logger = logger;
  }

  async getProfile(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative profile access.");
    }

    this.logger.info?.(`[ProfileAuthority] getProfile -> ${safeUsername} (server)`);

    await this.coordinator.profiles.ensureProfile(safeUsername);
    const challenges = await this.coordinator.getDailyChallenges(safeUsername);
    const profile = await this.coordinator.profiles.getProfile(safeUsername);

    if (!profile) {
      throw new Error(`Failed to load server-authoritative profile for ${safeUsername}.`);
    }

    return buildProfileSnapshot({ profile, challenges });
  }

  async assertProfileClaimAvailable(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative profile claim checks.");
    }

    const existingProfile = await this.coordinator.profiles.getProfile(safeUsername);
    const existingLinkedAccountId = normalizeAuthorityAccountId(existingProfile?.linkedAccountId);
    if (existingLinkedAccountId) {
      const error = new Error(`Profile ${safeUsername} is already linked to another account.`);
      error.code = "PROFILE_ALREADY_CLAIMED";
      throw error;
    }

    return existingProfile;
  }

  async linkProfileToAccount({ username, accountId }) {
    const safeUsername = normalizeAuthorityUsername(username);
    const safeAccountId = normalizeAuthorityAccountId(accountId);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative profile linking.");
    }
    if (!safeAccountId) {
      throw new Error("accountId is required for server-authoritative profile linking.");
    }

    this.logger.info?.(`[ProfileAuthority] linkProfileToAccount -> ${safeUsername} (${safeAccountId})`);

    const existingProfile = await this.coordinator.profiles.getProfile(safeUsername);
    const existingLinkedAccountId = normalizeAuthorityAccountId(existingProfile?.linkedAccountId);
    if (existingLinkedAccountId && existingLinkedAccountId !== safeAccountId) {
      const error = new Error(`Profile ${safeUsername} is already linked to another account.`);
      error.code = "PROFILE_ALREADY_CLAIMED";
      throw error;
    }

    if (!existingProfile) {
      await this.coordinator.profiles.ensureProfile(safeUsername, {
        linkedAccountId: safeAccountId
      });
      this.logger.info?.(`[ProfileAuthority] linkProfileToAccount <- ${safeUsername} (created)`);
      return this.getProfile(safeUsername);
    }

    if (existingLinkedAccountId === safeAccountId) {
      this.logger.info?.(`[ProfileAuthority] linkProfileToAccount <- ${safeUsername} (already-linked)`);
      return this.getProfile(safeUsername);
    }

    await this.coordinator.profiles.updateProfile(safeUsername, (current) => ({
      ...current,
      linkedAccountId: safeAccountId
    }));
    this.logger.info?.(`[ProfileAuthority] linkProfileToAccount <- ${safeUsername} (linked)`);
    return this.getProfile(safeUsername);
  }

  async updateProfile(username, changes) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative profile updates.");
    }

    this.logger.info?.(`[ProfileAuthority] updateProfile -> ${safeUsername} (server)`);

    await this.coordinator.profiles.updateProfile(safeUsername, (current) =>
      typeof changes === "function"
        ? changes(current)
        : {
            ...current,
            ...(changes ?? {})
          }
    );

    this.logger.info?.(`[ProfileAuthority] updateProfile <- ${safeUsername} (success)`);

    return this.getProfile(safeUsername);
  }

  async applyMatchResult({
    username,
    result,
    perspective = "p1",
    settlementKey = null,
    rewards = null,
    rewardDecision = null,
    participantRole = perspective === "p2" ? "guest" : "host"
  }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative match application.");
    }

    const outcome = summarizeMatchOutcome(result, perspective);
    this.logger.info?.(`[ProfileAuthority] applyMatchResult -> ${safeUsername} (${outcome})`);

    const matchResult = await this.coordinator.recordOnlineMatchResult({
      username: safeUsername,
      perspective,
      matchState: result,
      settlementKey
    });

    let rewardGrant = null;
    if (rewardDecision && settlementKey) {
      rewardGrant = await this.coordinator.applyOnlineRewardSettlementDecision({
        username: safeUsername,
        settlementKey,
        rewardDecision,
        participantRole
      });
    } else if (rewards && (rewards.tokens || rewards.xp || rewards.basicChests)) {
      rewardGrant = await this.coordinator.grantOnlineMatchRewards({
        username: safeUsername,
        ...rewards
      });
    }

    this.logger.info?.(
      `[ProfileAuthority] applyMatchResult <- ${safeUsername} (${matchResult?.duplicate ? "duplicate" : "success"})`
    );

    return {
      duplicate: Boolean(matchResult?.duplicate),
      matchResult,
      rewardGrant,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async getCosmetics(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative cosmetics access.");
    }

    this.logger.info?.(`[ProfileAuthority] getCosmetics -> ${safeUsername} (server)`);
    return this.coordinator.getCosmetics(safeUsername);
  }

  async claimDailyLoginReward(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative daily login claims.");
    }

    this.logger.info?.(`[ProfileAuthority] claimDailyLoginReward -> ${safeUsername} (server)`);
    const result = await this.coordinator.claimDailyLoginReward(safeUsername);
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async buyStoreItem({ username, type, cosmeticId }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative store purchases.");
    }

    this.logger.info?.(`[ProfileAuthority] buyStoreItem -> ${safeUsername} (${type ?? "unknown"})`);
    const result = await this.coordinator.buyStoreItem({
      username: safeUsername,
      type,
      cosmeticId
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async openChest({ username, chestType }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative chest opening.");
    }

    this.logger.info?.(
      `[ProfileAuthority] openChest -> ${safeUsername} (${String(chestType ?? "basic")})`
    );
    const result = await this.coordinator.openChest({
      username: safeUsername,
      chestType
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async equipCosmetic({ username, type, cosmeticId }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative cosmetic equip.");
    }

    this.logger.info?.(`[ProfileAuthority] equipCosmetic -> ${safeUsername} (${type ?? "unknown"})`);
    const result = await this.coordinator.equipCosmetic({
      username: safeUsername,
      type,
      cosmeticId
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async updateCosmeticPreferences({ username, patch }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative cosmetic preferences.");
    }

    this.logger.info?.(`[ProfileAuthority] updateCosmeticPreferences -> ${safeUsername} (server)`);
    const result = await this.coordinator.updateCosmeticPreferences({
      username: safeUsername,
      patch
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async randomizeOwnedCosmetics({ username, categories }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative cosmetic randomization.");
    }

    this.logger.info?.(`[ProfileAuthority] randomizeOwnedCosmetics -> ${safeUsername} (server)`);
    const result = await this.coordinator.randomizeOwnedCosmetics({
      username: safeUsername,
      categories
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async saveCosmeticLoadout({ username, slotIndex }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative loadout saves.");
    }

    this.logger.info?.(`[ProfileAuthority] saveCosmeticLoadout -> ${safeUsername} (slot ${slotIndex ?? "?"})`);
    const result = await this.coordinator.saveCosmeticLoadout({
      username: safeUsername,
      slotIndex
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async applyCosmeticLoadout({ username, slotIndex }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative loadout apply.");
    }

    this.logger.info?.(`[ProfileAuthority] applyCosmeticLoadout -> ${safeUsername} (slot ${slotIndex ?? "?"})`);
    const result = await this.coordinator.applyCosmeticLoadout({
      username: safeUsername,
      slotIndex
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async renameCosmeticLoadout({ username, slotIndex, name }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative loadout rename.");
    }

    this.logger.info?.(`[ProfileAuthority] renameCosmeticLoadout -> ${safeUsername} (slot ${slotIndex ?? "?"})`);
    const result = await this.coordinator.renameCosmeticLoadout({
      username: safeUsername,
      slotIndex,
      name
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }
}
