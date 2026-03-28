import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";
import {
  applyRoundToMatchState,
  containRuntimeMatchSummaryState,
  containRuntimeRoomState,
  createRoomStore,
  guardRuntimeHandState,
  guardRuntimeMatchResultPayload,
  guardRuntimeRoundPayload,
  guardRuntimeWarState
} from "../../src/multiplayer/rooms.js";
import { guardRuntimeStatWritePayload, StateCoordinator } from "../../src/state/stateCoordinator.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-runtime-guards-"));
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

test("runtime guard: multiplayer health reports phase 22", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} }
  });

  try {
    const port = await foundation.start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.phase, 22);
  } finally {
    await foundation.stop();
  }
});

test("runtime guard: malformed hand is repaired before round processing", () => {
  const repaired = guardRuntimeHandState({
    fire: "2",
    water: -3,
    earth: null,
    wind: 1
  });

  assert.equal(repaired.repaired, true);
  assert.deepEqual(repaired.value, {
    fire: 2,
    water: 0,
    earth: 2,
    wind: 1
  });
});

test("runtime invariant: malformed pre-round state is contained safely", () => {
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
    moves: { hostMove: "bogus", guestMove: "earth", updatedAt: "now" }
  };

  const contained = containRuntimeRoomState(room, {
    logger: null,
    logMessage: "[RuntimeInvariant] contained malformed pre-round state"
  });

  assert.equal(contained.repaired, true);
  assert.deepEqual(room.hostHand, {
    fire: 2,
    water: 0,
    earth: 2,
    wind: 1
  });
  assert.deepEqual(room.moves, {
    hostMove: null,
    guestMove: "earth",
    updatedAt: "now"
  });
});

test("runtime guard: malformed round payload is repaired from live room moves", () => {
  const repaired = guardRuntimeRoundPayload(
    {
      roomCode: "ABC123",
      roundNumber: 4,
      warActive: false,
      moves: {
        hostMove: "fire",
        guestMove: "earth"
      }
    },
    {
      roomCode: "ABC123",
      hostMove: null,
      guestMove: "bogus",
      round: "x",
      outcomeType: "oops"
    }
  );

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.value.hostMove, "fire");
  assert.equal(repaired.value.guestMove, "earth");
  assert.equal(repaired.value.round, 4);
  assert.equal(repaired.value.outcomeType, "resolved");
});

test("runtime guard: malformed war payload is repaired without wiping valid cards", () => {
  const repaired = guardRuntimeWarState({
    warActive: "yes",
    warDepth: "2",
    warRounds: [{ round: 1 }, null, "bad"],
    warPot: {
      host: ["fire", "invalid"],
      guest: ["water"]
    }
  });

  assert.equal(repaired.repaired, true);
  assert.deepEqual(repaired.value, {
    warActive: true,
    warDepth: 2,
    warRounds: [{ round: 1 }],
    warPot: {
      host: ["fire"],
      guest: ["water"]
    }
  });
});

test("runtime invariant: malformed war transition state is contained safely", () => {
  const room = {
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    warActive: "yes",
    warDepth: -3,
    warRounds: [{ round: 1 }, null],
    warPot: { host: ["fire", "bad"], guest: ["water"] },
    hostScore: 1,
    guestScore: 1,
    roundNumber: 3,
    moves: { hostMove: "fire", guestMove: "water", updatedAt: null }
  };

  const contained = containRuntimeRoomState(room, {
    logger: null,
    logMessage: "[RuntimeInvariant] contained malformed war transition state"
  });

  assert.equal(contained.repaired, true);
  assert.deepEqual(room.warPot, {
    host: ["fire"],
    guest: ["water"]
  });
  assert.equal(room.warActive, true);
  assert.equal(room.warDepth, 0);
  assert.deepEqual(room.warRounds, [{ round: 1 }]);
});

test("runtime guard: malformed match result payload is repaired safely", () => {
  const repaired = guardRuntimeMatchResultPayload({
    round: "3",
    roundNumber: "4",
    hostScore: "2",
    guestScore: null,
    hostHand: { fire: "1", water: 2, earth: 2, wind: 2 },
    guestHand: null,
    warPot: { host: ["fire"], guest: ["earth", "bad"] },
    warActive: 1,
    warDepth: "1",
    warRounds: [{ round: 1 }, "bad"]
  });

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.value.round, 3);
  assert.equal(repaired.value.roundNumber, 4);
  assert.equal(repaired.value.hostScore, 2);
  assert.equal(repaired.value.guestScore, 0);
  assert.deepEqual(repaired.value.warPot, {
    host: ["fire"],
    guest: ["earth"]
  });
});

