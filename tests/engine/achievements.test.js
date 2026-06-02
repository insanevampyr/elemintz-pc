import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ACHIEVEMENT_DEFINITIONS,
  applyAchievementTokenRewards,
  buildAchievementCatalog,
  evaluateAchievements,
  evaluateRetroactiveAchievements
} from "../../src/state/achievementSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

function buildCompletedMatch({
  winner = "p1",
  rounds = 3,
  endReason = null,
  history = [],
  mode = "pve",
  p1Hand = ["fire", "water", "earth", "wind"],
  p2Hand = [],
  durationMs = 240000
} = {}) {
  return {
    id: "match-ach",
    status: "completed",
    round: rounds,
    mode,
    difficulty: "balanced",
    winner,
    endReason,
    currentPile: [],
    players: {
      p1: { hand: [...p1Hand], wonRounds: 0 },
      p2: { hand: [...p2Hand], wonRounds: 0 }
    },
    war: {
      active: false,
      clashes: history.reduce((sum, entry) => sum + (entry.warClashes ?? 0), 0)
    },
    history,
    meta: {
      totalCards: p1Hand.length + p2Hand.length,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + durationMs).toISOString(),
      durationMs
    }
  };
}

function tempDirPrefix() {
  return path.join(os.tmpdir(), "elemintz-ach-");
}

async function createTempDataDir() {
  return fs.mkdtemp(tempDirPrefix());
}

function evaluateLongestMatchThresholds(rounds) {
  return evaluateAchievements({
    profileBefore: {
      wins: 10,
      losses: 1,
      gamesPlayed: 11,
      achievements: {},
      longestMatch: { rounds: Math.max(0, rounds - 1) }
    },
    profileAfter: {
      wins: 10,
      losses: 1,
      gamesPlayed: 11,
      achievements: {},
      longestMatch: { rounds }
    },
    matchState: buildCompletedMatch({
      winner: "p1",
      rounds,
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    }),
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  })
    .map((item) => item.id)
    .filter((id) => id.startsWith("long_match_"));
}

test("achievement definitions include required badges", () => {
  const ids = ACHIEVEMENT_DEFINITIONS.map((item) => item.id);
  assert.ok(ids.includes("first_flame"));
  assert.ok(ids.includes("flawless_victory"));
  assert.ok(ids.includes("quick_draw"));
  assert.ok(ids.includes("quickdraw_master"));
  assert.ok(ids.includes("card_hoarder"));
  assert.ok(ids.includes("card_hoarder_elite"));
  assert.ok(ids.includes("war_machine"));
  assert.ok(ids.includes("warrior"));
  assert.ok(ids.includes("perfect_warrior"));
  assert.ok(ids.includes("overtime_champion"));
  assert.ok(ids.includes("marathon_gamer"));
  assert.ok(ids.includes("elemental_overlord"));
  assert.ok(ids.includes("collector"));
  assert.ok(ids.includes("streak_lord"));
  assert.ok(ids.includes("unbreakable_streak"));
  assert.ok(ids.includes("the_immortal"));
  assert.ok(ids.includes("match_wins_25"));
  assert.ok(ids.includes("match_wins_250"));
  assert.ok(ids.includes("matches_played_50"));
  assert.ok(ids.includes("matches_played_250"));
  assert.ok(ids.includes("cards_captured_100"));
  assert.ok(ids.includes("cards_captured_1000"));
  assert.ok(ids.includes("wars_entered_25"));
  assert.ok(ids.includes("wars_won_100"));
  assert.ok(ids.includes("level_5"));
  assert.ok(ids.includes("level_50"));
  assert.ok(ids.includes("comeback_win"));
  assert.ok(ids.includes("longest_war_5"));
  assert.ok(ids.includes("longest_war_7"));
  assert.ok(ids.includes("comeback_win_5"));
  assert.ok(ids.includes("comeback_win_25"));
  assert.ok(ids.includes("local_pvp_wins_25"));
  assert.ok(ids.includes("pve_wins_25"));
  assert.ok(ids.includes("all_elements_25"));
  assert.ok(ids.includes("online_wins_10"));
  assert.ok(ids.includes("online_wins_25"));
  assert.ok(ids.includes("online_wins_50"));
  assert.ok(ids.includes("local_pvp_wins_50"));
  assert.ok(ids.includes("pve_wins_50"));
  assert.ok(ids.includes("matches_played_500"));
  assert.ok(ids.includes("cards_captured_2000"));
  assert.ok(ids.includes("wars_entered_250"));
  assert.ok(ids.includes("wars_won_250"));
  assert.ok(ids.includes("win_streak_10"));
  assert.ok(ids.includes("rival_defeats_10"));
  assert.ok(ids.includes("rival_defeats_20"));
  assert.ok(ids.includes("rival_defeats_30"));
  assert.ok(ids.includes("rival_defeats_50"));
  assert.ok(ids.includes("long_match_25"));
  assert.ok(ids.includes("long_match_50"));
  assert.ok(ids.includes("long_match_75"));
  assert.ok(ids.includes("long_match_100"));
});

test("achievement definitions map all Longest Match achievements to the shared badge art", () => {
  const longestMatchDefinitions = ACHIEVEMENT_DEFINITIONS.filter((item) =>
    ["long_match_25", "long_match_50", "long_match_75", "long_match_100"].includes(item.id)
  );

  assert.equal(longestMatchDefinitions.length, 4);
  assert.ok(
    longestMatchDefinitions.every((item) => item.image === "badges/longest_match_badge.png")
  );
});

test("achievement evaluator: Longest Match thresholds unlock the correct chain", () => {
  assert.deepEqual(evaluateLongestMatchThresholds(24), []);
  assert.deepEqual(evaluateLongestMatchThresholds(25), ["long_match_25"]);
  assert.deepEqual(evaluateLongestMatchThresholds(50), ["long_match_25", "long_match_50"]);
  assert.deepEqual(evaluateLongestMatchThresholds(75), [
    "long_match_25",
    "long_match_50",
    "long_match_75"
  ]);
  assert.deepEqual(evaluateLongestMatchThresholds(97), [
    "long_match_25",
    "long_match_50",
    "long_match_75"
  ]);
  assert.deepEqual(evaluateLongestMatchThresholds(100), [
    "long_match_25",
    "long_match_50",
    "long_match_75",
    "long_match_100"
  ]);
});

