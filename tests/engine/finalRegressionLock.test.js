import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildRoundResult,
  containRuntimeRoomState,
  createRoomStore,
  determineOutcome,
  getTotalCardsInHand,
  guardRuntimeHandState
} from "../../src/multiplayer/rooms.js";
import { guardRuntimeStatWritePayload, StateCoordinator } from "../../src/state/stateCoordinator.js";

const INITIAL_TOTAL_CARDS = 16;

function createStartedRoom() {
  const store = createRoomStore();
  const hostSocket = { id: "host-socket" };
  const guestSocket = { id: "guest-socket" };

  store.createRoom(hostSocket, { username: "Host" });
  const roomCode = store.getRoomCodeForSocket(hostSocket.id);
  store.joinRoom(guestSocket, roomCode, { username: "Guest" });

  return {
    store,
    roomCode,
    hostSocket,
    guestSocket
  };
}

function countTotalCards(room) {
  return (
    getTotalCardsInHand(room.hostHand) +
    getTotalCardsInHand(room.guestHand) +
    (Array.isArray(room.warPot?.host) ? room.warPot.host.length : 0) +
    (Array.isArray(room.warPot?.guest) ? room.warPot.guest.length : 0)
  );
}

function assertCleanFreshMatchState(room, label) {
  assert.equal(room.matchComplete, false, `${label}: matchComplete should be cleared`);
  assert.equal(room.winner, null, `${label}: winner should be cleared`);
  assert.equal(room.winReason, null, `${label}: winReason should be cleared`);
  assert.equal(room.hostScore, 0, `${label}: hostScore should reset`);
  assert.equal(room.guestScore, 0, `${label}: guestScore should reset`);
  assert.equal(room.roundNumber, 1, `${label}: roundNumber should reset`);
  assert.equal(room.warActive, false, `${label}: warActive should reset`);
  assert.equal(room.warDepth, 0, `${label}: warDepth should reset`);
  assert.deepEqual(room.warPot, { host: [], guest: [] }, `${label}: warPot should reset`);
  assert.deepEqual(room.warRounds, [], `${label}: warRounds should reset`);
  assert.deepEqual(room.roundHistory, [], `${label}: roundHistory should reset`);
  assert.deepEqual(
    room.moveSync,
    {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    },
    `${label}: moveSync should reset`
  );
  assert.equal(countTotalCards(room), INITIAL_TOTAL_CARDS, `${label}: total cards should reset cleanly`);
}

function buildStableRoomSummary(room) {
  return {
    matchComplete: room.matchComplete,
    winner: room.winner,
    winReason: room.winReason,
    hostScore: room.hostScore,
    guestScore: room.guestScore,
    roundNumber: room.roundNumber,
    lastOutcomeType: room.lastOutcomeType,
    hostHand: { ...room.hostHand },
    guestHand: { ...room.guestHand },
    warPot: {
      host: [...room.warPot.host],
      guest: [...room.warPot.guest]
    },
    warActive: room.warActive,
    warDepth: room.warDepth,
    warRounds: room.warRounds.map((entry) => ({ ...entry })),
    roundHistory: room.roundHistory.map((entry) => ({ ...entry })),
    moveSync: {
      hostSubmitted: room.moveSync?.hostSubmitted ?? false,
      guestSubmitted: room.moveSync?.guestSubmitted ?? false,
      submittedCount: room.moveSync?.submittedCount ?? 0,
      bothSubmitted: room.moveSync?.bothSubmitted ?? false
    }
  };
}

function createCompletedMatch({ mode = "pve", winner = "p1" } = {}) {
  return {
    status: "completed",
    endReason: null,
    winner,
    mode,
    round: 2,
    history: [
      { round: 1, result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 1, capturedOpponentCards: 1 },
      { round: 2, result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedOpponentCards: 1 }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };
}

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-final-regression-"));
}

