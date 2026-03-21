import test from "node:test";
import assert from "node:assert/strict";

import { createRoomStore, getTotalCardsInHand } from "../../src/multiplayer/rooms.js";

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

function assertValidNumericContainers(room, label) {
  for (const [owner, hand] of Object.entries({
    host: room.hostHand,
    guest: room.guestHand
  })) {
    for (const [element, count] of Object.entries(hand)) {
      assert.equal(Number.isInteger(count), true, `${label}: ${owner} ${element} must stay integer`);
      assert.ok(count >= 0, `${label}: ${owner} ${element} must stay non-negative`);
    }
  }

  assert.ok((room.hostScore ?? 0) >= 0, `${label}: hostScore must stay non-negative`);
  assert.ok((room.guestScore ?? 0) >= 0, `${label}: guestScore must stay non-negative`);
  assert.ok((room.roundNumber ?? 0) >= 1, `${label}: roundNumber must stay positive`);
}

function assertReplayCheckpoint(room, label) {
  assert.equal(countTotalCards(room), INITIAL_TOTAL_CARDS, `${label}: total card conservation`);
  assertValidNumericContainers(room, label);

  const hostPot = Array.isArray(room.warPot?.host) ? room.warPot.host.length : 0;
  const guestPot = Array.isArray(room.warPot?.guest) ? room.warPot.guest.length : 0;
  assert.equal(
    getTotalCardsInHand(room.hostHand) + getTotalCardsInHand(room.guestHand) + hostPot + guestPot,
    INITIAL_TOTAL_CARDS,
    `${label}: all cards accounted for`
  );
}

function assertStableFinalState(roomCode, store, expectedWinner, expectedHostScore, label) {
  const firstRoom = store.getRoom(roomCode);
  const secondRoom = store.getRoom(roomCode);

  assert.deepEqual(secondRoom, firstRoom, `${label}: post-match room state remains stable`);
  assert.equal(firstRoom.matchComplete, true, `${label}: match should be complete`);
  assert.equal(firstRoom.winner, expectedWinner, `${label}: winner should match expectation`);
  assert.equal(firstRoom.winReason, "hand_exhaustion", `${label}: win reason should stay consistent`);
  assert.equal(firstRoom.hostScore, expectedHostScore, `${label}: host score should match replay`);
  assert.equal(firstRoom.guestScore, 0, `${label}: guest score should match replay`);
  assert.equal(firstRoom.warActive, false, `${label}: no leftover warActive after completion`);
  assert.deepEqual(firstRoom.warPot, { host: [], guest: [] }, `${label}: no leftover war pot`);
  assert.deepEqual(firstRoom.warRounds, [], `${label}: no leftover war rounds`);
  assertReplayCheckpoint(firstRoom, `${label}: stable final room`);

  return firstRoom;
}

function buildFinalSummary(room, roundResult) {
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
    roundResult: roundResult
      ? {
          hostMove: roundResult.hostMove,
          guestMove: roundResult.guestMove,
          round: roundResult.round,
          outcomeType: roundResult.outcomeType,
          hostResult: roundResult.hostResult,
          guestResult: roundResult.guestResult,
          hostScore: roundResult.hostScore,
          guestScore: roundResult.guestScore,
          roundNumber: roundResult.roundNumber,
          lastOutcomeType: roundResult.lastOutcomeType,
          matchComplete: roundResult.matchComplete,
          winner: roundResult.winner,
          winReason: roundResult.winReason,
          rematch: { ...(roundResult.rematch ?? {}) }
        }
      : null
  };
}

