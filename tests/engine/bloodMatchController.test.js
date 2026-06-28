import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOOD_MATCH_RIVAL_IDS,
  createBloodMatchController
} from "../../src/renderer/systems/bloodMatchController.js";

function createManualScheduler() {
  let nextId = 1;
  const intervals = new Map();
  return {
    setInterval(callback) {
      const id = nextId;
      nextId += 1;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    activeCount() {
      return intervals.size;
    },
    tick(id) {
      intervals.get(id)?.();
    }
  };
}

function createController(options = {}) {
  const scheduler = options.scheduler ?? createManualScheduler();
  const controller = createBloodMatchController({
    scheduler,
    playerName: "VampyrLee",
    timerSeconds: 20,
    matchTimeLimitSeconds: 300,
    ...options
  });
  controller.startMatch();
  return { controller, scheduler };
}

function countLiveCards(state) {
  return ["player", "vampire", "lycan"].reduce(
    (sum, id) => sum + (state.combatants[id]?.hand?.length ?? 0),
    0
  ) + (state.potCardEntries?.length ?? 0);
}

function assertConserved(state, expectedTotal) {
  assert.equal(countLiveCards(state), expectedTotal);
}

test("bloodMatchController: creates live Blood Match with locked rivals", () => {
  const { controller, scheduler } = createController();
  const state = controller.getState();

  assert.equal(state.status, "active");
  assert.equal(state.combatants.player.name, "VampyrLee");
  assert.equal(state.combatants.vampire.rivalId, BLOOD_MATCH_RIVAL_IDS.vampire);
  assert.equal(state.combatants.vampire.name, "Countess Veyra");
  assert.equal(state.combatants.lycan.rivalId, BLOOD_MATCH_RIVAL_IDS.lycan);
  assert.equal(state.combatants.lycan.name, "Ravena Moonfang");
  assert.equal(scheduler.activeCount(), 2);
});

test("bloodMatchController: Veyra and Ravena choose independently from their own legal hands", () => {
  const choices = [];
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["water"],
      lycan: ["earth"]
    },
    aiChooser: ({ combatantId, legalHand }) => {
      choices.push({ combatantId, legalHand });
      return legalHand[0];
    }
  });

  const result = controller.playPlayerCard({ card: "fire" });

  assert.equal(result.status, "resolved");
  assert.deepEqual(choices, [
    { combatantId: "vampire", legalHand: ["water"] },
    { combatantId: "lycan", legalHand: ["earth"] }
  ]);
});

test("bloodMatchController: AI cannot select fatigued element when another legal card exists", () => {
  const { controller } = createController({
    initialHands: {
      player: ["earth", "wind"],
      vampire: ["water", "fire"],
      lycan: ["earth"]
    },
    aiChooser: ({ legalHand }) => legalHand[0]
  });
  controller.match.combatants.vampire.recentMoves = ["water", "water"];

  const choices = [];
  controller.aiChooser = ({ combatantId, legalHand }) => {
    choices.push({ combatantId, legalHand });
    return legalHand[0];
  };

  controller.playPlayerCard({ card: "earth" });

  assert.deepEqual(choices.find((entry) => entry.combatantId === "vampire"), {
    combatantId: "vampire",
    legalHand: ["fire"]
  });
});

test("bloodMatchController: AI may select fatigued element when it is the only legal option", () => {
  const { controller } = createController({
    initialHands: {
      player: ["earth", "wind"],
      vampire: ["water"],
      lycan: ["earth"]
    }
  });
  controller.match.combatants.vampire.recentMoves = ["water", "water"];

  assert.deepEqual(controller.getLegalPlayableCards("vampire"), ["water"]);
});

test("bloodMatchController: fatigue state remains independent per combatant", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["water", "fire"],
      lycan: ["earth", "wind"]
    }
  });
  controller.match.combatants.player.recentMoves = ["fire", "fire"];
  controller.match.combatants.vampire.recentMoves = ["water", "water"];
  controller.match.combatants.lycan.recentMoves = ["earth", "wind"];

  assert.deepEqual(controller.getLegalPlayableCards("player"), ["water"]);
  assert.deepEqual(controller.getLegalPlayableCards("vampire"), ["fire"]);
  assert.deepEqual(controller.getLegalPlayableCards("lycan"), ["earth", "wind"]);
});