test("achievement evaluator: Longest Match retroactive evaluation uses persisted rounds", () => {
  const unlocked = evaluateRetroactiveAchievements({
    username: "RetroLongestMatchUser",
    achievements: {},
    longestMatch: {
      rounds: 97,
      mode: "gauntlet",
      opponentName: "Countess Veyra",
      result: "timer_win",
      capturedFor: 43,
      capturedAgainst: 40,
      achievedAt: "2026-06-01T00:00:00.000Z"
    }
  });

  const ids = unlocked.map((item) => item.id);
  assert.deepEqual(ids, ["long_match_25", "long_match_50", "long_match_75"]);
  assert.ok(!ids.includes("long_match_100"));
});

test("achievement catalog: Longest Match unlock state and progress stay aligned for a 97-round record", () => {
  const catalog = buildAchievementCatalog({
    achievements: {
      long_match_25: { count: 1, firstUnlockedAt: "2026-06-01T00:00:00.000Z", lastUnlockedAt: "2026-06-01T00:00:00.000Z" },
      long_match_50: { count: 1, firstUnlockedAt: "2026-06-01T00:00:00.000Z", lastUnlockedAt: "2026-06-01T00:00:00.000Z" },
      long_match_75: { count: 1, firstUnlockedAt: "2026-06-01T00:00:00.000Z", lastUnlockedAt: "2026-06-01T00:00:00.000Z" }
    },
    longestMatch: {
      rounds: 97,
      mode: "gauntlet",
      opponentName: "Countess Veyra",
      result: "timer_win",
      capturedFor: 43,
      capturedAgainst: 40,
      achievedAt: "2026-06-01T00:00:00.000Z"
    }
  });

  assert.equal(catalog.find((item) => item.id === "long_match_25")?.unlocked, true);
  assert.equal(catalog.find((item) => item.id === "long_match_50")?.unlocked, true);
  assert.equal(catalog.find((item) => item.id === "long_match_75")?.unlocked, true);
  assert.equal(catalog.find((item) => item.id === "long_match_100")?.unlocked, false);
  assert.deepEqual(catalog.find((item) => item.id === "long_match_25")?.progress, {
    current: 25,
    target: 25,
    label: "25 / 25",
    kind: "numeric"
  });
  assert.deepEqual(catalog.find((item) => item.id === "long_match_50")?.progress, {
    current: 50,
    target: 50,
    label: "50 / 50",
    kind: "numeric"
  });
  assert.deepEqual(catalog.find((item) => item.id === "long_match_75")?.progress, {
    current: 75,
    target: 75,
    label: "75 / 75",
    kind: "numeric"
  });
  assert.deepEqual(catalog.find((item) => item.id === "long_match_100")?.progress, {
    current: 97,
    target: 100,
    label: "97 / 100",
    kind: "numeric"
  });
});

test("achievement catalog includes numeric progress metadata for safe locked achievements", () => {
  const catalog = buildAchievementCatalog({
    wins: 73,
    gamesPlayed: 412,
    cardsCaptured: 486,
    featuredRivalWins: 23,
    warsEntered: 120,
    warsWon: 86,
    playerLevel: 38,
    winStreak: 9,
    longestWar: 6,
    matchesUsingAllElements: 20,
    modeStats: {
      pve: { wins: 12, losses: 0 },
      local_pvp: { wins: 18, losses: 0 },
      online_pvp: { wins: 73, losses: 0 }
    },
    longestMatch: { rounds: 97 },
    achievements: {
      comeback_win: { count: 11 },
      card_hoarder: { count: 3 }
    }
  });

  assert.deepEqual(
    catalog.find((item) => item.id === "matches_played_500")?.progress,
    { current: 412, target: 500, label: "412 / 500", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "online_wins_50")?.progress,
    { current: 50, target: 50, label: "50 / 50", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "level_50")?.progress,
    { current: 38, target: 50, label: "38 / 50", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "rival_defeats_20")?.progress,
    { current: 20, target: 20, label: "20 / 20", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "comeback_win_25")?.progress,
    { current: 11, target: 25, label: "11 / 25", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "long_match_100")?.progress,
    { current: 97, target: 100, label: "97 / 100", kind: "numeric" }
  );
});

test("achievement catalog progress clamps current to 0 minimum", () => {
  const catalog = buildAchievementCatalog({
    wins: -20,
    gamesPlayed: -5,
    cardsCaptured: -10,
    featuredRivalWins: -12,
    warsEntered: -2,
    warsWon: -1,
    playerLevel: -4,
    winStreak: -3,
    longestWar: -7,
    matchesUsingAllElements: -9,
    modeStats: {
      pve: { wins: -8 },
      local_pvp: { wins: -6 },
      online_pvp: { wins: -11 }
    },
    achievements: {
      comeback_win: { count: -2 },
      card_hoarder: { count: -1 }
    }
  });

  assert.deepEqual(
    catalog.find((item) => item.id === "matches_played_500")?.progress,
    { current: 0, target: 500, label: "0 / 500", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "comeback_win_5")?.progress,
    { current: 0, target: 5, label: "0 / 5", kind: "numeric" }
  );
});

test("achievement catalog progress clamps current to target maximum", () => {
  const catalog = buildAchievementCatalog({
    wins: 9999,
    gamesPlayed: 9999,
    cardsCaptured: 9999,
    featuredRivalWins: 9999,
    warsEntered: 9999,
    warsWon: 9999,
    playerLevel: 999,
    winStreak: 999,
    longestWar: 999,
    matchesUsingAllElements: 999,
    modeStats: {
      pve: { wins: 999 },
      local_pvp: { wins: 999 },
      online_pvp: { wins: 999 }
    },
    achievements: {
      comeback_win: { count: 999 },
      card_hoarder: { count: 999 }
    }
  });

  assert.deepEqual(
    catalog.find((item) => item.id === "wars_won_250")?.progress,
    { current: 250, target: 250, label: "250 / 250", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "rival_defeats_50")?.progress,
    { current: 50, target: 50, label: "50 / 50", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "streak_lord")?.progress,
    { current: 15, target: 15, label: "15 / 15", kind: "numeric" }
  );
  assert.deepEqual(
    catalog.find((item) => item.id === "card_hoarder_elite")?.progress,
    { current: 5, target: 5, label: "5 / 5", kind: "numeric" }
  );
});

test("achievement catalog excludes special-condition achievements from numeric progress", () => {
  const catalog = buildAchievementCatalog({
    wins: 100,
    losses: 1,
    gamesPlayed: 100,
    warsEntered: 50,
    warsWon: 30,
    cardsCaptured: 200,
    playerLevel: 10,
    winStreak: 7,
    longestWar: 4,
    matchesUsingAllElements: 20,
    modeStats: {
      pve: { wins: 50 },
      local_pvp: { wins: 50 },
      online_pvp: { wins: 50 }
    },
    achievements: {
      comeback_win: { count: 3 },
      card_hoarder: { count: 2 }
    }
  });

  for (const excludedId of [
    "first_flame",
    "flawless_victory",
    "quick_draw",
    "quickdraw_master",
    "card_hoarder",
    "war_machine",
    "perfect_warrior",
    "overtime_champion",
    "the_immortal",
    "comeback_win"
  ]) {
    assert.equal(catalog.find((item) => item.id === excludedId)?.progress ?? null, null);
  }
});

