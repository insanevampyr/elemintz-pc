import test from "node:test";
import assert from "node:assert/strict";

import { GameController, MATCH_MODE } from "../../src/renderer/systems/gameController.js";
import { AppController } from "../../src/renderer/systems/appController.js";
import { WAR_REQUIRED_CARDS } from "../../src/engine/index.js";
import { createRoomStore } from "../../src/multiplayer/rooms.js";

function canonicalizeUsername(username) {
  const value = String(username ?? "").trim();
  return value.endsWith("-Canonical") ? value : `${value}-Canonical`;
}

function createMinimalMatch(mode = "pve") {
  return {
    id: "match-test",
    status: "active",
    round: 0,
    mode,
    difficulty: "hard",
    winner: null,
    currentPile: [],
    players: {
      p1: { hand: ["fire", "wind"], wonRounds: 0 },
      p2: { hand: ["earth", "water"], wonRounds: 0 }
    },
    war: {
      active: false,
      clashes: 0
    },
    history: [],
    meta: {
      totalCards: 4
    }
  };
}

function findCardIndexByElement(hand, element) {
  return Array.isArray(hand) ? hand.findIndex((card) => card === element) : -1;
}

function createAuthoritativeLocalRoom({
  roomCode = "ABC123",
  roundNumber = 1,
  matchComplete = false,
  winner = null,
  winReason = null,
  hostHand = { fire: 2, water: 2, earth: 2, wind: 2 },
  guestHand = { fire: 2, water: 2, earth: 2, wind: 2 },
  warActive = false,
  warRounds = [],
  warPot = { host: [], guest: [] },
  roundHistory = []
} = {}) {
  return {
    roomCode,
    status: "full",
    matchComplete,
    winner,
    winReason,
    roundNumber,
    hostHand,
    guestHand,
    warActive,
    warRounds,
    warPot,
    roundHistory,
    serverMatchState: {
      matchId: `${roomCode}:match:1`
    }
  };
}

function createAuthoritativePveStore({
  initialRoom = createAuthoritativeLocalRoom(),
  createRoom,
  joinRoom,
  submitMove,
  completeMatchByCardCount,
  completeMatch
} = {}) {
  return {
    createRoom:
      createRoom ??
      (() => ({ ok: true, room: initialRoom })),
    joinRoom:
      joinRoom ??
      (() => ({
        ok: true,
        room: {
          ...initialRoom,
          guest: {
            username: "EleMintz AI",
            bot: true,
            aiDifficulty: "normal"
          }
        }
      })),
    submitMove,
    completeMatchByCardCount,
    completeMatch
  };
}