test("bloodMatchController: clear winner settlement awards all three cards", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire"],
      vampire: ["earth"],
      lycan: ["earth"]
    },
    aiChooser: ({ legalHand }) => legalHand[0]
  });

  const result = controller.playPlayerCard({ card: "fire" });
  const state = result.state;

  assert.equal(result.result.type, "clear_winner");
  assert.equal(result.result.winnerId, "player");
  assert.deepEqual(state.combatants.player.hand, ["fire", "earth", "earth"]);
  assert.equal(state.combatants.player.capturedCards.length, 3);
  assert.equal(state.potCardEntries.length, 0);
  assertConserved(state, 3);
});

test("bloodMatchController: three-way WAR creates a three-participant shared pot", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "earth"],
      lycan: ["fire", "wind"]
    },
    aiChooser: () => "fire"
  });

  const result = controller.playPlayerCard({ card: "fire" });
  const state = result.state;

  assert.equal(result.result.type, "three_way_war");
  assert.deepEqual(state.war.activeCombatantIds, ["player", "vampire", "lycan"]);
  assert.equal(state.potCardEntries.length, 3);
  assertConserved(state, 6);
});

test("bloodMatchController: defeated-third two-way WAR preserves third card in pot and excludes third", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "earth"],
      lycan: ["earth", "wind"]
    },
    aiChooser: ({ combatantId }) => (combatantId === "vampire" ? "fire" : "earth")
  });

  const result = controller.playPlayerCard({ card: "fire" });
  const state = result.state;

  assert.equal(result.result.type, "two_way_war_defeated_third");
  assert.deepEqual(state.war.activeCombatantIds, ["player", "vampire"]);
  assert.deepEqual(result.result.excludedCombatantIds, ["lycan"]);
  assert.equal(state.potCardEntries.length, 3);
  assertConserved(state, 6);
});

test("bloodMatchController: neutral-third two-way WAR returns neutral card and excludes neutral participant", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "earth"],
      lycan: ["wind", "earth"]
    },
    aiChooser: ({ combatantId }) => (combatantId === "vampire" ? "fire" : "wind")
  });

  const result = controller.playPlayerCard({ card: "fire" });
  const state = result.state;

  assert.equal(result.result.type, "two_way_war_neutral_third");
  assert.deepEqual(state.war.activeCombatantIds, ["player", "vampire"]);
  assert.deepEqual(result.result.excludedCombatantIds, ["lycan"]);
  assert.equal(state.potCardEntries.length, 2);
  assert.deepEqual(state.combatants.lycan.hand, ["earth", "wind"]);
  assertConserved(state, 6);
});

test("bloodMatchController: three-way WAR resolves full shared pot into winner playable hand", () => {
  const choices = {
    vampire: ["fire", "fire"],
    lycan: ["fire", "fire"]
  };
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "fire"],
      lycan: ["fire", "fire"]
    },
    aiChooser: ({ combatantId, legalHand }) => {
      const choice = choices[combatantId]?.shift();
      return legalHand.includes(choice) ? choice : legalHand[0];
    }
  });

  const war = controller.playPlayerCard({ card: "fire" });
  assert.equal(war.result.type, "three_way_war");
  assertConserved(war.state, 6);

  const resolved = controller.playPlayerCard({ card: "water" });
  const state = resolved.state;

  assert.equal(resolved.result.type, "clear_winner");
  assert.equal(resolved.result.winnerId, "player");
  assert.equal(state.potCardEntries.length, 0);
  assert.equal(state.combatants.player.hand.length, 6);
  assert.equal(state.combatants.player.capturedCards.length, 6);
  assertConserved(state, 6);
});

test("bloodMatchController: defeated-third two-way WAR resolves original third card to eventual winner", () => {
  const choices = {
    vampire: ["fire", "fire"],
    lycan: ["earth"]
  };
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "fire"],
      lycan: ["earth", "wind"]
    },
    aiChooser: ({ combatantId, legalHand }) => {
      const choice = choices[combatantId]?.shift();
      return legalHand.includes(choice) ? choice : legalHand[0];
    }
  });

  const war = controller.playPlayerCard({ card: "fire" });
  assert.equal(war.result.type, "two_way_war_defeated_third");
  assert.equal(war.state.potCardEntries.length, 3);
  assertConserved(war.state, 6);

  const resolved = controller.playPlayerCard({ card: "water" });
  const state = resolved.state;

  assert.equal(resolved.result.type, "war_resolved");
  assert.equal(resolved.result.winnerId, "player");
  assert.equal(state.potCardEntries.length, 0);
  assert.equal(state.combatants.player.hand.length, 5);
  assert.equal(state.combatants.player.capturedCards.length, 5);
  assert.ok(state.combatants.player.hand.includes("earth"));
  assertConserved(state, 6);
});