function submitPair(store, roomCode, hostSocket, guestSocket, hostMove, guestMove, label) {
  const hostResult = store.submitMove(hostSocket.id, hostMove);
  const guestResult = store.submitMove(guestSocket.id, guestMove);

  assert.equal(hostResult.ok, true, `${label}: host submit should succeed`);
  assert.equal(guestResult.ok, true, `${label}: guest submit should succeed`);

  return {
    hostResult,
    guestResult,
    room: store.getRoom(roomCode)
  };
}

function runRuntimeGuardProbe() {
  const repairedHand = guardRuntimeHandState({
    fire: "2",
    water: -3,
    earth: null,
    wind: 1
  });
  assert.equal(repairedHand.repaired, true);
  assert.deepEqual(repairedHand.value, {
    fire: 2,
    water: 0,
    earth: 2,
    wind: 1
  });

  const room = {
    hostHand: { fire: "2", water: -2, earth: null, wind: 1 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    warActive: false,
    warDepth: 0,
    warRounds: [],
    warPot: { host: [], guest: [] },
    hostScore: 0,
    guestScore: 0,
    roundNumber: 1,
    moves: { hostMove: "bogus", guestMove: "earth", updatedAt: "stamp" }
  };

  const contained = containRuntimeRoomState(room, {
    logger: null,
    logMessage: "[RuntimeInvariant] contained malformed pre-round state"
  });
  assert.equal(contained.repaired, true);
  assert.deepEqual(room.moves, {
    hostMove: null,
    guestMove: "earth",
    updatedAt: "stamp"
  });

  const guardedStatWrite = guardRuntimeStatWritePayload({
    mode: "broken_mode",
    fallbackMode: "online_pvp",
    matchStats: {
      gamesPlayed: "1",
      wins: "1",
      losses: 0,
      warsEntered: "1",
      warsWon: "1",
      longestWar: "1",
      cardsCaptured: "2"
    }
  });
  assert.equal(guardedStatWrite.skipped, false);
  assert.equal(guardedStatWrite.mode, "online_pvp");

  return {
    repairedHand: repairedHand.value,
    guardedMode: guardedStatWrite.mode
  };
}

function runRoundOutcomeProbe() {
  const roundRoom = {
    roomCode: "ROUND-CHECK",
    roundNumber: 4,
    warActive: false,
    moves: {
      hostMove: "fire",
      guestMove: "earth"
    }
  };

  const deterministicOutcome = determineOutcome("fire", "earth");
  const roundResult = buildRoundResult(roundRoom);

  assert.deepEqual(deterministicOutcome, {
    hostResult: "win",
    guestResult: "lose"
  });
  assert.equal(roundResult.outcomeType, "resolved");
  assert.equal(roundResult.hostResult, "win");
  assert.equal(roundResult.guestResult, "lose");

  return {
    hostResult: roundResult.hostResult,
    guestResult: roundResult.guestResult,
    outcomeType: roundResult.outcomeType
  };
}

function runWarTransferProbe() {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  const firstRound = submitPair(store, roomCode, hostSocket, guestSocket, "fire", "fire", "war probe step 1");
  assert.equal(firstRound.guestResult.roundResult.outcomeType, "war");
  assert.equal(countTotalCards(firstRound.room), INITIAL_TOTAL_CARDS);

  const afterReset = store.resetRound(roomCode);
  assert.ok(afterReset);

  const resolvedRound = submitPair(
    store,
    roomCode,
    hostSocket,
    guestSocket,
    "water",
    "fire",
    "war probe step 2"
  );

  assert.equal(resolvedRound.guestResult.roundResult.outcomeType, "war_resolved");
  assert.equal(resolvedRound.room.warActive, false);
  assert.deepEqual(resolvedRound.room.warPot, { host: [], guest: [] });
  assert.equal(countTotalCards(resolvedRound.room), INITIAL_TOTAL_CARDS);

  return buildStableRoomSummary(resolvedRound.room);
}

function runRepeatedRoomCycles(sequence, cycles, label) {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();
  const summaries = [];

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let index = 0; index < sequence.length; index += 1) {
      const step = sequence[index];
      const isFinalStep = index === sequence.length - 1;
      const round = submitPair(
        store,
        roomCode,
        hostSocket,
        guestSocket,
        step.hostMove,
        step.guestMove,
        `${label} cycle ${cycle + 1} step ${index + 1}`
      );

      assert.equal(round.guestResult.roundResult.outcomeType, step.expectedOutcomeType);
      assert.equal(countTotalCards(round.room), INITIAL_TOTAL_CARDS);

      if (!isFinalStep) {
        const resetRoom = store.resetRound(roomCode);
        assert.ok(resetRoom, `${label}: reset should succeed`);
      }
    }

    const finalRoom = store.getRoom(roomCode);
    assert.equal(finalRoom.matchComplete, true, `${label}: final room should complete`);
    assert.equal(finalRoom.warActive, false, `${label}: no leftover warActive at match end`);
    summaries.push(buildStableRoomSummary(finalRoom));

    if (cycle < cycles - 1) {
      const hostReady = store.readyRematch(hostSocket.id);
      const guestReady = store.readyRematch(guestSocket.id);
      assert.equal(hostReady.ok, true);
      assert.equal(guestReady.ok, true);
      assert.equal(guestReady.rematchStarted, true, `${label}: rematch should start cleanly`);
      assertCleanFreshMatchState(guestReady.room, `${label} rematch ${cycle + 1}`);
    }
  }

  return summaries;
}

