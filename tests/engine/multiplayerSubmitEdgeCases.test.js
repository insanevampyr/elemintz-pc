import test from "node:test";
import assert from "node:assert/strict";

import { io as createClient } from "socket.io-client";

import { createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";
import { getTotalOwnedCards } from "../../src/multiplayer/rooms.js";

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const client = createClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false
    });

    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(socket, eventName) {
  return new Promise((resolve) => {
    socket.once(eventName, resolve);
  });
}

async function createFullRoom(host, guest) {
  const createdPromise = waitForEvent(host, "room:created");
  host.emit("room:create");
  const room = await createdPromise;

  const joinedPromise = waitForEvent(guest, "room:joined");
  const hostJoinUpdatePromise = waitForEvent(host, "room:update");
  guest.emit("room:join", { roomCode: room.roomCode });
  await joinedPromise;
  await hostJoinUpdatePromise;

  return room;
}

test("online submit edge cases: near-simultaneous and same-tick submits resolve one round once per player", async () => {
  const rewardPersisterCalls = [];
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 250,
    rewardPersister: async (payload) => {
      rewardPersisterCalls.push(payload);
    }
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdRoom = await createFullRoom(host, guest);

    const hostMoveSyncEvents = [];
    const guestMoveSyncEvents = [];
    const hostRoundResults = [];
    const guestRoundResults = [];

    host.on("room:moveSync", (payload) => hostMoveSyncEvents.push(payload));
    guest.on("room:moveSync", (payload) => guestMoveSyncEvents.push(payload));
    host.on("room:roundResult", (payload) => hostRoundResults.push(payload));
    guest.on("room:roundResult", (payload) => guestRoundResults.push(payload));

    host.emit("room:submitMove", { move: "fire" });
    guest.emit("room:submitMove", { move: "earth" });

    await wait(40);

    assert.equal(hostRoundResults.length, 1);
    assert.equal(guestRoundResults.length, 1);
    assert.equal(hostMoveSyncEvents.length, 2);
    assert.equal(guestMoveSyncEvents.length, 2);
    assert.equal(hostRoundResults[0].round, 1);
    assert.equal(hostRoundResults[0].roundNumber, 2);
    assert.equal(hostRoundResults[0].hostResult, "win");
    assert.equal(hostRoundResults[0].guestResult, "lose");
    assert.equal(rewardPersisterCalls.length, 0);

    const roomAfterFirstRound = foundation.roomStore.getRoom(createdRoom.roomCode);
    assert.equal(roomAfterFirstRound.roundNumber, 2);
    assert.equal(roomAfterFirstRound.matchComplete, false);
    assert.equal(roomAfterFirstRound.moveSync.submittedCount, 2);
    assert.equal(roomAfterFirstRound.moveSync.bothSubmitted, true);
    assert.deepEqual(roomAfterFirstRound.hostHand, {
      fire: 2,
      water: 2,
      earth: 3,
      wind: 2
    });
    assert.deepEqual(roomAfterFirstRound.guestHand, {
      fire: 2,
      water: 2,
      earth: 1,
      wind: 2
    });
    assert.equal(
      getTotalOwnedCards(roomAfterFirstRound.hostHand, roomAfterFirstRound.warPot?.host) +
        getTotalOwnedCards(roomAfterFirstRound.guestHand, roomAfterFirstRound.warPot?.guest),
      16
    );

    await wait(260);

    const hostSecondMoveSyncEvents = [];
    const guestSecondMoveSyncEvents = [];
    const hostSecondRoundResults = [];
    const guestSecondRoundResults = [];

    host.on("room:moveSync", (payload) => hostSecondMoveSyncEvents.push(payload));
    guest.on("room:moveSync", (payload) => guestSecondMoveSyncEvents.push(payload));
    host.on("room:roundResult", (payload) => hostSecondRoundResults.push(payload));
    guest.on("room:roundResult", (payload) => guestSecondRoundResults.push(payload));

    queueMicrotask(() => host.emit("room:submitMove", { move: "water" }));
    queueMicrotask(() => guest.emit("room:submitMove", { move: "fire" }));

    await wait(40);

    assert.equal(hostSecondRoundResults.length, 1);
    assert.equal(guestSecondRoundResults.length, 1);
    assert.equal(hostSecondMoveSyncEvents.length, 2);
    assert.equal(guestSecondMoveSyncEvents.length, 2);
    assert.equal(hostSecondRoundResults[0].round, 2);
    assert.equal(hostSecondRoundResults[0].roundNumber, 3);
    assert.equal(hostSecondRoundResults[0].hostResult, "win");
    assert.equal(hostSecondRoundResults[0].guestResult, "lose");
    assert.equal(rewardPersisterCalls.length, 0);

    const roomAfterSecondRound = foundation.roomStore.getRoom(createdRoom.roomCode);
    assert.equal(roomAfterSecondRound.roundNumber, 3);
    assert.equal(roomAfterSecondRound.matchComplete, false);
    assert.equal(roomAfterSecondRound.moveSync.submittedCount, 2);
    assert.equal(roomAfterSecondRound.moveSync.bothSubmitted, true);
    assert.deepEqual(roomAfterSecondRound.hostHand, {
      fire: 3,
      water: 2,
      earth: 3,
      wind: 2
    });
    assert.deepEqual(roomAfterSecondRound.guestHand, {
      fire: 1,
      water: 2,
      earth: 1,
      wind: 2
    });
    assert.equal(
      getTotalOwnedCards(roomAfterSecondRound.hostHand, roomAfterSecondRound.warPot?.host) +
        getTotalOwnedCards(roomAfterSecondRound.guestHand, roomAfterSecondRound.warPot?.guest),
      16
    );
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("online submit edge cases: rapid repeat submits count only the first move before round reset", async () => {
  const rewardPersisterCalls = [];
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 250,
    rewardPersister: async (payload) => {
      rewardPersisterCalls.push(payload);
    }
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdRoom = await createFullRoom(host, guest);
    const hostErrors = [];
    const guestErrors = [];
    const hostRoundResults = [];
    const guestRoundResults = [];

    host.on("room:error", (payload) => hostErrors.push(payload));
    guest.on("room:error", (payload) => guestErrors.push(payload));
    host.on("room:roundResult", (payload) => hostRoundResults.push(payload));
    guest.on("room:roundResult", (payload) => guestRoundResults.push(payload));

    host.emit("room:submitMove", { move: "fire" });
    host.emit("room:submitMove", { move: "water" });
    guest.emit("room:submitMove", { move: "earth" });
    guest.emit("room:submitMove", { move: "wind" });

    await wait(40);

    assert.equal(hostErrors.length, 1);
    assert.equal(guestErrors.length, 1);
    assert.deepEqual(hostErrors[0], {
      code: "MOVE_ALREADY_SUBMITTED",
      message: "This player already submitted a move."
    });
    assert.deepEqual(guestErrors[0], {
      code: "MOVE_ALREADY_SUBMITTED",
      message: "This player already submitted a move."
    });
    assert.equal(hostRoundResults.length, 1);
    assert.equal(guestRoundResults.length, 1);
    assert.equal(hostRoundResults[0].round, 1);
    assert.equal(hostRoundResults[0].roundNumber, 2);
    assert.equal(hostRoundResults[0].hostResult, "win");
    assert.equal(hostRoundResults[0].guestResult, "lose");
    assert.equal(rewardPersisterCalls.length, 0);

    const roomAfterSpam = foundation.roomStore.getRoom(createdRoom.roomCode);
    assert.equal(roomAfterSpam.roundNumber, 2);
    assert.equal(roomAfterSpam.matchComplete, false);
    assert.equal(roomAfterSpam.moveSync.submittedCount, 2);
    assert.equal(roomAfterSpam.moveSync.bothSubmitted, true);
    assert.deepEqual(roomAfterSpam.hostHand, {
      fire: 2,
      water: 2,
      earth: 3,
      wind: 2
    });
    assert.deepEqual(roomAfterSpam.guestHand, {
      fire: 2,
      water: 2,
      earth: 1,
      wind: 2
    });
    assert.equal(
      getTotalOwnedCards(roomAfterSpam.hostHand, roomAfterSpam.warPot?.host) +
        getTotalOwnedCards(roomAfterSpam.guestHand, roomAfterSpam.warPot?.guest),
      16
    );
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});