test("gameController: AI selection is independent from player's current card", async () => {
  const originalWindow = globalThis.window;
  const submittedMoves = [];
  const initialRoom = createAuthoritativeLocalRoom();
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 1, earth: 3, wind: 2 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "FairnessUser",
    timerSeconds: 30,
    aiDifficulty: "hard",
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: (_socketId, move) => {
          submittedMoves.push(move);
          return {
            ok: true,
            room: resolvedRoom,
            roundResult: {
              round: 1,
              hostMove: "fire",
              guestMove: "earth",
              outcomeType: "resolved",
              hostResult: "win",
              guestResult: "lose",
              warRounds: [],
              warPot: { host: [], guest: [] }
            }
          };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.startNewMatch();
    await controller.playCard(0);

    assert.deepEqual(submittedMoves, ["fire"]);
    assert.equal(controller.lastRound.p1Card, "fire");
    assert.equal(controller.lastRound.p2Card, "earth");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: completed PvE rounds wait for async match-complete handling before the trailing update", async () => {
  const originalWindow = globalThis.window;
  let releaseMatchComplete;
  let matchCompleteFinished = false;
  const updates = [];

  const controller = new GameController({
    username: "PveLossRaceUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {
      updates.push({
        isResolvingRound: controller.isResolvingRound,
        matchCompleteFinished
      });
    },
    onMatchComplete: async () => {
      await new Promise((resolve) => {
        releaseMatchComplete = resolve;
      });
      matchCompleteFinished = true;
    }
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.finalizeRound = async () => {
      controller.match.status = "completed";
      controller.match.winner = "p2";
      await controller.finalizeCompletedMatch();
      return {
        status: "resolved",
        round: {
          result: "p2",
          p1Card: "fire",
          p2Card: "earth",
          capturedOpponentCards: 1
        }
      };
    };

    const pendingPlay = controller.playCard(0);
    await Promise.resolve();

    assert.equal(typeof releaseMatchComplete, "function");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].isResolvingRound, true);
    assert.equal(updates[0].matchCompleteFinished, false);

    releaseMatchComplete();
    await pendingPlay;

    assert.equal(matchCompleteFinished, true);
    assert.equal(updates.at(-1).isResolvingRound, false);
    assert.equal(updates.at(-1).matchCompleteFinished, true);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat uses two pass states and resolves only on confirmation", async () => {
  const originalWindow = globalThis.window;
  const submitCalls = [];
  const initialRoom = createAuthoritativeLocalRoom();
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 3, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 1, water: 2, earth: 1, wind: 2 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });
  const fakeStore = {
    createRoom: () => ({ ok: true, room: initialRoom }),
    joinRoom: () => ({ ok: true, room: initialRoom }),
    submitMove: (_socketId, move) => {
      submitCalls.push(move);
      if (submitCalls.length === 1) {
        return { ok: true, room: initialRoom, roundResult: null };
      }

      return {
        ok: true,
        room: resolvedRoom,
        roundResult: {
          round: 1,
          hostMove: "fire",
          guestMove: "earth",
          outcomeType: "resolved",
          hostResult: "win",
          guestResult: "lose",
          warRounds: [],
          warPot: { host: [], guest: [] }
        }
      };
    }
  };

  const controller = new GameController({
    username: "LocalTester",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    aiDifficulty: "hard",
    localAuthorityStoreFactory: () => fakeStore,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const p1Selection = await controller.submitHotseatSelection(0);
    assert.equal(p1Selection.status, "pass_to_p2");

    const p2Selection = await controller.submitHotseatSelection(4);
    assert.equal(p2Selection.status, "pass_to_p1");
    assert.equal(controller.lastRound, null);

    const confirmed = await controller.confirmHotseatRound();
    assert.equal(confirmed.status, "round_resolved");
    assert.deepEqual(submitCalls, ["fire", "earth"]);
    assert.equal(controller.lastRound.p1Card, "fire");
    assert.equal(controller.lastRound.p2Card, "earth");
    assert.equal(controller.match.players.p1.hand.length, 9);
    assert.equal(controller.match.players.p2.hand.length, 6);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat WAR continuation comes from authoritative room state", async () => {
  const originalWindow = globalThis.window;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    warActive: true,
    warRounds: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war"
      }
    ],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  let submitCount = 0;
  const fakeStore = {
    createRoom: () => ({ ok: true, room: initialRoom }),
    joinRoom: () => ({ ok: true, room: initialRoom }),
    submitMove: (_socketId, move) => {
      if (move !== "fire") {
        return { ok: false, error: { code: "UNEXPECTED_MOVE" } };
      }

      submitCount += 1;
      return submitCount > 1
        ? {
            ok: true,
            room: warRoom,
            roundResult: {
              round: 1,
              hostMove: "fire",
              guestMove: "fire",
              outcomeType: "war",
              hostResult: "war",
              guestResult: "war",
              warRounds: [{ round: 1, outcomeType: "war" }],
              warPot: { host: ["fire"], guest: ["fire"] }
            }
          }
        : { ok: true, room: initialRoom, roundResult: null };
    }
  };
  const controller = new GameController({
    username: "WarAuthorityUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirmed = await controller.confirmHotseatRound();

    assert.equal(confirmed.status, "war_continues");
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.war.active, true);
    assert.deepEqual(controller.match.currentPile, ["fire", "fire"]);
    assert.equal(controller.roundResultText, "WAR continues. Choose new cards for the next clash.");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat authoritative room store accepts round progression beyond the first round", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "LocalRoundProgressUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    let result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "water")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const firstRound = await controller.confirmHotseatRound();
    assert.equal(firstRound.status, "round_resolved");
    assert.equal(controller.match.status, "active");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "water")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const secondRound = await controller.confirmHotseatRound();
    assert.equal(secondRound.status, "round_resolved");
    assert.equal(controller.match.status, "active");
    assert.equal(controller.match.round, 2);
    assert.equal(controller.pendingHotseatP1CardIndex, null);
    assert.equal(controller.pendingHotseatP2CardIndex, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat authoritative room store accepts WAR continuation submissions", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "LocalWarProgressUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    let result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const warStart = await controller.confirmHotseatRound();
    assert.equal(warStart.status, "war_continues");
    assert.equal(controller.match.war.active, true);

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const warContinue = await controller.confirmHotseatRound();
    assert.equal(warContinue.status, "war_continues");
    assert.equal(controller.match.war.active, true);
    assert.equal(controller.pendingHotseatP1CardIndex, null);
    assert.equal(controller.pendingHotseatP2CardIndex, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE authoritative room store accepts multiple resolved rounds and WAR continuation", async () => {
  const originalWindow = globalThis.window;

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    const resolvedController = new GameController({
      username: "PveProgressUser",
      timerSeconds: 30,
      mode: MATCH_MODE.PVE,
      localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
      onUpdate: () => {},
      onMatchComplete: () => {}
    });
    resolvedController.startNewMatch();

    const firstRound = await resolvedController.playCard(
      findCardIndexByElement(resolvedController.match.players.p1.hand, "water")
    );
    assert.equal(firstRound.status, "resolved");
    assert.equal(resolvedController.match.status, "active");

    const secondRound = await resolvedController.playCard(
      findCardIndexByElement(resolvedController.match.players.p1.hand, "wind")
    );
    assert.equal(secondRound.status, "resolved");
    assert.equal(resolvedController.match.status, "active");
    assert.equal(resolvedController.match.round, 2);
    resolvedController.stopTimer();
    resolvedController.stopMatchClock();

    const warController = new GameController({
      username: "PveWarProgressUser",
      timerSeconds: 30,
      mode: MATCH_MODE.PVE,
      localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
      onUpdate: () => {},
      onMatchComplete: () => {}
    });
    warController.startNewMatch();

    const warStart = await warController.playCard(
      findCardIndexByElement(warController.match.players.p1.hand, "fire")
    );
    assert.equal(warStart.status, "war_continues");
    assert.equal(warController.match.war.active, true);

    const warContinue = await warController.playCard(
      findCardIndexByElement(warController.match.players.p1.hand, "fire")
    );
    assert.notEqual(warContinue.skipped, true);
    assert.match(warContinue.status, /^(war_continues|resolved)$/);
    warController.stopTimer();
    warController.stopMatchClock();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("gameController: active authoritative sync clears stale local round presentation before the next clash", () => {
  const controller = new GameController({
    username: "RoundResetUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      status: "active",
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] }
    };
    controller.lastRound = {
      round: 1,
      p1Card: "fire",
      p2Card: "earth",
      result: "p1",
      warClashes: 0,
      capturedOpponentCards: 1
    };
    controller.roundResultText = "Player wins this clash.";

    controller.syncLocalAuthorityState(createAuthoritativeLocalRoom(), null);

    assert.equal(controller.lastRound, null);
    assert.equal(controller.roundResultText, "Choose a card to begin the next clash.");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: PvE rebuilt local history keeps capture totals monotonic through WAR chains", () => {
  const controller = new GameController({
    username: "PveWarCaptureUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const preWarRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      }
    ]
  });

  const warStartRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warContinueRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" },
      { round: 2, hostMove: "earth", guestMove: "fire", outcomeType: "no_effect" }
    ],
    warPot: { host: ["water", "earth"], guest: ["water", "fire"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warResolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    roundHistory: [
      ...warContinueRoom.roundHistory,
      {
        round: 2,
        hostMove: "wind",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(preWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warStartRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0]
    );

    controller.syncLocalAuthorityState(warContinueRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0, 0]
    );

    controller.syncLocalAuthorityState(warResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0, 0, 3]
    );
    assert.deepEqual(
      controller.match.history.map((round) => round.warClashes),
      [0, 0, 0, 3]
    );
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE WAR stats ignore pre-WAR no-effect rows when resolving war depth", () => {
  const controller = new GameController({
    username: "PveWarDepthTruthUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const tracedRoom = createAuthoritativeLocalRoom({
    roundNumber: 7,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 3,
        hostMove: "wind",
        guestMove: "wind",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 4,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 5,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 6,
        hostMove: "earth",
        guestMove: "wind",
        outcomeType: "war_resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(tracedRoom, null);

    assert.deepEqual(
      controller.match.history.map((round) => round.warClashes),
      [0, 0, 0, 0, 0, 3]
    );
    assert.deepEqual(controller.captured, { p1: 4, p2: 1 });
    assert.equal(controller.getViewModel().captured.p1, 4);
    assert.equal(controller.getViewModel().captured.p2, 1);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE live captured tally uses derived match stats without preserving higher prior values", () => {
  const controller = new GameController({
    username: "PveLiveCaptureUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const higherCaptureRoom = createAuthoritativeLocalRoom({
    roundNumber: 4,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "wind",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  const lowerSnapshotRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(higherCaptureRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });

    controller.syncLocalAuthorityState(lowerSnapshotRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE no-effect snapshot does not erase prior captured totals when room history is trimmed", () => {
  const controller = new GameController({
    username: "PveTrimNoEffectUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const beforeTrimRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM",
    roundNumber: 11,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  const trimmedNoEffectRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM",
    roundNumber: 12,
    roundHistory: [
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(beforeTrimRoom, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 3 });

    controller.syncLocalAuthorityState(trimmedNoEffectRoom, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 3 });
    assert.equal(controller.match.history.length, 11);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE later resolved player win does not erase prior AI captures when room history is trimmed", () => {
  const controller = new GameController({
    username: "PveTrimResolvedUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const beforeResolvedRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM2",
    roundNumber: 12,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  const trimmedResolvedRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM2",
    roundNumber: 13,
    roundHistory: [
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(beforeResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 3 });

    controller.syncLocalAuthorityState(trimmedResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 5, p2: 3 });
    assert.equal(controller.match.history.length, 12);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE WAR trigger does not erase prior player captures when room history is trimmed", () => {
  const controller = new GameController({
    username: "PveTrimWarUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const beforeWarRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM3",
    roundNumber: 13,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  const trimmedWarRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM3",
    roundNumber: 14,
    warActive: true,
    warDepth: 1,
    warRounds: [{ round: 13, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 13, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(beforeWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 5, p2: 3 });

    controller.syncLocalAuthorityState(trimmedWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 5, p2: 3 });
    assert.equal(controller.match.history.length, 13);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE repeated WAR and no-effect patterns do not duplicate prior rows during trimmed merges", () => {
  const controller = new GameController({
    username: "PveTrimRepeatedWarUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const snapshotA = createAuthoritativeLocalRoom({
    roomCode: "PVETRM4",
    roundNumber: 11,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 2, hostMove: "fire", guestMove: "earth", outcomeType: "war_resolved", hostResult: "win", guestResult: "lose", capturedCards: 4, capturedOpponentCards: 2 },
      { round: 3, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "wind", outcomeType: "war_resolved", hostResult: "lose", guestResult: "win", capturedCards: 6, capturedOpponentCards: 3 },
      { round: 8, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  const snapshotB = createAuthoritativeLocalRoom({
    roomCode: "PVETRM4",
    roundNumber: 14,
    warActive: true,
    warDepth: 2,
    warRounds: [
      { round: 11, hostMove: "fire", guestMove: "fire", outcomeType: "war" },
      { round: 12, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["fire", "water"], guest: ["fire", "water"] },
    roundHistory: [
      { round: 4, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "wind", outcomeType: "war_resolved", hostResult: "lose", guestResult: "win", capturedCards: 6, capturedOpponentCards: 3 },
      { round: 8, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "water", guestMove: "water", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 13, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(snapshotA, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 5 });
    assert.equal(controller.match.history.length, 10);

    controller.syncLocalAuthorityState(snapshotB, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 5 });
    assert.equal(controller.match.history.length, 13);
    assert.equal(
      controller.match.history.filter((round) => round.warClashes > 0).length,
      2
    );
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvP rebuilt local history keeps capture totals monotonic through WAR chains", () => {
  const controller = new GameController({
    username: "LocalPvpWarCaptureUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const preWarRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      }
    ]
  });

  const warStartRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warContinueRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" },
      { round: 2, hostMove: "earth", guestMove: "fire", outcomeType: "no_effect" }
    ],
    warPot: { host: ["water", "earth"], guest: ["water", "fire"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warResolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    roundHistory: [
      ...warContinueRoom.roundHistory,
      {
        round: 2,
        hostMove: "wind",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(preWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warStartRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warContinueRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0, 0, 3]
    );
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local time-limit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "host",
    winReason: "time_limit",
    roundNumber: 3,
    hostHand: { fire: 3, water: 2, earth: 2, wind: 1 },
    guestHand: { fire: 1, water: 1, earth: 1, wind: 1 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const fakeStore = {
    createRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    joinRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    completeMatchByCardCount: (_socketId, options) => {
      completionCalls.push(options);
      return { ok: true, room: completedRoom };
    }
  };
  const controller = new GameController({
    username: "LocalTimeLimitAuthority",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.finalizeByTimeLimit();

    assert.deepEqual(completionCalls, [{ reason: "time_limit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p1");
    assert.equal(controller.match.endReason, "time_limit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local quit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "guest",
    winReason: "quit_forfeit",
    roundNumber: 2,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
  });
  const fakeStore = {
    createRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    joinRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    completeMatch: (_socketId, options) => {
      completionCalls.push(options);
      return { ok: true, room: completedRoom };
    }
  };
  const controller = new GameController({
    username: "LocalQuitAuthority",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });

    assert.deepEqual(completionCalls, [{ winner: "guest", reason: "quit_forfeit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "quit_forfeit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local authoritative rematch start resets to a fresh room-backed state", async () => {
  const originalWindow = globalThis.window;
  const createdRooms = [];
  const roomA = createAuthoritativeLocalRoom({
    roomCode: "AAA111",
    roundNumber: 4,
    hostHand: { fire: 5, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 1, earth: 1, wind: 1 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });
  const roomB = createAuthoritativeLocalRoom({
    roomCode: "BBB222",
    roundNumber: 1,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    roundHistory: []
  });
  const fakeStore = {
    createRoom: () => {
      const room = createdRooms.length === 0 ? roomA : roomB;
      createdRooms.push(room.roomCode);
      return { ok: true, room };
    },
    joinRoom: () => ({ ok: true, room: createdRooms.length === 1 ? roomA : roomB })
  };
  const controller = new GameController({
    username: "LocalRematchAuthority",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    assert.equal(controller.match.id, "AAA111:match:1");
    assert.equal(controller.match.round, 3);
    assert.ok(controller.match.history.length > 0);

    controller.startNewMatch();
    assert.deepEqual(createdRooms, ["AAA111", "BBB222"]);
    assert.equal(controller.match.id, "BBB222:match:1");
    assert.equal(controller.match.round, 0);
    assert.deepEqual(controller.match.history, []);
    assert.equal(controller.match.players.p1.hand.length, 8);
    assert.equal(controller.match.players.p2.hand.length, 8);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: WAR pile preview reflects committed WAR cards", () => {
  const controller = new GameController({
    username: "WarPreviewUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  controller.match = createMinimalMatch(MATCH_MODE.PVE);
  controller.match.war = { active: true, clashes: 1, pendingClashes: 1, pendingPileSizes: [2] };
  controller.match.currentPile = ["fire", "earth"];
  controller.lastRound = {
    round: 1,
    p1Card: "fire",
    p2Card: "fire",
    result: "p1",
    warClashes: 1,
    capturedCards: 4,
    warPileSize: 2,
    warPileSizes: [2, 4]
  };

  let vm = controller.getViewModel();
  assert.equal(vm.warPileCards.length, 2);
  assert.deepEqual(vm.warPileCards, ["fire", "earth"]);

  controller.match.currentPile = ["fire", "earth", "water", "wind"];
  controller.match.war.pendingPileSizes = [2, 4];
  vm = controller.getViewModel();
  assert.equal(vm.warPileCards.length, 4);
  assert.deepEqual(vm.warPileCards, ["fire", "earth", "water", "wind"]);

  controller.match.war.active = false;
  controller.match.currentPile = [];
  vm = controller.getViewModel();
  assert.equal(vm.warPileCards.length, 0);
  assert.deepEqual(vm.warPileCards, []);
});

test("gameController: local turn timer counts down and times out", async () => {
  const originalWindow = globalThis.window;
  let timeoutTurn = null;

  const controller = new GameController({
    username: "TimerLocal",
    mode: MATCH_MODE.LOCAL_PVP,
    timerSeconds: 2,
    onUpdate: () => {},
    onHotseatTurnTimeout: async (turn) => {
      timeoutTurn = turn;
    },
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.match = createMinimalMatch(MATCH_MODE.LOCAL_PVP);
    controller.hotseatTurn = "p1";
    controller.resetTimer();
    controller.resumeLocalTurnTimer();

    await new Promise((resolve) => setTimeout(resolve, 2200));

    assert.equal(timeoutTurn, "p1");
    assert.equal(controller.timerId, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: local mode opens setup screen before match start", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "SignedInUser";
  app.onlinePlayState = app.normalizeOnlinePlayState({
    session: {
      authenticated: true,
      username: "SignedInUser"
    }
  });
  app.showMenu();
  shownScreens.at(-1).context.actions.startLocalGame();

  assert.equal(shownScreens.at(-1).name, "localSetup");
  assert.equal(shownScreens.at(-1).context.player1.authenticated, true);
  assert.equal(shownScreens.at(-1).context.player1.username, "SignedInUser");
  assert.equal(shownScreens.at(-1).context.player2.mode, "login");
});

test("appController: switch account clears authenticated state and returns to login", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    logout: 0,
    getState: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          logout: async () => {
            calls.logout += 1;
          },
          getState: async () => {
            calls.getState += 1;
            return {
              connectionStatus: "disconnected",
              session: {
                active: false,
                username: null,
                sessionId: null,
                accountId: null,
                profileKey: null,
                authenticated: false
              },
              room: null,
              lastError: null,
              statusMessage: "Signed out."
            };
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", tokens: 250 };
    app.dailyChallenges = { daily: { challenges: [] }, weekly: { challenges: [] } };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "SignedInUser",
        sessionId: "session-1",
        accountId: "account-1",
        profileKey: "SignedInUser",
        authenticated: true
      }
    });

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await shownScreens.at(-1).context.actions.switchAccount();

    assert.equal(calls.logout, 1);
    assert.equal(calls.getState, 1);
    assert.equal(app.username, null);
    assert.equal(app.profile, null);
    assert.equal(shownScreens.at(-1).name, "login");
    assert.equal(shownScreens.at(-1).context.statusMessage, "Signed out. Sign in with another account.");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: local hotseat setup resolves both players from authenticated account profiles", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  let startedMode = null;
  const calls = {
    multiplayerGetProfile: 0,
    authenticateHotseatIdentity: 0,
    ensureProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode) => {
    startedMode = mode;
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async () => {
            calls.ensureProfile += 1;
            throw new Error("local ensureProfile should not be used for authenticated hotseat setup");
          }
        },
        multiplayer: {
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              username: "SignedInUser",
              profile: {
                username: "SignedInUser",
                tokens: 200,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {
                  avatar: "default_avatar",
                  background: "default_background",
                  badge: "none",
                  title: "Initiate",
                  cardBack: "default_card_back",
                  elementCardVariant: {
                    fire: "default_fire_card",
                    water: "default_water_card",
                    earth: "default_earth_card",
                    wind: "default_wind_card"
                  }
                },
                owned: {}
              },
              stats: {
                summary: {
                  wins: 1,
                  losses: 0,
                  gamesPlayed: 1,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 1
                },
                modes: {}
              },
              currency: {
                tokens: 200
              }
            };
          },
          authenticateHotseatIdentity: async () => {
            calls.authenticateHotseatIdentity += 1;
            return {
              ok: true,
              account: {
                accountId: "account-p2"
              },
              session: {
                accountId: "account-p2",
                username: "SecondPlayer"
              },
              profile: {
                username: "SecondPlayer",
                profile: {
                  username: "SecondPlayer",
                  tokens: 180,
                  equippedCosmetics: {}
                },
                cosmetics: {
                  equipped: {
                    avatar: "default_avatar",
                    background: "default_background",
                    badge: "none",
                    title: "Initiate",
                    cardBack: "default_card_back",
                    elementCardVariant: {
                      fire: "default_fire_card",
                      water: "default_water_card",
                      earth: "default_earth_card",
                      wind: "default_wind_card"
                    }
                  },
                  owned: {}
                },
                stats: {
                  summary: {
                    wins: 2,
                    losses: 3,
                    gamesPlayed: 5,
                    warsEntered: 1,
                    warsWon: 0,
                    cardsCaptured: 4
                  },
                  modes: {}
                },
                currency: {
                  tokens: 180
                }
              }
            };
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      session: {
        authenticated: true,
        username: "SignedInUser",
        accountId: "account-p1"
      }
    });

    app.showLocalSetup();
    await shownScreens.at(-1).context.actions.start({
      p1: { authenticated: true },
      p2: {
        mode: "login",
        email: "p2@example.com",
        password: "password123",
        username: ""
      }
    });

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.authenticateHotseatIdentity, 1);
    assert.equal(calls.ensureProfile, 0);
    assert.equal(app.localPlayers.p1, "SignedInUser");
    assert.equal(app.localPlayers.p2, "SecondPlayer");
    assert.equal(app.localProfiles.p1.username, "SignedInUser");
    assert.equal(app.localProfiles.p2.username, "SecondPlayer");
    assert.equal(startedMode, MATCH_MODE.LOCAL_PVP);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu online play action opens the online play screen", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    getState: 0,
    connect: 0
  };
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => {
            calls.getState += 1;
            return {
              connectionStatus: "disconnected",
              room: null,
              statusMessage: "Offline. Open Online Play to connect."
            };
          },
          connect: async () => {
            calls.connect += 1;
            const state = {
              connectionStatus: "connected",
              socketId: "socket-1",
              room: null,
              lastError: null,
              statusMessage: "Connected. Create a room or join one."
            };
            for (const listener of updateListeners) {
              listener(state);
            }
            return state;
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await shownScreens.at(-1).context.actions.openOnlinePlay();

    assert.equal(calls.getState, 1);
    assert.equal(calls.connect, 1);
    assert.equal(shownScreens.at(-1).name, "onlinePlay");
    assert.equal(shownScreens.at(-1).context.username, "SignedInUser");
    assert.equal(shownScreens.at(-1).context.multiplayer.connectionStatus, "connected");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play create join submit-move and ready-rematch actions use the multiplayer bridge", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    createRoom: [],
    joinRoom: [],
    submitMove: [],
    readyRematch: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          getProfile: async ({ username }) => ({
            username: canonicalizeUsername(username),
            profile: {
              username: canonicalizeUsername(username),
              playerXP: 12,
              playerLevel: 2
            },
            cosmetics: {
              equipped: {
                avatar: "avatar_arcane_gambler",
                cardBack: "default_card_back",
                background: "bg_crystal_nexus",
                elementCardVariant: {
                  fire: "default_fire_card",
                  water: "default_water_card",
                  earth: "default_earth_card",
                  wind: "default_wind_card"
                },
                title: "Flame Vanguard",
                badge: "first_flame"
              },
              owned: {}
            },
            stats: {
              summary: {
                wins: 9,
                losses: 4,
                gamesPlayed: 13,
                warsEntered: 2,
                warsWon: 1,
                cardsCaptured: 18
              },
              modes: {}
            },
            currency: {
              tokens: 415
            },
            progression: {
              dailyChallenges: { challenges: [], msUntilReset: 3600000 },
              weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
              dailyLogin: { eligible: false, msUntilReset: 3600000 }
            }
          }),
          createRoom: async (payload) => {
            calls.createRoom.push(payload);
            return {};
          },
          joinRoom: async (payload) => {
            calls.joinRoom.push(payload);
            return {};
          },
          submitMove: async ({ move }) => {
            calls.submitMove.push(move);
            return {};
          },
          readyRematch: async () => {
            calls.readyRematch += 1;
            return {};
          },
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();

    await shownScreens.at(-1).context.actions.createRoom();
    await shownScreens.at(-1).context.actions.joinRoom("abc123");
    await shownScreens.at(-1).context.actions.submitMove("fire");
    await shownScreens.at(-1).context.actions.readyRematch();

    const expectedIdentityPayload = {
      username: "SignedInUser-Canonical",
      equippedCosmetics: {
        avatar: "avatar_arcane_gambler",
        cardBack: "default_card_back",
        background: "bg_crystal_nexus",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        title: "Flame Vanguard",
        badge: "first_flame"
      }
    };

    assert.deepEqual(calls.createRoom, [expectedIdentityPayload]);
    assert.deepEqual(calls.joinRoom, [{ roomCode: "ABC123", ...expectedIdentityPayload }]);
    assert.deepEqual(calls.submitMove, ["fire"]);
    assert.equal(calls.readyRematch, 1);
    assert.equal(app.onlinePlayJoinCode, "ABC123");
    assert.equal(app.username, "SignedInUser-Canonical");
    assert.equal(app.profile.tokens, 415);
    assert.equal(app.profile.wins, 9);
    assert.equal(app.profile.equippedCosmetics.background, "bg_crystal_nexus");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online settlement refresh prefers the multiplayer-authoritative profile snapshot", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0,
    localGetDailyChallenges: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              profile: {
                username,
                tokens: 245,
                playerXP: 18,
                playerLevel: 1,
                equippedCosmetics: {}
              },
              progression: {
                xp: {
                  playerXP: 18,
                  playerLevel: 1
                },
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        },
        state: {
          getProfile: async () => {
            calls.localGetProfile += 1;
            return null;
          },
          getDailyChallenges: async () => {
            calls.localGetDailyChallenges += 1;
            return null;
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", tokens: 200, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    const settledState = {
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-28T18:00:00.000Z",
          summary: {
            settledHostUsername: "SignedInUser",
            settledGuestUsername: "OtherPlayer"
          }
        }
      }
    };

    await app.refreshLocalProfileAfterOnlineSettlement(settledState);

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 0);
    assert.equal(calls.localGetDailyChallenges, 0);
    assert.equal(app.profile.tokens, 245);
    assert.equal(app.profile.playerXP, 18);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online menu challenge refresh prefers the multiplayer profile snapshot", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    multiplayerGetProfile: 0,
    localGetDailyChallenges: 0
  };

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username,
              profile: { username, tokens: 200, equippedCosmetics: {} },
              progression: {
                dailyChallenges: { challenges: [{ id: "daily" }], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [{ id: "weekly" }], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 1800000 }
              }
            };
          }
        },
        state: {
          getDailyChallenges: async () => {
            calls.localGetDailyChallenges += 1;
            return null;
          }
        }
      }
    };

    app.username = "MenuOnlineUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    await app.refreshDailyChallengesForMenu();

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetDailyChallenges, 0);
    assert.equal(app.dailyChallenges.daily.challenges[0].id, "daily");
    assert.equal(app.dailyChallenges.weekly.challenges[0].id, "weekly");
    assert.equal(app.dailyChallenges.dailyLogin.msUntilReset, 1800000);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online menu flow does not call the disabled local loadout unlock acknowledgement path", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    acknowledgeLoadoutUnlocks: 0,
    multiplayerGetProfile: 0
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          acknowledgeLoadoutUnlocks: async () => {
            calls.acknowledgeLoadoutUnlocks += 1;
            return null;
          }
        },
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username,
              profile: { username, tokens: 200, equippedCosmetics: {} },
              progression: {
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 1800000 }
              }
            };
          }
        }
      }
    };

    app.username = "MenuOnlineUser";
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "MenuOnlineUser",
        sessionId: "session-1",
        accountId: "account-1",
        profileKey: "MenuOnlineUser",
        authenticated: true
      }
    });

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.acknowledgeLoadoutUnlocks, 0);
    assert.equal(calls.multiplayerGetProfile, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online daily challenges screen prefers the multiplayer profile snapshot", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    multiplayerGetProfile: 0,
    localGetDailyChallenges: 0
  };

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username,
              profile: { username, tokens: 415, equippedCosmetics: {} },
              currency: { tokens: 415 },
              progression: {
                dailyChallenges: { challenges: [{ id: "daily-online" }], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [{ id: "weekly-online" }], msUntilReset: 7200000 }
              }
            };
          }
        },
        state: {
          getDailyChallenges: async () => {
            calls.localGetDailyChallenges += 1;
            return null;
          }
        }
      }
    };

    app.username = "DailyOnlineUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    await app.showDailyChallenges();

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetDailyChallenges, 0);
    assert.equal(shownScreens.at(-1).name, "dailyChallenges");
    assert.equal(shownScreens.at(-1).context.tokens, 415);
    assert.equal(shownScreens.at(-1).context.daily.challenges[0].id, "daily-online");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online cosmetic randomization after settlement uses multiplayer authority instead of local state", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerRandomizeOwnedCosmetics: 0,
    localRandomizeOwnedCosmetics: 0
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({
            username: "OnlineRandomUser",
            profile: {
              username: "OnlineRandomUser",
              cosmeticRandomizeAfterMatch: { avatar: true }
            }
          }),
          randomizeOwnedCosmetics: async () => {
            calls.multiplayerRandomizeOwnedCosmetics += 1;
            return {
              profile: {
                username: "OnlineRandomUser",
                equippedCosmetics: {
                  avatar: "avatar_arcane_gambler"
                }
              },
              snapshot: {
                username: "OnlineRandomUser",
                profile: {
                  username: "OnlineRandomUser",
                  equippedCosmetics: {
                    avatar: "avatar_arcane_gambler"
                  }
                },
                cosmetics: {
                  equipped: {
                    avatar: "avatar_arcane_gambler"
                  }
                }
              }
            };
          }
        },
        state: {
          randomizeOwnedCosmetics: async () => {
            calls.localRandomizeOwnedCosmetics += 1;
            return null;
          }
        }
      }
    };

    app.username = "OnlineRandomUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    const result = await app.randomizeOwnedCosmeticsFor("OnlineRandomUser", {
      username: "OnlineRandomUser",
      cosmeticRandomizeAfterMatch: { avatar: true }
    }, ["avatar"]);

    assert.equal(calls.multiplayerRandomizeOwnedCosmetics, 1);
    assert.equal(calls.localRandomizeOwnedCosmetics, 0);
    assert.equal(result.equippedCosmetics.avatar, "avatar_arcane_gambler");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play join rerenders move controls when a full room state is returned directly", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          joinRoom: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            lastError: null,
            statusMessage: "Room ABC123 is full.",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" }
            }
          }),
          createRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();
    await shownScreens.at(-1).context.actions.joinRoom("abc123");

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.room.status, "full");
    assert.deepEqual(onlinePlayContext.multiplayer.room.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play update preserves latest round result for the online play screen", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: true,
                guestSubmitted: true,
                submittedCount: 2,
                bothSubmitted: true,
                updatedAt: "2026-03-19T12:00:05.000Z"
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Both players submitted moves for room ABC123."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: true,
                guestSubmitted: true,
                submittedCount: 2,
                bothSubmitted: true,
                updatedAt: "2026-03-19T12:00:05.000Z"
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Both players submitted moves for room ABC123."
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    updateListeners[0]({
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      },
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win"
      },
      lastError: null,
      statusMessage: "You Win Room ABC123"
    });

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.deepEqual(onlinePlayContext.multiplayer.latestRoundResult, {
      roomCode: "ABC123",
      hostMove: "fire",
      guestMove: "water",
      outcomeType: "resolved",
      hostResult: "lose",
      guestResult: "win"
    });
    assert.equal(onlinePlayContext.multiplayer.room.hostScore, 0);
    assert.equal(onlinePlayContext.multiplayer.room.guestScore, 1);
    assert.equal(onlinePlayContext.multiplayer.room.roundNumber, 2);
    assert.equal(onlinePlayContext.multiplayer.room.lastOutcomeType, "resolved");
    assert.equal(onlinePlayContext.multiplayer.room.warActive, false);
    assert.equal(onlinePlayContext.multiplayer.room.warDepth, 0);
    assert.deepEqual(onlinePlayContext.multiplayer.room.warRounds, []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play clears previous round result when the next round begins", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: {
              roomCode: "ABC123",
              hostMove: "fire",
              guestMove: "water",
              outcomeType: "resolved",
              hostResult: "lose",
              guestResult: "win"
            },
            lastError: null,
            statusMessage: "You Win Room ABC123"
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: {
              roomCode: "ABC123",
              hostMove: "fire",
              guestMove: "water",
              outcomeType: "resolved",
              hostResult: "lose",
              guestResult: "win"
            },
            lastError: null,
            statusMessage: "You Win Room ABC123"
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    updateListeners[0]({
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: false,
          submittedCount: 1,
          bothSubmitted: false,
          updatedAt: "2026-03-19T12:01:00.000Z"
        }
      },
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win"
      },
      lastError: null,
      statusMessage: "1/2 move submission received for room ABC123."
    });

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.latestRoundResult, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play submit responses cannot resurrect a stale round result during 1/2 submitted state", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: true,
                guestSubmitted: false,
                submittedCount: 1,
                bothSubmitted: false,
                updatedAt: "2026-03-19T12:00:05.000Z"
              }
            },
            latestRoundResult: {
              roomCode: "ABC123",
              hostMove: "fire",
              guestMove: "earth",
              outcomeType: "resolved",
              hostResult: "win",
              guestResult: "lose"
            },
            lastError: null,
            statusMessage: "1/2 move submission received for room ABC123."
          }),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();
    await shownScreens.at(-1).context.actions.submitMove("fire");

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.room.moveSync.submittedCount, 1);
    assert.equal(onlinePlayContext.multiplayer.latestRoundResult, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play update preserves war state for the online play screen", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 3,
              lastOutcomeType: "no_effect",
              hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
              guestHand: { fire: 1, water: 2, earth: 2, wind: 1 },
              warPot: {
                host: ["fire"],
                guest: ["fire", "wind"]
              },
              warActive: true,
              warDepth: 1,
              warRounds: [
                {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war"
                },
                {
                  round: 2,
                  hostMove: "wind",
                  guestMove: "fire",
                  outcomeType: "no_effect"
                }
              ],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "No Effect Room ABC123"
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 3,
              lastOutcomeType: "no_effect",
              hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
              guestHand: { fire: 1, water: 2, earth: 2, wind: 1 },
              warPot: {
                host: ["fire"],
                guest: ["fire", "wind"]
              },
              warActive: true,
              warDepth: 1,
              warRounds: [
                {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war"
                },
                {
                  round: 2,
                  hostMove: "wind",
                  guestMove: "fire",
                  outcomeType: "no_effect"
                }
              ],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "No Effect Room ABC123"
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.room.warActive, true);
    assert.equal(onlinePlayContext.multiplayer.room.warDepth, 1);
    assert.deepEqual(onlinePlayContext.multiplayer.room.hostHand, {
      fire: 1,
      water: 2,
      earth: 2,
      wind: 2
    });
    assert.deepEqual(onlinePlayContext.multiplayer.room.guestHand, {
      fire: 1,
      water: 2,
      earth: 2,
      wind: 1
    });
    assert.deepEqual(onlinePlayContext.multiplayer.room.warPot, {
      host: ["fire"],
      guest: ["fire", "wind"]
    });
    assert.deepEqual(onlinePlayContext.multiplayer.room.warRounds, [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war"
      },
      {
        round: 2,
        hostMove: "wind",
        guestMove: "fire",
        outcomeType: "no_effect"
      }
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: reveal sounds are mode-aware and war start only plays when war begins", () => {
  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {}
  });

  app.sound = {
    playReveal: (payload) => calls.push({ type: "reveal", payload }),
    play: (key) => calls.push({ type: "play", key })
  };

  app.playRoundRevealSounds(
    {
      status: "war_continues",
      war: { clashes: 1 },
      revealedCards: { p1Card: "fire", p2Card: "water" }
    },
    MATCH_MODE.PVE,
    { warWasActive: false }
  );

  app.playRoundRevealSounds(
    {
      status: "round_resolved",
      round: { result: "p2", warClashes: 2 },
      revealedCards: { p1Card: "earth", p2Card: "wind" }
    },
    MATCH_MODE.LOCAL_PVP,
    { warWasActive: true }
  );

  assert.deepEqual(calls, [
    { type: "reveal", payload: { mode: MATCH_MODE.PVE, cards: ["fire"] } },
    { type: "play", key: "warStart" },
    { type: "reveal", payload: { mode: MATCH_MODE.LOCAL_PVP, cards: ["earth", "wind"] } }
  ]);
});