async function runResultBoundaryProbe() {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  try {
    const localResult = await state.recordMatchResult({
      username: "GroupedLocalUser",
      perspective: "p1",
      matchState: createCompletedMatch({ mode: "local_pvp", winner: "p1" })
    });
    const onlineResult = await state.recordOnlineMatchResult({
      username: "GroupedOnlineUser",
      perspective: "p1",
      settlementKey: "grouped-final-lock",
      matchState: createCompletedMatch({ mode: "online_pvp", winner: "p1" })
    });
    await state.recordOnlineMatchResult({
      username: "GroupedOnlineUser",
      perspective: "p1",
      settlementKey: "grouped-final-lock",
      matchState: createCompletedMatch({ mode: "online_pvp", winner: "p1" })
    });

    const localProfile = await state.profiles.getProfile("GroupedLocalUser");
    const onlineProfile = await state.profiles.getProfile("GroupedOnlineUser");
    const saves = await state.saves.listMatchResults();

    assert.equal(localProfile.modeStats.local_pvp.gamesPlayed, 1);
    assert.equal(localProfile.modeStats.online_pvp.gamesPlayed, 0);
    assert.equal(onlineProfile.modeStats.online_pvp.gamesPlayed, 1);
    assert.equal(onlineProfile.modeStats.local_pvp.gamesPlayed, 0);
    assert.equal(saves.filter((entry) => entry.username === "GroupedOnlineUser").length, 1);
    assert.equal(saves.filter((entry) => entry.username === "GroupedLocalUser").length, 1);

    return {
      localStats: localResult.stats,
      onlineStats: onlineResult.stats,
      localModeStats: localProfile.modeStats,
      onlineModeStats: onlineProfile.modeStats,
      onlineSaveCount: saves.filter((entry) => entry.username === "GroupedOnlineUser").length
    };
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

const DECISIVE_SEQUENCE = [
  { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
  { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
  { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
  { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
  { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
  { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
  { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
  { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
];

const MIXED_SEQUENCE = [
  { hostMove: "fire", guestMove: "wind", expectedOutcomeType: "no_effect" },
  { hostMove: "fire", guestMove: "fire", expectedOutcomeType: "war" },
  { hostMove: "water", guestMove: "fire", expectedOutcomeType: "war_resolved" },
  { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
  { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
  { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
  { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
  { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
  { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
];

function normalizeGroupedSummary(summary) {
  return JSON.parse(JSON.stringify(summary));
}

async function runGroupedValidationFlow(order = ["runtime", "round", "war", "replay", "result"]) {
  const outputs = {};

  for (const step of order) {
    if (step === "runtime") {
      outputs.runtime = runRuntimeGuardProbe();
      continue;
    }

    if (step === "round") {
      outputs.round = runRoundOutcomeProbe();
      continue;
    }

    if (step === "war") {
      outputs.war = runWarTransferProbe();
      continue;
    }

    if (step === "replay") {
      outputs.replay = runRepeatedRoomCycles(MIXED_SEQUENCE, 2, "grouped mixed replay");
      continue;
    }

    if (step === "result") {
      outputs.result = await runResultBoundaryProbe();
    }
  }

  return normalizeGroupedSummary(outputs);
}

test("final regression lock: grouped core validation flow remains stable", async () => {
  const groupedSummary = await runGroupedValidationFlow();

  assert.equal(groupedSummary.runtime.guardedMode, "online_pvp");
  assert.equal(groupedSummary.round.outcomeType, "resolved");
  assert.equal(groupedSummary.war.warActive, false);
  assert.equal(groupedSummary.replay.length, 2);
  assert.equal(groupedSummary.result.onlineSaveCount, 1);
});

test("final regression lock: grouped flow is order-independent at the final summary level", async () => {
  const first = await runGroupedValidationFlow(["runtime", "round", "war", "replay", "result"]);
  const second = await runGroupedValidationFlow(["replay", "war", "runtime", "result", "round"]);

  assert.deepEqual(second, first);
});

test("final regression lock: repeated grouped execution produces identical final results", async () => {
  const first = await runGroupedValidationFlow();
  const second = await runGroupedValidationFlow();

  assert.deepEqual(second, first);
});

test("final regression lock: no residual transient state remains after grouped execution", () => {
  const summaries = runRepeatedRoomCycles(MIXED_SEQUENCE, 2, "residual-state check");

  assert.equal(summaries.length, 2);
  for (const [index, summary] of summaries.entries()) {
    assert.equal(summary.warActive, false, `summary ${index + 1}: no warActive residual`);
    assert.equal(summary.warDepth, 0, `summary ${index + 1}: no warDepth residual`);
    assert.deepEqual(summary.warPot, { host: [], guest: [] }, `summary ${index + 1}: no warPot residual`);
    assert.deepEqual(summary.warRounds, [], `summary ${index + 1}: no warRounds residual`);
    assert.deepEqual(
      summary.moveSync,
      {
        hostSubmitted: true,
        guestSubmitted: true,
        submittedCount: 2,
        bothSubmitted: true
      },
      `summary ${index + 1}: final completed match sync state remains valid`
    );
    assert.equal(
      getTotalCardsInHand(summary.hostHand) + getTotalCardsInHand(summary.guestHand),
      INITIAL_TOTAL_CARDS,
      `summary ${index + 1}: no card loss after grouped execution`
    );
  }
});

test("final regression lock: result and stat boundaries remain clean after grouped execution", async () => {
  const resultSummary = await runResultBoundaryProbe();

  assert.equal(resultSummary.localStats.gamesPlayed, 1);
  assert.equal(resultSummary.localStats.wins, 1);
  assert.equal(resultSummary.onlineStats.gamesPlayed, 1);
  assert.equal(resultSummary.onlineStats.wins, 1);
  assert.equal(resultSummary.onlineModeStats.local_pvp.gamesPlayed, 0);
  assert.equal(resultSummary.onlineModeStats.online_pvp.gamesPlayed, 1);
  assert.equal(resultSummary.localModeStats.local_pvp.gamesPlayed, 1);
  assert.equal(resultSummary.localModeStats.online_pvp.gamesPlayed, 0);
  assert.equal(resultSummary.onlineSaveCount, 1);
});
