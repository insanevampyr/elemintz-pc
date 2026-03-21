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

function assertTotalCardConservation(room, label) {
  assert.equal(countTotalCards(room), INITIAL_TOTAL_CARDS, label);
}

function assertNoCrossContainerDuplication(room, label) {
  const hostOwned = getTotalCardsInHand(room.hostHand);
  const guestOwned = getTotalCardsInHand(room.guestHand);
  const hostPot = Array.isArray(room.warPot?.host) ? room.warPot.host.length : 0;
  const guestPot = Array.isArray(room.warPot?.guest) ? room.warPot.guest.length : 0;

  assert.equal(hostOwned + hostPot + guestOwned + guestPot, INITIAL_TOTAL_CARDS, label);
  assert.ok(hostPot >= 0 && guestPot >= 0, `${label}: war piles must be non-negative`);
}

function submitPair(store, roomCode, hostSocket, guestSocket, hostMove, guestMove) {
  const hostResult = store.submitMove(hostSocket.id, hostMove);
  const guestResult = store.submitMove(guestSocket.id, guestMove);

  assert.equal(hostResult.ok, true, `host submit should succeed for ${hostMove}`);
  assert.equal(guestResult.ok, true, `guest submit should succeed for ${guestMove}`);

  return {
    hostResult,
    guestResult,
    room: store.getRoom(roomCode)
  };
}

test("war transfer validation: simple host win transfers exactly both played cards", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();
  const initialRoom = store.getRoom(roomCode);
  assertTotalCardConservation(initialRoom, "initial room");

  const { guestResult, room } = submitPair(
    store,
    roomCode,
    hostSocket,
    guestSocket,
    "fire",
    "earth"
  );

  assert.equal(guestResult.roundResult.outcomeType, "resolved");
  assert.equal(guestResult.roundResult.hostResult, "win");
  assert.equal(guestResult.roundResult.guestResult, "lose");
  assert.equal(room.hostHand.fire, 2, "host regains played fire");
  assert.equal(room.hostHand.earth, 3, "host gains guest earth");
  assert.equal(room.guestHand.earth, 1, "guest loses contributed earth");
  assert.deepEqual(room.warPot, { host: [], guest: [] });
  assertTotalCardConservation(room, "after simple host win");
  assertNoCrossContainerDuplication(room, "after simple host win");
});

test("war transfer validation: simple guest win transfers exactly both played cards", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  const { guestResult, room } = submitPair(
    store,
    roomCode,
    hostSocket,
    guestSocket,
    "earth",
    "fire"
  );

  assert.equal(guestResult.roundResult.outcomeType, "resolved");
  assert.equal(guestResult.roundResult.hostResult, "lose");
  assert.equal(guestResult.roundResult.guestResult, "win");
  assert.equal(room.guestHand.fire, 2, "guest regains played fire");
  assert.equal(room.guestHand.earth, 3, "guest gains host earth");
  assert.equal(room.hostHand.earth, 1, "host loses contributed earth");
  assert.deepEqual(room.warPot, { host: [], guest: [] });
  assertTotalCardConservation(room, "after simple guest win");
  assertNoCrossContainerDuplication(room, "after simple guest win");
});

test("war transfer validation: single WAR resolution distributes full accumulated pile", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  const firstRound = submitPair(store, roomCode, hostSocket, guestSocket, "fire", "fire");
  assert.equal(firstRound.guestResult.roundResult.outcomeType, "war");
  assert.equal(firstRound.room.warActive, true);
  assert.deepEqual(firstRound.room.warPot, {
    host: ["fire"],
    guest: ["fire"]
  });
  assertTotalCardConservation(firstRound.room, "during single-step war");

  store.resetRound(roomCode);
  const secondRound = submitPair(store, roomCode, hostSocket, guestSocket, "water", "fire");
  assert.equal(secondRound.guestResult.roundResult.outcomeType, "war_resolved");
  assert.equal(secondRound.guestResult.roundResult.hostResult, "win");
  assert.equal(secondRound.room.warActive, false);
  assert.deepEqual(secondRound.room.warPot, { host: [], guest: [] });
  assert.equal(secondRound.room.hostHand.fire, 4);
  assert.equal(secondRound.room.hostHand.water, 2);
  assert.equal(secondRound.room.guestHand.fire, 0);
  assertTotalCardConservation(secondRound.room, "after single WAR resolution");
  assertNoCrossContainerDuplication(secondRound.room, "after single WAR resolution");
});