test("appController: removed offline login path is rejected cleanly", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    ensureProfile: 0,
    claimDailyLoginReward: 0,
    getDailyChallenges: 0,
    modalShow: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: {
      show: () => {
        calls.modalShow += 1;
      },
      hide: () => {}
    },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {},
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => {
            calls.ensureProfile += 1;
            return { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
          },
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: true,
              profile: { username, tokens: 105, playerXP: 2, playerLevel: 1, equippedCosmetics: {} },
              rewardTokens: 5,
              rewardXp: 2,
              levelRewardTokenDelta: 0,
              xpBreakdown: { lines: [{ key: "daily_login", label: "Daily Login", amount: 2 }], total: 2 },
              levelBefore: 1,
              levelAfter: 1,
              levelRewards: [],
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-09T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-09T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
          getDailyChallenges: async () => {
            calls.getDailyChallenges += 1;
            return {
              dailyLogin: { eligible: false, msUntilReset: 3600000 },
              daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            };
          }
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login("EligibleUser");

    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.claimDailyLoginReward, 0);
    assert.equal(calls.getDailyChallenges, 0);
    assert.equal(calls.modalShow, 0);
    assert.equal(app.profile, null);
    assert.equal(shownScreens.at(-1).name, "login");
    assert.match(shownScreens.at(-1).context.errorMessage, /Authenticated account login is required/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: login prefers the multiplayer profile snapshot when the session is already online-connected", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerLogin: [],
    ensureProfile: 0,
    multiplayerGetState: 0,
    multiplayerGetProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.onlinePlayState = app.normalizeOnlinePlayState({
    connectionStatus: "connected"
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => {
            calls.ensureProfile += 1;
            return { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          login: async (payload) => {
            calls.multiplayerLogin.push(payload);
            return {
              ok: true,
              account: {
                accountId: "account-connected-1",
                email: payload.email,
                username: "ConnectedUser"
              },
              session: {
                token: "session-token-connected-1",
                sessionId: "session-id-connected-1",
                username: "ConnectedUser",
                profileKey: "ConnectedUser",
                accountId: "account-connected-1",
                authenticated: true
              }
            };
          },
          getState: async () => {
            calls.multiplayerGetState += 1;
            return {
              connectionStatus: "connected",
              socketId: "socket-connected-1",
              session: {
                active: true,
                username: "ConnectedUser",
                sessionId: "session-id-connected-1",
                accountId: "account-connected-1",
                profileKey: "ConnectedUser",
                authenticated: true
              },
              room: null,
              lastError: null,
              statusMessage: "Signed in."
            };
          },
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username: canonicalizeUsername(username),
              profile: {
                username: canonicalizeUsername(username),
                playerXP: 18,
                playerLevel: 1
              },
              cosmetics: {
                equipped: { background: "wind_background", avatar: "default_avatar" },
                owned: { background: ["wind_background"] }
              },
              stats: {
                summary: {
                  wins: 4,
                  losses: 1,
                  gamesPlayed: 5,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 3
                },
                modes: {}
              },
              currency: {
                tokens: 245
              },
              progression: {
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login({
      mode: "login",
      email: "connected@example.com",
      password: "password123"
    });

    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.multiplayerLogin.length, 1);
    assert.equal(calls.multiplayerGetState, 1);
    assert.equal(calls.multiplayerGetProfile, 2);
    assert.equal(app.username, "ConnectedUser-Canonical");
    assert.equal(app.profile.tokens, 245);
    assert.equal(app.profile.wins, 4);
    assert.equal(app.profile.equippedCosmetics.background, "wind_background");
    assert.equal(app.profile.playerXP, 18);
    assert.equal(app.dailyChallenges.daily.msUntilReset, 3600000);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: account login uses the multiplayer auth path and hydrates the active profile from the server snapshot", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerLogin: [],
    multiplayerGetState: 0,
    multiplayerGetProfile: 0,
    ensureProfile: 0,
    claimDailyLoginReward: 0,
    getDailyChallenges: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
        elemintz: {
          state: {
            ensureProfile: async () => {
              calls.ensureProfile += 1;
              return { username: "LocalFallbackUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
            },
            getDailyChallenges: async () => {
              calls.getDailyChallenges += 1;
              return {
                dailyLogin: { eligible: false, msUntilReset: 3600000 },
                daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            };
          }
        },
        multiplayer: {
            login: async (payload) => {
              calls.multiplayerLogin.push(payload);
              return {
                ok: true,
                account: {
                accountId: "account-1",
                email: payload.email,
                username: "AccountUser"
              },
              session: {
                token: "session-token-1",
                sessionId: "session-id-1",
                username: "AccountUser",
                profileKey: "AccountUser",
                accountId: "account-1",
                  authenticated: true
                }
              };
            },
            claimDailyLoginReward: async ({ username }) => {
              calls.claimDailyLoginReward += 1;
              return {
                granted: false,
                profile: { username, tokens: 260, playerXP: 24, playerLevel: 2, equippedCosmetics: {} },
                snapshot: {
                  authority: "server",
                  profile: { username, tokens: 260, playerXP: 24, playerLevel: 2, equippedCosmetics: {} },
                  progression: {
                    dailyChallenges: { challenges: [] },
                    weeklyChallenges: { challenges: [] },
                    dailyLogin: {
                      eligible: false,
                      loginDayKey: "2026-03-28T00:00:00.000Z",
                      lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                      msUntilReset: 3600000
                    }
                  }
                },
                dailyLoginStatus: {
                  eligible: false,
                  loginDayKey: "2026-03-28T00:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                  msUntilReset: 3600000
                }
              };
            },
            getState: async () => {
            calls.multiplayerGetState += 1;
            return {
              connectionStatus: "connected",
              socketId: "socket-1",
              session: {
                active: true,
                username: "AccountUser",
                sessionId: "session-id-1",
                accountId: "account-1",
                profileKey: "AccountUser",
                authenticated: true
              },
              room: null,
              lastError: null,
              statusMessage: "Signed in."
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              username: "AccountUser",
              profile: {
                username: "AccountUser",
                tokens: 260,
                playerXP: 24,
                playerLevel: 2,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {},
                owned: {}
              },
              stats: {
                summary: {
                  wins: 5,
                  losses: 2,
                  gamesPlayed: 7,
                  warsEntered: 1,
                  warsWon: 1,
                  cardsCaptured: 9
                },
                modes: {
                  online: {
                    wins: 5,
                    losses: 2
                  }
                }
              },
              currency: {
                tokens: 260
              },
              progression: {
                xp: {
                  playerXP: 24,
                  playerLevel: 2
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login({
      mode: "login",
      email: "player@example.com",
      password: "password123"
    });

    assert.deepEqual(calls.multiplayerLogin, [
      {
        username: "",
        email: "player@example.com",
        password: "password123"
      }
    ]);
    assert.equal(calls.multiplayerGetState, 1);
    assert.equal(calls.multiplayerGetProfile, 2);
    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(calls.getDailyChallenges, 0);
    assert.equal(app.username, "AccountUser");
    assert.equal(app.profile.tokens, 260);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: init restores a persisted authenticated session and auto-enters the signed-in flow", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0,
    multiplayerGetProfile: 0,
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: () => {}
        },
        dataset: {}
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {}
        }
      }
    };
      globalThis.window = {
        elemintz: {
          state: {
            getSettings: async () => ({ gameplay: { timerSeconds: 30 }, ui: { reducedMotion: false }, audio: { enabled: true } }),
            getDailyChallenges: async () => ({
              dailyLogin: { eligible: false, msUntilReset: 3600000 },
              daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            })
          },
          multiplayer: {
            onUpdate: () => () => {},
            claimDailyLoginReward: async ({ username }) => {
              calls.claimDailyLoginReward += 1;
              return {
                granted: false,
                profile: { username, tokens: 275, playerXP: 22, playerLevel: 2, equippedCosmetics: {} },
                snapshot: {
                  authority: "server",
                  profile: { username, tokens: 275, playerXP: 22, playerLevel: 2, equippedCosmetics: {} },
                  progression: {
                    dailyChallenges: { challenges: [] },
                    weeklyChallenges: { challenges: [] },
                    dailyLogin: {
                      eligible: false,
                      loginDayKey: "2026-03-28T00:00:00.000Z",
                      lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                      msUntilReset: 3600000
                    }
                  }
                },
                dailyLoginStatus: {
                  eligible: false,
                  loginDayKey: "2026-03-28T00:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                  msUntilReset: 3600000
                }
              };
            },
            getState: async () => ({
              connectionStatus: "disconnected",
              session: {
                active: false,
              username: null,
              sessionId: null,
              accountId: null,
              profileKey: null,
              authenticated: false
            },
            room: null,
            lastError: null,
            statusMessage: "Offline."
          }),
          restoreSession: async () => {
            calls.restoreSession += 1;
            return {
              ok: true,
              restored: true,
              state: {
                connectionStatus: "connected",
                socketId: "socket-restore-1",
                session: {
                  active: true,
                  username: "RestoredUser",
                  sessionId: "session-restore-1",
                  accountId: "account-restore-1",
                  profileKey: "RestoredUser",
                  authenticated: true
                },
                room: null,
                lastError: null,
                statusMessage: "Signed in. Session restored."
              }
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              username: "RestoredUser",
              profile: {
                username: "RestoredUser",
                tokens: 275,
                playerXP: 22,
                playerLevel: 2,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {},
                owned: {}
              },
              stats: {
                summary: {
                  wins: 6,
                  losses: 1,
                  gamesPlayed: 7,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 8
                },
                modes: {
                  online: { wins: 6, losses: 1 }
                }
              },
              currency: {
                tokens: 275
              },
              progression: {
                xp: {
                  playerXP: 22,
                  playerLevel: 2
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    await app.init();

    assert.equal(calls.restoreSession, 1);
    assert.equal(calls.multiplayerGetProfile, 2);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(app.username, "RestoredUser");
    assert.equal(app.profile.tokens, 275);
    assert.equal(shownScreens.some((entry) => entry.name === "login"), false);
    assert.equal(shownScreens.at(-1).name, "menu");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: invalid restored session clears back to login with a visible status message", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: () => {}
        },
        dataset: {}
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {}
        }
      }
    };
    globalThis.window = {
      elemintz: {
        state: {
          getSettings: async () => ({ gameplay: { timerSeconds: 30 }, ui: { reducedMotion: false }, audio: { enabled: true } })
        },
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "disconnected",
            session: {
              active: false,
              username: null,
              sessionId: null,
              accountId: null,
              profileKey: null,
              authenticated: false
            },
            room: null,
            lastError: {
              code: "SESSION_EXPIRED",
              message: "Saved session expired. Please sign in again."
            },
            statusMessage: "Saved session expired. Please sign in again."
          }),
          restoreSession: async () => {
            calls.restoreSession += 1;
            return {
              ok: false,
              restored: false,
              invalid: true,
              error: {
                code: "SESSION_EXPIRED",
                message: "Saved session expired. Please sign in again."
              },
              state: {
                connectionStatus: "disconnected",
                session: {
                  active: false,
                  username: null,
                  sessionId: null,
                  accountId: null,
                  profileKey: null,
                  authenticated: false
                },
                room: null,
                lastError: {
                  code: "SESSION_EXPIRED",
                  message: "Saved session expired. Please sign in again."
                },
                statusMessage: "Saved session expired. Please sign in again."
              }
            };
          }
        }
      }
    };

    await app.init();

    assert.equal(calls.restoreSession, 1);
    assert.equal(shownScreens.at(-1).name, "login");
    assert.equal(shownScreens.at(-1).context.statusMessage, "Saved session expired. Please sign in again.");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: restored authenticated startup still exposes local setup and creates both local PvP profiles", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0,
    multiplayerGetProfile: 0,
    authenticateHotseatIdentity: 0,
    claimDailyLoginReward: []
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: () => {}
        },
        dataset: {}
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {}
        }
      }
    };
      globalThis.window = {
        elemintz: {
          state: {
            getSettings: async () => ({ gameplay: { timerSeconds: 30 }, ui: { reducedMotion: false }, audio: { enabled: true } }),
            getDailyChallenges: async () => ({
              dailyLogin: { eligible: false, msUntilReset: 3600000 },
              daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            }),
          recordMatchResult: async () => ({}),
          getProfile: async (username) => ({
            username,
            tokens: username === "LocalP2" ? 210 : 275,
            playerXP: 12,
            playerLevel: 2,
            equippedCosmetics: {}
          }),
          getCosmetics: async () => ({ owned: {}, equipped: {}, loadouts: [] })
          },
          multiplayer: {
            onUpdate: () => () => {},
            claimDailyLoginReward: async ({ username }) => {
              calls.claimDailyLoginReward.push(username);
              return {
                granted: false,
                profile: {
                  username,
                  tokens: username === "LocalP2" ? 210 : 275,
                  playerXP: 12,
                  playerLevel: 2,
                  equippedCosmetics: {}
                },
                snapshot: {
                  authority: "server",
                  profile: {
                    username,
                    tokens: username === "LocalP2" ? 210 : 275,
                    playerXP: 12,
                    playerLevel: 2,
                    equippedCosmetics: {}
                  },
                  progression: {
                    dailyChallenges: { challenges: [] },
                    weeklyChallenges: { challenges: [] },
                    dailyLogin: {
                      eligible: false,
                      loginDayKey: "2026-03-28T00:00:00.000Z",
                      lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                      msUntilReset: 3600000
                    }
                  }
                },
                dailyLoginStatus: {
                  eligible: false,
                  loginDayKey: "2026-03-28T00:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                  msUntilReset: 3600000
                }
              };
            },
            getState: async () => ({
              connectionStatus: "disconnected",
              session: {
                active: false,
              username: null,
              sessionId: null,
              accountId: null,
              profileKey: null,
              authenticated: false
            },
            room: null,
            lastError: null,
            statusMessage: "Offline."
          }),
          restoreSession: async () => {
            calls.restoreSession += 1;
            return {
              ok: true,
              restored: true,
              state: {
                connectionStatus: "connected",
                socketId: "socket-restore-2",
                session: {
                  active: true,
                  username: "RestoredUser",
                  sessionId: "session-restore-2",
                  accountId: "account-restore-2",
                  profileKey: "RestoredUser",
                  authenticated: true
                },
                room: null,
                lastError: null,
                statusMessage: "Signed in. Session restored."
              }
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              username: "RestoredUser",
              profile: {
                username: "RestoredUser",
                tokens: 275,
                playerXP: 22,
                playerLevel: 2,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {},
                owned: {}
              },
              stats: {
                summary: {
                  wins: 6,
                  losses: 1,
                  gamesPlayed: 7,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 8
                },
                modes: {
                  online: { wins: 6, losses: 1 }
                }
              },
              currency: {
                tokens: 275
              },
              progression: {
                xp: {
                  playerXP: 22,
                  playerLevel: 2
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          },
          authenticateHotseatIdentity: async () => {
            calls.authenticateHotseatIdentity += 1;
            return {
              ok: true,
              account: {
                accountId: "account-local-p2"
              },
              session: {
                accountId: "account-local-p2",
                username: "LocalP2"
              },
              profile: {
                authority: "server",
                source: "multiplayer",
                username: "LocalP2",
                profile: {
                  username: "LocalP2",
                  tokens: 210,
                  playerXP: 12,
                  playerLevel: 2,
                  equippedCosmetics: {}
                },
                cosmetics: {
                  equipped: {},
                  owned: {}
                },
                stats: {
                  summary: {
                    wins: 0,
                    losses: 0,
                    gamesPlayed: 0,
                    warsEntered: 0,
                    warsWon: 0,
                    cardsCaptured: 0
                  },
                  modes: {}
                },
                currency: {
                  tokens: 210
                }
              }
            };
          }
        }
      }
    };

    await app.init();
    assert.equal(shownScreens.at(-1).name, "menu");

    await shownScreens.at(-1).context.actions.startLocalGame();
    assert.equal(shownScreens.at(-1).name, "localSetup");
    assert.equal(shownScreens.at(-1).context.player1.authenticated, true);
    assert.equal(shownScreens.at(-1).context.player1.username, "RestoredUser");

    await shownScreens.at(-1).context.actions.start({
      p1: { authenticated: true },
      p2: {
        mode: "login",
        email: "localp2@example.com",
        password: "password123",
        username: ""
      }
    });

    assert.equal(calls.multiplayerGetProfile, 3);
    assert.equal(calls.authenticateHotseatIdentity, 1);
    assert.deepEqual(calls.claimDailyLoginReward, ["RestoredUser"]);
    assert.equal(app.localPlayers.p1, "RestoredUser");
    assert.equal(app.localPlayers.p2, "LocalP2");
    assert.equal(app.localProfiles.p1.username, "RestoredUser");
    assert.equal(app.localProfiles.p2.username, "LocalP2");
    assert.equal(shownScreens.at(-1).name, "pass");
    assert.equal(shownScreens.at(-1).context.message, "Player 1, Click When Ready");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: duplicate daily login auto-claim requests are deduped within one login cycle", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {},
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => ({ username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} }),
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: false,
              profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-10T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-10T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
          getDailyChallenges: async () => ({
            dailyLogin: { eligible: false, msUntilReset: 3600000 },
            daily: { msUntilReset: 3600000, challenges: [] },
            weekly: { msUntilReset: 7200000, challenges: [] }
          })
        }
      }
    };

    app.username = "GuardUser";
    app.profile = { username: "GuardUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
    await app.ensureDailyLoginAutoClaim({ showToasts: true, requestKey: "login:GuardUser" });

    assert.equal(calls.claimDailyLoginReward, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: showOnlinePlay refreshes the active profile from the multiplayer snapshot after connect", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "OnlineUser";
  app.profile = { username: "OnlineUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            calls.localGetProfile += 1;
            return { username: "OnlineUser", tokens: 110, playerXP: 2, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "disconnected",
            socketId: null,
            room: null,
            lastError: null,
            statusMessage: "Offline."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username: canonicalizeUsername(username),
              profile: {
                username: canonicalizeUsername(username),
                playerXP: 44,
                playerLevel: 3
              },
              cosmetics: {
                equipped: {
                  avatar: "default_avatar",
                  background: "bg_celestial_observatory",
                  cardBack: "default_card_back",
                  elementCardVariant: {
                    fire: "default_fire_card",
                    water: "default_water_card",
                    earth: "default_earth_card",
                    wind: "default_wind_card"
                  },
                  title: "Initiate",
                  badge: "none"
                },
                owned: {}
              },
              stats: {
                summary: {
                  wins: 12,
                  losses: 5,
                  gamesPlayed: 17,
                  warsEntered: 3,
                  warsWon: 2,
                  cardsCaptured: 28
                },
                modes: {}
              },
              currency: {
                tokens: 310
              },
              progression: {
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    await app.showOnlinePlay();

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 1);
    assert.equal(app.username, "OnlineUser-Canonical");
    assert.equal(app.profile.tokens, 310);
    assert.equal(app.profile.wins, 12);
    assert.equal(app.profile.equippedCosmetics.background, "bg_celestial_observatory");
    assert.equal(app.profile.playerLevel, 3);
    assert.equal(shownScreens.at(-1).name, "onlinePlay");
    assert.equal(shownScreens.at(-1).context.username, "OnlineUser-Canonical");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online profile load keeps local fallback when multiplayer snapshot is unavailable", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "FallbackUser";
  app.onlinePlayState = {
    connectionStatus: "connected"
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async (username) => {
            calls.localGetProfile += 1;
            return { username, tokens: 150, playerXP: 5, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return null;
          }
        }
      }
    };

    const result = await app.loadPreferredProfileForOnlineSession({
      username: "FallbackUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 1);
    assert.equal(result.tokens, 150);
    assert.equal(app.profile.tokens, 150);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: pass screen remains stable during timer ticks", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const timerLabel = { textContent: "" };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 3 }, ui: { reducedMotion: true } };
  app.username = "LocalFlowUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };

  try {
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: (id) => (id === "pass-timer-label" ? timerLabel : null)
    };
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);
    const startIndex = shownScreens.length - 1;
    await new Promise((resolve) => setTimeout(resolve, 2100));

    const newScreens = shownScreens.slice(startIndex);
    assert.equal(newScreens.length, 1);
    assert.ok(newScreens.every((entry) => entry.name === "pass"));
    assert.equal(timerLabel.textContent, "Time Remaining: 1s");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: local player turn remains on game screen while timer ticks", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 3 }, ui: { reducedMotion: true } };
  app.username = "LocalFlowUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };

  try {
    globalThis.Audio = class {
      play() {
        return Promise.resolve();
      }
    };

    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);
    await shownScreens.at(-1).context.actions.continue();

    const before = shownScreens.length;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const updates = shownScreens.slice(before - 1);
    const gameUpdates = updates.filter((entry) => entry.name === "game");
    assert.ok(gameUpdates.length >= 2);
    assert.equal(updates.at(-1).name, "game");
    assert.ok(gameUpdates.at(-1).context.game.timerSeconds < 3);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
  }
});

test("appController: local hotseat shows both strict privacy pass screens", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;

  const shownScreens = [];
  const screenManager = {
    register: () => {},
    show: (name, context) => {
      shownScreens.push({ name, context });
    }
  };

  const app = new AppController({
    screenManager,
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = {
    gameplay: { timerSeconds: 30 },
    ui: { reducedMotion: true }
  };
  app.username = "LocalFlowUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };
  const resolutionCalls = [];

  try {
    globalThis.Audio = class {
      play() {
        return Promise.resolve();
      }
    };

    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };
    app.showSharedResolutionPopup = async (result, mode) => {
      resolutionCalls.push({ result, mode });
    };
    app.showPlayer1TurnPass = async () => {
      shownScreens.push({
        name: "pass",
        context: { message: "Player 1, Click When Ready", summary: null }
      });
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);

    await app.handleGameCardSelection(0);
    let last = shownScreens.at(-1);
    assert.equal(last.name, "pass");
    assert.equal(last.context.message, "Player 2, Click When Ready");

    await last.context.actions.continue();
    await app.handleGameCardSelection(0);

    last = shownScreens.at(-1);
    assert.equal(last.name, "pass");
    assert.equal(last.context.message, "Player 1, Click When Ready");
    assert.equal(last.context.summary, null);
    assert.equal(resolutionCalls.length, 1);
    assert.equal(resolutionCalls[0].mode, MATCH_MODE.LOCAL_PVP);

    assert.ok(
      resolutionCalls[0].result?.status === "round_resolved" ||
      resolutionCalls[0].result?.status === "war_continues"
    );
  } finally {
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    app.clearPassTimer();
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
  }
});

test("appController: pass-screen timeout auto-picks for Player 2 turn", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  let pickedTurn = null;
  app.showPassScreen = async ({ onTimeout }) => {
    await onTimeout();
  };
  app.autoPickForTurn = async (turn) => {
    pickedTurn = turn;
  };

  try {
    globalThis.window = { elemintz: { state: {} } };
    await app.showPassToPlayer2();
    assert.equal(pickedTurn, "p2");
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("appController: Player 2 timeout resolves immediately without an extra Player 1-only reveal popup", async () => {
  const originalWindow = globalThis.window;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  let resolved = false;

  app.gameController = {
    pickRandomCardIndex: (turn) => {
      assert.equal(turn, "p2");
      return 1;
    },
    submitHotseatSelection: async (index) => {
      assert.equal(index, 1);
      return { status: "pass_to_p1" };
    }
  };

  app.presentHotseatResolution = async () => {
    resolved = true;
  };

  try {
    globalThis.window = { elemintz: { state: {} } };
    await app.autoPickForTurn("p2");

    assert.equal(resolved, true);
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("gameController: 5-minute timer resolves by card count and supports ties", async () => {
  const originalWindow = globalThis.window;

  const completions = [];
  const controller = new GameController({
    username: "TimerUser",
    mode: MATCH_MODE.PVE,
    matchTimeLimitSeconds: 1,
    onUpdate: () => {},
    onMatchComplete: ({ match }) => completions.push(match)
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.match.players.p1.hand = ["fire", "water", "wind"];
    controller.match.players.p2.hand = ["earth"];
    controller.match.meta.totalCards = 4;
    controller.totalMatchSeconds = 1;
    controller.startMatchClock();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.endReason, "time_limit");
    assert.equal(controller.match.winner, "p1");

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.match.players.p1.hand = ["fire"];
    controller.match.players.p2.hand = ["earth"];
    controller.match.meta.totalCards = 2;
    controller.completionNotified = false;
    controller.totalMatchSeconds = 1;
    controller.startMatchClock();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.endReason, "time_limit");
    assert.equal(controller.match.winner, "draw");
    assert.ok(completions.length >= 2);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: quit mid-game finalizes and persists", async () => {
  const originalWindow = globalThis.window;
  const calls = [];

  const controller = new GameController({
    username: "QuitUser",
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async (payload) => {
            calls.push(payload);
            return { ok: true };
          }
        }
      }
    };

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });

    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "quit_forfeit");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].matchState.status, "completed");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: local persistence records results for both local players", async () => {
  const originalWindow = globalThis.window;

  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "SignedInUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async (payload) => {
            calls.push(payload);
            return { profile: { username: payload.username }, stats: { cardsCaptured: 1 } };
          }
        }
      }
    };

    const match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      status: "completed",
      winner: "p1",
      round: 1
    };

    await app.persistLocalPvpResult(match);

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((entry) => [entry.username, entry.perspective]),
      [
        ["Alice", "p1"],
        ["Bob", "p2"]
      ]
    );
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("appController: gameplay uses equipped profile background", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "BgUser";
  app.profile = {
    username: "BgUser",
    equippedCosmetics: { background: "default_background" },
    cosmetics: { background: "default_background" }
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE);
    const last = shownScreens.at(-1);
    assert.equal(last.name, "game");
    assert.match(last.context.arenaBackground, /EleMintzIcon\.png/);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local WAR continuation requires additional player choices", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWar",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "water", "earth"], wonRounds: 0 },
        p2: { hand: ["fire", "earth", "wind"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 6 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    let confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "war_continues");
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 2);

    await controller.submitHotseatSelection(0); // water
    await controller.submitHotseatSelection(0); // earth -> no effect in WAR
    confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "war_continues");
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 4);

    await controller.submitHotseatSelection(0); // earth
    await controller.submitHotseatSelection(0); // wind -> p1 wins
    confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.lastRound.capturedCards, 6);
    assert.equal(controller.captured.p1, 3);
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.match.currentPile.length, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP resolved WAR clears active WAR state in the view model", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarVmClear",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "water"], wonRounds: 0 },
        p2: { hand: ["fire", "fire"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 4 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const first = await controller.confirmHotseatRound();
    assert.equal(first.status, "war_continues");

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const resolved = await controller.confirmHotseatRound();

    assert.equal(resolved.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");

    const vm = controller.getViewModel();
    assert.equal(vm.warActive, false);
    assert.equal(vm.roundOutcome.key, "player_win");
    assert.equal(vm.pileCount, 0);
    assert.deepEqual(vm.warPileCards, []);
    assert.deepEqual(vm.warPileSizes, []);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP later rounds cannot reassign an already-resolved WAR pile", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarNoReassign",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "water", "fire"], wonRounds: 0 },
        p2: { hand: ["fire", "fire", "water"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 6 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    let result = await controller.confirmHotseatRound();
    assert.equal(result.status, "war_continues");

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    result = await controller.confirmHotseatRound();
    assert.equal(result.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.captured.p1, 2);

    const capturedAfterWar = controller.captured.p1;

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    result = await controller.confirmHotseatRound();

    assert.equal(result.status, "round_resolved");
    assert.equal(controller.captured.p1, capturedAfterWar);
    assert.equal(controller.captured.p2, 1);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP WAR auto-resolves when p1 cannot continue", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarExhaustP1",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire"], wonRounds: 0 },
        p2: { hand: ["fire", "earth"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 3 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p2");
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.match.currentPile.length, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP WAR auto-resolves when p2 cannot continue", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarExhaustP2",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "earth"], wonRounds: 0 },
        p2: { hand: ["fire"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 3 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.match.currentPile.length, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local WAR exhaustion helper uses engine card requirement threshold", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarThreshold",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: {
          hand: Array.from({ length: Math.max(0, WAR_REQUIRED_CARDS - 1) }, () => "fire"),
          wonRounds: 0
        },
        p2: {
          hand: Array.from({ length: WAR_REQUIRED_CARDS }, () => "earth"),
          wonRounds: 0
        }
      },
      war: { active: true, clashes: 1, pendingClashes: 1, pendingPileSizes: [2] },
      currentPile: ["fire", "fire"],
      history: [],
      meta: { totalCards: Math.max(0, WAR_REQUIRED_CARDS - 1) + WAR_REQUIRED_CARDS + 2 }
    };

    const result = await controller.maybeAutoResolveLocalWarExhaustion();

    assert.equal(result?.status, "round_resolved");
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.lastRound.result, "p2");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP WAR draw auto-resolves when both players run out", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarExhaustBoth",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire"], wonRounds: 0 },
        p2: { hand: ["fire"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 2 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "draw");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "draw");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: reward toasts are labeled with receiving player", () => {
  const achievementCalls = [];
  const tokenCalls = [];
  const chestCalls = [];
  const xpCalls = [];
  const levelCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: (achievement, options) => achievementCalls.push({ achievement, options }),
      showTokenReward: (payload) => tokenCalls.push(payload),
      showChestGrant: (payload) => chestCalls.push(payload),
      showXpBreakdown: (payload) => xpCalls.push(payload),
      showLevelUp: (payload) => levelCalls.push(payload)
    }
  });

  app.emitRewardToastsForResult(
    {
      profile: { username: "Alice", chests: { basic: 3 } },
      unlockedAchievements: [
        { id: "first_flame", name: "First Flame", description: "Win first match." }
      ],
      dailyRewards: [{ id: "daily_win_1_match", rewardTokens: 1 }],
      weeklyRewards: [],
      levelRewardTokenDelta: 50,
      xpBreakdown: { lines: [{ label: "Match Completed", amount: 1 }] },
      xpDelta: 1,
      levelBefore: 1,
      levelAfter: 2,
      levelRewards: [{ id: "lvl2_tokens", name: "+50 Tokens" }]
    },
    "Player 1",
    { username: "Alice", chests: { basic: 1 } }
  );

  assert.equal(achievementCalls.length, 1);
  assert.equal(achievementCalls[0].options.playerName, "Alice");
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].label, "Alice reward payout");
  assert.equal(tokenCalls[0].amount, 51);
  assert.equal(chestCalls.length, 1);
  assert.equal(chestCalls[0].amount, 2);
  assert.equal(chestCalls[0].chestLabel, "Basic Chest");
  assert.equal(xpCalls.length, 1);
  assert.equal(xpCalls[0].label, "Alice XP");
  assert.equal(levelCalls.length, 1);
  assert.equal(levelCalls[0].playerName, "Alice");
});

