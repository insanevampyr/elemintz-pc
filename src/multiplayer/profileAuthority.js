import { StateCoordinator } from "../state/stateCoordinator.js";
import { getLevelProgress } from "../state/levelRewardsSystem.js";

function normalizeAuthorityUsername(username) {
  const normalized = String(username ?? "").trim();
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

function buildProfileSnapshot({ profile, challenges }) {
  return {
    authority: "server",
    source: "multiplayer",
    profile,
    cosmetics: {
      equipped: profile?.equippedCosmetics ?? null,
      owned: profile?.ownedCosmetics ?? null
    },
    stats: profile?.modeStats ?? null,
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
    rewards = null
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
    if (rewards && (rewards.tokens || rewards.xp || rewards.basicChests)) {
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
}
