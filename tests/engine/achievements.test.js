import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ACHIEVEMENT_DEFINITIONS,
  evaluateAchievements
} from "../../src/state/achievementSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

function buildCompletedMatch({
  winner = "p1",
  rounds = 3,
  endReason = null,
  history = [],
  p1Hand = ["fire", "water", "earth", "wind"],
  p2Hand = [],
  durationMs = 240000
} = {}) {
  return {
    id: "match-ach",
    status: "completed",
    round: rounds,
    mode: "pve",
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
  assert.ok(ids.includes("elemental_conqueror"));
  assert.ok(ids.includes("elemental_overlord"));
  assert.ok(ids.includes("collector"));
  assert.ok(ids.includes("collector_supreme"));
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
  assert.ok(ids.includes("elemental_conqueror"));
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
  assert.ok(ids.includes("collector_lord"));
  assert.ok(ids.includes("matches_played_50"));
  assert.ok(ids.includes("cards_captured_250"));
  assert.ok(ids.includes("card_hoarder_elite"));
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