test("appController: opening a basic chest from profile shows the fake open visual, then refreshes and emits reward toast", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const chestOpenCalls = [];
  const chestToastCalls = [];

  const initialProfile = {
    username: "ChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 1 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
  };
  const openedProfile = {
    ...initialProfile,
    playerXP: 5,
    chests: { basic: 0 }
  };
  let profileReads = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload)
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            profileReads += 1;
            return profileReads === 1 ? initialProfile : openedProfile;
          },
          getCosmetics: async () => ({
            equipped: initialProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            chestOpenCalls.push(payload);
            return {
              profile: openedProfile,
              chestType: "basic",
              consumed: 1,
              remaining: 0,
              rewards: { xp: 5, tokens: 0, cosmetic: null }
            };
          }
        }
      }
    };

    app.username = "ChestUser";

    await app.showProfile();
    assert.equal(shownScreens.at(-1).context.profile.chests.basic, 1);
    assert.equal(shownScreens.at(-1).context.basicChestVisualState.basicOpen, false);

    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.deepEqual(chestOpenCalls, [{ username: "ChestUser", chestType: "basic" }]);
    assert.equal(chestToastCalls.length, 1);
    assert.deepEqual(chestToastCalls[0], {
      rewards: { xp: 5, tokens: 0, cosmetic: null }
    });
    assert.equal(shownScreens.at(-2).context.basicChestVisualState.basicOpen, true);
    assert.equal(shownScreens.at(-1).name, "profile");
    assert.equal(shownScreens.at(-1).context.basicChestVisualState.basicOpen, false);
    assert.equal(shownScreens.at(-1).context.profile.chests.basic, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: opening a basic chest is a no-op when the profile has zero chests", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const chestOpenCalls = [];

  const profile = {
    username: "NoChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => profile,
          getCosmetics: async () => ({
            equipped: profile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            chestOpenCalls.push(payload);
            return {};
          }
        }
      }
    };

    app.username = "NoChestUser";

    await app.showProfile();
    const beforeCount = shownScreens.length;
    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.equal(chestOpenCalls.length, 0);
    assert.equal(shownScreens.length, beforeCount);
    assert.equal(shownScreens.at(-1).context.basicChestVisualState.basicOpen, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online profile chest opening uses multiplayer authority for epic chests", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const multiplayerOpenCalls = [];
  const localOpenCalls = [];
  const chestToastCalls = [];
  let serverProfileSnapshot = null;

  const onlineProfile = {
    username: "OnlineChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 200,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 0, milestone: 0, epic: 1, legendary: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" },
    ownedCosmetics: {}
  };
  const serverSnapshotBeforeOpen = {
    authority: "server",
    source: "multiplayer",
    profile: {
      ...onlineProfile
    },
    progression: {}
  };
  serverProfileSnapshot = serverSnapshotBeforeOpen;
  const openedSnapshot = {
    authority: "server",
    source: "multiplayer",
    profile: {
      ...onlineProfile,
      tokens: 280,
      playerXP: 30,
      chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
    },
    progression: {}
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload)
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            throw new Error("local profile path should not be used");
          },
          getCosmetics: async () => ({
            equipped: onlineProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            localOpenCalls.push(payload);
            return {};
          }
        },
        multiplayer: {
          getProfile: async () => serverProfileSnapshot,
          getCosmetics: async () => ({
            equipped: onlineProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          openChest: async (payload) => {
            multiplayerOpenCalls.push(payload);
            serverProfileSnapshot = openedSnapshot;
            return {
              chestType: "epic",
              consumed: 1,
              remaining: 0,
              rewards: { xp: 30, tokens: 80, cosmetic: null },
              snapshot: openedSnapshot
            };
          }
        }
      }
    };

    app.username = "OnlineChestUser";
    app.profile = onlineProfile;
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "OnlineChestUser",
        sessionId: "session-1",
        accountId: "account-1",
        profileKey: "OnlineChestUser",
        authenticated: true
      }
    });

    await app.showProfile();
    await shownScreens.at(-1).context.actions.openEpicChest();

    assert.deepEqual(multiplayerOpenCalls, [{ username: "OnlineChestUser", chestType: "epic" }]);
    assert.deepEqual(localOpenCalls, []);
    assert.equal(chestToastCalls.length, 1);
    assert.equal(shownScreens.at(-1).context.profile.chests.epic, 0);
    assert.equal(shownScreens.at(-2).context.basicChestVisualState.epicOpen, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: summary and turn flow update only after resolved hotseat round", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;

  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "HotseatUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };
  const resolutionCalls = [];

  try {
    globalThis.Audio = class {
      play() {
        return Promise.resolve();
      }
    };

    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };
    app.showSharedResolutionPopup = async (result, mode) => {
      resolutionCalls.push(app.buildResolutionPopupContent(result, mode));
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);
    await shownScreens.at(-1).context.actions.continue(); // P1 turn starts
    app.showPlayer1TurnPass = async () => {
      shownScreens.push({
        name: "pass",
        context: { message: "Player 1, Click When Ready", summary: null }
      });
    };

    await app.handleGameCardSelection(0); // P1 select
    let last = shownScreens.at(-1);
    assert.equal(last.name, "pass");
    assert.equal(last.context.message, "Player 2, Click When Ready");
    assert.equal(last.context.summary, null);

    await last.context.actions.continue(); // P2 turn starts
    await app.handleGameCardSelection(0); // P2 select

    assert.equal(resolutionCalls.length, 1);
    assert.match(resolutionCalls[0].message, /wins|No effect|WAR/);

    const afterResolvePass = shownScreens.at(-1);
    assert.equal(afterResolvePass.name, "pass");
    assert.equal(afterResolvePass.context.message, "Player 1, Click When Ready");
    assert.equal(afterResolvePass.context.summary, null);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
  }
});

