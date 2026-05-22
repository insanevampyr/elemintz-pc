import {
  applyXpWithMaxLevelFallback,
  buildXpBreakdown,
  deriveLevelFromXp,
  getLevelProgress,
  getXpThresholds,
  trimXpBreakdownLinesToAppliedXp
} from "./levelRewardsSystem.js";
import { EPIC_CHEST_TYPE, grantChest } from "./chestSystem.js";
import { applyBoostEventToBaseMatchRewards } from "../shared/boostEventRules.js";

const RESET_TIME_ZONE = "America/Chicago";
const RESET_HOUR = 18;
const DAILY_COMPLETION_CHEST_AMOUNT = 1;
const WEEKLY_COMPLETION_CHEST_AMOUNT = 1;
const HARD_PVE_WIN_TOKEN_BONUS = 5;
const HARD_PVE_WIN_XP_BONUS = 5;
const CHALLENGE_SET_VERSION = "core_bonus_v1";
const ACTIVE_DAILY_CHALLENGE_COUNT = 9;
const ACTIVE_WEEKLY_CHALLENGE_COUNT = 10;
const DAILY_FIXED_CORE_COUNT = 6;
const WEEKLY_FIXED_CORE_COUNT = 7;
const DAILY_BONUS_SELECTION_COUNT = ACTIVE_DAILY_CHALLENGE_COUNT - DAILY_FIXED_CORE_COUNT;
const WEEKLY_BONUS_SELECTION_COUNT = ACTIVE_WEEKLY_CHALLENGE_COUNT - WEEKLY_FIXED_CORE_COUNT;

const WEEKDAY_INDEX = Object.freeze({
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
});

export const DAILY_FIXED_CORE_CHALLENGE_DEFINITIONS = Object.freeze([
  {
    id: "daily_play_5_matches",
    name: "Play 5 Matches",
    description: "Complete 5 matches.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 5,
    progressKey: "matchesPlayed"
  },
  {
    id: "daily_win_1_match",
    name: "Win 1 Match",
    description: "Win 1 completed match.",
    rewardTokens: 2,
    rewardXp: 5,
    goal: 1,
    progressKey: "matchesWon"
  },
  {
    id: "daily_win_2_matches",
    name: "Win 2 Matches",
    description: "Win 2 completed matches in one day.",
    rewardTokens: 3,
    rewardXp: 7,
    goal: 2,
    progressKey: "matchesWon"
  },
  {
    id: "daily_win_1_war",
    name: "Win 1 WAR",
    description: "Win any WAR during a completed match.",
    rewardTokens: 2,
    rewardXp: 5,
    goal: 1,
    progressKey: "warsWon"
  },
  {
    id: "daily_capture_16_cards",
    name: "Capture 16 Cards Total In One Day",
    description: "Capture 16 opponent cards across completed matches in the same day.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 16,
    progressKey: "cardsCaptured"
  },
  {
    id: "daily_use_all_4_elements",
    name: "Use All 4 Elements In One Match",
    description: "In one completed match, play Fire, Water, Earth, and Wind at least once.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 1,
    progressKey: "usedAllElementsInMatch"
  }
].filter((item) => Number(item.rewardTokens) > 0));

export const DAILY_BONUS_CHALLENGE_POOL = Object.freeze([
  {
    id: "daily_online_match_1",
    name: "Complete 1 Online Match",
    description: "Complete 1 Online match.",
    rewardTokens: 4,
    rewardXp: 8,
    goal: 1,
    progressKey: "completedOnlineMatch"
  },
  {
    id: "daily_online_win_1",
    name: "Win 1 Online Match",
    description: "Win 1 Online match.",
    rewardTokens: 5,
    rewardXp: 10,
    goal: 1,
    progressKey: "wonOnlineMatch"
  },
  {
    id: "daily_hard_ai_win_1",
    name: "Win 1 Match Against Hard AI",
    description: "Win 1 match against Hard AI.",
    rewardTokens: 4,
    rewardXp: 9,
    goal: 1,
    progressKey: "wonHardPveMatch"
  },
  {
    id: "daily_local_pvp_match_1",
    name: "Complete 1 Local 2-Player Match",
    description: "Complete 1 Local 2-Player match.",
    rewardTokens: 3,
    rewardXp: 7,
    goal: 1,
    progressKey: "completedLocalPvpMatch"
  },
  {
    id: "daily_comeback_win",
    name: "Complete a Comeback Win",
    description: "Win a match after losing at least 1 round.",
    rewardTokens: 4,
    rewardXp: 8,
    goal: 1,
    progressKey: "comebackWin"
  },
  {
    id: "daily_no_quit_3",
    name: "Complete 3 Matches Without Quitting",
    description: "Complete 3 matches without quitting.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 3,
    progressKey: "completedNoQuitMatch"
  },
  {
    id: "daily_defeat_featured_rival_1",
    name: "Bring Down the Boss",
    description: "Defeat the Featured Rival 1 time today.",
    rewardTokens: 8,
    rewardXp: 15,
    goal: 1,
    progressKey: "featuredRivalWins"
  },
  {
    id: "daily_win_with_fire",
    name: "Win With Fire",
    description: "Win a completed match where Fire wins at least one round.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 1,
    progressKey: "wonRoundWithFire",
    bonusFamily: "elemental"
  },
  {
    id: "daily_win_with_water",
    name: "Win With Water",
    description: "Win a completed match where Water wins at least one round.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 1,
    progressKey: "wonRoundWithWater",
    bonusFamily: "elemental"
  },
  {
    id: "daily_win_with_earth",
    name: "Win With Earth",
    description: "Win a completed match where Earth wins at least one round.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 1,
    progressKey: "wonRoundWithEarth",
    bonusFamily: "elemental"
  },
  {
    id: "daily_win_with_wind",
    name: "Win With Wind",
    description: "Win a completed match where Wind wins at least one round.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 1,
    progressKey: "wonRoundWithWind",
    bonusFamily: "elemental"
  }
].filter((item) => Number(item.rewardTokens) > 0));

