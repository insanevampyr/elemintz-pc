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
import { applyLevelMilestoneChestGrants, normalizeProfileChests } from "./chestSystem.js";
import {
  applyMatchStatsToProfile,
  createDefaultProfile,
  normalizeProfileModeStats
} from "./statsTracking.js";
import { normalizeProfileStore } from "./storeSystem.js";
import { normalizeProfileDailyChallenges } from "./dailyChallengesSystem.js";
import { deriveLevelFromXp, normalizeProfileLevelRewards } from "./levelRewardsSystem.js";

// Bump this constant whenever persisted profile structure needs a new on-disk
// schema step. The migration pipeline below upgrades older records to match it.
export const CURRENT_PROFILE_SCHEMA_VERSION = 1;

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

// Treat profiles with no explicit schema version as version 0 so older saves
// can flow through the migration pipeline without throwing data away.
function getProfileSchemaVersion(profile) {
  const value = Number(profile?.schemaVersion);
  if (!Number.isFinite(value) || value < 1) {
    return 0;
  }

  return Math.floor(value);
}

// Version 0 -> 1 introduces an explicit schema marker only. Every other field
// is preserved exactly as loaded so later normalizers can backfill missing
// values without wiping known-good player progress.
function migrateProfileSchemaV0ToV1(profile) {
  return {
    ...profile,
    schemaVersion: 1
  };
}

// Keep profile migration centralized so every disk-loaded record follows the
// same forward-only upgrade path before the rest of the profile system touches
// it. This protects future save additions from breaking older profile files.
function migrateProfileSchema(profile) {
  const startingVersion = getProfileSchemaVersion(profile);

  if (startingVersion >= CURRENT_PROFILE_SCHEMA_VERSION) {
    console.info("[ProfileSystem] migration skipped - already current", {
      username: profile?.username ?? null,
      schemaVersion: startingVersion
    });
    return {
      profile,
      migrated: false,
      startingVersion,
      endingVersion: startingVersion
    };
  }

  console.info("[ProfileSystem] migration start", {
    username: profile?.username ?? null,
    fromVersion: startingVersion,
    toVersion: CURRENT_PROFILE_SCHEMA_VERSION
  });

  let migratedProfile = { ...profile };
  let workingVersion = startingVersion;

  while (workingVersion < CURRENT_PROFILE_SCHEMA_VERSION) {
    switch (workingVersion) {
      case 0:
        migratedProfile = migrateProfileSchemaV0ToV1(migratedProfile);
        workingVersion = 1;
        console.info("[ProfileSystem] migration applied", {
          username: profile?.username ?? null,
          appliedStep: "0->1"
        });
        break;
      default:
        throw new Error(`Unsupported profile schema migration path: ${workingVersion}`);
    }
  }

  console.info("[ProfileSystem] migration complete", {
    username: profile?.username ?? null,
    fromVersion: startingVersion,
    toVersion: workingVersion
  });

  return {
    profile: migratedProfile,
    migrated: true,
    startingVersion,
    endingVersion: workingVersion
  };
}