test("gameController: captured totals track only actual captured transfers", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "CaptureAudit",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: { hand: ["fire", "water", "fire"], wonRounds: 0 },
        p2: { hand: ["earth", "earth", "water"], wonRounds: 0 }
      },
      currentPile: [],
      history: [],
      meta: { totalCards: 6 }
    };

    await controller.finalizeRound({ p1CardIndex: 0, p2CardIndex: 0 }); // fire vs earth => p1 captures 2
    assert.equal(controller.captured.p1, 1);

    await controller.finalizeRound({ p1CardIndex: 0, p2CardIndex: 0 }); // water vs earth => no effect
    assert.equal(controller.captured.p1, 1);
    assert.equal(controller.captured.p2, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: time-limit and quit do not fabricate captured cards", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "CaptureEndings",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.captured = { p1: 3, p2: 1 };
    await controller.finalizeByTimeLimit();
    assert.deepEqual(controller.captured, { p1: 3, p2: 1 });

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.match.status = "active";
    controller.completionNotified = false;
    controller.captured = { p1: 3, p2: 1 };
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });
    assert.deepEqual(controller.captured, { p1: 3, p2: 1 });
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});




test("appController: menu uses default background when profile has none", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "MenuBgUser";
  app.profile = { username: "MenuBgUser" };
  app.showMenu();

  const menu = shownScreens.at(-1);
  assert.equal(menu.name, "menu");
  assert.match(menu.context.backgroundImage, /EleMintzIcon\.png/);
});

