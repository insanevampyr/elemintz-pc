import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRoomStore, getTotalCardsInHand } from "../../src/multiplayer/rooms.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

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

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-production-confidence-"));
}

function countTotalCards(room) {
  return (
    getTotalCardsInHand(room.hostHand) +
    getTotalCardsInHand(room.guestHand) +
    (Array.isArray(room.warPot?.host) ? room.warPot.host.length : 0) +
    (Array.isArray(room.warPot?.guest) ? room.warPot.guest.length : 0)
  );
}

function assertCleanRoomState(room, label) {
  assert.equal(countTotalCards(room), INITIAL_TOTAL_CARDS, `${label}: total cards remain conserved`);
  assert.equal(room.warActive, false, `${label}: no leftover warActive`);
  assert.equal(room.warDepth, 0, `${label}: no leftover warDepth`);
  assert.deepEqual(room.warPot, { host: [], guest: [] }, `${label}: no leftover war pot`);
  assert.deepEqual(room.warRounds, [], `${label}: no leftover war rounds`);
  assert.deepEqual(
    room.moveSync,
    {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    },
    `${label}: no leftover pending move state`
  );
}

function buildReplaySummary(room) {
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
    roundHistory: room.roundHistory.map((entry) => ({ ...entry })),
    warPot: {
      host: [...room.warPot.host],
      guest: [...room.warPot.guest]
    },
    warActive: room.warActive,
    warDepth: room.warDepth,
    warRounds: room.warRounds.map((entry) => ({ ...entry })),
    moveSync: {
      hostSubmitted: room.moveSync?.hostSubmitted ?? false,
      guestSubmitted: room.moveSync?.guestSubmitted ?? false,
      submittedCount: room.moveSync?.submittedCount ?? 0,
      bothSubmitted: room.moveSync?.bothSubmitted ?? false
    }
  };
}

function playMatchOnStore({ store, roomCode, hostSocket, guestSocket, sequence, label }) {
  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index];
    const isFinalStep = index === sequence.length - 1;

    const hostResult = store.submitMove(hostSocket.id, step.hostMove);
    const guestResult = store.submitMove(guestSocket.id, step.guestMove);

    assert.equal(hostResult.ok, true, `${label}: host submit succeeds at step ${index + 1}`);
    assert.equal(guestResult.ok, true, `${label}: guest submit succeeds at step ${index + 1}`);

    const room = store.getRoom(roomCode);
    assert.ok(guestResult.roundResult, `${label}: round result exists at step ${index + 1}`);
    assert.equal(
      guestResult.roundResult.outcomeType,
      step.expectedOutcomeType,
      `${label}: expected outcome at step ${index + 1}`
    );
    assert.equal(countTotalCards(room), INITIAL_TOTAL_CARDS, `${label}: conservation at step ${index + 1}`);

    if (isFinalStep) {
      assert.equal(room.matchComplete, true, `${label}: final step completes match`);
      assert.equal(guestResult.roundResult.matchComplete, true, `${label}: final payload marks complete`);
    } else {
      assert.equal(room.matchComplete, false, `${label}: no premature completion at step ${index + 1}`);
      const resetRoom = store.resetRound(roomCode);
      assert.ok(resetRoom, `${label}: reset succeeds at step ${index + 1}`);
    }
  }

  const finalRoom = store.getRoom(roomCode);
  assert.equal(finalRoom.matchComplete, true, `${label}: final room remains complete`);
  assert.equal(countTotalCards(finalRoom), INITIAL_TOTAL_CARDS, `${label}: final conservation`);
  assert.equal(finalRoom.warActive, false, `${label}: no war leak at completion`);
  assert.deepEqual(finalRoom.warPot, { host: [], guest: [] }, `${label}: no war pot leak at completion`);
  assert.deepEqual(finalRoom.warRounds, [], `${label}: no war rounds leak at completion`);

  return buildReplaySummary(finalRoom);
}

function readyRematchPair(store, hostSocket, guestSocket, label) {
  const hostReady = store.readyRematch(hostSocket.id);
  assert.equal(hostReady.ok, true, `${label}: host rematch ready succeeds`);
  assert.equal(hostReady.rematchStarted, false, `${label}: host ready alone does not start rematch`);

  const guestReady = store.readyRematch(guestSocket.id);
  assert.equal(guestReady.ok, true, `${label}: guest rematch ready succeeds`);
  assert.equal(guestReady.rematchStarted, true, `${label}: guest ready starts rematch`);

  return guestReady.room;
}

function runRepeatedMatchCycle({ sequence, cycles = 3, label }) {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();
  const summaries = [];

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const summary = playMatchOnStore({
      store,
      roomCode,
      hostSocket,
      guestSocket,
      sequence,
      label: `${label} cycle ${cycle + 1}`
    });
    summaries.push(summary);

    if (cycle < cycles - 1) {
      const rematchRoom = readyRematchPair(store, hostSocket, guestSocket, `${label} cycle ${cycle + 1}`);
      assertCleanRoomState(rematchRoom, `${label} rematch ${cycle + 1}`);
      assert.equal(rematchRoom.matchComplete, false, `${label}: rematch clears completion`);
      assert.equal(rematchRoom.winner, null, `${label}: rematch clears winner`);
      assert.equal(rematchRoom.winReason, null, `${label}: rematch clears win reason`);
      assert.equal(rematchRoom.hostScore, 0, `${label}: rematch clears host score`);
      assert.equal(rematchRoom.guestScore, 0, `${label}: rematch clears guest score`);
      assert.equal(rematchRoom.roundNumber, 1, `${label}: rematch resets round number`);
      assert.deepEqual(rematchRoom.roundHistory, [], `${label}: rematch clears round history`);
    }
  }

  return summaries;
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