test("runtime invariant: malformed post-round summary is contained safely", () => {
  const contained = containRuntimeMatchSummaryState(
    {
      round: "3",
      roundNumber: "4",
      hostScore: -1,
      guestScore: null,
      hostHand: { fire: "1", water: 2, earth: 2, wind: 2 },
      guestHand: null,
      warPot: { host: ["fire"], guest: ["earth", "bad"] },
      warActive: 1,
      warDepth: "1",
      warRounds: [{ round: 1 }, "bad"]
    },
    null
  );

  assert.equal(contained.repaired, true);
  assert.equal(contained.value.hostScore, 0);
  assert.equal(contained.value.guestScore, 0);
  assert.deepEqual(contained.value.guestHand, {
    fire: 2,
    water: 2,
    earth: 2,
    wind: 2
  });
});

test("runtime guard: invalid mode falls back to current runtime mode without cross-writing stats", async (t) => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await state.recordMatchResult({
    username: "FallbackModeUser",
    perspective: "p1",
    matchState: createCompletedMatch({ mode: "broken_mode", winner: "p1" })
  });

  const profile = await state.profiles.getProfile("FallbackModeUser");
  assert.equal(profile.modeStats.pve.gamesPlayed, 1);
  assert.equal(profile.modeStats.pve.wins, 1);
  assert.equal(profile.modeStats.online_pvp.gamesPlayed, 0);
  assert.equal(profile.modeStats.local_pvp.gamesPlayed, 0);
});

test("runtime guard: unresolved mode safely skips stat write", () => {
  const guarded = guardRuntimeStatWritePayload({
    mode: "broken_mode",
    fallbackMode: "also_broken",
    matchStats: {
      gamesPlayed: "2",
      wins: "1",
      losses: 0
    }
  });

  assert.equal(guarded.skipped, true);
  assert.equal(guarded.mode, null);
  assert.deepEqual(guarded.matchStats, {
    gamesPlayed: 2,
    wins: 1,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    matchesUsingAllElements: 0,
    quickWins: 0,
    timeLimitWins: 0
  });
});

test("runtime invariant: malformed stat delta does not propagate negative values", () => {
  const guarded = guardRuntimeStatWritePayload({
    mode: "online_pvp",
    fallbackMode: "online_pvp",
    matchStats: {
      gamesPlayed: "-2",
      wins: -10,
      losses: "oops",
      warsEntered: -1,
      warsWon: -4,
      longestWar: -7,
      cardsCaptured: -9,
      matchesUsingAllElements: -1,
      quickWins: -5,
      timeLimitWins: -6
    }
  });

  assert.equal(guarded.skipped, false);
  assert.equal(guarded.mode, "online_pvp");
  assert.deepEqual(guarded.matchStats, {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    matchesUsingAllElements: 0,
    quickWins: 0,
    timeLimitWins: 0
  });
});

test("runtime invariant: valid runtime state remains unchanged", () => {
  const room = {
    hostHand: { fire: 2, water: 1, earth: 2, wind: 1 },
    guestHand: { fire: 1, water: 2, earth: 2, wind: 1 },
    warActive: false,
    warDepth: 0,
    warRounds: [],
    warPot: { host: [], guest: [] },
    hostScore: 1,
    guestScore: 2,
    roundNumber: 4,
    moves: { hostMove: "fire", guestMove: "water", updatedAt: "stamp" }
  };
  const before = JSON.parse(JSON.stringify(room));

  const contained = containRuntimeRoomState(room, {
    logger: null,
    logMessage: "[RuntimeInvariant] contained malformed pre-round state"
  });

  assert.equal(contained.repaired, false);
  assert.deepEqual(room, before);
});

test("runtime edge guard: duplicate move application is skipped safely", () => {
  const store = createRoomStore();
  const hostSocket = { id: "host-socket" };
  const guestSocket = { id: "guest-socket" };

  store.createRoom(hostSocket, { username: "Host" });
  const roomCode = store.getRoomCodeForSocket(hostSocket.id);
  store.joinRoom(guestSocket, roomCode, { username: "Guest" });

  const firstSubmit = store.submitMove(hostSocket.id, "fire");
  const duplicateSubmit = store.submitMove(hostSocket.id, "fire");
  const room = store.getRoom(roomCode);

  assert.equal(firstSubmit.ok, true);
  assert.equal(duplicateSubmit.ok, false);
  assert.equal(duplicateSubmit.error.code, "MOVE_ALREADY_SUBMITTED");
  assert.equal(room.hostHand.fire, 1);
});

