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
import { normalizeProfileDailyElementChest } from "./dailyElementChestSystem.js";
import {
  applyMatchStatsToProfile,
  createDefaultProfile,
  normalizeLongestMatchRecord,
  normalizeProfileModeStats
} from "./statsTracking.js";
import { normalizeProfileStore } from "./storeSystem.js";
import { normalizeProfileDailyChallenges } from "./dailyChallengesSystem.js";
import {
  deriveLevelFromXp,
  getMaxLevelXpThreshold,
  normalizeProfileLevelRewards
} from "./levelRewardsSystem.js";
import { normalizeCollectionAlbumRewardClaims } from "./collectionAlbums.js";

// Bump this constant whenever persisted profile structure needs a new on-disk
// schema step. The migration pipeline below upgrades older records to match it.
export const CURRENT_PROFILE_SCHEMA_VERSION = 1;

const PROFILE_DEBUG_ENABLED = process.env.ELE_DEBUG_PROFILE === "1";

function logProfileDebug(message, details) {
  if (!PROFILE_DEBUG_ENABLED) {
    return;
  }

  if (details === undefined) {
    console.info(message);
    return;
  }

  console.info(message, details);
}

function normalizeUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : "Player";
}

const VAMPYRLEE_LONGEST_MATCH_BACKFILL = Object.freeze({
  rounds: 97,
  mode: "gauntlet",
  opponentId: "vampire_rival",
  opponentName: "Countess Veyra",
  result: "timer_win",
  capturedFor: 43,
  capturedAgainst: 40,
  achievedAt: "2026-06-01T00:00:00.000Z"
});