export const DAILY_CHALLENGE_DEFINITIONS = Object.freeze([
  ...DAILY_FIXED_CORE_CHALLENGE_DEFINITIONS,
  ...DAILY_BONUS_CHALLENGE_POOL
]);

export const WEEKLY_FIXED_CORE_CHALLENGE_DEFINITIONS = Object.freeze([
  {
    id: "weekly_play_15_matches",
    name: "Play 15 Matches",
    description: "Complete 15 matches.",
    rewardTokens: 5,
    rewardXp: 15,
    goal: 15,
    progressKey: "matchesPlayed"
  },
  {
    id: "weekly_win_10_matches",
    name: "Win 10 Matches",
    description: "Win 10 completed matches.",
    rewardTokens: 5,
    rewardXp: 15,
    goal: 10,
    progressKey: "matchesWon"
  },
  {
    id: "weekly_win_9_wars",
    name: "Win 9 WARs",
    description: "Win 9 WARs across completed matches.",
    rewardTokens: 8,
    rewardXp: 18,
    goal: 9,
    progressKey: "warsWon"
  },
  {
    id: "weekly_capture_64_cards",
    name: "Capture 64 Cards Total",
    description: "Capture 64 opponent cards across completed matches.",
    rewardTokens: 8,
    rewardXp: 18,
    goal: 64,
    progressKey: "cardsCaptured"
  },
  {
    id: "weekly_win_streak_3",
    name: "Reach A 3-Match Win Streak",
    description: "Reach a 3-match win streak during the week.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 1,
    progressKey: "reachedWinStreak3"
  },
  {
    id: "weekly_use_all_4_elements_5x",
    name: "Use All 4 Elements in 5 Different Matches",
    description: "In 5 completed matches, play Fire, Water, Earth, and Wind at least once.",
    rewardTokens: 8,
    rewardXp: 18,
    goal: 5,
    progressKey: "usedAllElementsInMatch"
  },
  {
    id: "weekly_longest_war_5",
    name: "Survive A WAR Of 5 Clashes",
    description: "In any completed match during the week, be part of a WAR that lasts 5 clashes.",
    rewardTokens: 12,
    rewardXp: 30,
    goal: 1,
    progressKey: "survivedLongestWar5"
  }
].filter((item) => Number(item.rewardTokens) > 0));

export const WEEKLY_BONUS_CHALLENGE_POOL = Object.freeze([
  {
    id: "weekly_online_matches_5",
    name: "Complete 5 Online Matches",
    description: "Complete 5 Online matches.",
    rewardTokens: 12,
    rewardXp: 28,
    goal: 5,
    progressKey: "completedOnlineMatch"
  },
  {
    id: "weekly_online_wins_3",
    name: "Win 3 Online Matches",
    description: "Win 3 Online matches.",
    rewardTokens: 15,
    rewardXp: 35,
    goal: 3,
    progressKey: "wonOnlineMatch"
  },
  {
    id: "weekly_hard_ai_wins_5",
    name: "Win 5 Matches Against Hard AI",
    description: "Win 5 matches against Hard AI.",
    rewardTokens: 12,
    rewardXp: 30,
    goal: 5,
    progressKey: "wonHardPveMatch"
  },
  {
    id: "weekly_local_pvp_matches_5",
    name: "Complete 5 Local 2-Player Matches",
    description: "Complete 5 Local 2-Player matches.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 5,
    progressKey: "completedLocalPvpMatch"
  },
  {
    id: "weekly_comeback_wins_5",
    name: "Complete 5 Comeback Wins",
    description: "Win 5 matches after losing at least 1 round.",
    rewardTokens: 12,
    rewardXp: 30,
    goal: 5,
    progressKey: "comebackWin"
  },
  {
    id: "weekly_no_quit_10",
    name: "Complete 10 Matches Without Quitting",
    description: "Complete 10 matches without quitting.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 10,
    progressKey: "completedNoQuitMatch"
  },
  {
    id: "weekly_defeat_featured_rival_3",
    name: "Rival Challenger",
    description: "Defeat the Featured Rival 3 times this week.",
    rewardTokens: 25,
    rewardXp: 45,
    goal: 3,
    progressKey: "featuredRivalWins"
  },
  {
    id: "weekly_defeat_featured_rival_5",
    name: "Rival Slayer",
    description: "Defeat the Featured Rival 5 times this week.",
    rewardTokens: 40,
    rewardXp: 75,
    goal: 5,
    progressKey: "featuredRivalWins"
  },
  {
    id: "weekly_element_master_fire",
    name: "Element Master: Fire",
    description: "Win 5 matches where Fire wins at least one round.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 5,
    progressKey: "wonRoundWithFire",
    bonusFamily: "elemental"
  },
  {
    id: "weekly_element_master_water",
    name: "Element Master: Water",
    description: "Win 5 matches where Water wins at least one round.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 5,
    progressKey: "wonRoundWithWater",
    bonusFamily: "elemental"
  },
  {
    id: "weekly_element_master_earth",
    name: "Element Master: Earth",
    description: "Win 5 matches where Earth wins at least one round.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 5,
    progressKey: "wonRoundWithEarth",
    bonusFamily: "elemental"
  },
  {
    id: "weekly_element_master_wind",
    name: "Element Master: Wind",
    description: "Win 5 matches where Wind wins at least one round.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 5,
    progressKey: "wonRoundWithWind",
    bonusFamily: "elemental"
  }
].filter((item) => Number(item.rewardTokens) > 0));