test("bloodMatchController: neutral-third two-way WAR returns third card and resolves tied pot only", () => {
  const choices = {
    vampire: ["fire", "fire"],
    lycan: ["wind"]
  };
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "fire"],
      lycan: ["wind", "earth"]
    },
    aiChooser: ({ combatantId, legalHand }) => {
      const choice = choices[combatantId]?.shift();
      return legalHand.includes(choice) ? choice : legalHand[0];
    }
  });

  const war = controller.playPlayerCard({ card: "fire" });
  assert.equal(war.result.type, "two_way_war_neutral_third");
  assert.deepEqual(war.state.combatants.lycan.hand, ["earth", "wind"]);
  assertConserved(war.state, 6);

  const resolved = controller.playPlayerCard({ card: "water" });
  const state = resolved.state;

  assert.equal(resolved.result.type, "war_resolved");
  assert.equal(resolved.result.winnerId, "player");
  assert.equal(state.combatants.player.hand.length, 4);
  assert.equal(state.combatants.player.capturedCards.length, 4);
  assert.deepEqual(state.combatants.lycan.hand, ["earth", "wind"]);
  assertConserved(state, 6);
});

test("bloodMatchController: no-effect two-combatant clash returns both committed cards", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire"],
      vampire: [],
      lycan: ["wind"]
    },
    aiChooser: () => "wind"
  });
  controller.match.combatants.vampire.eliminated = true;

  const result = controller.playPlayerCard({ card: "fire" });
  const state = result.state;

  assert.equal(result.result.type, "two_combatant_no_effect");
  assert.deepEqual(state.combatants.player.hand, ["fire"]);
  assert.deepEqual(state.combatants.lycan.hand, ["wind"]);
  assertConserved(state, 2);
});

test("bloodMatchController: awarded cards are usable by player and AI after a win", () => {
  const { controller } = createController({
    initialHands: {
      player: ["water"],
      vampire: ["fire"],
      lycan: ["wind"]
    },
    aiChooser: ({ combatantId, legalHand }) => {
      if (combatantId === "vampire") return "fire";
      if (combatantId === "lycan") return legalHand[0];
      return legalHand[0];
    }
  });

  const aiWin = controller.playPlayerCard({ card: "water" });
  assert.equal(aiWin.result.winnerId, "lycan");
  assert.deepEqual(aiWin.state.combatants.lycan.hand.sort(), ["fire", "water", "wind"]);
  assert.deepEqual(controller.getLegalPlayableCards("lycan").sort(), ["fire", "water", "wind"]);
  assertConserved(aiWin.state, 3);
});

test("bloodMatchController: player unable to continue immediately ends match without later AI action", () => {
  const aiCalls = [];
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: [],
      vampire: ["water"],
      lycan: ["earth"]
    },
    aiChooser: (context) => {
      aiCalls.push(context);
      return context.legalHand[0];
    },
    onMatchComplete: (result) => completeCalls.push(result)
  });

  const result = controller.playPlayerCard({ card: "fire" });
  const state = controller.getState();

  assert.equal(result.result.type, "player_loss");
  assert.equal(state.status, "completed");
  assert.equal(state.terminalResult.result, "player_loss");
  assert.equal(aiCalls.length, 0);
  assert.equal(completeCalls.length, 1);
});

test("bloodMatchController: player with zero legal next play loses immediately after a resolved clash", () => {
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: ["fire"],
      vampire: [],
      lycan: ["water"]
    },
    aiChooser: () => "water",
    onMatchComplete: (result) => completeCalls.push(result)
  });
  controller.match.combatants.vampire.eliminated = true;

  const result = controller.playPlayerCard({ card: "fire" });
  const state = controller.getState();

  assert.equal(result.status, "resolved");
  assert.equal(result.result.type, "clear_winner");
  assert.equal(result.result.winnerId, "lycan");
  assert.equal(result.requiredPlayResult.type, "player_loss");
  assert.equal(state.status, "completed");
  assert.equal(state.war.active, false);
  assert.equal(state.combatants.player.hand.length, 0);
  assert.equal(state.combatants.player.eliminated, true);
  assert.equal(state.terminalResult.result, "player_loss");
  assert.equal(state.terminalResult.endReason, "player_required_play_unavailable");
  assert.equal(completeCalls.length, 1);
});

