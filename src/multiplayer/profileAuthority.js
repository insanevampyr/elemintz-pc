import { StateCoordinator } from "../state/stateCoordinator.js";
import {
  buildAuthoritativeCosmeticSnapshot,
  getCosmeticCatalogForProfile,
  getCosmeticDisplayName
} from "../state/cosmeticSystem.js";
import { getLevelProgress } from "../state/levelRewardsSystem.js";

function normalizeAuthorityUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuthorityAccountId(accountId) {
  const normalized = String(accountId ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildOnlineLatestBattleContext(rewardDecision, participantRole = "host") {
  const normalizedRole = participantRole === "guest" ? "guest" : "host";
  const participants = rewardDecision?.participants ?? null;
  if (!participants || typeof participants !== "object") {
    return null;
  }

  const opponentUsername = String(
    normalizedRole === "guest"
      ? participants.hostUsername ?? ""
      : participants.guestUsername ?? ""
  ).trim();
  const opponentUserId = String(
    normalizedRole === "guest"
      ? participants.hostUserId ?? participants.hostAccountId ?? ""
      : participants.guestUserId ?? participants.guestAccountId ?? ""
  ).trim();

  if (!opponentUsername && !opponentUserId) {
    return null;
  }

  return {
    opponentName: opponentUsername || null,
    opponentUsername: opponentUsername || null,
    opponentUserId: opponentUserId || null
  };
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

const PUBLIC_TROPHY_SHELF_LIMIT = 3;
const PUBLIC_TROPHY_RARITY_RANK = Object.freeze({
  Unique: 0,
  Legendary: 1,
  Epic: 2,
  Rare: 3,
  Common: 4
});
const PUBLIC_TROPHY_TYPE_LABELS = Object.freeze({
  avatar: "Avatar",
  title: "Title",
  badge: "Badge",
  background: "Background",
  cardBack: "Card Back"
});

function titleCase(value) {
  const safeValue = String(value ?? "").trim().toLowerCase();
  return safeValue ? `${safeValue[0].toUpperCase()}${safeValue.slice(1)}` : "";
}

function getPublicTrophyTypeLabel(type, definition = {}) {
  if (type === "elementCardVariant") {
    const elementLabel = titleCase(definition?.element);
    return elementLabel ? `${elementLabel} Variant` : "Variant";
  }

  return PUBLIC_TROPHY_TYPE_LABELS[type] ?? "Cosmetic";
}

function buildPublicTrophyShelf(profile) {
  const sourceCatalog = getCosmeticCatalogForProfile(profile);
  const selected = [];
  const seenKeys = new Set();

  for (const [type, entries] of Object.entries(sourceCatalog ?? {})) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (!entry?.owned || !entry?.id || entry?.defaultOwned) {
        continue;
      }

      const dedupeKey = `${type}:${entry.id}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      const rarity = titleCase(entry.rarity) || "Common";
      selected.push({
        id: entry.id,
        type,
        name: entry.name ?? getCosmeticDisplayName(type, entry.id, entry.id),
        rarity,
        rarityRank: PUBLIC_TROPHY_RARITY_RANK[rarity] ?? PUBLIC_TROPHY_RARITY_RANK.Common,
        typeLabel: getPublicTrophyTypeLabel(type, entry),
        image: entry.image ?? null,
        collection: entry.collection ?? null,
        equipped: Boolean(entry.equipped)
      });
    }
  }

  return selected
    .sort((left, right) => {
      if (left.rarityRank !== right.rarityRank) {
        return left.rarityRank - right.rarityRank;
      }
      if (left.equipped !== right.equipped) {
        return left.equipped ? -1 : 1;
      }

      const nameComparison = String(left.name ?? "").localeCompare(String(right.name ?? ""));
      if (nameComparison !== 0) {
        return nameComparison;
      }

      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    })
    .slice(0, PUBLIC_TROPHY_SHELF_LIMIT)
    .map(({ rarityRank, ...item }) => item);
}

function buildPublicSnapshotCosmetics(profile) {
  const snapshot = buildAuthoritativeCosmeticSnapshot(profile);
  const trophyShelf = buildPublicTrophyShelf(profile);

  return {
    authority: "server",
    source: "profileAuthority",
    snapshot: {
      equipped: snapshot.equipped
    },
    equipped: snapshot.equipped,
    trophyShelf
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

function sanitizePublicLongestMatch(profile) {
  const candidate = profile?.longestMatch;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const rounds = Math.max(0, Number(candidate.rounds ?? 0) || 0);
  const mode = String(candidate.mode ?? "").trim();
  const result = String(candidate.result ?? "").trim();
  if (!rounds || !mode || !result) {
    return null;
  }

  const normalizeOptionalString = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  };
  const normalizeOptionalCount = (value) => {
    if (value == null) {
      return null;
    }
    return Math.max(0, Number(value ?? 0) || 0);
  };

  return {
    rounds,
    mode,
    opponentId: normalizeOptionalString(candidate.opponentId),
    opponentName: normalizeOptionalString(candidate.opponentName),
    result,
    capturedFor: normalizeOptionalCount(candidate.capturedFor),
    capturedAgainst: normalizeOptionalCount(candidate.capturedAgainst),
    achievedAt: normalizeOptionalString(candidate.achievedAt)
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

function buildPublicProfileSnapshot({ profile }) {
  const cosmetics = buildPublicSnapshotCosmetics(profile);
  const stats = buildSnapshotStats(profile);
  const currency = {
    tokens: Number(profile?.tokens ?? 0)
  };
  const publicTitle =
    getCosmeticDisplayName(
      "title",
      cosmetics.equipped?.title ?? profile?.equippedCosmetics?.title ?? profile?.title,
      profile?.title ?? "Initiate"
    ) ?? "Initiate";

  return {
    authority: "server",
    source: "multiplayer",
    username: profile?.username ?? null,
    profile: {
      username: profile?.username ?? null,
      title: publicTitle,
      playerXP: Number(profile?.playerXP ?? 0),
      playerLevel: Number(profile?.playerLevel ?? 1),
      tokens: currency.tokens,
      wins: stats.summary.wins,
      losses: stats.summary.losses,
      gamesPlayed: stats.summary.gamesPlayed,
      warsEntered: stats.summary.warsEntered,
      warsWon: stats.summary.warsWon,
      cardsCaptured: stats.summary.cardsCaptured,
      longestWar: Number(profile?.longestWar ?? 0),
      bestWinStreak: Number(profile?.bestWinStreak ?? 0),
      featuredRivalWins: Number(profile?.featuredRivalWins ?? 0),
      gauntletBestStreak: Number(profile?.gauntletBestStreak ?? 0),
      gauntletRuns: Number(profile?.gauntletRuns ?? 0),
      gauntletWins: Number(profile?.gauntletWins ?? 0),
      gauntletLosses: Number(profile?.gauntletLosses ?? 0),
      gauntletRivalsDefeated: Number(profile?.gauntletRivalsDefeated ?? 0),
      longestMatch: sanitizePublicLongestMatch(profile),
      achievements: profile?.achievements ?? {},
      modeStats: stats.modes,
      equippedCosmetics: cosmetics.equipped,
      trophyShelf: cosmetics.trophyShelf
    },
    cosmetics,
    stats,
    currency,
    progression: {
      xp: getLevelProgress(profile)
    }
  };
}

export class MultiplayerProfileAuthority {
  constructor({ coordinator = null, logger = console, announcementStore = null, accountStore = null, ...options } = {}) {
    this.coordinator = coordinator ?? new StateCoordinator(options);
    this.logger = logger;
    this.announcementStore = announcementStore;
    this.accountStore = accountStore;
    this.founderGrantFlights = new Map();
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

  async viewProfile(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative viewed profile access.");
    }

    this.logger.info?.(`[ProfileAuthority] viewProfile -> ${safeUsername} (server)`);
    const resolved = await this.resolveViewedProfileIdentity(safeUsername);
    const profile = resolved?.profile ?? null;

    if (!profile) {
      this.logger.info?.("[ProfileAuthority] viewProfile miss", {
        requestedUsername: safeUsername,
        normalizedUsername: safeUsername,
        resolutionPath: "notFound",
        reason: resolved?.reason ?? "unknown"
      });
      const error = new Error(`Profile ${safeUsername} was not found.`);
      error.code = "PROFILE_NOT_FOUND";
      throw error;
    }

    this.logger.info?.("[ProfileAuthority] viewProfile resolved", {
      requestedUsername: safeUsername,
      normalizedUsername: safeUsername,
      resolutionPath: resolved?.resolutionPath ?? "directProfile",
      resolvedProfileKey: resolved?.resolvedProfileKey ?? profile?.username ?? safeUsername,
      resolvedProfileUsername: profile?.username ?? null
    });

    return buildPublicProfileSnapshot({ profile });
  }

  async resolveViewedProfileIdentity(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      return {
        profile: null,
        resolutionPath: "notFound",
        reason: "missingUsername",
        resolvedProfileKey: null
      };
    }

    try {
      const directProfile = await this.coordinator.profiles.getProfile(safeUsername);
      if (directProfile) {
        return {
          profile: directProfile,
          resolutionPath: "directProfile",
          reason: null,
          resolvedProfileKey: directProfile?.username ?? safeUsername
        };
      }

      if (typeof this.accountStore?.getAccountByUsername !== "function") {
        return {
          profile: null,
          resolutionPath: "notFound",
          reason: "noDirectProfileOrAccountMatch",
          resolvedProfileKey: null
        };
      }

      const account = await this.accountStore.getAccountByUsername(safeUsername);
      const profileKey = normalizeAuthorityUsername(account?.profileKey);
      if (!profileKey) {
        return {
          profile: null,
          resolutionPath: "notFound",
          reason: account ? "accountMissingProfileKey" : "noDirectProfileOrAccountMatch",
          resolvedProfileKey: null
        };
      }

      const resolvedProfile = await this.coordinator.profiles.getProfile(profileKey);
      if (!resolvedProfile) {
        return {
          profile: null,
          resolutionPath: "notFound",
          reason: "accountProfileKeyMissingProfile",
          resolvedProfileKey: profileKey
        };
      }

      return {
        profile: resolvedProfile,
        resolutionPath: "accountProfileKey",
        reason: null,
        resolvedProfileKey: profileKey
      };
    } catch (error) {
      this.logger.warn?.("[ProfileAuthority] viewProfile resolution failed", {
        requestedUsername: safeUsername,
        normalizedUsername: safeUsername,
        resolutionPath: "notFound",
        reason: "profileReadFailure",
        message: String(error?.message ?? "Unknown profile read failure."),
        code: String(error?.code ?? "").trim() || null
      });
      throw error;
    }
  }

  async isProfileClaimed(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      return false;
    }

    const existingProfile = await this.coordinator.profiles.getProfile(safeUsername);
    return Boolean(normalizeAuthorityAccountId(existingProfile?.linkedAccountId));
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

  async acknowledgeAnnouncement({ username, key }) {
    const safeUsername = normalizeAuthorityUsername(username);
    const safeKey = String(key ?? "").trim();
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative announcement updates.");
    }
    if (!safeKey) {
      throw new Error("announcement key is required for server-authoritative announcement updates.");
    }

    this.logger.info?.(`[ProfileAuthority] acknowledgeAnnouncement -> ${safeUsername} (${safeKey})`);

    await this.coordinator.profiles.updateProfile(safeUsername, (current) => ({
      ...current,
      seenAnnouncements: {
        ...(current?.seenAnnouncements ?? {}),
        [safeKey]: true
      }
    }));

    const snapshot = await this.getProfile(safeUsername);
    return {
      key: safeKey,
      seen: Boolean(snapshot?.profile?.seenAnnouncements?.[safeKey]),
      snapshot
    };
  }

  async listAnnouncements(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative announcement access.");
    }
    if (!this.announcementStore) {
      throw new Error("Server announcement store is not available.");
    }

    this.logger.info?.(`[ProfileAuthority] listAnnouncements -> ${safeUsername}`);
    const snapshot = await this.getProfile(safeUsername);
    const announcements = await this.announcementStore.listActiveAnnouncements({
      seenAnnouncements: snapshot?.profile?.seenAnnouncements ?? {}
    });
    return {
      announcements,
      snapshot
    };
  }

  async dismissAnnouncement({ username, id }) {
    const safeUsername = normalizeAuthorityUsername(username);
    const safeId = String(id ?? "").trim();
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative announcement dismissal.");
    }
    if (!safeId) {
      throw new Error("announcement id is required for server-authoritative dismissal.");
    }
    if (!this.announcementStore) {
      throw new Error("Server announcement store is not available.");
    }

    this.logger.info?.(`[ProfileAuthority] dismissAnnouncement -> ${safeUsername} (${safeId})`);
    const result = await this.acknowledgeAnnouncement({
      username: safeUsername,
      key: `announcement:${safeId}`
    });
    const snapshot = result?.snapshot ?? (await this.getProfile(safeUsername));
    const announcements = await this.announcementStore.listActiveAnnouncements({
      seenAnnouncements: snapshot?.profile?.seenAnnouncements ?? {}
    });
    return {
      id: safeId,
      snapshot,
      announcements
    };
  }

  async applyMatchResult({
    username,
    result,
    perspective = "p1",
    settlementKey = null,
    rewards = null,
    rewardDecision = null,
    latestBattleContext = null,
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
      settlementKey,
      latestBattleContext:
        latestBattleContext ?? buildOnlineLatestBattleContext(rewardDecision, participantRole)
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

  async applyLocalMatchResult({
    username,
    result,
    perspective = "p1",
    settlementKey = null,
    latestBattleContext = null
  }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative local match application.");
    }

    const outcome = summarizeMatchOutcome(result, perspective);
    this.logger.info?.(`[ProfileAuthority] applyLocalMatchResult -> ${safeUsername} (${outcome})`);

    const matchResult = await this.coordinator.recordMatchResult({
      username: safeUsername,
      perspective,
      matchState: result,
      settlementKey,
      latestBattleContext
    });

    return {
      duplicate: Boolean(matchResult?.duplicate),
      matchResult,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async applyLocalHotseatResult({
    username,
    result,
    perspective = "p1",
    settlementKey = null,
    latestBattleContext = null
  }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative local hotseat application.");
    }

    const outcome = summarizeMatchOutcome(result, perspective);
    this.logger.info?.(`[ProfileAuthority] applyLocalHotseatResult -> ${safeUsername} (${outcome})`);

    const matchResult = await this.coordinator.recordLocalHotseatResult({
      username: safeUsername,
      perspective,
      matchState: result,
      settlementKey,
      latestBattleContext
    });

    return {
      duplicate: Boolean(matchResult?.duplicate),
      matchResult,
      snapshot: await this.getProfile(safeUsername)
    };
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
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative gauntlet stat persistence.");
    }

    this.logger.info?.(`[ProfileAuthority] recordGauntletStats -> ${safeUsername} (server)`);
    const result = await this.coordinator.recordGauntletStats({
      username: safeUsername,
      runStarted,
      matchWon,
      runEndedWithLoss,
      currentStreak,
      claimedMilestoneStreaks,
      matchState,
      latestBattleContext,
      battleReportAlreadyRecorded,
      perspective,
      nowMs
    });

    return {
      ...result,
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

  async getDailyElementChestStatus(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Daily Element Chest status.");
    }

    this.logger.info?.(`[ProfileAuthority] getDailyElementChestStatus -> ${safeUsername} (server)`);
    return this.coordinator.getDailyElementChestStatus(safeUsername);
  }

  async acknowledgeMilestoneChestReward({ username, level = null }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative milestone reward acknowledgement.");
    }

    this.logger.info?.(
      `[ProfileAuthority] acknowledgeMilestoneChestReward -> ${safeUsername} (${String(level ?? "pending")})`
    );
    const result = await this.coordinator.acknowledgeMilestoneChestReward({
      username: safeUsername,
      level
    });
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

  async openDailyElementChest({ username, openType }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Daily Element Chest opening.");
    }

    this.logger.info?.(
      `[ProfileAuthority] openDailyElementChest -> ${safeUsername} (${String(openType ?? "free")})`
    );
    const result = await this.coordinator.openDailyElementChest({
      username: safeUsername,
      openType
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async applyAdminGrant({ username, xp = 0, tokens = 0, chests = [], cosmetic = null }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative admin grants.");
    }

    this.logger.info?.(`[ProfileAuthority] applyAdminGrant -> ${safeUsername}`);
    const result = await this.coordinator.applyAdminGrant({
      username: safeUsername,
      xp,
      tokens,
      chests,
      cosmetic
    });

    return {
      ...result,
      snapshot: await this.getProfile(safeUsername),
      cosmetics: await this.getCosmetics(safeUsername)
    };
  }

  async grantSpecialCosmetic({ username, type, cosmeticId }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative special cosmetic grants.");
    }
    const existingProfile = await this.coordinator.profiles.getProfile(safeUsername);
    if (!existingProfile) {
      const error = new Error(`Profile '${safeUsername}' was not found.`);
      error.code = "PROFILE_NOT_FOUND";
      throw error;
    }
    this.logger.info?.(`[ProfileAuthority] grantSpecialCosmetic -> ${safeUsername}`);
    const result = await this.coordinator.grantSpecialCosmetic({
      username: safeUsername,
      type,
      cosmeticId
    });
    return {
      ...result,
      snapshot: await this.getProfile(safeUsername),
      cosmetics: await this.getCosmetics(safeUsername)
    };
  }

  async grantFounderStatus({ username }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative founder grants.");
    }

    const existingFlight = this.founderGrantFlights.get(safeUsername);
    if (existingFlight) {
      return existingFlight;
    }

    const flight = (async () => {
      this.logger.info?.(`[ProfileAuthority] grantFounderStatus -> ${safeUsername}`);
      const result = await this.coordinator.grantFounderStatus(safeUsername);
      return {
        ...result,
        snapshot: await this.getProfile(safeUsername),
        cosmetics: await this.getCosmetics(safeUsername)
      };
    })();

    this.founderGrantFlights.set(safeUsername, flight);
    try {
      return await flight;
    } finally {
      if (this.founderGrantFlights.get(safeUsername) === flight) {
        this.founderGrantFlights.delete(safeUsername);
      }
    }
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