export const WEEKLY_CHALLENGE_DEFINITIONS = Object.freeze([
  ...WEEKLY_FIXED_CORE_CHALLENGE_DEFINITIONS,
  ...WEEKLY_BONUS_CHALLENGE_POOL
]);

const DAILY_BONUS_POOL_BY_ID = Object.freeze(
  Object.fromEntries(DAILY_BONUS_CHALLENGE_POOL.map((item) => [item.id, item]))
);
const WEEKLY_BONUS_POOL_BY_ID = Object.freeze(
  Object.fromEntries(WEEKLY_BONUS_CHALLENGE_POOL.map((item) => [item.id, item]))
);
const DAILY_BONUS_ID_SET = new Set(DAILY_BONUS_CHALLENGE_POOL.map((item) => item.id));
const WEEKLY_BONUS_ID_SET = new Set(WEEKLY_BONUS_CHALLENGE_POOL.map((item) => item.id));

function getMatchTokenReward({ isCompleted, isQuit, didWin, didDraw }) {
  if (!isCompleted || isQuit) {
    return 0;
  }

  if (didWin) {
    return 2;
  }

  if (didDraw) {
    return 1;
  }

  return 1;
}

function isEasyPvePracticeMode(matchState) {
  return (
    String(matchState?.mode ?? "").trim().toLowerCase() === "pve" &&
    String(matchState?.difficulty ?? "").trim().toLowerCase() === "easy"
  );
}

function getHardPveWinBonus(matchState, didWin) {
  const isHardPve =
    String(matchState?.mode ?? "").trim().toLowerCase() === "pve" &&
    String(matchState?.difficulty ?? "").trim().toLowerCase() === "hard";

  if (!isHardPve || !didWin) {
    return {
      tokenBonus: 0,
      xpBonus: 0
    };
  }

  return {
    tokenBonus: HARD_PVE_WIN_TOKEN_BONUS,
    xpBonus: HARD_PVE_WIN_XP_BONUS
  };
}

function buildProgressDefaults() {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    warsWon: 0,
    cardsCaptured: 0,
    usedAllElementsInMatch: 0,
    triggeredTwoWarsInMatch: 0,
    reachedWinStreak3: 0,
    survivedLongestWar5: 0,
    completedOnlineMatch: 0,
    wonOnlineMatch: 0,
    wonHardPveMatch: 0,
    completedLocalPvpMatch: 0,
    completedNoQuitMatch: 0,
    featuredRivalWins: 0,
    comebackWin: 0,
    wonRoundWithFire: 0,
    wonRoundWithWater: 0,
    wonRoundWithEarth: 0,
    wonRoundWithWind: 0
  };
}

function buildBooleanMap(definitions, defaultValue = false) {
  const entries = definitions.map((item) => [item.id, defaultValue]);
  return Object.fromEntries(entries);
}

function safeIsoFromMs(value) {
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) ? numeric : Date.now();
  return new Date(ms).toISOString();
}