// Profile data is loaded from disk before any gameplay/state systems touch it,
// so validate the broad on-disk shape here and repair only the broken pieces.
// This keeps malformed sections from leaking deeper while preserving good data.
function validateAndRepairProfile(profile) {
  const baseProfile =
    profile && typeof profile === "object" && !Array.isArray(profile) ? { ...profile } : {};
  const defaults = createDefaultProfile(normalizeUsername(baseProfile.username));
  const repairs = [];
  let mutated = false;

  // Start validation with a shallow clone so section-level repairs do not
  // mutate the raw object that came back from disk.
  const repairedProfile = {
    ...baseProfile
  };

  console.info("[ProfileSystem] validation start", {
    username: repairedProfile.username ?? null
  });

  // Keep local helpers inside the validator so the repair rules stay
  // centralized in one place and do not affect unrelated persistence code.
  const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const cloneValue = (value) => JSON.parse(JSON.stringify(value));
  const logFieldRepair = (field, previousValue, nextValue) => {
    repairs.push(field);
    mutated = true;
    console.info("[ProfileSystem] validation repaired field", {
      username: repairedProfile.username ?? null,
      field,
      previousType: Array.isArray(previousValue) ? "array" : typeof previousValue,
      nextType: Array.isArray(nextValue) ? "array" : typeof nextValue
    });
  };
  const logSectionRepair = (section, previousValue, nextValue) => {
    repairs.push(section);
    mutated = true;
    console.info("[ProfileSystem] validation repaired section", {
      username: repairedProfile.username ?? null,
      section,
      previousType: Array.isArray(previousValue) ? "array" : typeof previousValue,
      nextType: Array.isArray(nextValue) ? "array" : typeof nextValue
    });
  };
  const repairNumericField = (field, fallback, { min = 0 } = {}) => {
    const currentValue = repairedProfile[field];
    const numeric = Number(currentValue);
    const nextValue = Number.isFinite(numeric) ? Math.max(min, Math.floor(numeric)) : fallback;

    if (!Number.isFinite(numeric) || nextValue !== currentValue) {
      repairedProfile[field] = nextValue;
      logFieldRepair(field, currentValue, nextValue);
    }
  };
  const repairObjectSection = (section, fallbackValue) => {
    const currentValue = repairedProfile[section];
    if (!isPlainObject(currentValue)) {
      const nextValue = cloneValue(fallbackValue);
      repairedProfile[section] = nextValue;
      logSectionRepair(section, currentValue, nextValue);
    }
  };
  const repairArraySection = (section, fallbackValue) => {
    const currentValue = repairedProfile[section];
    if (!Array.isArray(currentValue)) {
      const nextValue = cloneValue(fallbackValue);
      repairedProfile[section] = nextValue;
      logSectionRepair(section, currentValue, nextValue);
    }
  };

  // Repair critical numeric counters individually so one malformed value does
  // not force a broader profile reset.
  repairNumericField("tokens", defaults.tokens);
  repairNumericField("wins", defaults.wins);
  repairNumericField("losses", defaults.losses);
  repairNumericField("gamesPlayed", defaults.gamesPlayed);
  repairNumericField("warsEntered", defaults.warsEntered);
  repairNumericField("warsWon", defaults.warsWon);
  repairNumericField("playerXP", defaults.playerXP);
  repairNumericField("playerLevel", defaults.playerLevel, { min: 1 });
  repairNumericField("cardsCaptured", defaults.cardsCaptured);
  repairNumericField("longestWar", defaults.longestWar);
  repairNumericField("matchesUsingAllElements", defaults.matchesUsingAllElements);

  // Repair top-level object/array sections independently so unrelated valid
  // progress is preserved even when one subsection is broken.
  repairObjectSection("achievements", defaults.achievements);
  repairObjectSection("dailyChallenges", defaults.dailyChallenges);
  repairObjectSection("modeStats", defaults.modeStats);
  repairObjectSection("ownedCosmetics", defaults.ownedCosmetics);
  repairObjectSection("equippedCosmetics", defaults.equippedCosmetics);
  repairObjectSection("cosmetics", defaults.cosmetics);
  repairObjectSection("levelRewardsClaimed", defaults.levelRewardsClaimed);
  repairObjectSection("cosmeticUnlockTracking", defaults.cosmeticUnlockTracking);
  repairObjectSection(
    "acknowledgedLoadoutUnlockSlots",
    isPlainObject(repairedProfile.loadoutUnlockNoticesSeen)
      ? repairedProfile.loadoutUnlockNoticesSeen
      : defaults.acknowledgedLoadoutUnlockSlots
  );
  repairObjectSection("chests", defaults.chests);
  repairObjectSection("onlineDisconnectTracking", defaults.onlineDisconnectTracking);
  repairArraySection("cosmeticLoadouts", defaults.cosmeticLoadouts);

  // Repair nested structures inside mode stats so downstream stat math always
  // receives objects for each mode bucket.
  for (const modeKey of Object.keys(defaults.modeStats)) {
    const currentModeStats = repairedProfile.modeStats?.[modeKey];
    if (!isPlainObject(currentModeStats)) {
      const nextModeStats = cloneValue(defaults.modeStats[modeKey]);
      repairedProfile.modeStats = {
        ...repairedProfile.modeStats,
        [modeKey]: nextModeStats
      };
      logSectionRepair(`modeStats.${modeKey}`, currentModeStats, nextModeStats);
    }
  }

  // Repair nested cosmetic object shapes so cosmetic normalization can safely
  // validate IDs without first handling null/wrong-type containers.
  const previousElementVariants = repairedProfile.equippedCosmetics?.elementCardVariant;
  if (
    !isPlainObject(previousElementVariants) &&
    typeof previousElementVariants !== "string"
  ) {
    const nextVariants = cloneValue(defaults.equippedCosmetics.elementCardVariant);
    repairedProfile.equippedCosmetics = {
      ...repairedProfile.equippedCosmetics,
      elementCardVariant: nextVariants
    };
    logSectionRepair(
      "equippedCosmetics.elementCardVariant",
      previousElementVariants,
      nextVariants
    );
  }

  const previousNestedCosmetics = repairedProfile.cosmetics?.equipped;
  if (
    previousNestedCosmetics != null &&
    !isPlainObject(previousNestedCosmetics)
  ) {
    const nextEquippedSnapshot = {
      avatar: defaults.equippedCosmetics.avatar,
      cardBack: defaults.equippedCosmetics.cardBack,
      background: defaults.equippedCosmetics.background,
      badge: defaults.equippedCosmetics.badge,
      title: defaults.equippedCosmetics.title,
      elementCardVariant: cloneValue(defaults.equippedCosmetics.elementCardVariant)
    };
    repairedProfile.cosmetics = {
      ...repairedProfile.cosmetics,
      equipped: nextEquippedSnapshot
    };
    logSectionRepair(
      "cosmetics.equipped",
      previousNestedCosmetics,
      nextEquippedSnapshot
    );
  }

  // Repair nested disconnect tracking counters and timestamp arrays so online
  // moderation/support data remains safe to consume without wiping the section.
  const disconnectDefaults = defaults.onlineDisconnectTracking;
  const disconnectTracking = {
    ...repairedProfile.onlineDisconnectTracking
  };

  for (const numericField of [
    "totalLiveMatchDisconnects",
    "totalReconnectTimeoutExpirations",
    "totalSuccessfulReconnectResumes"
  ]) {
    const currentValue = disconnectTracking[numericField];
    const numeric = Number(currentValue);
    const nextValue = Number.isFinite(numeric)
      ? Math.max(0, Math.floor(numeric))
      : disconnectDefaults[numericField];

    if (!Number.isFinite(numeric) || nextValue !== currentValue) {
      disconnectTracking[numericField] = nextValue;
      logFieldRepair(`onlineDisconnectTracking.${numericField}`, currentValue, nextValue);
    }
  }

  for (const arrayField of ["recentDisconnectTimestamps", "recentExpirationTimestamps"]) {
    const currentValue = disconnectTracking[arrayField];
    if (!Array.isArray(currentValue)) {
      const nextValue = cloneValue(disconnectDefaults[arrayField]);
      disconnectTracking[arrayField] = nextValue;
      logSectionRepair(`onlineDisconnectTracking.${arrayField}`, currentValue, nextValue);
    }
  }

  repairedProfile.onlineDisconnectTracking = disconnectTracking;

  if (repairs.length === 0) {
    console.info("[ProfileSystem] validation idempotent - no changes applied", {
      username: repairedProfile.username ?? null
    });
    console.info("[ProfileSystem] validation skipped - already valid", {
      username: repairedProfile.username ?? null
    });
  }

  console.info("[ProfileSystem] validation complete", {
    username: repairedProfile.username ?? null,
    repairedCount: repairs.length
  });

  return {
    profile: repairedProfile,
    mutated
  };
}