test("war transfer validation: WAR to WAR to WIN resolves full accumulated pile with no leftovers", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  const warOne = submitPair(store, roomCode, hostSocket, guestSocket, "fire", "fire");
  assert.equal(warOne.room.warDepth, 1);
  assertTotalCardConservation(warOne.room, "after first war tie");

  store.resetRound(roomCode);
  const warTwo = submitPair(store, roomCode, hostSocket, guestSocket, "water", "water");
  assert.equal(warTwo.room.warDepth, 2);
  assert.deepEqual(warTwo.room.warPot, {
    host: ["fire", "water"],
    guest: ["fire", "water"]
  });
  assertTotalCardConservation(warTwo.room, "after second war tie");

  store.resetRound(roomCode);
  const resolved = submitPair(store, roomCode, hostSocket, guestSocket, "earth", "wind");
  assert.equal(resolved.guestResult.roundResult.outcomeType, "war_resolved");
  assert.equal(resolved.room.warActive, false);
  assert.equal(resolved.room.warDepth, 0);
  assert.deepEqual(resolved.room.warPot, { host: [], guest: [] });
  assert.deepEqual(resolved.room.warRounds, []);
  assert.equal(getTotalCardsInHand(resolved.room.hostHand), 11);
  assert.equal(getTotalCardsInHand(resolved.room.guestHand), 5);
  assertTotalCardConservation(resolved.room, "after multi-step war chain");
  assertNoCrossContainerDuplication(resolved.room, "after multi-step war chain");
});

test("war transfer validation: WAR with no-effect step still resolves full pile correctly", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  const warStart = submitPair(store, roomCode, hostSocket, guestSocket, "fire", "fire");
  assert.equal(warStart.room.warActive, true);

  store.resetRound(roomCode);
  const neutralStep = submitPair(store, roomCode, hostSocket, guestSocket, "fire", "wind");
  assert.equal(neutralStep.guestResult.roundResult.outcomeType, "no_effect");
  assert.equal(neutralStep.room.warActive, true);
  assert.deepEqual(neutralStep.room.warPot, {
    host: ["fire", "fire"],
    guest: ["fire", "wind"]
  });
  assertTotalCardConservation(neutralStep.room, "after neutral war step");

  store.resetRound(roomCode);
  const resolved = submitPair(store, roomCode, hostSocket, guestSocket, "earth", "wind");
  assert.equal(resolved.guestResult.roundResult.outcomeType, "war_resolved");
  assert.equal(resolved.guestResult.roundResult.hostResult, "win");
  assert.equal(resolved.room.warActive, false);
  assert.deepEqual(resolved.room.warPot, { host: [], guest: [] });
  assert.deepEqual(resolved.room.warRounds, []);
  assertTotalCardConservation(resolved.room, "after neutral war chain resolution");
  assertNoCrossContainerDuplication(resolved.room, "after neutral war chain resolution");
});

test("war transfer validation: next round after resolution starts with valid hands and no phantom war state", () => {
  const { store, roomCode, hostSocket, guestSocket } = createStartedRoom();

  submitPair(store, roomCode, hostSocket, guestSocket, "fire", "fire");
  store.resetRound(roomCode);
  const resolved = submitPair(store, roomCode, hostSocket, guestSocket, "water", "fire");

  assert.equal(resolved.room.warActive, false);
  assert.deepEqual(resolved.room.warPot, { host: [], guest: [] });
  assert.deepEqual(resolved.room.warRounds, []);

  const resetRoom = store.resetRound(roomCode);
  assert.equal(resetRoom.warActive, false);
  assert.deepEqual(resetRoom.warPot, { host: [], guest: [] });
  assert.deepEqual(resetRoom.warRounds, []);
  assertTotalCardConservation(resetRoom, "after reset following war resolution");

  const nextRound = submitPair(store, roomCode, hostSocket, guestSocket, "earth", "water");
  assert.equal(nextRound.guestResult.roundResult.outcomeType, "no_effect");
  assert.equal(nextRound.room.warActive, false);
  assert.deepEqual(nextRound.room.warPot, { host: [], guest: [] });
  assertTotalCardConservation(nextRound.room, "next round after war resolution");
  assertNoCrossContainerDuplication(nextRound.room, "next round after war resolution");
});