test("bloodMatchController: rival with zero legal next play is eliminated immediately after a resolved clash", () => {
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: ["water"],
      vampire: [],
      lycan: ["fire"]
    },
    aiChooser: () => "fire",
    onMatchComplete: (result) => completeCalls.push(result)
  });
  controller.match.combatants.vampire.eliminated = true;

  const result = controller.playPlayerCard({ card: "water" });
  const state = controller.getState();

  assert.equal(result.status, "resolved");
  assert.equal(result.result.type, "clear_winner");
  assert.equal(result.result.winnerId, "player");
  assert.equal(result.requiredPlayResult.type, "player_win");
  assert.equal(state.status, "completed");
  assert.equal(state.combatants.lycan.eliminated, true);
  assert.equal(state.terminalResult.result, "player_win");
  assert.equal(state.terminalResult.endReason, "all_ai_required_play_unavailable");
  assert.equal(completeCalls.length, 1);
});

test("bloodMatchController: Countess with cards prevents false Player victory when Ravena cannot continue WAR", () => {
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: ["fire"],
      vampire: ["water"],
      lycan: []
    },
    onMatchComplete: (result) => completeCalls.push(result)
  });
  controller.match.potCardEntries = [
    { ownerId: "player", element: "fire" },
    { ownerId: "lycan", element: "fire" }
  ];
  controller.match.war = { active: true, activeCombatantIds: ["player", "lycan"], clashes: 1 };

  const result = controller.playPlayerCard({ card: "fire" });
  const state = controller.getState();

  assert.equal(result.status, "required_play_result");
  assert.equal(result.result.type, "ai_eliminated_continue");
  assert.equal(state.status, "active");
  assert.equal(state.terminalResult, null);
  assert.equal(state.combatants.vampire.eliminated, false);
  assert.equal(state.combatants.vampire.hand.length, 1);
  assert.equal(state.combatants.lycan.eliminated, true);
  assert.equal(state.war.active, true);
  assert.deepEqual(state.war.activeCombatantIds, ["player", "vampire"]);
  assert.equal(completeCalls.length, 0);
});

test("bloodMatchController: Ravena with cards prevents false Player victory when Countess cannot continue WAR", () => {
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: ["earth"],
      vampire: [],
      lycan: ["wind"]
    },
    onMatchComplete: (result) => completeCalls.push(result)
  });
  controller.match.potCardEntries = [
    { ownerId: "player", element: "earth" },
    { ownerId: "vampire", element: "earth" }
  ];
  controller.match.war = { active: true, activeCombatantIds: ["player", "vampire"], clashes: 1 };

  const result = controller.playPlayerCard({ card: "earth" });
  const state = controller.getState();

  assert.equal(result.status, "required_play_result");
  assert.equal(result.result.type, "ai_eliminated_continue");
  assert.equal(state.status, "active");
  assert.equal(state.terminalResult, null);
  assert.equal(state.combatants.vampire.eliminated, true);
  assert.equal(state.combatants.lycan.eliminated, false);
  assert.equal(state.combatants.lycan.hand.length, 1);
  assert.equal(state.war.active, true);
  assert.deepEqual(state.war.activeCombatantIds, ["player", "lycan"]);
  assert.equal(completeCalls.length, 0);
});

test("bloodMatchController: one eliminated AI leaves remaining two-combatant Blood Match active", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: [],
      lycan: ["earth", "fire"]
    },
    aiChooser: () => "fire"
  });
  controller.match.war = { active: true, activeCombatantIds: ["player", "vampire", "lycan"], clashes: 0 };

  const result = controller.playPlayerCard({ card: "fire" });
  const state = controller.getState();

  assert.equal(result.result.type, "ai_eliminated_continue");
  assert.equal(state.status, "active");
  assert.equal(state.combatants.vampire.eliminated, true);
  assert.deepEqual(state.war.activeCombatantIds, ["player", "lycan"]);

  const continuation = controller.playPlayerCard({ card: "water" });
  assert.equal(continuation.status, "resolved");
  assert.equal(continuation.result.type, "war_resolved");
  assert.equal(continuation.result.winnerId, "player");
});