function toMs(isoValue, fallbackMs) {
  const parsed = Date.parse(String(isoValue ?? ""));
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function normalizeProgress(value) {
  const incoming = value ?? {};
  const defaults = buildProgressDefaults();

  return {
    matchesPlayed: Math.max(0, Number(incoming.matchesPlayed ?? defaults.matchesPlayed) || 0),
    matchesWon: Math.max(0, Number(incoming.matchesWon ?? defaults.matchesWon) || 0),
    warsWon: Math.max(0, Number(incoming.warsWon ?? defaults.warsWon) || 0),
    cardsCaptured: Math.max(0, Number(incoming.cardsCaptured ?? defaults.cardsCaptured) || 0),
    usedAllElementsInMatch: Math.max(
      0,
      Number(incoming.usedAllElementsInMatch ?? defaults.usedAllElementsInMatch) || 0
    ),
    triggeredTwoWarsInMatch: Math.max(
      0,
      Number(incoming.triggeredTwoWarsInMatch ?? defaults.triggeredTwoWarsInMatch) || 0
    ),
    reachedWinStreak3: Math.max(0, Number(incoming.reachedWinStreak3 ?? defaults.reachedWinStreak3) || 0),
    survivedLongestWar5: Math.max(
      0,
      Number(incoming.survivedLongestWar5 ?? defaults.survivedLongestWar5) || 0
    ),
    completedOnlineMatch: Math.max(0, Number(incoming.completedOnlineMatch ?? defaults.completedOnlineMatch) || 0),
    wonOnlineMatch: Math.max(0, Number(incoming.wonOnlineMatch ?? defaults.wonOnlineMatch) || 0),
    wonHardPveMatch: Math.max(0, Number(incoming.wonHardPveMatch ?? defaults.wonHardPveMatch) || 0),
    completedLocalPvpMatch: Math.max(
      0,
      Number(incoming.completedLocalPvpMatch ?? defaults.completedLocalPvpMatch) || 0
    ),
    completedNoQuitMatch: Math.max(
      0,
      Number(incoming.completedNoQuitMatch ?? defaults.completedNoQuitMatch) || 0
    ),
    featuredRivalWins: Math.max(
      0,
      Number(incoming.featuredRivalWins ?? defaults.featuredRivalWins) || 0
    ),
    comebackWin: Math.max(0, Number(incoming.comebackWin ?? defaults.comebackWin) || 0),
    wonRoundWithFire: Math.max(0, Number(incoming.wonRoundWithFire ?? defaults.wonRoundWithFire) || 0),
    wonRoundWithWater: Math.max(0, Number(incoming.wonRoundWithWater ?? defaults.wonRoundWithWater) || 0),
    wonRoundWithEarth: Math.max(0, Number(incoming.wonRoundWithEarth ?? defaults.wonRoundWithEarth) || 0),
    wonRoundWithWind: Math.max(0, Number(incoming.wonRoundWithWind ?? defaults.wonRoundWithWind) || 0)
  };
}

function normalizeFlags(value, definitions, defaultValue = false) {
  const incoming = value ?? {};
  const defaults = buildBooleanMap(definitions, defaultValue);
  const next = Object.fromEntries(
    Object.keys(incoming)
      .filter((key) => typeof key === "string" && key.trim().length > 0)
      .map((key) => [key, Boolean(incoming[key])])
  );

  for (const key of Object.keys(defaults)) {
    next[key] = Boolean(incoming[key] ?? defaults[key]);
  }

  return next;
}

function normalizeCompletedFlags(progress, completed, rewarded, definitions) {
  const next = { ...(completed ?? {}) };

  for (const challenge of definitions) {
    const progressValue = challengeProgressValue(challenge, progress);
    next[challenge.id] = Boolean(
      completed?.[challenge.id] ||
      rewarded?.[challenge.id] ||
      progressValue >= challenge.goal
    );
  }

  return next;
}

function isElementalBonusChallenge(challenge) {
  return String(challenge?.bonusFamily ?? "").trim().toLowerCase() === "elemental";
}

function hashSelectionSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectBonusChallengeIds(pool, count, seedKey) {
  const ordered = [...pool].sort((left, right) => {
    const leftHash = hashSelectionSeed(`${seedKey}:${left.id}`);
    const rightHash = hashSelectionSeed(`${seedKey}:${right.id}`);
    if (leftHash !== rightHash) {
      return leftHash - rightHash;
    }
    return left.id.localeCompare(right.id);
  });

  const selected = [];
  let elementalCount = 0;
  for (const challenge of ordered) {
    if (selected.length >= count) {
      break;
    }
    if (isElementalBonusChallenge(challenge) && elementalCount >= 1) {
      continue;
    }
    selected.push(challenge.id);
    if (isElementalBonusChallenge(challenge)) {
      elementalCount += 1;
    }
  }

  if (selected.length < count) {
    for (const challenge of ordered) {
      if (selected.length >= count) {
        break;
      }
      if (selected.includes(challenge.id)) {
        continue;
      }
      selected.push(challenge.id);
    }
  }

  return selected.slice(0, count);
}

function normalizeSelectedBonusChallengeIds(selectedIds, pool, count, seedKey) {
  const poolIds = new Set(pool.map((item) => item.id));
  const incoming = Array.isArray(selectedIds)
    ? selectedIds
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0)
    : [];
  const uniqueIncoming = [...new Set(incoming)];
  const validIncoming = uniqueIncoming.filter((id) => poolIds.has(id));
  const elementalSelections = validIncoming.filter((id) => isElementalBonusChallenge(pool.find((item) => item.id === id)));
  const isValid =
    validIncoming.length === count &&
    uniqueIncoming.length === count &&
    elementalSelections.length <= 1;

  if (isValid) {
    return {
      ids: validIncoming,
      didChange: false
    };
  }

  return {
    ids: selectBonusChallengeIds(pool, count, seedKey),
    didChange: true
  };
}

function resolveDailyBonusSelection(state, lastResetMs) {
  return normalizeSelectedBonusChallengeIds(
    state?.selectedBonusChallengeIds,
    DAILY_BONUS_CHALLENGE_POOL,
    DAILY_BONUS_SELECTION_COUNT,
    `daily:${lastResetMs}`
  );
}

function resolveWeeklyBonusSelection(state, lastResetMs) {
  return normalizeSelectedBonusChallengeIds(
    state?.selectedBonusChallengeIds,
    WEEKLY_BONUS_CHALLENGE_POOL,
    WEEKLY_BONUS_SELECTION_COUNT,
    `weekly:${lastResetMs}`
  );
}

function getDailyActiveDefinitions(state) {
  return [
    ...DAILY_FIXED_CORE_CHALLENGE_DEFINITIONS,
    ...(state?.selectedBonusChallengeIds ?? []).map((id) => DAILY_BONUS_POOL_BY_ID[id]).filter(Boolean)
  ];
}

function getWeeklyActiveDefinitions(state) {
  return [
    ...WEEKLY_FIXED_CORE_CHALLENGE_DEFINITIONS,
    ...(state?.selectedBonusChallengeIds ?? []).map((id) => WEEKLY_BONUS_POOL_BY_ID[id]).filter(Boolean)
  ];
}

function getZonedParts(ms, timeZone = RESET_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(new Date(ms));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
    weekday: byType.weekday
  };
}

