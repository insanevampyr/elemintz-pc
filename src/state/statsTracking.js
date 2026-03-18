import { ACHIEVEMENT_DEFINITIONS } from "./achievementSystem.js";
import { createDefaultChestState } from "./chestSystem.js";
import { createDefaultCosmeticsState } from "./cosmeticSystem.js";
import { createDefaultEconomyState } from "./storeSystem.js";
import { createDefaultDailyChallenges } from "./dailyChallengesSystem.js";

function emptyModeStats() {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    quickWins: 0,
    timeLimitWins: 0
  };
}

function extractPlayedElements(matchState, perspective) {
  const played = new Set();
  const cardKey = perspective === "p2" ? "p2Card" : "p1Card";

  for (const round of matchState.history ?? []) {
    const card = String(round?.[cardKey] ?? "").toLowerCase();
    if (["fire", "water", "earth", "wind"].includes(card)) {
      played.add(card);
    }
  }

  return played;
}

function safeNonNegativeInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.floor(numeric));
}

export function createDefaultModeStats() {
  return {
    pve: emptyModeStats(),
    local_pvp: emptyModeStats()
  };
}

export function normalizeProfileModeStats(profile) {
  const existing = profile.modeStats ?? {};
  const pve = existing.pve ?? {};
  const localPvp = existing.local_pvp ?? {};

  return {
    ...profile,
    wins: safeNonNegativeInt(profile.wins),
    losses: safeNonNegativeInt(profile.losses),
    gamesPlayed: safeNonNegativeInt(profile.gamesPlayed),
    timeLimitWins: safeNonNegativeInt(profile.timeLimitWins),
    quickWins: safeNonNegativeInt(profile.quickWins),
    winStreak: safeNonNegativeInt(profile.winStreak),
    bestWinStreak: safeNonNegativeInt(profile.bestWinStreak),
    warsEntered: safeNonNegativeInt(profile.warsEntered),
    warsWon: safeNonNegativeInt(profile.warsWon),
    longestWar: safeNonNegativeInt(profile.longestWar),
    cardsCaptured: safeNonNegativeInt(profile.cardsCaptured),
    matchesUsingAllElements: safeNonNegativeInt(profile.matchesUsingAllElements),
    playerXP: safeNonNegativeInt(profile.playerXP),
    playerLevel: Math.max(1, safeNonNegativeInt(profile.playerLevel, 1)),
    lastDailyLoginClaimDate:
      typeof profile.lastDailyLoginClaimDate === "string" && profile.lastDailyLoginClaimDate.trim()
        ? profile.lastDailyLoginClaimDate
        : null,
    achievements:
      profile.achievements && typeof profile.achievements === "object" && !Array.isArray(profile.achievements)
        ? profile.achievements
        : {},
    modeStats: {
      pve: {
        gamesPlayed: safeNonNegativeInt(pve.gamesPlayed),
        wins: safeNonNegativeInt(pve.wins),
        losses: safeNonNegativeInt(pve.losses),
        warsEntered: safeNonNegativeInt(pve.warsEntered),
        warsWon: safeNonNegativeInt(pve.warsWon),
        longestWar: safeNonNegativeInt(pve.longestWar),
        cardsCaptured: safeNonNegativeInt(pve.cardsCaptured),
        quickWins: safeNonNegativeInt(pve.quickWins),
        timeLimitWins: safeNonNegativeInt(pve.timeLimitWins)
      },
      local_pvp: {
        gamesPlayed: safeNonNegativeInt(localPvp.gamesPlayed),
        wins: safeNonNegativeInt(localPvp.wins),
        losses: safeNonNegativeInt(localPvp.losses),
        warsEntered: safeNonNegativeInt(localPvp.warsEntered),
        warsWon: safeNonNegativeInt(localPvp.warsWon),
        longestWar: safeNonNegativeInt(localPvp.longestWar),
        cardsCaptured: safeNonNegativeInt(localPvp.cardsCaptured),
        quickWins: safeNonNegativeInt(localPvp.quickWins),
        timeLimitWins: safeNonNegativeInt(localPvp.timeLimitWins)
      }
    }
  };
}

export function createDefaultProfile(username) {
  return {
    username,
    title: "Initiate",
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    timeLimitWins: 0,
    quickWins: 0,
    winStreak: 0,
    bestWinStreak: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    matchesUsingAllElements: 0,
    playerXP: 0,
    playerLevel: 1,
    lastDailyLoginClaimDate: null,
    modeStats: createDefaultModeStats(),
    achievements: {},
    ...createDefaultCosmeticsState(),
    ...createDefaultEconomyState(),
    ...createDefaultChestState(),
    dailyChallenges: createDefaultDailyChallenges(),
    achievementCatalogVersion: ACHIEVEMENT_DEFINITIONS.length,
    levelRewardsClaimed: {}
  };
}