test("runtime edge guard: duplicate round application is skipped safely", () => {
  const room = {
    roomCode: "ABC123",
    matchSequence: 1,
    hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 1, wind: 2 },
    warActive: false,
    warDepth: 0,
    warRounds: [],
    warPot: { host: [], guest: [] },
    hostScore: 0,
    guestScore: 0,
    roundNumber: 1,
    roundHistory: [],
    lastOutcomeType: null,
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: { hostReady: false, guestReady: false },
    moves: { hostMove: "fire", guestMove: "earth", updatedAt: "stamp" },
    latestRoundResult: null
  };

  const firstRound = applyRoundToMatchState(room, {
    roomCode: "ABC123",
    hostMove: "fire",
    guestMove: "earth",
    round: 1,
    outcomeType: "resolved",
    hostResult: "win",
    guestResult: "lose"
  });
  room.latestRoundResult = firstRound;
  const scoreAfterFirstRound = { host: room.hostScore, guest: room.guestScore };
  const handAfterFirstRound = JSON.parse(JSON.stringify(room.hostHand));
  const secondRound = applyRoundToMatchState(room, {
    roomCode: "ABC123",
    hostMove: "fire",
    guestMove: "earth",
    round: 1,
    outcomeType: "resolved",
    hostResult: "win",
    guestResult: "lose"
  });

  assert.deepEqual(secondRound, firstRound);
  assert.deepEqual(
    { host: room.hostScore, guest: room.guestScore },
    scoreAfterFirstRound
  );
  assert.deepEqual(room.hostHand, handAfterFirstRound);
});

test("runtime edge guard: stale round payload is contained and does not overwrite current state", () => {
  const room = {
    roomCode: "ABC123",
    matchSequence: 1,
    hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 1, wind: 2 },
    warActive: false,
    warDepth: 0,
    warRounds: [],
    warPot: { host: [], guest: [] },
    hostScore: 0,
    guestScore: 0,
    roundNumber: 4,
    roundHistory: [],
    lastOutcomeType: null,
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: { hostReady: false, guestReady: false },
    moves: { hostMove: "fire", guestMove: "earth", updatedAt: "stamp" },
    latestRoundResult: null
  };

  const result = applyRoundToMatchState(room, {
    roomCode: "ABC123",
    hostMove: "water",
    guestMove: "water",
    round: 1,
    outcomeType: "war",
    hostResult: "war",
    guestResult: "war"
  });

  assert.equal(result.hostMove, "fire");
  assert.equal(result.guestMove, "earth");
  assert.equal(result.round, 4);
  assert.equal(room.hostScore, 1);
  assert.equal(room.guestScore, 0);
});

test("runtime edge guard: duplicate online settlement is skipped safely", async (t) => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const first = await state.recordOnlineMatchResult({
    username: "DuplicateLocalResultUser",
    perspective: "p1",
    settlementKey: "room-abc:round-2",
    matchState: createCompletedMatch({ mode: "online_pvp", winner: "p1" })
  });
  const second = await state.recordOnlineMatchResult({
    username: "DuplicateLocalResultUser",
    perspective: "p1",
    settlementKey: "room-abc:round-2",
    matchState: createCompletedMatch({ mode: "online_pvp", winner: "p1" })
  });

  const profile = await state.profiles.getProfile("DuplicateLocalResultUser");
  const saves = await state.saves.listMatchResults();

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.save?.settlementKey, "room-abc:round-2");
  assert.equal(profile.modeStats.online_pvp.gamesPlayed, 1);
  assert.equal(saves.length, 1);
});

test("runtime edge guard: consumed transient state does not leak into later rounds", () => {
  const store = createRoomStore();
  const hostSocket = { id: "host-socket-reset" };
  const guestSocket = { id: "guest-socket-reset" };

  store.createRoom(hostSocket, { username: "Host" });
  const roomCode = store.getRoomCodeForSocket(hostSocket.id);
  store.joinRoom(guestSocket, roomCode, { username: "Guest" });

  const roundOneHost = store.submitMove(hostSocket.id, "fire");
  const roundOneGuest = store.submitMove(guestSocket.id, "earth");
  assert.equal(roundOneHost.ok, true);
  assert.equal(roundOneGuest.ok, true);

  const resetRoom = store.resetRound(roomCode);
  assert.deepEqual(resetRoom.moveSync, {
    hostSubmitted: false,
    guestSubmitted: false,
    submittedCount: 0,
    bothSubmitted: false,
    updatedAt: null
  });

  const roundTwoHost = store.submitMove(hostSocket.id, "water");
  const roundTwoGuest = store.submitMove(guestSocket.id, "fire");
  assert.equal(roundTwoHost.ok, true);
  assert.equal(roundTwoGuest.ok, true);
  assert.equal(roundTwoGuest.roundResult.round, 2);
});