function applyVampyrLeeLongestMatchBackfill(profile) {
  if (String(profile?.username ?? "").trim() !== "VampyrLee") {
    return profile;
  }

  if (profile?.vampyrLeeLongestMatchBackfillApplied === true) {
    return profile;
  }

  const currentRounds = Number(profile?.longestMatch?.rounds ?? 0) || 0;
  if (currentRounds >= VAMPYRLEE_LONGEST_MATCH_BACKFILL.rounds) {
    return {
      ...profile,
      vampyrLeeLongestMatchBackfillApplied: true
    };
  }

  return {
    ...profile,
    longestMatch: { ...VAMPYRLEE_LONGEST_MATCH_BACKFILL },
    vampyrLeeLongestMatchBackfillApplied: true
  };
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
    logProfileDebug("[ProfileSystem] migration skipped - already current", {
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

  logProfileDebug("[ProfileSystem] migration start", {
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

  logProfileDebug("[ProfileSystem] validation start", {
    username: repairedProfile.username ?? null
  });

  // Keep local helpers inside the validator so the repair rules stay
  // centralized in one place and do not affect unrelated persistence code.
  const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const cloneValue = (value) => JSON.parse(JSON.stringify(value));
  const logFieldRepair = (field, previousValue, nextValue) => {
    repairs.push(field);
    mutated = true;
    logProfileDebug("[ProfileSystem] validation repaired field", {
      username: repairedProfile.username ?? null,
      field,
      previousType: Array.isArray(previousValue) ? "array" : typeof previousValue,
      nextType: Array.isArray(nextValue) ? "array" : typeof nextValue
    });
  };
  const logSectionRepair = (section, previousValue, nextValue) => {
    repairs.push(section);
    mutated = true;
    logProfileDebug("[ProfileSystem] validation repaired section", {
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
  repairNumericField("featuredRivalWins", defaults.featuredRivalWins);
  repairNumericField("gauntletBestStreak", defaults.gauntletBestStreak);
  repairNumericField("gauntletRuns", defaults.gauntletRuns);
  repairNumericField("gauntletWins", defaults.gauntletWins);
  repairNumericField("gauntletLosses", defaults.gauntletLosses);
  repairNumericField("gauntletRivalsDefeated", defaults.gauntletRivalsDefeated);
  repairNumericField("longestWar", defaults.longestWar);
  repairNumericField("matchesUsingAllElements", defaults.matchesUsingAllElements);

  const maxLevelXpThreshold = getMaxLevelXpThreshold();
  if (Number(repairedProfile.playerXP ?? 0) > maxLevelXpThreshold) {
    const previousValue = repairedProfile.playerXP;
    repairedProfile.playerXP = maxLevelXpThreshold;
    logFieldRepair("playerXP", previousValue, maxLevelXpThreshold);
  }

  const derivedPlayerLevel = Math.max(
    1,
    Math.floor(Number(deriveLevelFromXp(repairedProfile.playerXP)) || defaults.playerLevel)
  );
  if (repairedProfile.playerLevel !== derivedPlayerLevel) {
    const previousValue = repairedProfile.playerLevel;
    repairedProfile.playerLevel = derivedPlayerLevel;
    logFieldRepair("playerLevel", previousValue, derivedPlayerLevel);
  }

  // Repair top-level object/array sections independently so unrelated valid
  // progress is preserved even when one subsection is broken.
  repairObjectSection("achievements", defaults.achievements);
  repairObjectSection("dailyChallenges", defaults.dailyChallenges);
  repairObjectSection("modeStats", defaults.modeStats);
  repairObjectSection("ownedCosmetics", defaults.ownedCosmetics);
  repairObjectSection("equippedCosmetics", defaults.equippedCosmetics);
  repairObjectSection("cosmetics", defaults.cosmetics);
  repairObjectSection("seenAnnouncements", defaults.seenAnnouncements);
  repairObjectSection("featuredRivalRewards", defaults.featuredRivalRewards);
  repairObjectSection("collectionAlbumRewardClaims", defaults.collectionAlbumRewardClaims);
  repairObjectSection("levelRewardsClaimed", defaults.levelRewardsClaimed);
  repairObjectSection("cosmeticUnlockTracking", defaults.cosmeticUnlockTracking);
  repairObjectSection("uniqueCosmeticAcquisitions", defaults.uniqueCosmeticAcquisitions);
  repairObjectSection("onlineRewardSettlements", defaults.onlineRewardSettlements);
  repairObjectSection(
    "acknowledgedLoadoutUnlockSlots",
    isPlainObject(repairedProfile.loadoutUnlockNoticesSeen)
      ? repairedProfile.loadoutUnlockNoticesSeen
      : defaults.acknowledgedLoadoutUnlockSlots
  );
  repairObjectSection("chests", defaults.chests);
  repairObjectSection("dailyElementChest", defaults.dailyElementChest);
  repairObjectSection("milestoneChestGrantedLevels", defaults.milestoneChestGrantedLevels);
  repairObjectSection("legendaryChestGrantedLevels", defaults.legendaryChestGrantedLevels);
  repairObjectSection("onlineDisconnectTracking", defaults.onlineDisconnectTracking);
  repairArraySection("cosmeticLoadouts", defaults.cosmeticLoadouts);
  repairArraySection("recentOpponents", defaults.recentOpponents);

  const normalizedLongestMatch = normalizeLongestMatchRecord(repairedProfile.longestMatch);
  if (JSON.stringify(normalizedLongestMatch) !== JSON.stringify(repairedProfile.longestMatch ?? null)) {
    const previousValue = repairedProfile.longestMatch;
    repairedProfile.longestMatch = normalizedLongestMatch;
    logFieldRepair("longestMatch", previousValue, normalizedLongestMatch);
  }

  const normalizedLatestBattle = normalizeLatestBattleSummary(repairedProfile.latestBattle);
  if (JSON.stringify(normalizedLatestBattle) !== JSON.stringify(repairedProfile.latestBattle ?? null)) {
    const previousValue = repairedProfile.latestBattle;
    repairedProfile.latestBattle = normalizedLatestBattle;
    logFieldRepair("latestBattle", previousValue, normalizedLatestBattle);
  }

  const normalizedRecentBattles = normalizeRecentBattles(
    repairedProfile.recentBattles,
    repairedProfile.latestBattle
  );
  if (JSON.stringify(normalizedRecentBattles) !== JSON.stringify(repairedProfile.recentBattles ?? [])) {
    const previousValue = repairedProfile.recentBattles;
    repairedProfile.recentBattles = normalizedRecentBattles;
    logFieldRepair("recentBattles", previousValue, normalizedRecentBattles);
  }

  const normalizedRecentOpponents = normalizeRecentOpponents(
    repairedProfile.recentOpponents,
    repairedProfile.username
  );
  if (JSON.stringify(normalizedRecentOpponents) !== JSON.stringify(repairedProfile.recentOpponents ?? [])) {
    const previousValue = repairedProfile.recentOpponents;
    repairedProfile.recentOpponents = normalizedRecentOpponents;
    logFieldRepair("recentOpponents", previousValue, normalizedRecentOpponents);
  }

  const synchronizedLatestBattle = normalizedRecentBattles[0] ?? normalizedLatestBattle;
  if (JSON.stringify(synchronizedLatestBattle) !== JSON.stringify(repairedProfile.latestBattle ?? null)) {
    const previousValue = repairedProfile.latestBattle;
    repairedProfile.latestBattle = synchronizedLatestBattle;
    logFieldRepair("latestBattle", previousValue, synchronizedLatestBattle);
  }

  const pendingMilestoneChestRewardLevel = Number(repairedProfile.pendingMilestoneChestRewardLevel);
  if (
    repairedProfile.pendingMilestoneChestRewardLevel != null &&
    (!Number.isFinite(pendingMilestoneChestRewardLevel) || pendingMilestoneChestRewardLevel < 1)
  ) {
    const previousValue = repairedProfile.pendingMilestoneChestRewardLevel;
    const nextValue = defaults.pendingMilestoneChestRewardLevel;
    repairedProfile.pendingMilestoneChestRewardLevel = nextValue;
    logFieldRepair("pendingMilestoneChestRewardLevel", previousValue, nextValue);
  }

  const totalOwnedCosmetics = Object.values(repairedProfile.ownedCosmetics ?? {}).reduce(
    (total, values) => total + (Array.isArray(values) ? values.length : 0),
    0
  );
  if (repairedProfile.cosmeticUnlockTracking?.TOTAL_COSMETICS_OWNED !== totalOwnedCosmetics) {
    const previousValue = repairedProfile.cosmeticUnlockTracking?.TOTAL_COSMETICS_OWNED;
    repairedProfile.cosmeticUnlockTracking = {
      ...repairedProfile.cosmeticUnlockTracking,
      TOTAL_COSMETICS_OWNED: totalOwnedCosmetics
    };
    logFieldRepair(
      "cosmeticUnlockTracking.TOTAL_COSMETICS_OWNED",
      previousValue,
      totalOwnedCosmetics
    );
  }

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

  const previousFeaturedRivalRewards = repairedProfile.featuredRivalRewards?.crownfire_duelist;
  if (!isPlainObject(previousFeaturedRivalRewards)) {
    const nextFeaturedRivalRewards = cloneValue(defaults.featuredRivalRewards.crownfire_duelist);
    repairedProfile.featuredRivalRewards = {
      ...repairedProfile.featuredRivalRewards,
      crownfire_duelist: nextFeaturedRivalRewards
    };
    logSectionRepair(
      "featuredRivalRewards.crownfire_duelist",
      previousFeaturedRivalRewards,
      nextFeaturedRivalRewards
    );
  } else if (
    previousFeaturedRivalRewards.lastDailyWinRewardDate != null &&
    (typeof previousFeaturedRivalRewards.lastDailyWinRewardDate !== "string" ||
      !previousFeaturedRivalRewards.lastDailyWinRewardDate.trim())
  ) {
    const nextLastDailyWinRewardDate = defaults.featuredRivalRewards.crownfire_duelist.lastDailyWinRewardDate;
    repairedProfile.featuredRivalRewards = {
      ...repairedProfile.featuredRivalRewards,
      crownfire_duelist: {
        ...previousFeaturedRivalRewards,
        lastDailyWinRewardDate: nextLastDailyWinRewardDate
      }
    };
    logFieldRepair(
      "featuredRivalRewards.crownfire_duelist.lastDailyWinRewardDate",
      previousFeaturedRivalRewards.lastDailyWinRewardDate,
      nextLastDailyWinRewardDate
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
    logProfileDebug("[ProfileSystem] validation idempotent - no changes applied", {
      username: repairedProfile.username ?? null
    });
    logProfileDebug("[ProfileSystem] validation skipped - already valid", {
      username: repairedProfile.username ?? null
    });
  }

  if (repairs.length > 0) {
    console.info("[ProfileSystem] validation complete", {
      username: repairedProfile.username ?? null,
      repairedCount: repairs.length,
      repairedFields: repairs
    });
  } else {
    logProfileDebug("[ProfileSystem] validation complete", {
      username: repairedProfile.username ?? null,
      repairedCount: repairs.length
    });
  }

  return {
    profile: repairedProfile,
    mutated
  };
}

const VALID_LATEST_BATTLE_MODES = new Set([
  "online",
  "pve",
  "localHotseat",
  "gauntlet",
  "featuredRival",
  "bloodMatch"
]);
const VALID_LATEST_BATTLE_RESULTS = new Set(["win", "loss", "draw"]);
const RECENT_BATTLES_LIMIT = 5;
const RECENT_OPPONENTS_LIMIT = 15;

function normalizeLatestBattleSummary(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const mode = String(entry.mode ?? "").trim();
  const result = String(entry.result ?? "").trim();
  const completedAt = String(entry.completedAt ?? "").trim();

  if (
    !VALID_LATEST_BATTLE_MODES.has(mode) ||
    !VALID_LATEST_BATTLE_RESULTS.has(result) ||
    !completedAt
  ) {
    return null;
  }

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const sanitizeOptionalString = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  };
  const sanitizeOptionalCount = (value) => {
    if (value == null || String(value).trim() === "") {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
  };
  const assignOptionalString = (target, key, fallback = null) => {
    if (!hasOwn(entry, key) && fallback == null) {
      return;
    }
    target[key] = sanitizeOptionalString(entry[key]) ?? fallback;
  };
  const assignOptionalCount = (target, key) => {
    if (!hasOwn(entry, key)) {
      return;
    }
    target[key] = sanitizeOptionalCount(entry[key]);
  };

  const normalizedEntry = {
    mode,
    result,
    completedAt
  };
  assignOptionalCount(normalizedEntry, "rounds");
  assignOptionalCount(normalizedEntry, "warsEntered");

  if (mode === "online") {
    const opponentUsername = sanitizeOptionalString(entry.opponentUsername);
    const onlineEntry = { ...normalizedEntry };
    assignOptionalString(onlineEntry, "opponentName", opponentUsername);
    assignOptionalString(onlineEntry, "opponentUsername");
    assignOptionalString(onlineEntry, "opponentUserId");
    return onlineEntry;
  }

  if (mode === "featuredRival" || mode === "gauntlet") {
    const rivalEntry = { ...normalizedEntry };
    assignOptionalString(rivalEntry, "rivalName");
    return rivalEntry;
  }

  if (mode === "bloodMatch") {
    const bloodEntry = {
      mode,
      displayMode: sanitizeOptionalString(entry.displayMode) ?? "Blood Match",
      result,
      completedAt
    };
    assignOptionalCount(bloodEntry, "rounds");
    assignOptionalCount(bloodEntry, "warsEntered");
    assignOptionalString(bloodEntry, "rivalName");
    assignOptionalString(bloodEntry, "endReason");
    assignOptionalCount(bloodEntry, "playerCardsCaptured");
    assignOptionalCount(bloodEntry, "playerHandAtEnd");
    assignOptionalCount(bloodEntry, "vampireHandAtEnd");
    assignOptionalCount(bloodEntry, "lycanHandAtEnd");
    assignOptionalCount(bloodEntry, "twoWayWars");
    assignOptionalCount(bloodEntry, "threeWayWars");
    return bloodEntry;
  }

  const localEntry = { ...normalizedEntry };
  assignOptionalString(localEntry, "opponentName");
  return localEntry;
}

function normalizeRecentBattles(entries, fallbackLatestBattle = null) {
  const normalizedEntries = Array.isArray(entries)
    ? entries
        .map((entry, index) => ({ entry: normalizeLatestBattleSummary(entry), index }))
        .filter((item) => item.entry)
    : [];

  const normalizedFallback = normalizeLatestBattleSummary(fallbackLatestBattle);
  if (normalizedFallback && normalizedEntries.length === 0) {
    normalizedEntries.push({ entry: normalizedFallback, index: 0 });
  }

  const dedupedEntries = [];
  const seenEntries = new Set();
  for (const item of normalizedEntries) {
    const signature = JSON.stringify(item.entry);
    if (seenEntries.has(signature)) {
      continue;
    }
    seenEntries.add(signature);
    dedupedEntries.push(item);
  }

  return dedupedEntries
    .sort((a, b) => {
      const timeA = Date.parse(a.entry.completedAt);
      const timeB = Date.parse(b.entry.completedAt);
      const safeTimeA = Number.isFinite(timeA) ? timeA : Number.NEGATIVE_INFINITY;
      const safeTimeB = Number.isFinite(timeB) ? timeB : Number.NEGATIVE_INFINITY;
      if (safeTimeA !== safeTimeB) {
        return safeTimeB - safeTimeA;
      }
      return a.index - b.index;
    })
    .slice(0, RECENT_BATTLES_LIMIT)
    .map((item) => item.entry);
}

function normalizeRecentOpponentDisplayCosmetics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      avatar: null,
      title: null
    };
  }

  const normalizeOptionalId = (id) => {
    const normalized = String(id ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  };

  return {
    avatar: normalizeOptionalId(value.avatar),
    title: normalizeOptionalId(value.title)
  };
}

function normalizeRecentOpponentEntry(entry, ownerProfileKey = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const opponentProfileKey = String(entry.opponentProfileKey ?? "").trim();
  if (!opponentProfileKey) {
    return null;
  }

  const normalizedOwnerProfileKey = String(ownerProfileKey ?? "").trim();
  if (normalizedOwnerProfileKey && opponentProfileKey === normalizedOwnerProfileKey) {
    return null;
  }

  const latestResult = String(entry.latestResult ?? "").trim();
  if (!VALID_LATEST_BATTLE_RESULTS.has(latestResult)) {
    return null;
  }

  const parsedCompletedAt = Date.parse(String(entry.lastCompletedAt ?? "").trim());
  if (!Number.isFinite(parsedCompletedAt)) {
    return null;
  }

  const normalizeDisplayText = (value, fallback = null) => {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : fallback;
  };

  return {
    opponentProfileKey,
    opponentUsername: normalizeDisplayText(entry.opponentUsername, opponentProfileKey),
    displayName: normalizeDisplayText(entry.displayName, opponentProfileKey),
    latestResult,
    lastCompletedAt: new Date(parsedCompletedAt).toISOString(),
    lastSettlementKey: normalizeDisplayText(entry.lastSettlementKey),
    displayCosmetics: normalizeRecentOpponentDisplayCosmetics(entry.displayCosmetics)
  };
}

export function normalizeRecentOpponents(entries, ownerProfileKey = null) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalizedEntries = entries
    .map((entry, index) => ({ entry: normalizeRecentOpponentEntry(entry, ownerProfileKey), index }))
    .filter((item) => item.entry);
  const sortedEntries = normalizedEntries.sort((a, b) => {
    const timeA = Date.parse(a.entry.lastCompletedAt);
    const timeB = Date.parse(b.entry.lastCompletedAt);
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return a.index - b.index;
  });
  const dedupedEntries = [];
  const seenProfileKeys = new Set();
  for (const item of sortedEntries) {
    const key = item.entry.opponentProfileKey;
    if (seenProfileKeys.has(key)) {
      continue;
    }
    seenProfileKeys.add(key);
    dedupedEntries.push(item.entry);
  }

  return dedupedEntries.slice(0, RECENT_OPPONENTS_LIMIT);
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
  const normalizedOnlineRewardSettlements = {
    appliedSettlementKeys: Array.isArray(validatedProfile?.onlineRewardSettlements?.appliedSettlementKeys)
      ? validatedProfile.onlineRewardSettlements.appliedSettlementKeys
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
          .slice(-50)
      : []
  };
  const normalizedStoreRoyaltyPayouts = {
    appliedTransactionIds: Array.isArray(validatedProfile?.storeRoyaltyPayouts?.appliedTransactionIds)
      ? validatedProfile.storeRoyaltyPayouts.appliedTransactionIds
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
          .slice(-100)
      : []
  };
  const normalizedCollectionAlbumRewardClaims = normalizeCollectionAlbumRewardClaims(
    validatedProfile.collectionAlbumRewardClaims
  );

  let normalized = normalizeProfileDailyChallenges(
    normalizeProfileLevelRewards(
      normalizeProfileDailyElementChest(
      normalizeProfileChests(
        normalizeProfileStore(
          normalizeProfileCosmetics({
            ...normalizeProfileModeStats(validatedProfile),
            achievements: normalizeAchievementProgressMap(validatedProfile?.achievements),
            onlineDisconnectTracking: normalizedDisconnectTracking,
            onlineRewardSettlements: normalizedOnlineRewardSettlements,
            collectionAlbumRewardClaims: normalizedCollectionAlbumRewardClaims,
            storeRoyaltyPayouts: normalizedStoreRoyaltyPayouts
          })
        )
      )
      )
    )
  );
  normalized = applyVampyrLeeLongestMatchBackfill(normalized);

  let retroactiveMutated = false;
  if (applyRetroactive) {
    const retroactiveUnlocks = evaluateRetroactiveAchievements(normalized);
    if (retroactiveUnlocks.length > 0) {
      const withAchievements = applyAchievementUnlocks(normalized, retroactiveUnlocks);
      const withTokens = applyAchievementTokenRewards(withAchievements.profile, withAchievements.unlockEvents);
      const withCosmetics = applyAchievementCosmeticRewards(withTokens.profile, withAchievements.unlockEvents);
      normalized = withCosmetics.profile;
      retroactiveMutated = true;
    }
  }

  const preMilestoneGrantProfile = {
    ...normalized,
    playerLevel: deriveLevelFromXp(normalized.playerXP)
  };
  normalized = applyLevelMilestoneChestGrants(preMilestoneGrantProfile);
  const milestoneGrantMutated =
    JSON.stringify(normalized) !== JSON.stringify(preMilestoneGrantProfile);

  const finalNormalizedProfile = {
    ...normalized,
    latestBattle: validatedProfile.latestBattle ?? null,
    recentBattles: Array.isArray(validatedProfile.recentBattles) ? validatedProfile.recentBattles : [],
    recentOpponents: normalizeRecentOpponents(validatedProfile.recentOpponents, validatedProfile.username),
    // Persist the current schema marker after migration/default filling so
    // upgraded records are written back in their latest supported shape.
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    playerLevel: deriveLevelFromXp(normalized.playerXP)
  };

  // If validation reported a true no-op, the remaining normalization pipeline
  // should also behave as a no-op for already-valid data. Warn when that
  // expectation is violated so future persistence changes do not silently
  // reintroduce repeated rewrites.
  if (
    !mutated &&
    !migration.migrated &&
    !retroactiveMutated &&
    !milestoneGrantMutated &&
    JSON.stringify(finalNormalizedProfile) !== JSON.stringify(validatedProfile)
  ) {
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

export class ProfileSystem {
  constructor(options = {}) {
    this.store = new JsonStore("profiles.json", options);
    this.inMemoryProfiles = [];
    this.mutationQueue = Promise.resolve();
  }

  cacheProfile(profile) {
    if (!profile?.username) {
      return;
    }

    const nextProfiles = [...this.inMemoryProfiles];
    const index = nextProfiles.findIndex((entry) => entry?.username === profile.username);
    if (index === -1) {
      nextProfiles.push(profile);
    } else {
      nextProfiles[index] = profile;
    }
    this.inMemoryProfiles = nextProfiles;
  }

  async readProfilesArray({ repairMalformedRoot = true } = {}) {
    const profiles = await this.store.read([]);
    if (Array.isArray(profiles)) {
      return profiles;
    }

    if (repairMalformedRoot) {
      await this.store.write([]);
    }
    this.inMemoryProfiles = [];
    return [];
  }

  findProfileIndex(profiles, username) {
    const normalized = normalizeUsername(username);
    return profiles.findIndex((profile) => normalizeUsername(profile?.username) === normalized);
  }

  async loadNormalizedProfileByUsername(username, { applyRetroactive = true } = {}) {
    const normalized = normalizeUsername(username);
    const profiles = await this.readProfilesArray();
    const index = this.findProfileIndex(profiles, normalized);
    if (index === -1) {
      return {
        profiles,
        index: -1,
        profile: null
      };
    }

    const current = profiles[index];
    const repaired = normalizeProfile(current, { applyRetroactive });
    if (JSON.stringify(repaired) !== JSON.stringify(current)) {
      const nextProfiles = [...profiles];
      nextProfiles[index] = repaired;
      await this.store.write(nextProfiles);
      this.cacheProfile(repaired);
      return {
        profiles: nextProfiles,
        index,
        profile: repaired
      };
    }

    this.cacheProfile(repaired);
    return {
      profiles,
      index,
      profile: repaired
    };
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
    try {
      const result = await this.loadNormalizedProfileByUsername(normalized, {
        applyRetroactive: true
      });
      return result.profile ?? null;
    } catch (error) {
      console.error("[ProfileSystem] getProfile failed", {
        username: normalized,
        message: error?.message,
        code: error?.code,
        stack: error?.stack,
        filePath: this.store.filePath
      });
      return this.inMemoryProfiles.find((profile) => profile.username === normalized) ?? null;
    }
  }

  async ensureProfile(username, seed = {}) {
    return this.runMutation(async () => {
      const normalized = normalizeUsername(username);
      const filePath = this.store.filePath;
      const dirPath = path.dirname(filePath);

      const fileExists = await checkFileExists(filePath);
      const dirWritable = await checkDirectoryWritable(dirPath);

      logProfileDebug("[ProfileSystem] ensureProfile diagnostics", {
        username: normalized,
        dataDir: this.store.dataDir,
        filePath,
        fileExists,
        dirWritable
      });

      try {
        const { profiles, profile: existing } = await this.loadNormalizedProfileByUsername(normalized, {
          applyRetroactive: true
        });

        if (existing) {
          logProfileDebug("[ProfileSystem] ensureProfile existing profile returned", {
            username: normalized
          });
          return existing;
        }

        const createdSeed = {
          ...seed,
          username: normalized
        };

        const created = normalizeProfile(
          {
            ...createDefaultProfile(normalized),
            ...createdSeed
          },
          { applyRetroactive: true }
        );

        const nextProfiles = [...profiles, created];

        await this.store.write(nextProfiles);
        this.inMemoryProfiles = nextProfiles;
        console.info("[ProfileSystem] ensureProfile created and persisted profile", {
          username: normalized,
          totalProfiles: nextProfiles.length
        });

        return created;
      } catch (error) {
        const fallbackCreated = normalizeProfile(
          {
            ...createDefaultProfile(normalized),
            ...seed,
            username: normalized
          },
          { applyRetroactive: true }
        );

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
      const profiles = await this.readProfilesArray();
      const index = this.findProfileIndex(profiles, normalized);

      const nextProfiles = [...profiles];
      const current = index === -1
        ? normalizeProfile(createDefaultProfile(normalized))
        : normalizeProfile(profiles[index]);

      const next = normalizeProfile(
        typeof updater === "function" ? updater(current) : { ...current, ...updater }
      );

      if (index === -1) {
        nextProfiles.push(next);
      } else {
        nextProfiles[index] = next;
      }

      if (JSON.stringify(snapshot(current)) !== JSON.stringify(snapshot(next))) {
        console.info("[ProfileSystem] updateProfile write", {
          before: snapshot(current),
          after: snapshot(next),
          filePath: this.store.filePath
        });
      } else {
        logProfileDebug("[ProfileSystem] updateProfile write", {
          before: snapshot(current),
          after: snapshot(next),
          filePath: this.store.filePath
        });
      }

      await this.store.write(nextProfiles);
      this.cacheProfile(next);

      const reloaded = (await this.loadNormalizedProfileByUsername(normalized, {
        applyRetroactive: false
      })).profile;
      logProfileDebug("[ProfileSystem] updateProfile reloaded", {
        reloaded: snapshot(reloaded),
        filePath: this.store.filePath
      });

      return reloaded ?? next;
    });
  }

  async updateProfilesAtomically(usernames, updater) {
    return this.runMutation(async () => {
      const normalizedUsernames = [...new Set(
        (Array.isArray(usernames) ? usernames : [])
          .map((username) => normalizeUsername(username))
          .filter(Boolean)
      )];
      if (normalizedUsernames.length === 0) {
        throw new Error("At least one username is required for atomic profile updates.");
      }

      const profiles = await this.readProfilesArray();
      const currentByUsername = Object.fromEntries(
        normalizedUsernames.map((username) => {
          const index = this.findProfileIndex(profiles, username);
          const current = index === -1
            ? normalizeProfile(createDefaultProfile(username))
            : normalizeProfile(profiles[index]);
          return [username, current];
        })
      );
      const updates = typeof updater === "function"
        ? updater(currentByUsername)
        : updater;
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        throw new Error("Atomic profile updater must return profiles by username.");
      }

      const nextProfiles = [...profiles];
      const committed = {};
      for (const username of normalizedUsernames) {
        const current = currentByUsername[username];
        const next = normalizeProfile(updates[username] ?? current);
        const index = this.findProfileIndex(nextProfiles, username);
        if (index === -1) {
          nextProfiles.push(next);
        } else {
          nextProfiles[index] = next;
        }
        committed[username] = next;
      }

      await this.store.write(nextProfiles);
      for (const profile of Object.values(committed)) {
        this.cacheProfile(profile);
      }
      return committed;
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