export function applyMatchStatsToProfile(profile, matchStats, mode = "pve") {
  const winsDelta = matchStats.wins ?? 0;
  const lossesDelta = matchStats.losses ?? 0;

  const normalized = normalizeProfileModeStats(profile);

  const currentWinStreak = normalized.winStreak ?? 0;
  const currentBestWinStreak = normalized.bestWinStreak ?? 0;
  const nextWinStreak = lossesDelta > 0 ? 0 : currentWinStreak + winsDelta;

  const modeKey = mode === "local_pvp" ? "local_pvp" : "pve";
  const currentMode = normalized.modeStats[modeKey];

  return {
    ...normalized,
    wins: normalized.wins + winsDelta,
    losses: normalized.losses + lossesDelta,
    gamesPlayed: normalized.gamesPlayed + (matchStats.gamesPlayed ?? 1),
    timeLimitWins: normalized.timeLimitWins + (matchStats.timeLimitWins ?? 0),
    quickWins: normalized.quickWins + (matchStats.quickWins ?? 0),
    winStreak: nextWinStreak,
    bestWinStreak: Math.max(currentBestWinStreak, nextWinStreak),
    warsEntered: normalized.warsEntered + (matchStats.warsEntered ?? 0),
    warsWon: normalized.warsWon + (matchStats.warsWon ?? 0),
    longestWar: Math.max(normalized.longestWar, matchStats.longestWar ?? 0),
    cardsCaptured: normalized.cardsCaptured + (matchStats.cardsCaptured ?? 0),
    matchesUsingAllElements:
      normalized.matchesUsingAllElements + (matchStats.matchesUsingAllElements ?? 0),
    modeStats: {
      ...normalized.modeStats,
      [modeKey]: {
        gamesPlayed: currentMode.gamesPlayed + (matchStats.gamesPlayed ?? 1),
        wins: currentMode.wins + winsDelta,
        losses: currentMode.losses + lossesDelta,
        warsEntered: currentMode.warsEntered + (matchStats.warsEntered ?? 0),
        warsWon: currentMode.warsWon + (matchStats.warsWon ?? 0),
        longestWar: Math.max(currentMode.longestWar, matchStats.longestWar ?? 0),
        cardsCaptured: currentMode.cardsCaptured + (matchStats.cardsCaptured ?? 0),
        quickWins: currentMode.quickWins + (matchStats.quickWins ?? 0),
        timeLimitWins: currentMode.timeLimitWins + (matchStats.timeLimitWins ?? 0)
      }
    }
  };
}

export function deriveMatchStats(matchState, perspective = "p1") {
  if (!matchState || !Array.isArray(matchState.history)) {
    throw new Error("Invalid matchState provided to deriveMatchStats.");
  }

  const winner = matchState.winner;
  const didWin = winner === perspective;
  const isQuitForfeit = String(matchState?.endReason ?? "") === "quit_forfeit";
  const isLocalPvp = String(matchState?.mode ?? "") === "local_pvp";

  let warsEntered = 0;
  let warsWon = 0;
  let longestWar = 0;
  let cardsCaptured = 0;

  for (const round of matchState.history) {
    const warClashes = round.warClashes ?? 0;

    if (warClashes > 0) {
      warsEntered += 1;
      longestWar = Math.max(longestWar, warClashes);
      if (round.result === perspective) {
        warsWon += 1;
      }
    }

    if (round.result === perspective) {
      const explicitCaptured = Number(round.capturedOpponentCards);
      cardsCaptured += Number.isFinite(explicitCaptured) && explicitCaptured >= 0
        ? safeNonNegativeInt(explicitCaptured)
        : Math.max(0, Math.floor(safeNonNegativeInt(round.capturedCards ?? 0) / 2));
    }
  }

  const quickWins = didWin && (matchState.round ?? 0) < 5 ? 1 : 0;
  const timeLimitWins = didWin && matchState.endReason === "time_limit" ? 1 : 0;
  const matchesUsingAllElements =
    extractPlayedElements(matchState, perspective).size === 4 ? 1 : 0;

  return {
    gamesPlayed: 1,
    wins: didWin ? 1 : 0,
    losses: isQuitForfeit && isLocalPvp ? 1 : winner && winner !== "draw" && !didWin ? 1 : 0,
    warsEntered,
    warsWon,
    longestWar,
    cardsCaptured,
    matchesUsingAllElements,
    quickWins,
    timeLimitWins
  };
}