test("appController: profile view falls back to default background when not equipped", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "ProfileBgUser";

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => ({ username: "ProfileBgUser", title: "Initiate", equippedCosmetics: {}, cosmetics: {}, achievements: {}, wins: 0, losses: 0, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } } }),
          getCosmetics: async () => ({ equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: "default_element_cards", badge: "none", title: "Initiate" }, catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_element_cards", name: "Default", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] } }),
          listProfiles: async () => []
        }
      }
    };

    await app.showProfile();
    const profile = shownScreens.at(-1);
    assert.equal(profile.name, "profile");
    assert.match(profile.context.backgroundImage, /EleMintzIcon\.png/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: equipped background is used on menu, profile, and game screens", async () => {
  const originalWindow = globalThis.window;
  const shown = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "BgEverywhere";
  app.profile = {
    username: "BgEverywhere",
    title: "Initiate",
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "wind_background",
      cardBack: "default_card_back",
      badge: "none",
      title: "Initiate",
      elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }
    },
    cosmetics: { background: "wind_background" }
  };

  app.showMenu();
  assert.equal(shown.at(-1).name, "menu");
  assert.match(shown.at(-1).context.backgroundImage, /windBattleArena\.png/);

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => app.profile,
          getCosmetics: async () => ({
            equipped: app.profile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }, { id: "wind_background", name: "Wind", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          listProfiles: async () => []
        }
      }
    };

    await app.showProfile();
    assert.equal(shown.at(-1).name, "profile");
    assert.match(shown.at(-1).context.backgroundImage, /windBattleArena\.png/);
  } finally {
    globalThis.window = originalWindow;
  }

  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: "pve",
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();
  assert.equal(shown.at(-1).name, "game");
  assert.match(shown.at(-1).context.arenaBackground, /windBattleArena\.png/);
});