const REPLAY_SCENARIOS = {
  decisive: [
    { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
    { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
    { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
    { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
    { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
    { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
    { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
    { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
  ],
  war: [
    { hostMove: "fire", guestMove: "fire", expectedOutcomeType: "war" },
    { hostMove: "water", guestMove: "fire", expectedOutcomeType: "war_resolved" },
    { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
    { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
    { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
    { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
    { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
    { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
  ],
  mixed: [
    { hostMove: "fire", guestMove: "wind", expectedOutcomeType: "no_effect" },
    { hostMove: "fire", guestMove: "fire", expectedOutcomeType: "war" },
    { hostMove: "water", guestMove: "fire", expectedOutcomeType: "war_resolved" },
    { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
    { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
    { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
    { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
    { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
    { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
  ]
};

test("production confidence: repeated decisive match cycles remain clean", () => {
  const summaries = runRepeatedMatchCycle({
    sequence: REPLAY_SCENARIOS.decisive,
    cycles: 3,
    label: "decisive repeated flow"
  });

  assert.equal(summaries.length, 3);
  assert.deepEqual(summaries[1], summaries[0]);
  assert.deepEqual(summaries[2], summaries[0]);
});

test("production confidence: repeated WAR match cycles remain clean", () => {
  const summaries = runRepeatedMatchCycle({
    sequence: REPLAY_SCENARIOS.war,
    cycles: 3,
    label: "war repeated flow"
  });

  assert.equal(summaries.length, 3);
  assert.deepEqual(summaries[1], summaries[0]);
  assert.deepEqual(summaries[2], summaries[0]);
});

test("production confidence: repeated mixed match cycles remain clean", () => {
  const summaries = runRepeatedMatchCycle({
    sequence: REPLAY_SCENARIOS.mixed,
    cycles: 3,
    label: "mixed repeated flow"
  });

  assert.equal(summaries.length, 3);
  assert.deepEqual(summaries[1], summaries[0]);
  assert.deepEqual(summaries[2], summaries[0]);
});

test("production confidence: no cross-match transient leakage blocks a rematch in the same room", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  playMatchOnStore({
    store,
    roomCode,
    hostSocket,
    guestSocket,
    sequence: REPLAY_SCENARIOS.war,
    label: "same-room rematch baseline"
  });

  const rematchRoom = readyRematchPair(store, hostSocket, guestSocket, "same-room rematch");
  assertCleanRoomState(rematchRoom, "same-room rematch reset");

  const firstStepHost = store.submitMove(hostSocket.id, "fire");
  const firstStepGuest = store.submitMove(guestSocket.id, "earth");
  assert.equal(firstStepHost.ok, true);
  assert.equal(firstStepGuest.ok, true);
  assert.equal(firstStepGuest.roundResult.round, 1);
  assert.equal(firstStepGuest.roundResult.outcomeType, "resolved");
});

test("production confidence: repeated identical mixed cycles produce identical final summaries", () => {
  const firstRun = runRepeatedMatchCycle({
    sequence: REPLAY_SCENARIOS.mixed,
    cycles: 2,
    label: "deterministic mixed cycle A"
  });
  const secondRun = runRepeatedMatchCycle({
    sequence: REPLAY_SCENARIOS.mixed,
    cycles: 2,
    label: "deterministic mixed cycle B"
  });

  assert.deepEqual(secondRun, firstRun);
});

test("production confidence: local and online result boundaries stay consistent for equivalent resolved payloads", async (t) => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const localResult = await state.recordMatchResult({
    username: "LocalBoundaryUser",
    perspective: "p1",
    matchState: createCompletedMatch({ mode: "local_pvp", winner: "p1" })
  });
  const onlineResult = await state.recordOnlineMatchResult({
    username: "OnlineBoundaryUser",
    perspective: "p1",
    settlementKey: "confidence-sweep-settlement",
    matchState: createCompletedMatch({ mode: "online_pvp", winner: "p1" })
  });
  const duplicateOnlineResult = await state.recordOnlineMatchResult({
    username: "OnlineBoundaryUser",
    perspective: "p1",
    settlementKey: "confidence-sweep-settlement",
    matchState: createCompletedMatch({ mode: "online_pvp", winner: "p1" })
  });

  const localProfile = await state.profiles.getProfile("LocalBoundaryUser");
  const onlineProfile = await state.profiles.getProfile("OnlineBoundaryUser");
  const saves = await state.saves.listMatchResults();

  assert.equal(localResult.stats.gamesPlayed, 1);
  assert.equal(localResult.stats.wins, 1);
  assert.equal(onlineResult.stats.gamesPlayed, 1);
  assert.equal(onlineResult.stats.wins, 1);
  assert.equal(onlineResult.stats.losses, 0);
  assert.equal(onlineResult.stats.warsEntered, 1);
  assert.equal(onlineResult.stats.warsWon, 1);
  assert.equal(onlineResult.stats.cardsCaptured, 2);
  assert.equal(localProfile.modeStats.local_pvp.gamesPlayed, 1);
  assert.equal(localProfile.modeStats.online_pvp.gamesPlayed, 0);
  assert.equal(onlineProfile.modeStats.online_pvp.gamesPlayed, 1);
  assert.equal(onlineProfile.modeStats.local_pvp.gamesPlayed, 0);
  assert.equal(duplicateOnlineResult.stats.gamesPlayed, 1);
  assert.equal(onlineProfile.gamesPlayed, 1);
  assert.equal(saves.filter((entry) => entry.username === "OnlineBoundaryUser").length, 1);
  assert.equal(saves.filter((entry) => entry.username === "LocalBoundaryUser").length, 1);
});