test("bloodMatchController: both AI eliminations immediately produce Player win", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire"],
      vampire: [],
      lycan: []
    }
  });
  controller.match.war = { active: true, activeCombatantIds: ["player", "vampire", "lycan"], clashes: 0 };

  controller.playPlayerCard({ card: "fire" });
  const state = controller.getState();

  assert.equal(state.status, "completed");
  assert.equal(state.terminalResult.result, "player_win");
  assert.equal(state.winnerId, "player");
});

test("bloodMatchController: neutral third participant is excluded from WAR without elimination", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire", "earth"],
      lycan: ["wind", "earth"]
    },
    aiChooser: ({ combatantId }) => (combatantId === "vampire" ? "fire" : "wind")
  });

  const result = controller.playPlayerCard({ card: "fire" });
  const state = controller.getState();

  assert.equal(result.result.type, "two_way_war_neutral_third");
  assert.deepEqual(result.result.excludedCombatantIds, ["lycan"]);
  assert.equal(state.combatants.lycan.eliminated, false);
  assert.equal(state.combatants.lycan.hand.length, 2);
  assert.equal(state.status, "active");
});

test("bloodMatchController: terminal settlement cannot execute twice", () => {
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: [],
      vampire: ["water"],
      lycan: ["earth"]
    },
    onMatchComplete: (result) => completeCalls.push(result)
  });

  controller.playPlayerCard({ card: "fire" });
  controller.playPlayerCard({ card: "water" });
  controller.expireByTimeLimit();

  assert.equal(completeCalls.length, 1);
});

test("bloodMatchController: timer expiry uses strict Player lead over surviving AIs", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water", "earth"],
      vampire: ["fire"],
      lycan: ["earth", "wind"]
    }
  });

  const result = controller.expireByTimeLimit();

  assert.equal(result.result, "player_win");
  assert.equal(result.endReason, "timeout_lead");
});

test("bloodMatchController: timer tie or deficit is player loss", () => {
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water"],
      vampire: ["fire"],
      lycan: ["earth", "wind"]
    }
  });

  const result = controller.expireByTimeLimit();

  assert.equal(result.result, "player_loss");
  assert.equal(result.endReason, "timeout_tie_or_deficit");
});

test("bloodMatchController: timer completion runs once only", () => {
  const completeCalls = [];
  const { controller } = createController({
    initialHands: {
      player: ["fire", "water", "earth"],
      vampire: ["fire"],
      lycan: ["earth"]
    },
    onMatchComplete: (result) => completeCalls.push(result)
  });

  controller.expireByTimeLimit();
  controller.expireByTimeLimit();

  assert.equal(completeCalls.length, 1);
});

test("bloodMatchController: rematch clears prior pot, fatigue, elimination, terminal, and timer state", () => {
  const { controller, scheduler } = createController({
    initialHands: {
      player: ["fire"],
      vampire: [],
      lycan: []
    }
  });
  controller.match.combatants.player.recentMoves = ["fire", "fire"];
  controller.match.potCardEntries = [{ ownerId: "player", element: "fire" }];
  controller.match.combatants.vampire.eliminated = true;
  controller.expireByTimeLimit();

  const rematch = controller.rematch();

  assert.equal(rematch.status, "active");
  assert.equal(rematch.potCardEntries.length, 0);
  assert.deepEqual(rematch.combatants.player.recentMoves, []);
  assert.equal(rematch.combatants.vampire.eliminated, false);
  assert.equal(rematch.terminalResult, null);
  assert.equal(rematch.timerSeconds, 20);
  assert.equal(rematch.totalMatchSeconds, 300);
  assert.equal(scheduler.activeCount(), 2);
});

test("bloodMatchController: quit cleans up controller timer safely", () => {
  const { controller, scheduler } = createController();

  controller.quit();
  const state = controller.getState();

  assert.equal(state.status, "completed");
  assert.equal(state.terminalResult.result, "player_loss");
  assert.equal(state.endReason, "quit_forfeit");
  assert.equal(scheduler.activeCount(), 0);
});