test("achievement evaluator: approved expansion achievements unlock at their configured thresholds", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 8,
    history: [{ result: "p1", warClashes: 7, capturedCards: 8, capturedOpponentCards: 4 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });
  match.meta.minHandSizes = { p1: 3, p2: 4 };

  const unlocked = evaluateAchievements({
    profileBefore: {
      wins: 49,
      losses: 10,
      achievements: { comeback_win: { count: 4 } },
      winStreak: 0,
      gamesPlayed: 80,
      cardsCaptured: 90,
      longestWar: 4,
      matchesUsingAllElements: 24,
      modeStats: {
        pve: { wins: 24, losses: 10 },
        local_pvp: { wins: 24, losses: 12 }
      }
    },
    profileAfter: {
      wins: 50,
      losses: 10,
      achievements: { comeback_win: { count: 4 } },
      winStreak: 1,
      gamesPlayed: 81,
      cardsCaptured: 94,
      longestWar: 7,
      matchesUsingAllElements: 25,
      modeStats: {
        pve: { wins: 25, losses: 10 },
        local_pvp: { wins: 25, losses: 12 }
      }
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 4 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(ids.includes("longest_war_5"));
  assert.ok(ids.includes("longest_war_7"));
  assert.ok(ids.includes("comeback_win"));
  assert.ok(ids.includes("comeback_win_5"));
  assert.ok(ids.includes("local_pvp_wins_25"));
  assert.ok(ids.includes("pve_wins_25"));
  assert.ok(ids.includes("all_elements_25"));
});

test("achievement evaluator: approved expansion achievements do not unlock below threshold", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 8,
    history: [{ result: "p1", warClashes: 4, capturedCards: 6, capturedOpponentCards: 3 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });
  match.meta.minHandSizes = { p1: 4, p2: 4 };

  const unlocked = evaluateAchievements({
    profileBefore: {
      achievements: { comeback_win: { count: 3 } },
      longestWar: 4,
      matchesUsingAllElements: 24,
      modeStats: {
        pve: { wins: 24, losses: 10 },
        local_pvp: { wins: 24, losses: 12 }
      }
    },
    profileAfter: {
      achievements: { comeback_win: { count: 3 } },
      longestWar: 4,
      matchesUsingAllElements: 24,
      modeStats: {
        pve: { wins: 24, losses: 10 },
        local_pvp: { wins: 24, losses: 12 }
      }
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 3 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(!ids.includes("longest_war_5"));
  assert.ok(!ids.includes("longest_war_7"));
  assert.ok(!ids.includes("comeback_win_5"));
  assert.ok(!ids.includes("comeback_win_25"));
  assert.ok(!ids.includes("local_pvp_wins_25"));
  assert.ok(!ids.includes("pve_wins_25"));
  assert.ok(!ids.includes("all_elements_25"));
});

test("achievement evaluator: unlocks quick draw and flawless victory conditions", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 2,
    durationMs: 110000,
    history: [
      { result: "p1", warClashes: 0, capturedCards: 2 },
      { result: "p1", warClashes: 0, capturedCards: 2 }
    ],
    p1Hand: ["fire", "fire", "water", "water", "earth", "earth", "wind", "wind", "fire", "fire", "water", "water", "earth", "earth", "wind", "wind"],
    p2Hand: []
  });

  const unlocked = evaluateAchievements({
    profileBefore: { wins: 0, achievements: {}, winStreak: 0, gamesPlayed: 0, cardsCaptured: 0 },
    profileAfter: { wins: 1, achievements: {}, winStreak: 1, gamesPlayed: 1, cardsCaptured: 4 },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 4 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(ids.includes("first_flame"));
  assert.ok(ids.includes("flawless_victory"));
  assert.ok(ids.includes("quick_draw"));
  assert.ok(ids.includes("quickdraw_master"));
  assert.ok(ids.includes("card_hoarder"));
  assert.ok(ids.includes("perfect_warrior"));
});

test("achievement evaluator: unlocks overtime and progression achievements", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 8,
    endReason: "time_limit",
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlocked = evaluateAchievements({
    profileBefore: { wins: 24, achievements: {}, winStreak: 4, gamesPlayed: 24, cardsCaptured: 24, warsWon: 9 },
    profileAfter: { wins: 25, achievements: {}, winStreak: 5, gamesPlayed: 25, cardsCaptured: 25, warsWon: 10 },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(ids.includes("overtime_champion"));
  assert.ok(ids.includes("marathon_gamer"));
  assert.ok(ids.includes("match_wins_25"));
  assert.ok(ids.includes("collector"));
  assert.ok(ids.includes("warrior"));
  assert.ok(ids.includes("unbreakable_streak"));
});

test("achievement evaluator: unlocks extended progression milestones", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 6,
    history: [{ result: "p1", warClashes: 1, capturedCards: 4 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlocked = evaluateAchievements({
    profileBefore: {
      wins: 199,
      achievements: { card_hoarder: { count: 5 } },
      winStreak: 14,
      bestWinStreak: 14,
      gamesPlayed: 60,
      cardsCaptured: 249,
      warsWon: 12
    },
    profileAfter: {
      wins: 200,
      achievements: { card_hoarder: { count: 5 } },
      winStreak: 15,
      bestWinStreak: 15,
      gamesPlayed: 61,
      cardsCaptured: 250,
      warsWon: 13
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 1 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(ids.includes("elemental_overlord"));
  assert.ok(ids.includes("streak_lord"));
  assert.ok(ids.includes("cards_captured_250"));
  assert.ok(ids.includes("matches_played_50"));
  assert.ok(ids.includes("cards_captured_250"));
  assert.ok(ids.includes("card_hoarder_elite"));
});

test("achievement normalization removes deleted duplicate achievements from saved progress and catalog output", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "DuplicateCleanupUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    achievements: {
      ...profile.achievements,
      elemental_conqueror: {
        count: 1,
        firstUnlockedAt: "2026-01-01T00:00:00.000Z",
        lastUnlockedAt: "2026-01-01T00:00:00.000Z"
      },
      collector_supreme: {
        count: 1,
        firstUnlockedAt: "2026-01-02T00:00:00.000Z",
        lastUnlockedAt: "2026-01-02T00:00:00.000Z"
      },
      match_wins_25: {
        count: 1,
        firstUnlockedAt: "2026-01-03T00:00:00.000Z",
        lastUnlockedAt: "2026-01-03T00:00:00.000Z"
      }
    }
  });

  const normalized = await state.profiles.getProfile(username);
  assert.equal("elemental_conqueror" in normalized.achievements, false);
  assert.equal("collector_supreme" in normalized.achievements, false);
  assert.equal(normalized.achievements.match_wins_25.count, 1);

  const catalogIds = buildAchievementCatalog(normalized).map((item) => item.id);
  assert.ok(!catalogIds.includes("elemental_conqueror"));
  assert.ok(!catalogIds.includes("collector_supreme"));
  assert.ok(catalogIds.includes("match_wins_25"));
});

test("achievement evaluator: phase 1 tiered achievements unlock at the configured thresholds", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 10,
    history: [{ result: "p1", warClashes: 1, capturedCards: 8 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlocked = evaluateAchievements({
    profileBefore: {
      wins: 99,
      losses: 20,
      gamesPlayed: 99,
      cardsCaptured: 499,
      warsEntered: 99,
      warsWon: 99,
      playerLevel: 49,
      achievements: {},
      winStreak: 0
    },
    profileAfter: {
      wins: 100,
      losses: 20,
      gamesPlayed: 100,
      cardsCaptured: 500,
      warsEntered: 100,
      warsWon: 100,
      playerLevel: 50,
      achievements: {},
      winStreak: 1
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 8 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(ids.includes("match_wins_100"));
  assert.ok(ids.includes("matches_played_100"));
  assert.ok(ids.includes("cards_captured_500"));
  assert.ok(ids.includes("wars_entered_100"));
  assert.ok(ids.includes("wars_won_100"));
  assert.ok(ids.includes("level_50"));
});

test("achievement evaluator: phase 1 tiered achievements do not unlock below threshold and remain non-repeatable", () => {
  const definitions = ACHIEVEMENT_DEFINITIONS.filter((item) =>
    [
      "match_wins_25",
      "matches_played_50",
      "cards_captured_100",
      "wars_entered_25",
      "wars_won_25",
      "level_5"
    ].includes(item.id)
  );

  assert.ok(definitions.every((item) => item.repeatable === false));

  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 4,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlockedBelow = evaluateAchievements({
    profileBefore: {
      wins: 23,
      losses: 1,
      gamesPlayed: 49,
      cardsCaptured: 99,
      warsEntered: 24,
      warsWon: 24,
      playerLevel: 4,
      achievements: {},
      winStreak: 0
    },
    profileAfter: {
      wins: 24,
      losses: 1,
      gamesPlayed: 49,
      cardsCaptured: 99,
      warsEntered: 24,
      warsWon: 24,
      playerLevel: 4,
      achievements: {},
      winStreak: 1
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  const unlockedIds = unlockedBelow.map((item) => item.id);
  assert.ok(!unlockedIds.includes("match_wins_25"));
  assert.ok(!unlockedIds.includes("matches_played_50"));
  assert.ok(!unlockedIds.includes("cards_captured_100"));
  assert.ok(!unlockedIds.includes("wars_entered_25"));
  assert.ok(!unlockedIds.includes("wars_won_25"));
  assert.ok(!unlockedIds.includes("level_5"));

  const filteredRepeat = evaluateAchievements({
    profileBefore: {
      wins: 25,
      losses: 1,
      gamesPlayed: 50,
      cardsCaptured: 100,
      warsEntered: 25,
      warsWon: 25,
      playerLevel: 5,
      achievements: {
        match_wins_25: { count: 1 },
        matches_played_50: { count: 1 },
        cards_captured_100: { count: 1 },
        wars_entered_25: { count: 1 },
        wars_won_25: { count: 1 },
        level_5: { count: 1 }
      },
      winStreak: 0
    },
    profileAfter: {
      wins: 30,
      losses: 1,
      gamesPlayed: 60,
      cardsCaptured: 120,
      warsEntered: 30,
      warsWon: 30,
      playerLevel: 6,
      achievements: {
        match_wins_25: { count: 1 },
        matches_played_50: { count: 1 },
        cards_captured_100: { count: 1 },
        wars_entered_25: { count: 1 },
        wars_won_25: { count: 1 },
        level_5: { count: 1 }
      },
      winStreak: 1
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  const repeatIds = filteredRepeat.map((item) => item.id);
  assert.ok(!repeatIds.includes("match_wins_25"));
  assert.ok(!repeatIds.includes("matches_played_50"));
  assert.ok(!repeatIds.includes("cards_captured_100"));
  assert.ok(!repeatIds.includes("wars_entered_25"));
  assert.ok(!repeatIds.includes("wars_won_25"));
  assert.ok(!repeatIds.includes("level_5"));
});

test("achievement evaluator: first expansion batch unlocks at the configured thresholds", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 8,
    history: [{ result: "p1", warClashes: 2, capturedCards: 8 }],
    mode: "online_pvp"
  });

  const unlocked = evaluateAchievements({
    profileBefore: {
      gamesPlayed: 499,
      cardsCaptured: 1999,
      warsEntered: 249,
      warsWon: 249,
      winStreak: 9,
      achievements: {},
      modeStats: {
        online_pvp: { wins: 49, losses: 0 },
        local_pvp: { wins: 49, losses: 0 },
        pve: { wins: 49, losses: 0 }
      }
    },
    profileAfter: {
      gamesPlayed: 500,
      cardsCaptured: 2000,
      warsEntered: 250,
      warsWon: 250,
      winStreak: 10,
      achievements: {},
      modeStats: {
        online_pvp: { wins: 50, losses: 0 },
        local_pvp: { wins: 50, losses: 0 },
        pve: { wins: 50, losses: 0 }
      }
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 8 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(ids.includes("online_wins_10"));
  assert.ok(ids.includes("online_wins_25"));
  assert.ok(ids.includes("online_wins_50"));
  assert.ok(ids.includes("local_pvp_wins_50"));
  assert.ok(ids.includes("pve_wins_50"));
  assert.ok(ids.includes("matches_played_500"));
  assert.ok(ids.includes("cards_captured_2000"));
  assert.ok(ids.includes("wars_entered_250"));
  assert.ok(ids.includes("wars_won_250"));
  assert.ok(ids.includes("win_streak_10"));
});

test("achievement evaluator: first expansion batch does not unlock below threshold", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 5,
    history: [{ result: "p1", warClashes: 1, capturedCards: 4 }],
    mode: "online_pvp"
  });

  const unlocked = evaluateAchievements({
    profileBefore: {
      gamesPlayed: 498,
      cardsCaptured: 1998,
      warsEntered: 248,
      warsWon: 248,
      winStreak: 8,
      achievements: {},
      modeStats: {
        online_pvp: { wins: 9, losses: 0 },
        local_pvp: { wins: 49, losses: 0 },
        pve: { wins: 49, losses: 0 }
      }
    },
    profileAfter: {
      gamesPlayed: 499,
      cardsCaptured: 1999,
      warsEntered: 249,
      warsWon: 249,
      winStreak: 9,
      achievements: {},
      modeStats: {
        online_pvp: { wins: 9, losses: 0 },
        local_pvp: { wins: 49, losses: 0 },
        pve: { wins: 49, losses: 0 }
      }
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 4 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(!ids.includes("online_wins_10"));
  assert.ok(!ids.includes("online_wins_25"));
  assert.ok(!ids.includes("online_wins_50"));
  assert.ok(!ids.includes("local_pvp_wins_50"));
  assert.ok(!ids.includes("pve_wins_50"));
  assert.ok(!ids.includes("matches_played_500"));
  assert.ok(!ids.includes("cards_captured_2000"));
  assert.ok(!ids.includes("wars_entered_250"));
  assert.ok(!ids.includes("wars_won_250"));
  assert.ok(!ids.includes("win_streak_10"));
});

test("achievement evaluator: Featured Rival lifetime milestones unlock at 10, 20, 30, and 50 wins", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 5,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    mode: "pve"
  });
  match.featuredRivalId = "crownfire_duelist";

  const scenarios = [
    { before: 9, after: 10, id: "rival_defeats_10" },
    { before: 19, after: 20, id: "rival_defeats_20" },
    { before: 29, after: 30, id: "rival_defeats_30" },
    { before: 49, after: 50, id: "rival_defeats_50" }
  ];

  for (const scenario of scenarios) {
    const unlocked = evaluateAchievements({
      profileBefore: { achievements: {}, featuredRivalWins: scenario.before },
      profileAfter: { achievements: {}, featuredRivalWins: scenario.after },
      matchState: match,
      perspective: "p1",
      matchStats: { wins: 1, losses: 0, cardsCaptured: 1, featuredRivalWins: 1 }
    });

    assert.ok(unlocked.some((item) => item.id === scenario.id));
  }
});

test("achievement token rewards: first expansion batch grants only the approved token payouts", () => {
  const startingProfile = { tokens: 100 };
  const rewarded = applyAchievementTokenRewards(startingProfile, [
    { id: "online_wins_10" },
    { id: "online_wins_25" },
    { id: "online_wins_50" },
    { id: "local_pvp_wins_50" },
    { id: "pve_wins_50" },
    { id: "win_streak_10" }
  ]);
  assert.equal(rewarded.profile.tokens, 160);

  const unrewarded = applyAchievementTokenRewards({ tokens: 100 }, [
    { id: "matches_played_500" },
    { id: "cards_captured_2000" },
    { id: "wars_entered_250" },
    { id: "wars_won_250" }
  ]);
  assert.equal(unrewarded.profile.tokens, 100);
});

test("Featured Rival lifetime achievements use the shared badge and grant no token rewards", () => {
  const definitions = ACHIEVEMENT_DEFINITIONS.filter((item) =>
    ["rival_defeats_10", "rival_defeats_20", "rival_defeats_30", "rival_defeats_50"].includes(item.id)
  );

  assert.equal(definitions.length, 4);
  for (const definition of definitions) {
    assert.equal(definition.image, "badges/featuredRival.png");
    assert.equal(definition.repeatable, false);
    assert.equal("rewardTokens" in definition, false);
    assert.equal("rewardXp" in definition, false);
    assert.equal("rewardChest" in definition, false);
    assert.equal("rewardCosmetic" in definition, false);
    assert.equal("rewardTitle" in definition, false);
    assert.equal("shopReward" in definition, false);
  }

  const rewarded = applyAchievementTokenRewards(
    { tokens: 100 },
    definitions.map((definition) => ({ id: definition.id }))
  );
  assert.equal(rewarded.tokenDelta, 0);
  assert.equal(rewarded.profile.tokens, 100);
});

test("achievement evaluator: comeback win unlocks only for the eventual winner who dropped to three cards", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 8,
    history: [{ result: "p1", warClashes: 1, capturedCards: 6, capturedOpponentCards: 3 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: [],
    durationMs: 210000
  });
  match.meta.minHandSizes = { p1: 3, p2: 4 };

  const unlockedWinner = evaluateAchievements({
    profileBefore: { wins: 1, losses: 1, achievements: {}, winStreak: 0, gamesPlayed: 2, cardsCaptured: 10 },
    profileAfter: { wins: 2, losses: 1, achievements: {}, winStreak: 1, gamesPlayed: 3, cardsCaptured: 13 },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 3 }
  });

  assert.ok(unlockedWinner.some((item) => item.id === "comeback_win"));
  const definition = unlockedWinner.find((item) => item.id === "comeback_win");
  assert.equal(definition.repeatable, true);

  const unlockedLoser = evaluateAchievements({
    profileBefore: { wins: 1, losses: 1, achievements: {}, winStreak: 0, gamesPlayed: 2, cardsCaptured: 10 },
    profileAfter: { wins: 1, losses: 2, achievements: {}, winStreak: 0, gamesPlayed: 3, cardsCaptured: 10 },
    matchState: match,
    perspective: "p2",
    matchStats: { wins: 0, losses: 1, cardsCaptured: 0 }
  });

  assert.ok(!unlockedLoser.some((item) => item.id === "comeback_win"));
});

test("achievement evaluator: comeback win does not unlock if winner never dropped to three cards", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 6,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });
  match.meta.minHandSizes = { p1: 4, p2: 4 };

  const unlocked = evaluateAchievements({
    profileBefore: { wins: 0, losses: 0, achievements: {}, winStreak: 0, gamesPlayed: 0, cardsCaptured: 0 },
    profileAfter: { wins: 1, losses: 0, achievements: {}, winStreak: 1, gamesPlayed: 1, cardsCaptured: 1 },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 1 }
  });

  assert.ok(!unlocked.some((item) => item.id === "comeback_win"));
});

test("state coordinator: repeatable comeback_win increments on later earns", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const buildComebackMatch = () => {
    const match = buildCompletedMatch({
      winner: "p1",
      rounds: 6,
      history: [{ result: "p1", warClashes: 1, capturedCards: 6, capturedOpponentCards: 3 }],
      p1Hand: ["fire", "water", "earth", "wind"],
      p2Hand: [],
      durationMs: 240000
    });
    match.meta.minHandSizes = { p1: 3, p2: 4 };
    return match;
  };

  const first = await state.recordMatchResult({
    username: "RepeatComebackUser",
    perspective: "p1",
    matchState: buildComebackMatch()
  });
  assert.equal(first.profile.achievements.comeback_win.count, 1);

  const second = await state.recordMatchResult({
    username: "RepeatComebackUser",
    perspective: "p1",
    matchState: buildComebackMatch()
  });
  assert.equal(second.profile.achievements.comeback_win.count, 2);
  assert.ok(second.unlockedAchievements.some((item) => item.id === "comeback_win"));
});

test("state coordinator: persists unlocked achievements and repeat counts", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const quickDrawMatch = buildCompletedMatch({
    winner: "p1",
    rounds: 3,
    durationMs: 100000,
    history: [
      { result: "p1", warClashes: 0, capturedCards: 2 },
      { result: "p1", warClashes: 0, capturedCards: 2 }
    ],
    p1Hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const first = await state.recordMatchResult({
    username: "AchTester",
    perspective: "p1",
    matchState: quickDrawMatch
  });

  assert.ok(first.unlockedAchievements.length > 0);
  assert.ok(first.unlockedAchievements.some((item) => item.id === "first_flame"));

  const second = await state.recordMatchResult({
    username: "AchTester",
    perspective: "p1",
    matchState: quickDrawMatch
  });

  const profile = await state.profiles.getProfile("AchTester");
  assert.ok(profile.achievements.quick_draw.count >= 2);
  assert.ok(second.profileAchievements.some((item) => item.id === "quick_draw"));
});

test("state coordinator: PvE unlocks mode achievements through the shared authoritative path", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "PveAchievementUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    wins: 24,
    gamesPlayed: 24,
    modeStats: {
      ...profile.modeStats,
      pve: {
        ...(profile.modeStats?.pve ?? {}),
        wins: 24,
        losses: profile.modeStats?.pve?.losses ?? 0
      }
    }
  });

  const result = await state.recordMatchResult({
    username,
    perspective: "p1",
    matchState: buildCompletedMatch({
      mode: "pve",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "pve_wins_25"));
  assert.equal(result.profile.achievements.pve_wins_25.count, 1);
});

test("state coordinator: PvE mode milestones grant one-time token rewards and do not duplicate on reload", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "PveFiftyUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    tokens: 100,
    modeStats: {
      ...profile.modeStats,
      pve: {
        ...(profile.modeStats?.pve ?? {}),
        wins: 49,
        losses: profile.modeStats?.pve?.losses ?? 0
      }
    }
  });

  const beforeMilestone = await state.profiles.getProfile(username);
  assert.equal(beforeMilestone.achievements.pve_wins_25.count, 1);

  const result = await state.recordMatchResult({
    username,
    perspective: "p1",
    matchState: buildCompletedMatch({
      mode: "pve",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "pve_wins_50"));
  assert.equal(result.profile.achievements.pve_wins_50.count, 1);
  assert.equal(result.profile.tokens - beforeMilestone.tokens, 14);

  const reloaded = await state.profiles.getProfile(username);
  assert.equal(reloaded.achievements.pve_wins_50.count, 1);
  assert.equal(reloaded.tokens, result.profile.tokens);
});

test("state coordinator: local PvP unlocks mode achievements through the shared authoritative path", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "LocalPvpAchievementUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    wins: 24,
    gamesPlayed: 24,
    modeStats: {
      ...profile.modeStats,
      local_pvp: {
        ...(profile.modeStats?.local_pvp ?? {}),
        wins: 24,
        losses: profile.modeStats?.local_pvp?.losses ?? 0
      }
    }
  });

  const result = await state.recordMatchResult({
    username,
    perspective: "p1",
    matchState: buildCompletedMatch({
      mode: "local_pvp",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "local_pvp_wins_25"));
  assert.equal(result.profile.achievements.local_pvp_wins_25.count, 1);
});

test("state coordinator: local PvP mode milestone grants one-time token reward", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "LocalFiftyUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    tokens: 100,
    modeStats: {
      ...profile.modeStats,
      local_pvp: {
        ...(profile.modeStats?.local_pvp ?? {}),
        wins: 49,
        losses: profile.modeStats?.local_pvp?.losses ?? 0
      }
    }
  });

  const beforeMilestone = await state.profiles.getProfile(username);
  assert.equal(beforeMilestone.achievements.local_pvp_wins_25.count, 1);

  const result = await state.recordMatchResult({
    username,
    perspective: "p1",
    matchState: buildCompletedMatch({
      mode: "local_pvp",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "local_pvp_wins_50"));
  assert.equal(result.profile.achievements.local_pvp_wins_50.count, 1);
  assert.equal(
    result.profile.tokens - beforeMilestone.tokens - result.tokenDelta - result.levelRewardTokenDelta,
    10
  );
});

test("state coordinator: online PvP unlocks through recordOnlineMatchResult on the shared authoritative path", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const result = await state.recordOnlineMatchResult({
    username: "OnlineAchievementUser",
    perspective: "p1",
    settlementKey: "achievement-online-1",
    matchState: buildCompletedMatch({
      mode: "online_pvp",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "first_flame"));
  assert.equal(result.profile.achievements.first_flame.count, 1);
});

test("state coordinator: online PvP milestones grant one-time token rewards", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "OnlineMilestoneUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    tokens: 100,
    modeStats: {
      ...profile.modeStats,
      online_pvp: {
        ...(profile.modeStats?.online_pvp ?? {}),
        wins: 9,
        losses: profile.modeStats?.online_pvp?.losses ?? 0
      }
    }
  });

  const result = await state.recordOnlineMatchResult({
    username,
    perspective: "p1",
    settlementKey: "achievement-online-milestone-1",
    matchState: buildCompletedMatch({
      mode: "online_pvp",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  const ids = result.unlockedAchievements.map((item) => item.id);
  assert.ok(ids.includes("online_wins_10"));
  assert.equal(result.profile.achievements.online_wins_10.count, 1);
  assert.ok(!result.profile.achievements.online_wins_25);
  assert.ok(!result.profile.achievements.online_wins_50);

  const second = await state.recordOnlineMatchResult({
    username,
    perspective: "p1",
    settlementKey: "achievement-online-milestone-2",
    matchState: buildCompletedMatch({
      mode: "online_pvp",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  const third = await state.recordOnlineMatchResult({
    username,
    perspective: "p1",
    settlementKey: "achievement-online-milestone-3",
    matchState: buildCompletedMatch({
      mode: "online_pvp",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.equal(second.profile.achievements.online_wins_10.count, 1);
  assert.equal(third.profile.achievements.online_wins_10.count, 1);
  assert.ok(!second.unlockedAchievements.some((item) => item.id === "online_wins_10"));
  assert.ok(!third.unlockedAchievements.some((item) => item.id === "online_wins_10"));
});

test("state coordinator: win_streak_10 unlocks between existing streak milestones and grants tokens once", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "StreakCommanderUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    tokens: 100,
    wins: 9,
    gamesPlayed: 9,
    winStreak: 9
  });

  const result = await state.recordMatchResult({
    username,
    perspective: "p1",
    matchState: buildCompletedMatch({
      mode: "pve",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  const ids = result.unlockedAchievements.map((item) => item.id);
  assert.ok(ids.includes("win_streak_10"));
  assert.ok(ids.includes("unbreakable_streak"));
  assert.ok(!ids.includes("streak_lord"));
  assert.equal(result.profile.achievements.win_streak_10.count, 1);
  assert.ok(result.profile.tokens >= 110);
});

test("profile normalization retroactively unlocks first expansion batch from persisted stats and stays idempotent", async () => {
  const dataDir = await createTempDataDir();
  const profilesPath = path.join(dataDir, "profiles.json");
  await fs.writeFile(
    profilesPath,
    JSON.stringify([
      {
        username: "RetroBatchUser",
        tokens: 100,
        wins: 300,
        losses: 10,
        gamesPlayed: 500,
        warsEntered: 250,
        warsWon: 250,
        cardsCaptured: 2000,
        winStreak: 10,
        playerXP: 0,
        playerLevel: 1,
        modeStats: {
          pve: { gamesPlayed: 60, wins: 50, losses: 10, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 },
          local_pvp: { gamesPlayed: 70, wins: 50, losses: 20, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 },
          online_pvp: { gamesPlayed: 80, wins: 50, losses: 30, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 }
        },
        achievements: {},
        ownedCosmetics: {
          avatar: ["default_avatar"],
          cardBack: ["default_card_back"],
          background: ["default_background"],
          elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
          badge: ["none"],
          title: ["Initiate"]
        },
        equippedCosmetics: {
          avatar: "default_avatar",
          cardBack: "default_card_back",
          background: "default_background",
          elementCardVariant: {
            fire: "default_fire_card",
            water: "default_water_card",
            earth: "default_earth_card",
            wind: "default_wind_card"
          },
          badge: "none",
          title: "Initiate"
        },
        cosmetics: {
          avatar: "default_avatar",
          cardBack: "default_card_back",
          background: "default_background",
          badge: "none"
        },
        dailyChallenges: {
          daily: { lastReset: null, progress: {}, completed: {}, rewarded: {}, completionChestGranted: false },
          weekly: { lastReset: null, progress: {}, completed: {}, rewarded: {}, completionChestGranted: false }
        },
        chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 },
        levelRewardsClaimed: {},
        cosmeticUnlockTracking: {
          FIRST_AVATAR_PURCHASED: false,
          FIRST_CARD_BACK_PURCHASED: false,
          FIRST_BACKGROUND_PURCHASED: false,
          FIRST_CARD_VARIANT_PURCHASED: false,
          FIRST_TITLE_UNLOCKED: false,
          FIRST_BADGE_UNLOCKED: false,
          TOTAL_COSMETICS_OWNED: 9
        },
        onlineRewardSettlements: { appliedSettlementKeys: [] },
        onlineDisconnectTracking: {
          totalLiveMatchDisconnects: 0,
          totalReconnectTimeoutExpirations: 0,
          totalSuccessfulReconnectResumes: 0,
          recentDisconnectTimestamps: [],
          recentExpirationTimestamps: []
        },
        achievementCatalogVersion: 45,
        schemaVersion: 1
      }
    ], null, 2)
  );

  const state = new StateCoordinator({ dataDir });
  const firstLoad = await state.profiles.getProfile("RetroBatchUser");

  assert.equal(firstLoad.achievements.online_wins_10.count, 1);
  assert.equal(firstLoad.achievements.online_wins_25.count, 1);
  assert.equal(firstLoad.achievements.online_wins_50.count, 1);
  assert.equal(firstLoad.achievements.local_pvp_wins_50.count, 1);
  assert.equal(firstLoad.achievements.pve_wins_50.count, 1);
  assert.equal(firstLoad.achievements.matches_played_500.count, 1);
  assert.equal(firstLoad.achievements.cards_captured_2000.count, 1);
  assert.equal(firstLoad.achievements.wars_entered_250.count, 1);
  assert.equal(firstLoad.achievements.wars_won_250.count, 1);
  assert.equal(firstLoad.achievements.win_streak_10.count, 1);
  assert.equal(firstLoad.achievements.local_pvp_wins_25.count, 1);
  assert.equal(firstLoad.achievements.pve_wins_25.count, 1);
  assert.equal(firstLoad.tokens, 170);

  const secondLoad = await state.profiles.getProfile("RetroBatchUser");
  assert.equal(secondLoad.achievements.online_wins_50.count, 1);
  assert.equal(secondLoad.achievements.win_streak_10.count, 1);
  assert.equal(secondLoad.tokens, 170);
});

test("profile normalization retroactively unlocks Featured Rival lifetime achievements only when the lifetime stat exists", async () => {
  const dataDir = await createTempDataDir();
  const profilesPath = path.join(dataDir, "profiles.json");
  await fs.writeFile(
    profilesPath,
    JSON.stringify([
      {
        username: "RetroFeaturedRivalUser",
        tokens: 55,
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        featuredRivalWins: 50,
        playerXP: 0,
        playerLevel: 1,
        modeStats: {
          pve: { gamesPlayed: 0, wins: 0, losses: 0, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 },
          local_pvp: { gamesPlayed: 0, wins: 0, losses: 0, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 },
          online_pvp: { gamesPlayed: 0, wins: 0, losses: 0, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 }
        },
        achievements: {},
        ownedCosmetics: {
          avatar: ["default_avatar"],
          cardBack: ["default_card_back"],
          background: ["default_background"],
          elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
          badge: ["none"],
          title: ["Initiate"]
        },
        equippedCosmetics: {
          avatar: "default_avatar",
          cardBack: "default_card_back",
          background: "default_background",
          elementCardVariant: {
            fire: "default_fire_card",
            water: "default_water_card",
            earth: "default_earth_card",
            wind: "default_wind_card"
          },
          badge: "none",
          title: "Initiate"
        },
        cosmetics: {
          avatar: "default_avatar",
          cardBack: "default_card_back",
          background: "default_background",
          badge: "none"
        },
        dailyChallenges: {
          daily: { lastReset: null, progress: {}, completed: {}, rewarded: {}, completionChestGranted: false },
          weekly: { lastReset: null, progress: {}, completed: {}, rewarded: {}, completionChestGranted: false }
        },
        chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 },
        levelRewardsClaimed: {},
        cosmeticUnlockTracking: {
          FIRST_AVATAR_PURCHASED: false,
          FIRST_CARD_BACK_PURCHASED: false,
          FIRST_BACKGROUND_PURCHASED: false,
          FIRST_CARD_VARIANT_PURCHASED: false,
          FIRST_TITLE_UNLOCKED: false,
          FIRST_BADGE_UNLOCKED: false,
          TOTAL_COSMETICS_OWNED: 9
        },
        onlineRewardSettlements: { appliedSettlementKeys: [] },
        onlineDisconnectTracking: {
          totalLiveMatchDisconnects: 0,
          totalReconnectTimeoutExpirations: 0,
          totalSuccessfulReconnectResumes: 0,
          recentDisconnectTimestamps: [],
          recentExpirationTimestamps: []
        },
        achievementCatalogVersion: 45,
        schemaVersion: 1
      },
      {
        username: "LegacyFeaturedRivalUser",
        tokens: 55,
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        playerXP: 0,
        playerLevel: 1,
        achievements: {},
        schemaVersion: 1
      }
    ], null, 2)
  );

  const state = new StateCoordinator({ dataDir });
  const withStat = await state.profiles.getProfile("RetroFeaturedRivalUser");
  const legacy = await state.profiles.getProfile("LegacyFeaturedRivalUser");

  assert.equal(withStat.achievements.rival_defeats_10.count, 1);
  assert.equal(withStat.achievements.rival_defeats_20.count, 1);
  assert.equal(withStat.achievements.rival_defeats_30.count, 1);
  assert.equal(withStat.achievements.rival_defeats_50.count, 1);
  assert.equal(withStat.tokens, 55);

  assert.equal(legacy.featuredRivalWins, 0);
  assert.equal(legacy.achievements.rival_defeats_10 ?? null, null);

  const secondLoad = await state.profiles.getProfile("RetroFeaturedRivalUser");
  assert.equal(secondLoad.achievements.rival_defeats_50.count, 1);
  assert.equal(secondLoad.tokens, 55);
});

test("state coordinator: already unlocked non-repeatable achievements do not persist twice", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const username = "DuplicateAchievementUser";
  const profile = await state.profiles.ensureProfile(username);

  await state.profiles.updateProfile(username, {
    ...profile,
    wins: 1,
    gamesPlayed: 1,
    achievements: {
      ...profile.achievements,
      first_flame: {
        count: 1,
        unlockedAt: "2026-01-01T00:00:00.000Z"
      }
    }
  });

  const result = await state.recordMatchResult({
    username,
    perspective: "p1",
    matchState: buildCompletedMatch({
      mode: "pve",
      winner: "p1",
      history: [{ result: "p1", warClashes: 0, capturedCards: 2 }]
    })
  });

  assert.ok(!result.unlockedAchievements.some((item) => item.id === "first_flame"));
  assert.equal(result.profile.achievements.first_flame.count, 1);
});

test("state coordinator: unlocks war machine from single-match WAR wins", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const warMatch = buildCompletedMatch({
    winner: "p1",
    rounds: 6,
    history: [
      { result: "p1", warClashes: 1, capturedCards: 4 },
      { result: "p1", warClashes: 2, capturedCards: 6 },
      { result: "p1", warClashes: 1, capturedCards: 4 }
    ],
    p1Hand: ["fire", "fire", "water", "water", "earth", "earth", "wind", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const result = await state.recordMatchResult({
    username: "WarTester",
    perspective: "p1",
    matchState: warMatch
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "war_machine"));
});

test("state: achievements catalog includes locked and unlocked entries", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const before = await state.getAchievements("CatalogUser");
  assert.equal(before.achievements.length, ACHIEVEMENT_DEFINITIONS.length);
  assert.ok(before.achievements.some((item) => item.unlocked === false));

  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 2,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind"],
    p2Hand: []
  });

  await state.recordMatchResult({
    username: "CatalogUser",
    perspective: "p1",
    matchState: match
  });

  const after = await state.getAchievements("CatalogUser");
  assert.ok(after.achievements.some((item) => item.unlocked === true));
});

test("achievement evaluator: quick draw achievements are not awarded for quit forfeits", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 2,
    endReason: "quit_forfeit",
    durationMs: 60000,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlocked = evaluateAchievements({
    profileBefore: { wins: 0, achievements: {}, winStreak: 0, gamesPlayed: 0, cardsCaptured: 0 },
    profileAfter: { wins: 1, achievements: {}, winStreak: 1, gamesPlayed: 1, cardsCaptured: 2 },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  const ids = unlocked.map((item) => item.id);
  assert.ok(!ids.includes("quick_draw"));
  assert.ok(!ids.includes("quickdraw_master"));
});

test("achievement evaluator: first_flame requires winning the first recorded match", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 2,
    durationMs: 180000,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlockedAfterPriorMatches = evaluateAchievements({
    profileBefore: {
      wins: 0,
      losses: 1,
      gamesPlayed: 1,
      achievements: {},
      winStreak: 1,
      cardsCaptured: 0
    },
    profileAfter: {
      wins: 1,
      losses: 1,
      gamesPlayed: 2,
      achievements: {},
      winStreak: 1,
      cardsCaptured: 2
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  assert.ok(!unlockedAfterPriorMatches.some((item) => item.id === "first_flame"));
});

test("achievement evaluator: the_immortal requires 10 wins with zero total losses", () => {
  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 4,
    durationMs: 200000,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const unlockedWithPriorLoss = evaluateAchievements({
    profileBefore: {
      wins: 9,
      losses: 1,
      gamesPlayed: 10,
      achievements: {},
      winStreak: 10,
      cardsCaptured: 0
    },
    profileAfter: {
      wins: 10,
      losses: 1,
      gamesPlayed: 11,
      achievements: {},
      winStreak: 10,
      cardsCaptured: 2
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  const unlockedPerfectRecord = evaluateAchievements({
    profileBefore: {
      wins: 9,
      losses: 0,
      gamesPlayed: 9,
      achievements: {},
      winStreak: 9,
      cardsCaptured: 0
    },
    profileAfter: {
      wins: 10,
      losses: 0,
      gamesPlayed: 10,
      achievements: {},
      winStreak: 10,
      cardsCaptured: 2
    },
    matchState: match,
    perspective: "p1",
    matchStats: { wins: 1, losses: 0, cardsCaptured: 2 }
  });

  assert.ok(!unlockedWithPriorLoss.some((item) => item.id === "the_immortal"));
  assert.ok(unlockedPerfectRecord.some((item) => item.id === "the_immortal"));
});
