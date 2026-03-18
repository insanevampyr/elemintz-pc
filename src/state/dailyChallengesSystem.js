import { buildXpBreakdown, deriveLevelFromXp, getLevelProgress, getXpThresholds } from "./levelRewardsSystem.js";

const RESET_TIME_ZONE = "America/Chicago";
const RESET_HOUR = 18;

const WEEKDAY_INDEX = Object.freeze({
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
});

export const DAILY_CHALLENGE_DEFINITIONS = Object.freeze([
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
    id: "daily_win_2_wars",
    name: "Win 2 WARs",
    description: "Win 2 WARs across completed matches in one day.",
    rewardTokens: 3,
    rewardXp: 7,
    goal: 2,
    progressKey: "warsWon"
  },
  {
    id: "daily_trigger_2_wars_one_match",
    name: "Trigger 2 WARs In One Match",
    description: "In one completed match, trigger 2 WARs.",
    rewardTokens: 4,
    rewardXp: 8,
    goal: 1,
    progressKey: "triggeredTwoWarsInMatch"
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
    id: "daily_capture_24_cards",
    name: "Capture 24 Cards In One Day",
    description: "Capture 24 opponent cards across completed matches in one day.",
    rewardTokens: 4,
    rewardXp: 8,
    goal: 24,
    progressKey: "cardsCaptured"
  },
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
    id: "daily_use_all_4_elements",
    name: "Use All 4 Elements In One Match",
    description: "In one completed match, play Fire, Water, Earth, and Wind at least once.",
    rewardTokens: 3,
    rewardXp: 6,
    goal: 1,
    progressKey: "usedAllElementsInMatch"
  }
].filter((item) => Number(item.rewardTokens) > 0));

export const WEEKLY_CHALLENGE_DEFINITIONS = Object.freeze([
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
    id: "weekly_win_20_matches",
    name: "Win 20 Matches",
    description: "Win 20 completed matches in one week.",
    rewardTokens: 10,
    rewardXp: 22,
    goal: 20,
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
    id: "weekly_win_15_wars",
    name: "Win 15 WARs",
    description: "Win 15 WARs across completed matches in one week.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 15,
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
    id: "weekly_play_15_matches",
    name: "Play 15 Matches",
    description: "Complete 15 matches.",
    rewardTokens: 5,
    rewardXp: 15,
    goal: 15,
    progressKey: "matchesPlayed"
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
    id: "weekly_use_all_4_elements_10x",
    name: "Use All 4 Elements In 10 Different Matches",
    description: "In 10 completed matches, play Fire, Water, Earth, and Wind at least once.",
    rewardTokens: 10,
    rewardXp: 25,
    goal: 10,
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

function buildProgressDefaults() {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    warsWon: 0,
    cardsCaptured: 0,
    usedAllElementsInMatch: 0,
    triggeredTwoWarsInMatch: 0,
    reachedWinStreak3: 0,
    survivedLongestWar5: 0
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
    )
  };
}

function normalizeFlags(value, definitions, defaultValue = false) {
  const incoming = value ?? {};
  const defaults = buildBooleanMap(definitions, defaultValue);
  const next = {};

  for (const key of Object.keys(defaults)) {
    next[key] = Boolean(incoming[key] ?? defaults[key]);
  }

  return next;
}

function normalizeCompletedFlags(progress, completed, rewarded, definitions) {
  const next = {};

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

function buildChallengeState(definitions, lastResetMs) {
  return {
    lastReset: safeIsoFromMs(lastResetMs),
    progress: buildProgressDefaults(),
    completed: buildBooleanMap(definitions, false),
    rewarded: buildBooleanMap(definitions, false)
  };
}

function normalizeChallengeState(current, definitions, fallbackResetMs) {
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
    rewarded
  };
}