export function normalizeProfile(profile, { applyRetroactive = false } = {}) {
  // Always migrate first so older records keep their existing data and only
  // receive the minimum schema changes needed before default filling happens.
  const migration = migrateProfileSchema(profile);
  const migratedProfile = migration.profile;

  // Validate the migrated profile before deeper normalizers run so malformed
  // sections are repaired centrally and valid sections remain untouched.
  const validation = validateAndRepairProfile(migratedProfile);
  const { profile: validatedProfile, mutated } = validation;

  const normalizedDisconnectTracking = {
    totalLiveMatchDisconnects: Math.max(0, Number(validatedProfile?.onlineDisconnectTracking?.totalLiveMatchDisconnects ?? 0)),
    totalReconnectTimeoutExpirations: Math.max(0, Number(validatedProfile?.onlineDisconnectTracking?.totalReconnectTimeoutExpirations ?? 0)),
    totalSuccessfulReconnectResumes: Math.max(0, Number(validatedProfile?.onlineDisconnectTracking?.totalSuccessfulReconnectResumes ?? 0)),
    recentDisconnectTimestamps: Array.isArray(validatedProfile?.onlineDisconnectTracking?.recentDisconnectTimestamps)
      ? validatedProfile.onlineDisconnectTracking.recentDisconnectTimestamps
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
          .slice(-10)
      : [],
    recentExpirationTimestamps: Array.isArray(validatedProfile?.onlineDisconnectTracking?.recentExpirationTimestamps)
      ? validatedProfile.onlineDisconnectTracking.recentExpirationTimestamps
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
          .slice(-10)
      : []
  };

  let normalized = normalizeProfileDailyChallenges(
    normalizeProfileLevelRewards(
      normalizeProfileChests(
        normalizeProfileStore(
          normalizeProfileCosmetics({
            ...normalizeProfileModeStats(validatedProfile),
            achievements: normalizeAchievementProgressMap(validatedProfile?.achievements),
            onlineDisconnectTracking: normalizedDisconnectTracking
          })
        )
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

  normalized = applyLevelMilestoneChestGrants({
    ...normalized,
    playerLevel: deriveLevelFromXp(normalized.playerXP)
  });

  const finalNormalizedProfile = {
    ...normalized,
    // Persist the current schema marker after migration/default filling so
    // upgraded records are written back in their latest supported shape.
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    playerLevel: deriveLevelFromXp(normalized.playerXP)
  };

  // If validation reported a true no-op, the remaining normalization pipeline
  // should also behave as a no-op for already-valid data. Warn when that
  // expectation is violated so future persistence changes do not silently
  // reintroduce repeated rewrites.
  if (!mutated && JSON.stringify(finalNormalizedProfile) !== JSON.stringify(validatedProfile)) {
    console.warn("[ProfileSystem] WARNING: normalization introduced unexpected mutation", {
      username: validatedProfile?.username ?? null
    });
  }

  return finalNormalizedProfile;
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

  async applyMatchStats(username, matchStats, mode = "pve", options = {}) {
    await this.ensureProfile(username);

    return this.updateProfile(username, (current) =>
      applyMatchStatsToProfile(current, matchStats, mode, options)
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