test("appController: background change is reflected immediately across screens", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "BgSwap";
  app.profile = { username: "BgSwap", equippedCosmetics: { background: "default_background" } };

  app.showMenu();
  assert.match(shown.at(-1).context.backgroundImage, /EleMintzIcon\.png/);

  app.profile = { username: "BgSwap", equippedCosmetics: { background: "wind_background" } };
  app.showMenu();
  assert.match(shown.at(-1).context.backgroundImage, /windBattleArena\.png/);
});

test("appController: PvE quit shows warning and applies forfeit loss path", async () => {
  let lastModal = null;
  const quitCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: {
      show: (config) => {
        lastModal = config;
      },
      hide: () => {}
    },
    toastManager: { showAchievement: () => {} }
  });

  app.gameController = {
    getViewModel: () => ({ status: "active", mode: MATCH_MODE.PVE }),
    quitMatch: async (payload) => {
      quitCalls.push(payload);
    }
  };

  await app.quitCurrentMatch();
  assert.match(lastModal.body, /Quitting gives you a loss and no achievements will be awarded for this match\./);

  await lastModal.actions[0].onClick();
  assert.deepEqual(quitCalls, [{ quitter: "p1", reason: "quit_forfeit" }]);
});

test("appController: local quit requires approval and enforces 30s cooldown", async () => {
  let lastModal = null;
  const quitCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: {
      show: (config) => {
        lastModal = config;
      },
      hide: () => {}
    },
    toastManager: { showAchievement: () => {} }
  });

  app.localPlayers = { p1: "Alice", p2: "Bob" };
  app.gameController = {
    getViewModel: () => ({ status: "active", mode: MATCH_MODE.LOCAL_PVP, hotseatTurn: "p1" }),
    quitMatch: async (payload) => {
      quitCalls.push(payload);
    }
  };

  await app.quitCurrentMatch();
  assert.match(lastModal.body, /Both players must agree to quit\./);
  await lastModal.actions[1].onClick();
  assert.equal(quitCalls.length, 0);

  await app.quitCurrentMatch();
  assert.equal(lastModal.title, "Quit Cooldown");

  app.localQuitLastRequestAt = Date.now() - 31000;
  await app.quitCurrentMatch();
  await lastModal.actions[0].onClick();

  assert.deepEqual(quitCalls, [{ quitter: "both", reason: "quit_forfeit" }]);
});

test("appController: pass screen Enter key triggers continue and cleans key listener", async () => {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  let continueCalls = 0;
  let prevented = false;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type, handler) => {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };

    const pending = app.showPassScreen({
      message: "Player 1, Click When Ready",
      includeSummary: false,
      onContinue: async () => {
        continueCalls += 1;
      },
      onTimeout: async () => {}
    });

    const keyHandler = listeners.get("keydown");
    assert.equal(typeof keyHandler, "function");

    await keyHandler({ key: "x", preventDefault: () => { prevented = true; } });
    assert.equal(continueCalls, 0);

    await keyHandler({ key: "Enter", preventDefault: () => { prevented = true; } });
    await pending;
    assert.equal(prevented, true);
    assert.equal(continueCalls, 1);
    assert.equal(listeners.has("keydown"), false);
    assert.equal(app.passKeyHandler, null);
  } finally {
    app.clearPassTimer();
    globalThis.document = originalDocument;
  }
});

test("appController: pass screen countdown uses configured timer seconds for ready prompts", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 12 }, ui: { reducedMotion: true } };

  try {
    globalThis.window = { elemintz: { state: {} } };
    const pending = app.showPlayer1TurnPass(false);
    assert.equal(shownScreens.at(-1).context.secondsLeft, 12);
    app.clearPassTimer();
    await pending;
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("appController: resolution popup content reflects WAR continuation without stale capture text", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const content = app.buildResolutionPopupContent(
    {
      status: "war_continues",
      war: {
        pileSize: 6,
        clashes: 2
      }
    },
    MATCH_MODE.LOCAL_PVP
  );

  assert.equal(content.message, "WAR continues");
  assert.match(content.summary, /No cards were captured/);
  assert.match(content.summary, /6 card\(s\)/);
});

test("appController: shared resolution popup uses 3-second skippable pass screen", async () => {
  let captured = null;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.showPassScreen = async (options) => {
    captured = options;
  };

  await app.showSharedResolutionPopup(
    { status: "round_resolved", round: { result: "p1", warClashes: 0, capturedOpponentCards: 1 } },
    MATCH_MODE.PVE
  );

  assert.equal(captured.secondsLeft, 3);
  assert.equal(captured.showContinueButton, true);
  assert.equal(captured.allowEnter, true);
  assert.equal(typeof captured.onContinue, "function");
});

test("appController: local hotseat waits for shared resolution popup before re-entering the next selectable turn", async () => {
  let releaseResolution;
  let enterCalls = 0;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.enterHotseatTurn = () => {
    enterCalls += 1;
  };
  app.showSharedResolutionPopup = () =>
    new Promise((resolve) => {
      releaseResolution = resolve;
    });
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    getViewModel: () => ({ status: "active", warActive: false }),
    confirmHotseatRound: async () => ({
      status: "round_resolved",
      round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
      revealedCards: { p1Card: "fire", p2Card: "earth" }
    })
  };
  app.sound = { playReveal: () => {}, play: () => {} };

  const pending = app.presentHotseatResolution();
  await Promise.resolve();
  assert.equal(enterCalls, 0);

  releaseResolution();
  await pending;
  assert.equal(enterCalls, 1);
});

test("appController: local hotseat resolved round returns directly to game instead of leaving screenFlow on pass", async () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showSharedResolutionPopup = async () => {};
  app.sound = { playReveal: () => {}, play: () => {} };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resetTimer: () => {},
    resumeLocalTurnTimer: () => {},
    rearmActiveRoundPresentation: () => {},
    getViewModel: () => ({
      status: "active",
      warActive: false,
      mode: MATCH_MODE.LOCAL_PVP,
      canSelectCard: true,
      hotseatTurn: "p1",
      hotseatPending: false,
      round: 1,
      roundResult: "Choose a card to begin the next clash.",
      lastRound: null
    }),
    confirmHotseatRound: async () => ({
      status: "round_resolved",
      round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
      revealedCards: { p1Card: "fire", p2Card: "earth" }
    })
  };

  await app.presentHotseatResolution();

  assert.equal(app.screenFlow, "game");
  assert.deepEqual(app.roundPresentation, {
    phase: "idle",
    busy: false,
    selectedCardIndex: null
  });
});

test("appController: local hotseat WAR continuation clears the busy lock if popup flow is interrupted", async () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.showPlayer1TurnPass = async () => {};
  app.showSharedResolutionPopup = async () => {
    throw new Error("popup interrupted");
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    getViewModel: () => ({ status: "active", warActive: true }),
    confirmHotseatRound: async () => ({
      status: "war_continues",
      war: { clashes: 1, pileSize: 2, pileSizes: [2] },
      revealedCards: { p1Card: "fire", p2Card: "fire" }
    })
  };
  app.sound = { playReveal: () => {}, play: () => {} };

  await assert.rejects(() => app.presentHotseatResolution(), /popup interrupted/);
  assert.deepEqual(app.roundPresentation, {
    phase: "idle",
    busy: false,
    selectedCardIndex: null
  });
});

