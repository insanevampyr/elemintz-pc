import { StateCoordinator } from "../state/stateCoordinator.js";
import {
  buildAuthoritativeCosmeticSnapshot,
  getCosmeticCatalogForProfile,
  getCosmeticDisplayName,
  resolveProfileShowcaseSlots
} from "../state/cosmeticSystem.js";
import {
  buildOwnCollectionAlbumsView,
  buildPublicCollectionAlbumsSummary
} from "../state/collectionAlbums.js";
import { getLevelProgress } from "../state/levelRewardsSystem.js";

function normalizeAuthorityUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuthorityAccountId(accountId) {
  const normalized = String(accountId ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeProfileResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || !result.profile) {
    return result;
  }
  const {
    uniqueCosmeticAcquisitions: _uniqueCosmeticAcquisitions,
    referralRewardGrantIds: _referralRewardGrantIds,
    ...publicProfile
  } = result.profile;
  return {
    ...result,
    profile: publicProfile
  };
}

function sanitizeCollectionPackPurchaseResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  return {
    purchase: result.purchase ?? null,
    tracking: result.tracking ?? null,
    transaction: result.transaction
      ? {
          status: result.transaction.status ?? null,
          duplicate: Boolean(result.transaction.duplicate)
        }
      : null,
    store: result.store ?? null,
    deals: Array.isArray(result.deals) ? result.deals : []
  };
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
  const opponentProfileKey = String(
    normalizedRole === "guest"
      ? participants.hostProfileKey ?? ""
      : participants.guestProfileKey ?? ""
  ).trim();
  const displayCosmetics =
    normalizedRole === "guest"
      ? participants.hostDisplayCosmetics
      : participants.guestDisplayCosmetics;

  if (!opponentUsername && !opponentUserId && !opponentProfileKey) {
    return null;
  }

  return {
    opponentName: opponentUsername || null,
    opponentUsername: opponentUsername || null,
    opponentUserId: opponentUserId || null,
    opponentProfileKey: opponentProfileKey || null,
    opponentDisplayCosmetics:
      displayCosmetics && typeof displayCosmetics === "object" && !Array.isArray(displayCosmetics)
        ? {
            avatar: String(displayCosmetics.avatar ?? "").trim() || null,
            title: String(displayCosmetics.title ?? "").trim() || null
          }
        : null
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

function classifyReferralQualificationMode(result = {}) {
  if (String(result?.gauntletRivalId ?? "").trim() || result?.gauntletMode === true) {
    return "gauntlet";
  }
  if (String(result?.featuredRivalId ?? "").trim()) {
    return "featured_rival";
  }

  const mode = String(result?.mode ?? "").trim().toLowerCase();
  return ["pve", "online_pvp", "blood_match"].includes(mode) ? mode : null;
}

function buildBloodMatchReferralQualificationResult(summary = {}) {
  const terminalResult = String(summary?.terminalResult?.result ?? "").trim().toLowerCase();
  return {
    mode: "blood_match",
    status: summary?.status,
    endReason: summary?.endReason,
    winner:
      terminalResult === "player_win"
        ? "p1"
        : terminalResult === "player_loss"
          ? "p2"
          : "draw"
  };
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

function buildPublicTrophyShelf(profile, specialRecords = []) {
  const publicCreatedForById = new Map(
    (Array.isArray(specialRecords) ? specialRecords : [])
      .filter((record) => record?.cosmeticId && record?.createdForUsername)
      .map((record) => [record.cosmeticId, record.createdForUsername])
  );
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
        ...(rarity === "Unique" && publicCreatedForById.has(entry.id)
          ? { createdForUsername: publicCreatedForById.get(entry.id) }
          : {}),
        ...(rarity === "Unique" && entry.acquisitionLabel
          ? { acquisitionLabel: entry.acquisitionLabel }
          : {}),
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

function buildPublicShowcaseItem(type, entry) {
  if (!entry?.id || !type) {
    return null;
  }

  return {
    type,
    id: entry.id,
    name: entry.name ?? getCosmeticDisplayName(type, entry.id, entry.id),
    rarity: titleCase(entry.rarity) || "Common",
    collection: entry.collection ?? null,
    image: entry.image ?? null,
    ...(entry.element ? { element: entry.element } : {})
  };
}

function buildPublicShowcaseSlots(profile) {
  return resolveProfileShowcaseSlots(profile).map((item) =>
    item ? buildPublicShowcaseItem(item.type, item) : null
  );
}

function buildPublicSnapshotCosmetics(profile, specialRecords = []) {
  const snapshot = buildAuthoritativeCosmeticSnapshot(profile);
  const trophyShelf = buildPublicTrophyShelf(profile, specialRecords);
  const showcaseSlots = buildPublicShowcaseSlots(profile);

  return {
    authority: "server",
    source: "profileAuthority",
    snapshot: {
      equipped: snapshot.equipped
    },
    equipped: snapshot.equipped,
    trophyShelf,
    showcaseSlots
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

function buildPublicBloodMatchStats(profile = {}) {
  return {
    bloodMatchMatchesPlayed: Number(profile?.bloodMatchMatchesPlayed ?? 0),
    bloodMatchWins: Number(profile?.bloodMatchWins ?? 0),
    bloodMatchLosses: Number(profile?.bloodMatchLosses ?? 0),
    bloodMatchCurrentWinStreak: Number(profile?.bloodMatchCurrentWinStreak ?? 0),
    bloodMatchBestWinStreak: Number(profile?.bloodMatchBestWinStreak ?? 0),
    bloodMatchVampireEliminations: Number(profile?.bloodMatchVampireEliminations ?? 0),
    bloodMatchLycanEliminations: Number(profile?.bloodMatchLycanEliminations ?? 0),
    bloodMatchDoubleEliminationWins: Number(profile?.bloodMatchDoubleEliminationWins ?? 0),
    bloodMatchTwoWayWars: Number(profile?.bloodMatchTwoWayWars ?? 0),
    bloodMatchThreeWayWars: Number(profile?.bloodMatchThreeWayWars ?? 0),
    bloodMatchWarsWon: Number(profile?.bloodMatchWarsWon ?? 0),
    bloodMatchWarsLost: Number(profile?.bloodMatchWarsLost ?? 0),
    bloodMatchThreeWayWarsWon: Number(profile?.bloodMatchThreeWayWarsWon ?? 0),
    bloodMatchCardsCaptured: Number(profile?.bloodMatchCardsCaptured ?? 0),
    bloodMatchTimeoutLosses: Number(profile?.bloodMatchTimeoutLosses ?? 0),
    bloodMatchTimeoutWins: Number(profile?.bloodMatchTimeoutWins ?? 0)
  };
}

function buildProfileSnapshot({ profile, challenges }) {
  const cosmetics = buildSnapshotCosmetics(profile);
  const stats = buildSnapshotStats(profile);
  const collectionAlbums = buildOwnCollectionAlbumsView(profile);
  const currency = {
    tokens: Number(profile?.tokens ?? 0)
  };
  const {
    uniqueCosmeticAcquisitions: _uniqueCosmeticAcquisitions,
    collectionAlbums: _collectionAlbums,
    referralRewardGrantIds: _referralRewardGrantIds,
    ...clientProfile
  } = profile ?? {};

  return {
    authority: "server",
    source: "multiplayer",
    username: profile?.username ?? null,
    profile: {
      ...clientProfile,
      username: profile?.username ?? null,
      tokens: currency.tokens,
      equippedCosmetics: cosmetics.equipped,
      ownedCosmetics: cosmetics.owned,
      cosmeticLoadouts: cosmetics.loadouts,
      cosmeticRandomizeAfterMatch: cosmetics.preferences,
      modeStats: stats.modes,
      collectionAlbums
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

function buildPublicProfileSnapshot({ profile, specialRecords = [] }) {
  const cosmetics = buildPublicSnapshotCosmetics(profile, specialRecords);
  const stats = buildSnapshotStats(profile);
  const collectionAlbums = buildPublicCollectionAlbumsSummary(profile);
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
      ...buildPublicBloodMatchStats(profile),
      longestMatch: sanitizePublicLongestMatch(profile),
      achievements: profile?.achievements ?? {},
      modeStats: stats.modes,
      equippedCosmetics: cosmetics.equipped,
      trophyShelf: cosmetics.trophyShelf,
      showcaseSlots: cosmetics.showcaseSlots,
      collectionAlbums
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

    await this.coordinator.ensureUniqueCosmeticAcquisitions(safeUsername);
    const challenges = await this.coordinator.getDailyChallenges(safeUsername);
    const profile = await this.coordinator.profiles.getProfile(safeUsername);

    if (!profile) {
      throw new Error(`Failed to load server-authoritative profile for ${safeUsername}.`);
    }

    return buildProfileSnapshot({ profile, challenges });
  }

  async recordReferralQualificationForMatch({ username, result, settlementKey, snapshot }) {
    if (typeof this.accountStore?.recordReferralQualificationMatch !== "function") {
      return null;
    }

    const mode = classifyReferralQualificationMode(result);
    if (!mode) {
      return null;
    }

    try {
      return await this.accountStore.recordReferralQualificationMatch({
        profileKey: username,
        settlementId: settlementKey,
        mode,
        difficulty: result?.difficulty,
        status: result?.status,
        endReason: result?.endReason,
        winner: result?.winner,
        trainingMode: result?.trainingMode === true,
        playerLevel: snapshot?.profile?.playerLevel ?? 1
      });
    } catch (error) {
      this.logger.error?.("[ProfileAuthority] referral qualification update failed", {
        username,
        mode,
        message: error?.message ?? String(error)
      });
      return null;
    }
  }

  async viewProfile(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative viewed profile access.");
    }

    this.logger.info?.(`[ProfileAuthority] viewProfile -> ${safeUsername} (server)`);
    const resolved = await this.resolveViewedProfileIdentity(safeUsername);
    let profile = resolved?.profile ?? null;

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

    profile = await this.coordinator.ensureUniqueCosmeticAcquisitions(
      profile.username ?? safeUsername
    );

    this.logger.info?.("[ProfileAuthority] viewProfile resolved", {
      requestedUsername: safeUsername,
      normalizedUsername: safeUsername,
      resolutionPath: resolved?.resolutionPath ?? "directProfile",
      resolvedProfileKey: resolved?.resolvedProfileKey ?? profile?.username ?? safeUsername,
      resolvedProfileUsername: profile?.username ?? null
    });

    const specialRecords = await this.coordinator.specialCosmeticRegistry.listRecords();
    return buildPublicProfileSnapshot({ profile, specialRecords });
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

    const snapshot = await this.getProfile(safeUsername);
    const referralQualification = await this.recordReferralQualificationForMatch({
      username: safeUsername,
      result,
      settlementKey,
      snapshot
    });

    return {
      duplicate: Boolean(matchResult?.duplicate),
      matchResult,
      rewardGrant,
      referralQualification,
      snapshot
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

    const snapshot = await this.getProfile(safeUsername);
    const referralQualification = await this.recordReferralQualificationForMatch({
      username: safeUsername,
      result,
      settlementKey,
      snapshot
    });

    return {
      duplicate: Boolean(matchResult?.duplicate),
      matchResult,
      referralQualification,
      snapshot
    };
  }

  async applyBloodMatchResult({
    username,
    summary,
    settlementKey
  } = {}) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Blood Match settlement.");
    }

    this.logger.info?.(`[ProfileAuthority] applyBloodMatchResult -> ${safeUsername} (server)`);
    const matchResult = await this.coordinator.recordBloodMatchResult({
      username: safeUsername,
      summary,
      settlementKey
    });
    const snapshot = await this.getProfile(safeUsername);
    const referralQualification = matchResult?.duplicate
      ? null
      : await this.recordReferralQualificationForMatch({
          username: safeUsername,
          result: buildBloodMatchReferralQualificationResult(summary),
          settlementKey,
          snapshot
        });

    return {
      duplicate: Boolean(matchResult?.duplicate),
      matchResult: sanitizeProfileResult(matchResult),
      referralQualification,
      snapshot
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
      ...sanitizeProfileResult(result),
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

  async getStore(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Store access.");
    }

    this.logger.info?.(`[ProfileAuthority] getStore -> ${safeUsername} (server)`);
    return this.coordinator.getStore(safeUsername);
  }

  async getCollectionPackDeals(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Collection Pack deals.");
    }

    this.logger.info?.(`[ProfileAuthority] getCollectionPackDeals -> ${safeUsername} (server)`);
    return this.coordinator.getCollectionPackDeals(safeUsername);
  }

  async claimDailyLoginReward(username) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative daily login claims.");
    }

    this.logger.info?.(`[ProfileAuthority] claimDailyLoginReward -> ${safeUsername} (server)`);
    const result = await this.coordinator.claimDailyLoginReward(safeUsername);
    return {
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async buyStoreItem({ username, type, cosmeticId, transactionId = null }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative store purchases.");
    }

    this.logger.info?.(`[ProfileAuthority] buyStoreItem -> ${safeUsername} (${type ?? "unknown"})`);
    const result = await this.coordinator.buyStoreItem({
      username: safeUsername,
      type,
      cosmeticId,
      transactionId
    });
    return {
      ...sanitizeProfileResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async buyCollectionPack({ username, packId, transactionId = null }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Collection Pack purchases.");
    }

    this.logger.info?.(
      `[ProfileAuthority] buyCollectionPack -> ${safeUsername} (${String(packId ?? "unknown")})`
    );
    const result = await this.coordinator.buyCollectionPack({
      username: safeUsername,
      packId,
      transactionId
    });
    return {
      ...sanitizeCollectionPackPurchaseResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async listCollectionPacksForAdmin() {
    this.logger.info?.("[ProfileAuthority] listCollectionPacksForAdmin");
    return this.coordinator.listCollectionPacksForAdmin();
  }

  async getCollectionPackForAdmin(packId) {
    this.logger.info?.(`[ProfileAuthority] getCollectionPackForAdmin -> ${String(packId ?? "")}`);
    return this.coordinator.getCollectionPackForAdmin(packId);
  }

  async upsertCollectionPackForAdmin(draft = {}) {
    this.logger.info?.(
      `[ProfileAuthority] upsertCollectionPackForAdmin -> ${String(draft?.packId ?? draft?.id ?? "")}`
    );
    return this.coordinator.upsertCollectionPackForAdmin(draft);
  }

  async previewCollectionPackForAdmin({ draft = {}, username = null } = {}) {
    this.logger.info?.(
      `[ProfileAuthority] previewCollectionPackForAdmin -> ${String(draft?.packId ?? draft?.id ?? "")}`
    );
    return this.coordinator.previewCollectionPackForAdmin({ draft, username });
  }

  async listEligibleCollectionPackCosmeticsForAdmin() {
    this.logger.info?.("[ProfileAuthority] listEligibleCollectionPackCosmeticsForAdmin");
    return this.coordinator.listEligibleCollectionPackCosmeticsForAdmin();
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
        ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async updateProfileShowcaseSlot({ username, slotIndex, cosmetic = null }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Showcase updates.");
    }

    this.logger.info?.(`[ProfileAuthority] updateProfileShowcaseSlot -> ${safeUsername} (slot ${slotIndex ?? "?"})`);
    const result = await this.coordinator.updateProfileShowcaseSlot({
      username: safeUsername,
      slotIndex,
      cosmetic
    });
    return {
      ...sanitizeProfileResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async claimCollectionAlbumReward({ username, albumId }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative Collection Album rewards.");
    }

    this.logger.info?.(`[ProfileAuthority] claimCollectionAlbumReward -> ${safeUsername} (${albumId ?? "unknown"})`);
    const result = await this.coordinator.claimCollectionAlbumReward({
      username: safeUsername,
      albumId
    });
    return {
      ...sanitizeProfileResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }

  async grantReferralRewardTokens({ username, claimId, amount }) {
    const safeUsername = normalizeAuthorityUsername(username);
    if (!safeUsername) {
      throw new Error("username is required for server-authoritative referral rewards.");
    }

    const result = await this.coordinator.grantReferralRewardTokens({
      username: safeUsername,
      claimId,
      amount
    });
    return {
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
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
      ...sanitizeProfileResult(result),
      snapshot: await this.getProfile(safeUsername)
    };
  }
}