function buildDefaultState(nowMs = Date.now()) {
  return {
    daily: buildChallengeState(DAILY_CHALLENGE_DEFINITIONS, getDailyResetWindow(nowMs).lastResetMs),
    weekly: buildChallengeState(WEEKLY_CHALLENGE_DEFINITIONS, getWeeklyResetWindow(nowMs).lastResetMs)
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

function ensureChallengeWindow(state, definitions, resetWindow) {
  const lastAppliedResetMs = toMs(state?.lastReset, 0);
  if (lastAppliedResetMs < resetWindow.lastResetMs) {
    return {
      state: buildChallengeState(definitions, resetWindow.lastResetMs),
      didReset: true
    };
  }

  return {
    state: normalizeChallengeState(state, definitions, resetWindow.lastResetMs),
    didReset: false
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
    dailyResetWindow
  );
  const ensuredWeekly = ensureChallengeWindow(
    current.weekly,
    WEEKLY_CHALLENGE_DEFINITIONS,
    weeklyResetWindow
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

function buildChallengeView(definitions, state, nextResetMs, icon, nowMs) {
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
  nowMs = Date.now()
}) {
  const ensured = ensureChallengeState(profile, nowMs);
  const isCompleted = matchState?.status === "completed";
  const isQuit = String(matchState?.endReason ?? "") === "quit_forfeit";

  let dailyState = ensured.challenges.daily;
  let weeklyState = ensured.challenges.weekly;

  let dailyRewards = [];
  let weeklyRewards = [];

  const didWin = matchState.winner === perspective;
  const didDraw = matchState.winner === "draw";
  const playedElements = extractPlayedElements(matchState, perspective);

  if (isCompleted && !isQuit) {
    const metrics = {
      matchesPlayed: 1,
      matchesWon: didWin ? 1 : 0,
      warsWon: Number(matchStats?.warsWon ?? 0),
      cardsCaptured: Number(matchStats?.cardsCaptured ?? 0),
      usedAllElementsInMatch: playedElements.size === 4 ? 1 : 0,
      triggeredTwoWarsInMatch: Number(matchStats?.warsEntered ?? 0) >= 2 ? 1 : 0,
      reachedWinStreak3: Number(profile?.winStreak ?? 0) >= 3 ? 1 : 0,
      survivedLongestWar5: Number(matchStats?.longestWar ?? 0) >= 5 ? 1 : 0
    };

    const dailyApplied = applyChallengeProgress({
      definitions: DAILY_CHALLENGE_DEFINITIONS,
      state: dailyState,
      metrics
    });
    dailyState = dailyApplied.next;
    dailyRewards = dailyApplied.rewards;

    const weeklyApplied = applyChallengeProgress({
      definitions: WEEKLY_CHALLENGE_DEFINITIONS,
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
  const matchTokenDelta = getMatchTokenReward({ isCompleted, isQuit, didWin, didDraw });
  const tokenDelta = matchTokenDelta + challengeTokenDelta;

  const previousXp = Math.max(0, Number(profile.playerXP ?? 0));
  const matchXpBreakdown = buildXpBreakdown({
    isCompleted,
    isQuit,
    didWin,
    warsWon: Number(matchStats?.warsWon ?? 0)
  });
  const challengeXpLines = [...dailyRewards, ...weeklyRewards]
    .filter((reward) => Number(reward.rewardXp ?? 0) > 0)
    .map((reward) => ({
      key: `challenge_${reward.id}`,
      label: `${reward.name} Challenge`,
      amount: Number(reward.rewardXp)
    }));
  const xpBreakdown = {
    lines: [...matchXpBreakdown.lines, ...challengeXpLines],
    total: matchXpBreakdown.total + challengeXpDelta
  };
  const xpDelta = xpBreakdown.total;
  const nextXp = previousXp + xpDelta;
  const nextLevel = deriveLevelFromXp(nextXp);

  const nextProfile = {
    ...profile,
    tokens: Math.max(0, Number(profile.tokens ?? 0) + tokenDelta),
    playerXP: nextXp,
    playerLevel: nextLevel,
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
    xpDelta,
    xpBreakdown,
    levelBefore: deriveLevelFromXp(previousXp),
    levelAfter: nextLevel
  };
}

export function getDailyChallengesView(profile, nowMs = Date.now()) {
  const ensured = ensureChallengeState(profile, nowMs);
  const normalizedProfile = {
    ...profile,
    dailyChallenges: ensured.challenges
  };

  return {
    profile: normalizedProfile,
    didReset: ensured.didReset,
    view: {
      daily: buildChallengeView(
        DAILY_CHALLENGE_DEFINITIONS,
        ensured.challenges.daily,
        ensured.dailyResetWindow.nextResetMs,
        "\u2B50",
        nowMs
      ),
      weekly: buildChallengeView(
        WEEKLY_CHALLENGE_DEFINITIONS,
        ensured.challenges.weekly,
        ensured.weeklyResetWindow.nextResetMs,
        "\uD83C\uDFC6",
        nowMs
      )
    },
    level: getLevelProgress(normalizedProfile)
  };
}

export { getDailyResetWindow, getLevelProgress, getXpThresholds };