test("appController: PvE match-complete modal waits for shared resolution popup to finish", async () => {
  let releaseResolution;
  let flushCalls = 0;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.flushPendingMatchCompleteModal = () => {
    flushCalls += 1;
  };
  app.waitForRevealSoundSpacing = async () => {};
  app.showSharedResolutionPopup = () =>
    new Promise((resolve) => {
      releaseResolution = resolve;
    });
  app.gameController = {
    stopTimer: () => {},
    playCard: async () => ({
      status: "resolved",
      round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
      revealedCards: { p1Card: "fire", p2Card: "earth" }
    }),
    getViewModel: () => ({ status: "completed", warActive: false })
  };
  app.sound = { playReveal: () => {}, play: () => {} };

  const pending = app.presentPveRound(0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(flushCalls, 0);
  assert.equal(typeof releaseResolution, "function");

  releaseResolution();
  await pending;
  assert.equal(flushCalls, 1);
});

test("appController: PvE WAR continuation clears the busy lock if popup flow is interrupted", async () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.waitForRevealSoundSpacing = async () => {};
  app.showSharedResolutionPopup = async () => {
    throw new Error("popup interrupted");
  };
  app.gameController = {
    stopTimer: () => {},
    playCard: async () => ({
      status: "war_continues",
      war: { clashes: 1, pileSize: 2, pileSizes: [2] },
      revealedCards: { p1Card: "fire", p2Card: "fire" }
    }),
    getViewModel: () => ({ status: "active", warActive: true })
  };
  app.sound = { playReveal: () => {}, play: () => {}, playRoundResolved: () => {} };

  await assert.rejects(() => app.presentPveRound(0), /popup interrupted/);
  assert.deepEqual(app.roundPresentation, {
    phase: "idle",
    busy: false,
    selectedCardIndex: null
  });
});

test("appController: PvE round plays player reveal sound before popup and outcome sound on popup mount", async () => {
  const order = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {
    order.push("showGame");
  };
  app.waitForRevealSoundSpacing = async () => {
    order.push("wait");
  };
  app.showSharedResolutionPopup = async (_result, _mode, options) => {
    order.push("popup");
    await options.onShown?.();
  };
  app.gameController = {
    stopTimer: () => {},
    playCard: async () => {
      app.deferredPveRoundSound = {
        result: "p1",
        p1Card: "fire",
        p2Card: "earth",
        warClashes: 0,
        capturedOpponentCards: 1
      };
      return {
        status: "resolved",
        round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
        revealedCards: { p1Card: "fire", p2Card: "earth" }
      };
    },
    getViewModel: () => ({ status: "active", warActive: false })
  };
  app.sound = {
    playReveal: (payload) => {
      order.push(`reveal:${payload.cards.join(",")}`);
      return true;
    },
    play: () => {},
    playRoundResolved: () => {
      order.push("outcome");
    }
  };

  await app.presentPveRound(0);

  assert.deepEqual(order, [
    "showGame",
    "showGame",
    "reveal:fire",
    "wait",
    "popup",
    "outcome",
    "showGame"
  ]);
});

test("gameController: PvE WAR requires additional player choices while AI auto-selects", async () => {
  const originalWindow = globalThis.window;
  let submitCount = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 1, earth: 1, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 1, wind: 1 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const warRoomTwo = createAuthoritativeLocalRoom({
    roundNumber: 3,
    hostHand: { fire: 0, water: 1, earth: 1, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 1 },
    warActive: true,
    warRounds: [
      { round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" },
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["fire", "water"], guest: ["fire", "water"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 4,
    hostHand: { fire: 4, water: 0, earth: 1, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 1 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 3,
        hostMove: "earth",
        guestMove: "wind",
        outcomeType: "war_resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "PveWarUser",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    aiDifficulty: "normal",
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => {
          submitCount += 1;
          if (submitCount === 1) {
            return {
              ok: true,
              room: warRoom,
              roundResult: {
                round: 1,
                hostMove: "fire",
                guestMove: "fire",
                outcomeType: "war",
                hostResult: "war",
                guestResult: "war",
                warRounds: [{ round: 1, outcomeType: "war" }],
                warPot: { host: ["fire"], guest: ["fire"] }
              }
            };
          }

          if (submitCount === 2) {
            return {
              ok: true,
              room: warRoomTwo,
              roundResult: {
                round: 2,
                hostMove: "water",
                guestMove: "water",
                outcomeType: "war",
                hostResult: "war",
                guestResult: "war",
                warRounds: [{ round: 1, outcomeType: "war" }, { round: 2, outcomeType: "war" }],
                warPot: { host: ["fire", "water"], guest: ["fire", "water"] }
              }
            };
          }

          return {
            ok: true,
            room: resolvedRoom,
            roundResult: {
              round: 3,
              hostMove: "earth",
              guestMove: "wind",
              outcomeType: "war_resolved",
              hostResult: "win",
              guestResult: "lose",
              warRounds: [
                { round: 1, outcomeType: "war" },
                { round: 2, outcomeType: "war" },
                { round: 3, outcomeType: "war_resolved" }
              ],
              warPot: { host: [], guest: [] }
            }
          };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.startNewMatch();

    const first = await controller.playCard(0);
    assert.equal(first.status, "war_continues");
    assert.equal(controller.match.war.active, true);
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 2);

    const second = await controller.playCard(0);
    assert.equal(second.status, "war_continues");
    assert.equal(controller.match.war.active, true);
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 4);

    const third = await controller.playCard(0);
    assert.equal(third.status, "resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.lastRound.p2Card, "wind");
    assert.equal(controller.lastRound.capturedCards, 6);
    assert.equal(controller.match.war.active, false);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: rearming an active local WAR clears stale cards while preserving authoritative WAR continuation text", () => {
  const controller = new GameController({
    username: "WarResetUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      status: "active",
      war: { active: true, clashes: 1, pendingClashes: 1, pendingPileSizes: [2] }
    };
    controller.lastRound = {
      round: 1,
      p1Card: "fire",
      p2Card: "fire",
      result: "none",
      warClashes: 1,
      capturedOpponentCards: 0
    };
    controller.roundResultText = "WAR triggered";

    controller.rearmActiveRoundPresentation();

    assert.equal(controller.lastRound, null);
    assert.equal(controller.roundResultText, "WAR continues. Choose new cards for the next clash.");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local authoritative history uses stored per-card capture values", () => {
  const controller = new GameController({
    username: "LocalCaptureTruth",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    controller.syncLocalAuthorityState(
      createAuthoritativeLocalRoom({
        roundNumber: 4,
        winner: "host",
        roundHistory: [
          {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war",
            hostResult: "war",
            guestResult: "war",
            capturedCards: 0,
            capturedOpponentCards: 0
          },
          {
            round: 2,
            hostMove: "water",
            guestMove: "water",
            outcomeType: "no_effect",
            hostResult: "no_effect",
            guestResult: "no_effect",
            capturedCards: 0,
            capturedOpponentCards: 0
          },
          {
            round: 3,
            hostMove: "earth",
            guestMove: "wind",
            outcomeType: "war_resolved",
            hostResult: "win",
            guestResult: "lose",
            capturedCards: 6,
            capturedOpponentCards: 3
          }
        ]
      }),
      null
    );

    assert.deepEqual(controller.match.history, [
      {
        result: "p1",
        warClashes: 3,
        capturedCards: 6,
        capturedOpponentCards: 3,
        p1Card: "fire",
        p2Card: "fire"
      }
    ]);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: PvE time-limit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "host",
    winReason: "time_limit",
    roundNumber: 3,
    hostHand: { fire: 3, water: 1, earth: 1, wind: 1 },
    guestHand: { fire: 0, water: 1, earth: 0, wind: 0 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "PveTimeLimitAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        completeMatchByCardCount: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.finalizeByTimeLimit();

    assert.deepEqual(completionCalls, [{ reason: "time_limit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p1");
    assert.equal(controller.match.endReason, "time_limit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE quit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "guest",
    winReason: "quit_forfeit",
    roundNumber: 2,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
  });

  const controller = new GameController({
    username: "PveQuitAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        completeMatch: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });

    assert.deepEqual(completionCalls, [{ winner: "guest", reason: "quit_forfeit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "quit_forfeit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE authoritative restart resets to a fresh room-backed state", async () => {
  const originalWindow = globalThis.window;
  const createdRooms = [];
  const roomA = createAuthoritativeLocalRoom({
    roomCode: "PVE111",
    roundNumber: 4,
    hostHand: { fire: 5, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 1, earth: 1, wind: 1 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });
  const roomB = createAuthoritativeLocalRoom({
    roomCode: "PVE222",
    roundNumber: 1,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    roundHistory: []
  });

  const controller = new GameController({
    username: "PveRestartAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        createRoom: () => {
          const room = createdRooms.length === 0 ? roomA : roomB;
          createdRooms.push(room.roomCode);
          return { ok: true, room };
        },
        joinRoom: () => {
          const room = createdRooms.length === 1 ? roomA : roomB;
          return {
            ok: true,
            room: {
              ...room,
              guest: {
                username: "EleMintz AI",
                bot: true,
                aiDifficulty: "normal"
              }
            }
          };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    assert.equal(controller.match.id, "PVE111:match:1");
    assert.equal(controller.match.round, 3);
    assert.ok(controller.match.history.length > 0);

    controller.startNewMatch();
    assert.deepEqual(createdRooms, ["PVE111", "PVE222"]);
    assert.equal(controller.match.id, "PVE222:match:1");
    assert.equal(controller.match.round, 0);
    assert.deepEqual(controller.match.history, []);
    assert.equal(controller.match.players.p1.hand.length, 8);
    assert.equal(controller.match.players.p2.hand.length, 8);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE captured totals ignore unresolved WAR pile stake", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "CapturePileUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: { hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire"], wonRounds: 0 },
        p2: { hand: ["fire", "water", "earth", "wind", "fire", "water", "earth"], wonRounds: 0 }
      },
      currentPile: ["fire", "fire", "water", "earth"],
      meta: { totalCards: 16 },
      history: []
    };

    controller.recalculateCapturedTotals();
    assert.equal(controller.captured.p1, 0);
    assert.equal(controller.captured.p2, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE WAR resolves immediately on non-tie continuation reveal", async () => {
  const originalWindow = globalThis.window;
  let submitCount = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 1, earth: 0, wind: 0 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 2, water: 0, earth: 0, wind: 0 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 2,
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win"
      }
    ]
  });

  const controller = new GameController({
    username: "PveWarResolve",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => {
          submitCount += 1;
          return submitCount === 1
            ? {
                ok: true,
                room: warRoom,
                roundResult: {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war",
                  hostResult: "war",
                  guestResult: "war",
                  warRounds: [{ round: 1, outcomeType: "war" }],
                  warPot: { host: ["fire"], guest: ["fire"] }
                }
              }
            : {
                ok: true,
                room: resolvedRoom,
                roundResult: {
                  round: 2,
                  hostMove: "fire",
                  guestMove: "water",
                  outcomeType: "war_resolved",
                  hostResult: "lose",
                  guestResult: "win",
                  warRounds: [
                    { round: 1, outcomeType: "war" },
                    { round: 2, outcomeType: "war_resolved" }
                  ],
                  warPot: { host: [], guest: [] }
                }
              };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const first = await controller.playCard(0);
    assert.equal(first.status, "war_continues");
    assert.equal(controller.match.war.active, true);

    const second = await controller.playCard(0);
    assert.equal(second.status, "resolved");
    assert.equal(controller.lastRound.result, "p2");
    assert.equal(controller.match.war.active, false);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE simultaneous WAR exhaustion resolves immediately without waiting for timer", async () => {
  const originalWindow = globalThis.window;
  let submitCount = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 0, water: 1, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 1, wind: 0 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    matchComplete: true,
    winner: "draw",
    winReason: "hand_exhaustion",
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });

  const controller = new GameController({
    username: "PveWarExhaust",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => {
          submitCount += 1;
          return submitCount === 1
            ? {
                ok: true,
                room: warRoom,
                roundResult: {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war",
                  hostResult: "war",
                  guestResult: "war",
                  warRounds: [{ round: 1, outcomeType: "war" }],
                  warPot: { host: ["fire"], guest: ["fire"] }
                }
              }
            : {
                ok: true,
                room: resolvedRoom,
                roundResult: {
                  round: 1,
                  hostMove: "water",
                  guestMove: "earth",
                  outcomeType: "no_effect",
                  hostResult: "no_effect",
                  guestResult: "no_effect",
                  warRounds: [{ round: 1, outcomeType: "war" }],
                  warPot: { host: [], guest: [] }
                }
              };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const first = await controller.playCard(0);
    assert.equal(first.status, "war_continues");
    assert.equal(controller.match.status, "active");

    const second = await controller.playCard(0);
    assert.equal(second.status, "resolved");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "draw");
    assert.equal(controller.timerSeconds, 30);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

