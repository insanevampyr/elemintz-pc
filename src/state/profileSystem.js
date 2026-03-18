import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "./storage/jsonStore.js";
import {
  applyAchievementTokenRewards,
  applyAchievementUnlocks,
  evaluateRetroactiveAchievements,
  normalizeAchievementProgressMap
} from "./achievementSystem.js";
import {
  applyAchievementCosmeticRewards,
  equipCosmetic,
  getCosmeticCatalogForProfile,
  normalizeProfileCosmetics
} from "./cosmeticSystem.js";
import {
  applyMatchStatsToProfile,
  createDefaultProfile,
  normalizeProfileModeStats
} from "./statsTracking.js";
import { normalizeProfileStore } from "./storeSystem.js";
import { normalizeProfileDailyChallenges } from "./dailyChallengesSystem.js";
import { deriveLevelFromXp, normalizeProfileLevelRewards } from "./levelRewardsSystem.js";

function normalizeUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : "Player";
}

async function checkFileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkDirectoryWritable(dirPath) {
  try {
    await fsp.mkdir(dirPath, { recursive: true });
    await fsp.access(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeProfile(profile, { applyRetroactive = false } = {}) {
  let normalized = normalizeProfileDailyChallenges(
    normalizeProfileLevelRewards(
      normalizeProfileStore(
        normalizeProfileCosmetics({
          ...normalizeProfileModeStats(profile),
          achievements: normalizeAchievementProgressMap(profile?.achievements)
        })
      )
    )
  );

  if (applyRetroactive) {
    const retroactiveUnlocks = evaluateRetroactiveAchievements(normalized);
    if (retroactiveUnlocks.length > 0) {
      const withAchievements = applyAchievementUnlocks(normalized, retroactiveUnlocks);
      const withTokens = applyAchievementTokenRewards(withAchievements.profile, withAchievements.unlockEvents);
      const withCosmetics = applyAchievementCosmeticRewards(withTokens.profile, withAchievements.unlockEvents);
      normalized = withCosmetics.profile;
    }
  }

  return {
    ...normalized,
    playerLevel: deriveLevelFromXp(normalized.playerXP)
  };
}

function snapshot(profile) {
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

export class ProfileSystem {
  constructor(options = {}) {
    this.store = new JsonStore("profiles.json", options);
    this.inMemoryProfiles = [];
    this.mutationQueue = Promise.resolve();
  }

  runMutation(task) {
    const run = this.mutationQueue.then(task, task);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }

  async listProfiles() {
    try {
      const profiles = await this.store.read([]);
      if (!Array.isArray(profiles)) {
        await this.store.write([]);
        this.inMemoryProfiles = [];
        return [];
      }

      const normalized = profiles.map((profile) => normalizeProfile(profile, { applyRetroactive: true }));
      if (JSON.stringify(normalized) !== JSON.stringify(profiles)) {
        await this.store.write(normalized);
      }
      this.inMemoryProfiles = normalized;
      return normalized;
    } catch (error) {
      console.error("[ProfileSystem] listProfiles failed", {
        message: error?.message,
        code: error?.code,
        stack: error?.stack,
        filePath: this.store.filePath
      });
      return this.inMemoryProfiles;
    }
  }

  async getProfile(username) {
    const normalized = normalizeUsername(username);
    const profiles = await this.listProfiles();
    return profiles.find((profile) => profile.username === normalized) ?? null;
  }

  async ensureProfile(username, seed = {}) {
    return this.runMutation(async () => {
      const normalized = normalizeUsername(username);
      const filePath = this.store.filePath;
      const dirPath = path.dirname(filePath);

      const fileExists = await checkFileExists(filePath);
      const dirWritable = await checkDirectoryWritable(dirPath);

      console.info("[ProfileSystem] ensureProfile diagnostics", {
        username: normalized,
        dataDir: this.store.dataDir,
        filePath,
        fileExists,
        dirWritable
      });

      try {
        const profiles = await this.listProfiles();
        const existing = profiles.find((profile) => profile.username === normalized);

        if (existing) {
          console.info("[ProfileSystem] ensureProfile existing profile returned", {
            username: normalized
          });
          return existing;
        }

        const createdSeed = {
          ...seed,
          username: normalized
        };

        const created = normalizeProfile({
          ...createDefaultProfile(normalized),
          ...createdSeed
        });

        const nextProfiles = [...profiles, created];

        await this.store.write(nextProfiles);
        this.inMemoryProfiles = nextProfiles;
        console.info("[ProfileSystem] ensureProfile created and persisted profile", {
          username: normalized,
          totalProfiles: nextProfiles.length
        });

        return created;
      } catch (error) {
        const fallbackCreated = normalizeProfile({
          ...createDefaultProfile(normalized),
          ...seed,
          username: normalized
        });

        const hasFallback = this.inMemoryProfiles.some(
          (profile) => profile.username === normalized
        );

        if (!hasFallback) {
          this.inMemoryProfiles = [...this.inMemoryProfiles, fallbackCreated];
        }

        console.error("[ProfileSystem] ensureProfile threw, returning fallback profile", {
          username: normalized,
          message: error?.message,
          code: error?.code,
          stack: error?.stack,
          filePath
        });

        return hasFallback
          ? this.inMemoryProfiles.find((profile) => profile.username === normalized)
          : fallbackCreated;
      }
    });
  }

  async updateProfile(username, updater) {
    return this.runMutation(async () => {
      const normalized = normalizeUsername(username);
      const profiles = await this.listProfiles();
      const index = profiles.findIndex((profile) => profile.username === normalized);

      const nextProfiles = [...profiles];
      const current = index === -1
        ? normalizeProfile(createDefaultProfile(normalized))
        : profiles[index];

      const next = normalizeProfile(
        typeof updater === "function" ? updater(current) : { ...current, ...updater }
      );

      if (index === -1) {
        nextProfiles.push(next);
      } else {
        nextProfiles[index] = next;
      }

      console.info("[ProfileSystem] updateProfile write", {
        before: snapshot(current),
        after: snapshot(next),
        filePath: this.store.filePath
      });

      await this.store.write(nextProfiles);
      this.inMemoryProfiles = nextProfiles;

      const reloadedProfiles = await this.store.read([]);
      const normalizedReloaded = Array.isArray(reloadedProfiles)
        ? reloadedProfiles.map((profile) => normalizeProfile(profile))
        : [];
      this.inMemoryProfiles = normalizedReloaded;

      const reloaded = normalizedReloaded.find((profile) => profile.username === normalized) ?? null;
      console.info("[ProfileSystem] updateProfile reloaded", {
        reloaded: snapshot(reloaded),
        filePath: this.store.filePath
      });

      return reloaded ?? next;
    });
  }

  async applyMatchStats(username, matchStats, mode = "pve") {
    await this.ensureProfile(username);

    return this.updateProfile(username, (current) =>
      applyMatchStatsToProfile(current, matchStats, mode)
    );
  }

  async equipCosmetic(username, type, cosmeticId) {
    return this.updateProfile(username, (current) => equipCosmetic(current, type, cosmeticId));
  }

  async getCosmeticCatalog(username) {
    const profile = await this.ensureProfile(username);
    return getCosmeticCatalogForProfile(profile);
  }
}