function chicagoLocalToUtcMs({ year, month, day, hour, minute = 0, second = 0 }) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second, 0);

  for (let i = 0; i < 4; i += 1) {
    const zoned = getZonedParts(guess);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
      0
    );
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
    guess += targetAsUtc - zonedAsUtc;
  }

  return guess;
}

function shiftYmdByDays({ year, month, day }, offsetDays) {
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function getDailyResetWindow(nowMs = Date.now()) {
  const nowChicago = getZonedParts(nowMs);
  const todayYmd = {
    year: nowChicago.year,
    month: nowChicago.month,
    day: nowChicago.day
  };

  const todayResetMs = chicagoLocalToUtcMs({
    ...todayYmd,
    hour: RESET_HOUR,
    minute: 0,
    second: 0
  });

  if (nowMs >= todayResetMs) {
    const tomorrowYmd = shiftYmdByDays(todayYmd, 1);
    const nextResetMs = chicagoLocalToUtcMs({
      ...tomorrowYmd,
      hour: RESET_HOUR,
      minute: 0,
      second: 0
    });

    return {
      lastResetMs: todayResetMs,
      nextResetMs
    };
  }

  const yesterdayYmd = shiftYmdByDays(todayYmd, -1);
  const lastResetMs = chicagoLocalToUtcMs({
    ...yesterdayYmd,
    hour: RESET_HOUR,
    minute: 0,
    second: 0
  });

  return {
    lastResetMs,
    nextResetMs: todayResetMs
  };
}

function getWeeklyResetWindow(nowMs = Date.now()) {
  const nowChicago = getZonedParts(nowMs);
  const weekday = WEEKDAY_INDEX[nowChicago.weekday] ?? 1;

  const todayYmd = {
    year: nowChicago.year,
    month: nowChicago.month,
    day: nowChicago.day
  };

  const mondayYmd = shiftYmdByDays(todayYmd, -(weekday - 1));
  const mondayResetMs = chicagoLocalToUtcMs({
    ...mondayYmd,
    hour: RESET_HOUR,
    minute: 0,
    second: 0
  });

  if (nowMs >= mondayResetMs) {
    const nextMondayYmd = shiftYmdByDays(mondayYmd, 7);
    const nextResetMs = chicagoLocalToUtcMs({
      ...nextMondayYmd,
      hour: RESET_HOUR,
      minute: 0,
      second: 0
    });

    return {
      lastResetMs: mondayResetMs,
      nextResetMs
    };
  }

  const prevMondayYmd = shiftYmdByDays(mondayYmd, -7);
  const lastResetMs = chicagoLocalToUtcMs({
    ...prevMondayYmd,
    hour: RESET_HOUR,
    minute: 0,
    second: 0
  });

  return {
    lastResetMs,
    nextResetMs: mondayResetMs
  };
}

function buildChallengeState(definitions, lastResetMs, selectionState = {}) {
  return {
    lastReset: safeIsoFromMs(lastResetMs),
    progress: buildProgressDefaults(),
    completed: buildBooleanMap(definitions, false),
    rewarded: buildBooleanMap(definitions, false),
    completionChestGranted: false,
    selectedBonusChallengeIds: [...(selectionState.selectedBonusChallengeIds ?? [])],
    setVersion: CHALLENGE_SET_VERSION
  };
}

function normalizeChallengeState(current, definitions, fallbackResetMs, selectionState = {}) {
  const progress = normalizeProgress(current?.progress);
  const rewarded = normalizeFlags(current?.rewarded, definitions);
  const completed = normalizeCompletedFlags(
    progress,
    normalizeFlags(current?.completed, definitions),
    rewarded,
    definitions
  );

  return {
    lastReset: safeIsoFromMs(toMs(current?.lastReset, fallbackResetMs)),
    progress,
    completed,
    rewarded,
    completionChestGranted: Boolean(current?.completionChestGranted),
    selectedBonusChallengeIds: [...(selectionState.selectedBonusChallengeIds ?? [])],
    setVersion: CHALLENGE_SET_VERSION
  };
}

function buildDefaultState(nowMs = Date.now()) {
  const dailyResetMs = getDailyResetWindow(nowMs).lastResetMs;
  const weeklyResetMs = getWeeklyResetWindow(nowMs).lastResetMs;
  const dailySelection = resolveDailyBonusSelection({}, dailyResetMs);
  const weeklySelection = resolveWeeklyBonusSelection({}, weeklyResetMs);
  return {
    daily: buildChallengeState(DAILY_CHALLENGE_DEFINITIONS, dailyResetMs, {
      selectedBonusChallengeIds: dailySelection.ids
    }),
    weekly: buildChallengeState(WEEKLY_CHALLENGE_DEFINITIONS, weeklyResetMs, {
      selectedBonusChallengeIds: weeklySelection.ids
    })
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

function extractWonRoundElements(matchState, perspective) {
  const won = new Set();
  const cardKey = perspective === "p2" ? "p2Card" : "p1Card";

  for (const round of matchState.history ?? []) {
    if (round?.result !== perspective) {
      continue;
    }
    const card = String(round?.[cardKey] ?? "").toLowerCase();
    if (["fire", "water", "earth", "wind"].includes(card)) {
      won.add(card);
    }
  }

  return won;
}

function didLoseAnyRound(matchState, perspective) {
  const opponent = perspective === "p2" ? "p1" : "p2";
  return (matchState.history ?? []).some((round) => round?.result === opponent);
}

function ensureChallengeWindow(state, definitions, resetWindow, selectionResolver) {
  const lastAppliedResetMs = toMs(state?.lastReset, 0);
  if (lastAppliedResetMs < resetWindow.lastResetMs) {
    const selection = selectionResolver({}, resetWindow.lastResetMs);
    return {
      state: buildChallengeState(definitions, resetWindow.lastResetMs, {
        selectedBonusChallengeIds: selection.ids
      }),
      didReset: true
    };
  }

  const selection = selectionResolver(state, resetWindow.lastResetMs);
  return {
    state: normalizeChallengeState(state, definitions, resetWindow.lastResetMs, {
      selectedBonusChallengeIds: selection.ids
    }),
    didReset: selection.didChange
  };
}

function ensureChallengeState(profile, nowMs = Date.now()) {
  const dailyResetWindow = getDailyResetWindow(nowMs);
  const weeklyResetWindow = getWeeklyResetWindow(nowMs);

  const legacy = profile.dailyChallenges ?? {};
  const legacyLastReset = legacy.dailyChallengeLastReset ?? legacy.windowStartedAt ?? safeIsoFromMs(nowMs);
  const legacyDaily = {
    lastReset: legacyLastReset,
    progress: legacy.progress,
    completed: legacy.completed,
    rewarded: legacy.rewarded
  };

  const current = legacy.daily || legacy.weekly ? legacy : { daily: legacyDaily, weekly: undefined };

  const ensuredDaily = ensureChallengeWindow(
    current.daily,
    DAILY_CHALLENGE_DEFINITIONS,
    dailyResetWindow,
    resolveDailyBonusSelection
  );
  const ensuredWeekly = ensureChallengeWindow(
    current.weekly,
    WEEKLY_CHALLENGE_DEFINITIONS,
    weeklyResetWindow,
    resolveWeeklyBonusSelection
  );

  return {
    challenges: {
      daily: ensuredDaily.state,
      weekly: ensuredWeekly.state
    },
    didReset: ensuredDaily.didReset || ensuredWeekly.didReset,
    dailyResetWindow,
    weeklyResetWindow
  };
}

function challengeProgressValue(challenge, progress) {
  const value = Number(progress?.[challenge.progressKey] ?? 0);
  return Math.max(0, value);
}

function buildChallengeView(definitions, state, nextResetMs, icon, nowMs, options = {}) {
  const bonusIdSet = options.bonusIdSet instanceof Set ? options.bonusIdSet : null;
  return {
    lastReset: state.lastReset,
    resetAt: new Date(nextResetMs).toISOString(),
    msUntilReset: Math.max(0, nextResetMs - nowMs),
    challenges: definitions.map((challenge) => {
      const progressValue = challengeProgressValue(challenge, state.progress);
      const isCompleted = Boolean(state.completed[challenge.id] || progressValue >= challenge.goal);
      return {
        id: challenge.id,
        name: challenge.name,
        description: challenge.description,
        rewardTokens: challenge.rewardTokens,
        rewardXp: Math.max(0, Number(challenge.rewardXp ?? 0)),
        goal: challenge.goal,
        progress: Math.min(challenge.goal, progressValue),
        completed: isCompleted,
        isBonus: bonusIdSet ? bonusIdSet.has(challenge.id) : false,
        icon
      };
    })
  };
}

function applyChallengeProgress({ definitions, state, metrics }) {
  const next = {
    ...state,
    progress: { ...state.progress },
    completed: { ...state.completed },
    rewarded: { ...state.rewarded }
  };

  next.progress.matchesPlayed += metrics.matchesPlayed;
  next.progress.matchesWon += metrics.matchesWon;
  next.progress.warsWon += metrics.warsWon;
  next.progress.cardsCaptured += metrics.cardsCaptured;
  next.progress.usedAllElementsInMatch += metrics.usedAllElementsInMatch;
  next.progress.triggeredTwoWarsInMatch += metrics.triggeredTwoWarsInMatch;
  next.progress.reachedWinStreak3 += metrics.reachedWinStreak3;
  next.progress.survivedLongestWar5 += metrics.survivedLongestWar5;
  next.progress.completedOnlineMatch += metrics.completedOnlineMatch;
  next.progress.wonOnlineMatch += metrics.wonOnlineMatch;
  next.progress.wonHardPveMatch += metrics.wonHardPveMatch;
  next.progress.completedLocalPvpMatch += metrics.completedLocalPvpMatch;
  next.progress.completedNoQuitMatch += metrics.completedNoQuitMatch;
  next.progress.featuredRivalWins += metrics.featuredRivalWins;
  next.progress.comebackWin += metrics.comebackWin;
  next.progress.wonRoundWithFire += metrics.wonRoundWithFire;
  next.progress.wonRoundWithWater += metrics.wonRoundWithWater;
  next.progress.wonRoundWithEarth += metrics.wonRoundWithEarth;
  next.progress.wonRoundWithWind += metrics.wonRoundWithWind;

  const rewards = [];
  for (const challenge of definitions) {
    const reached = challengeProgressValue(challenge, next.progress) >= challenge.goal;
    if (!reached || next.rewarded[challenge.id]) {
      continue;
    }

    next.completed[challenge.id] = true;
    next.rewarded[challenge.id] = true;
    rewards.push({
      id: challenge.id,
      name: challenge.name,
      rewardTokens: challenge.rewardTokens,
      rewardXp: Math.max(0, Number(challenge.rewardXp ?? 0))
    });
  }

  return {
    next,
    rewards
  };
}

function areAllChallengesCompleted(definitions, state) {
  return definitions.every((challenge) => Boolean(state?.completed?.[challenge.id]));
}

export function createDefaultDailyChallenges(nowMs = Date.now()) {
  return buildDefaultState(nowMs);
}

export function normalizeProfileDailyChallenges(profile, nowMs = Date.now()) {
  const ensured = ensureChallengeState(profile, nowMs);
  return {
    ...profile,
    dailyChallenges: ensured.challenges
  };
}

export function applyDailyChallengesForMatch({
  profile,
  matchState,
  perspective,
  matchStats,
  nowMs = Date.now(),
  options = {}
}) {
  const ensured = ensureChallengeState(profile, nowMs);
  const isCompleted = matchState?.status === "completed";
  const isQuit = String(matchState?.endReason ?? "") === "quit_forfeit";
  const includeMatchRewards = options.includeMatchRewards !== false;
  const practiceMode = options.practiceMode === true || isEasyPvePracticeMode(matchState);

  let dailyState = ensured.challenges.daily;
  let weeklyState = ensured.challenges.weekly;

  let dailyRewards = [];
  let weeklyRewards = [];
  let dailyChestDelta = 0;
  let weeklyChestDelta = 0;

  const didWin = matchState.winner === perspective;
  const didDraw = matchState.winner === "draw";
  const playedElements = extractPlayedElements(matchState, perspective);
  const wonRoundElements = extractWonRoundElements(matchState, perspective);
  const hardPveWinBonus = getHardPveWinBonus(matchState, didWin);
  const dailyActiveDefinitions = getDailyActiveDefinitions(dailyState);
  const weeklyActiveDefinitions = getWeeklyActiveDefinitions(weeklyState);
  const baseMatchTokenDelta = includeMatchRewards
    ? getMatchTokenReward({ isCompleted, isQuit, didWin, didDraw }) + hardPveWinBonus.tokenBonus
    : 0;
  const matchXpBreakdown = buildXpBreakdown({
    isCompleted: includeMatchRewards ? isCompleted : false,
    isQuit,
    didWin,
    warsWon: Number(matchStats?.warsWon ?? 0)
  });
  const baseMatchXpDelta = matchXpBreakdown.total + hardPveWinBonus.xpBonus;
  const boostRewardResult = applyBoostEventToBaseMatchRewards({
    boostEvent: options.boostEvent ?? null,
    matchState,
    xp: baseMatchXpDelta,
    tokens: baseMatchTokenDelta
  });

  if (isCompleted && !isQuit && !practiceMode) {
    const isFeaturedRivalWin =
      String(matchState?.mode ?? "").trim().toLowerCase() === "pve" &&
      String(matchState?.featuredRivalId ?? "").trim().length > 0 &&
      didWin;
    const metrics = {
      matchesPlayed: 1,
      matchesWon: didWin ? 1 : 0,
      warsWon: Number(matchStats?.warsWon ?? 0),
      cardsCaptured: Number(matchStats?.cardsCaptured ?? 0),
      usedAllElementsInMatch: playedElements.size === 4 ? 1 : 0,
      triggeredTwoWarsInMatch: Number(matchStats?.warsEntered ?? 0) >= 2 ? 1 : 0,
      reachedWinStreak3: Number(profile?.winStreak ?? 0) >= 3 ? 1 : 0,
      survivedLongestWar5: Number(matchStats?.longestWar ?? 0) >= 5 ? 1 : 0,
      completedOnlineMatch: String(matchState?.mode ?? "").trim().toLowerCase() === "online_pvp" ? 1 : 0,
      wonOnlineMatch:
        String(matchState?.mode ?? "").trim().toLowerCase() === "online_pvp" && didWin ? 1 : 0,
      wonHardPveMatch:
        String(matchState?.mode ?? "").trim().toLowerCase() === "pve" &&
        String(matchState?.difficulty ?? "").trim().toLowerCase() === "hard" &&
        didWin
          ? 1
          : 0,
      completedLocalPvpMatch: String(matchState?.mode ?? "").trim().toLowerCase() === "local_pvp" ? 1 : 0,
      completedNoQuitMatch: 1,
      featuredRivalWins: isFeaturedRivalWin ? 1 : 0,
      comebackWin: didWin && didLoseAnyRound(matchState, perspective) ? 1 : 0,
      wonRoundWithFire: didWin && wonRoundElements.has("fire") ? 1 : 0,
      wonRoundWithWater: didWin && wonRoundElements.has("water") ? 1 : 0,
      wonRoundWithEarth: didWin && wonRoundElements.has("earth") ? 1 : 0,
      wonRoundWithWind: didWin && wonRoundElements.has("wind") ? 1 : 0
    };

    const dailyApplied = applyChallengeProgress({
      definitions: dailyActiveDefinitions,
      state: dailyState,
      metrics
    });
    dailyState = dailyApplied.next;
    dailyRewards = dailyApplied.rewards;

    const weeklyApplied = applyChallengeProgress({
      definitions: weeklyActiveDefinitions,
      state: weeklyState,
      metrics
    });
    weeklyState = weeklyApplied.next;
    weeklyRewards = weeklyApplied.rewards;
  }

  const challengeTokenDelta = [...dailyRewards, ...weeklyRewards].reduce(
    (sum, item) => sum + item.rewardTokens,
    0
  );
  const challengeXpDelta = [...dailyRewards, ...weeklyRewards].reduce(
    (sum, item) => sum + Math.max(0, Number(item.rewardXp ?? 0)),
    0
  );
  const matchTokenDelta = boostRewardResult.tokens;
  const previousXp = Math.max(0, Number(profile.playerXP ?? 0));
  const challengeXpLines = [...dailyRewards, ...weeklyRewards]
    .filter((reward) => Number(reward.rewardXp ?? 0) > 0)
    .map((reward) => ({
      key: `challenge_${reward.id}`,
      label: `${reward.name} Challenge`,
      amount: Number(reward.rewardXp)
    }));
  const hardBonusXpLines =
    hardPveWinBonus.xpBonus > 0
      ? [
          {
            key: "hard_pve_victory_bonus",
            label: "Hard AI Victory Bonus",
            amount: hardPveWinBonus.xpBonus
          }
        ]
      : [];
  const boostXpLines =
    boostRewardResult.xpBonus > 0
      ? [
          {
            key: "boost_event_match_xp_bonus",
            label: "Boost Event Match XP Bonus",
            amount: boostRewardResult.xpBonus
          }
        ]
      : [];
  const rawXpLines = [...matchXpBreakdown.lines, ...hardBonusXpLines, ...boostXpLines, ...challengeXpLines];
  const rawXpDelta = boostRewardResult.xp + challengeXpDelta;
  const xpAwardResult = applyXpWithMaxLevelFallback({
    currentXp: previousXp,
    xpToAward: rawXpDelta
  });
  const xpBreakdown = {
    lines: trimXpBreakdownLinesToAppliedXp(rawXpLines, xpAwardResult.appliedXp),
    total: xpAwardResult.appliedXp
  };
  const xpDelta = xpAwardResult.appliedXp;
  const matchXpDelta = boostRewardResult.xp;
  const nextXp = xpAwardResult.nextXp;
  const nextLevel = xpAwardResult.levelAfter;
  const xpConversionTokenBonus = xpAwardResult.convertedTokens;
  const overflowXp = xpAwardResult.overflowXp;
  const tokenDelta = matchTokenDelta + challengeTokenDelta + xpConversionTokenBonus;

  let nextProfile = {
    ...profile,
    tokens: Math.max(0, Number(profile.tokens ?? 0) + tokenDelta),
    playerXP: nextXp,
    playerLevel: nextLevel,
    dailyChallenges: {
      daily: dailyState,
      weekly: weeklyState
    }
  };

  if (areAllChallengesCompleted(dailyActiveDefinitions, dailyState) && !dailyState.completionChestGranted) {
    dailyState = {
      ...dailyState,
      completionChestGranted: true
    };
    nextProfile = grantChest(
      {
        ...nextProfile,
        dailyChallenges: {
          ...nextProfile.dailyChallenges,
          daily: dailyState
        }
      },
      { amount: DAILY_COMPLETION_CHEST_AMOUNT }
    );
    dailyChestDelta = DAILY_COMPLETION_CHEST_AMOUNT;
  }

  if (areAllChallengesCompleted(weeklyActiveDefinitions, weeklyState) && !weeklyState.completionChestGranted) {
    weeklyState = {
      ...weeklyState,
      completionChestGranted: true
    };
    nextProfile = grantChest(
      {
        ...nextProfile,
        dailyChallenges: {
          ...nextProfile.dailyChallenges,
          weekly: weeklyState
        }
      },
      { chestType: EPIC_CHEST_TYPE, amount: WEEKLY_COMPLETION_CHEST_AMOUNT }
    );
    weeklyChestDelta = WEEKLY_COMPLETION_CHEST_AMOUNT;
  }

  nextProfile = {
    ...nextProfile,
    dailyChallenges: {
      daily: dailyState,
      weekly: weeklyState
    }
  };

  const view = getDailyChallengesView(nextProfile, nowMs).view;

  return {
    profile: nextProfile,
    rewards: {
      daily: dailyRewards,
      weekly: weeklyRewards
    },
    view,
    tokenDelta,
    matchTokenDelta,
    challengeTokenDelta,
    challengeXpDelta,
    dailyChestDelta,
    weeklyChestDelta,
    xpDelta,
    matchXpDelta,
    xpBreakdown,
    xpConversionTokenBonus,
    overflowXp,
    boostDisplay: boostRewardResult.display,
    levelBefore: deriveLevelFromXp(previousXp),
    levelAfter: nextLevel
  };
}

export function getDailyChallengesView(profile, nowMs = Date.now()) {
  const ensured = ensureChallengeState(profile, nowMs);
  const dailyActiveDefinitions = getDailyActiveDefinitions(ensured.challenges.daily);
  const weeklyActiveDefinitions = getWeeklyActiveDefinitions(ensured.challenges.weekly);
  const normalizedProfile = {
    ...profile,
    dailyChallenges: ensured.challenges
  };

  return {
    profile: normalizedProfile,
    didReset: ensured.didReset,
    view: {
      daily: buildChallengeView(
        dailyActiveDefinitions,
        ensured.challenges.daily,
        ensured.dailyResetWindow.nextResetMs,
        "\u2B50",
        nowMs,
        { bonusIdSet: DAILY_BONUS_ID_SET }
      ),
      weekly: buildChallengeView(
        weeklyActiveDefinitions,
        ensured.challenges.weekly,
        ensured.weeklyResetWindow.nextResetMs,
        "\uD83C\uDFC6",
        nowMs,
        { bonusIdSet: WEEKLY_BONUS_ID_SET }
      )
    },
    level: getLevelProgress(normalizedProfile)
  };
}

export { getDailyResetWindow, getLevelProgress, getXpThresholds };