function replayMatch(sequence, { expectedWinner = "host", expectedHostScore, label }) {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();
  let finalRoundResult = null;

  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index];
    const isFinalStep = index === sequence.length - 1;

    const hostResult = store.submitMove(hostSocket.id, step.hostMove);
    const guestResult = store.submitMove(guestSocket.id, step.guestMove);

    assert.equal(hostResult.ok, true, `${label}: host submit succeeds on step ${index + 1}`);
    assert.equal(guestResult.ok, true, `${label}: guest submit succeeds on step ${index + 1}`);

    const room = store.getRoom(roomCode);
    finalRoundResult = guestResult.roundResult;

    assert.ok(finalRoundResult, `${label}: round result exists on step ${index + 1}`);
    assert.equal(
      finalRoundResult.outcomeType,
      step.expectedOutcomeType,
      `${label}: outcome matches expected step ${index + 1}`
    );
    assertReplayCheckpoint(room, `${label}: after step ${index + 1}`);

    if (isFinalStep) {
      assert.equal(room.matchComplete, true, `${label}: final step completes the match`);
      assert.equal(finalRoundResult.matchComplete, true, `${label}: final payload marks completion`);
      assert.equal(finalRoundResult.winner, expectedWinner, `${label}: final payload winner matches`);
      assert.equal(finalRoundResult.winReason, "hand_exhaustion", `${label}: final payload win reason matches`);
      assert.deepEqual(
        finalRoundResult.rematch,
        { hostReady: false, guestReady: false },
        `${label}: final payload rematch state stays clean`
      );
    } else {
      assert.equal(room.matchComplete, false, `${label}: no premature completion on step ${index + 1}`);
      assert.equal(finalRoundResult.matchComplete, false, `${label}: payload stays incomplete on step ${index + 1}`);

      const resetRoom = store.resetRound(roomCode);
      assert.ok(resetRoom, `${label}: round reset succeeds on step ${index + 1}`);
      assertReplayCheckpoint(resetRoom, `${label}: after reset ${index + 1}`);
    }
  }

  const stableFinalRoom = assertStableFinalState(
    roomCode,
    store,
    expectedWinner,
    expectedHostScore,
    label
  );

  assert.ok(finalRoundResult, `${label}: final round result is available`);
  assert.equal(finalRoundResult.roundNumber, stableFinalRoom.roundNumber, `${label}: final payload roundNumber aligns`);
  assert.equal(finalRoundResult.hostScore, stableFinalRoom.hostScore, `${label}: final payload hostScore aligns`);
  assert.equal(finalRoundResult.guestScore, stableFinalRoom.guestScore, `${label}: final payload guestScore aligns`);
  assert.equal(finalRoundResult.lastOutcomeType, stableFinalRoom.lastOutcomeType, `${label}: final payload outcome aligns`);

  return buildFinalSummary(stableFinalRoom, finalRoundResult);
}

const SCENARIOS = {
  decisiveNoWar: {
    label: "full replay decisive no-war",
    expectedHostScore: 8,
    sequence: [
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
      { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
    ]
  },
  singleWar: {
    label: "full replay single war",
    expectedHostScore: 7,
    sequence: [
      { hostMove: "fire", guestMove: "fire", expectedOutcomeType: "war" },
      { hostMove: "water", guestMove: "fire", expectedOutcomeType: "war_resolved" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
    ]
  },
  chainedWar: {
    label: "full replay chained war",
    expectedHostScore: 6,
    sequence: [
      { hostMove: "fire", guestMove: "fire", expectedOutcomeType: "war" },
      { hostMove: "water", guestMove: "water", expectedOutcomeType: "war" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "war_resolved" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" }
    ]
  },
  neutralRounds: {
    label: "full replay neutral rounds",
    expectedHostScore: 8,
    sequence: [
      { hostMove: "fire", guestMove: "wind", expectedOutcomeType: "no_effect" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "fire", guestMove: "earth", expectedOutcomeType: "resolved" },
      { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
      { hostMove: "water", guestMove: "fire", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "earth", guestMove: "wind", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" },
      { hostMove: "wind", guestMove: "water", expectedOutcomeType: "resolved" }
    ]
  },
  mixedReplay: {
    label: "full replay mixed decisive neutral war",
    expectedHostScore: 7,
    sequence: [
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
  }
};

test("full replay validation: decisive match resolves correctly through production flow", () => {
  replayMatch(SCENARIOS.decisiveNoWar.sequence, SCENARIOS.decisiveNoWar);
});

test("full replay validation: single WAR match resolves correctly through production flow", () => {
  replayMatch(SCENARIOS.singleWar.sequence, SCENARIOS.singleWar);
});

test("full replay validation: chained WAR match resolves correctly through production flow", () => {
  replayMatch(SCENARIOS.chainedWar.sequence, SCENARIOS.chainedWar);
});

test("full replay validation: neutral/no-effect rounds remain stable through full match flow", () => {
  replayMatch(SCENARIOS.neutralRounds.sequence, SCENARIOS.neutralRounds);
});

test("full replay validation: mixed decisive neutral and WAR match resolves correctly", () => {
  replayMatch(SCENARIOS.mixedReplay.sequence, SCENARIOS.mixedReplay);
});

test("full replay validation: identical replay sequence produces identical final summary", () => {
  const firstReplay = replayMatch(SCENARIOS.mixedReplay.sequence, SCENARIOS.mixedReplay);
  const secondReplay = replayMatch(SCENARIOS.mixedReplay.sequence, SCENARIOS.mixedReplay);

  assert.deepEqual(secondReplay, firstReplay);
});
