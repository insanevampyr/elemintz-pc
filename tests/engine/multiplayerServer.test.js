import test from "node:test";
import assert from "node:assert/strict";

import { io as createClient } from "socket.io-client";

import { createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";

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

function waitForEvent(socket, eventName) {
  return new Promise((resolve) => {
    socket.once(eventName, resolve);
  });
}

test("multiplayer foundation: health endpoint responds for deployment checks", async () => {
  const logEntries = [];
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: {
      info: (...args) => logEntries.push(args)
    }
  });

  try {
    const port = await foundation.start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      ok: true,
      service: "elemintz-multiplayer",
      phase: 5,
      transport: "socket.io"
    });
    assert.ok(logEntries.some((entry) => entry[0] === "[Multiplayer] server listening"));
    assert.equal(typeof foundation.io.on, "function");
  } finally {
    await foundation.stop();
  }
});

test("multiplayer rooms: room creation returns a short waiting room", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let host = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create");
    const room = await createdPromise;

    assert.match(room.roomCode, /^[A-Z]{3}[2-9]{3}$/);
    assert.equal(room.status, "waiting");
    assert.equal(room.host.socketId, host.id);
    assert.equal(room.guest, null);
    assert.deepEqual(room.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
  } finally {
    host?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: room join succeeds and notifies both players", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create");
    const createdRoom = await createdPromise;

    const hostUpdatePromise = waitForEvent(host, "room:update");
    const guestJoinedPromise = waitForEvent(guest, "room:joined");
    const guestUpdatePromise = waitForEvent(guest, "room:update");
    guest.emit("room:join", { roomCode: createdRoom.roomCode.toLowerCase() });

    const joinedRoom = await guestJoinedPromise;
    const hostUpdate = await hostUpdatePromise;
    const guestUpdate = await guestUpdatePromise;

    assert.equal(joinedRoom.status, "full");
    assert.equal(joinedRoom.roomCode, createdRoom.roomCode);
    assert.equal(joinedRoom.host.socketId, host.id);
    assert.equal(joinedRoom.guest.socketId, guest.id);
    assert.deepEqual(joinedRoom.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
    assert.deepEqual(hostUpdate, joinedRoom);
    assert.deepEqual(guestUpdate, joinedRoom);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: move submissions sync and resolve one round after host and guest both submit", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create");
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const hostMoveSyncPromise = waitForEvent(host, "room:moveSync");
    const guestMoveSyncPromise = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });

    const hostMoveSync = await hostMoveSyncPromise;
    const guestMoveSync = await guestMoveSyncPromise;

    assert.deepEqual(hostMoveSync.moveSync, {
      hostSubmitted: true,
      guestSubmitted: false,
      submittedCount: 1,
      bothSubmitted: false,
      updatedAt: hostMoveSync.moveSync.updatedAt
    });
    assert.deepEqual(guestMoveSync, hostMoveSync);

    const hostBothSyncPromise = waitForEvent(host, "room:moveSync");
    const guestBothSyncPromise = waitForEvent(guest, "room:moveSync");
    const hostRoundResultPromise = waitForEvent(host, "room:roundResult");
    const guestRoundResultPromise = waitForEvent(guest, "room:roundResult");
    guest.emit("room:submitMove", { move: "water" });

    const hostBothSync = await hostBothSyncPromise;
    const guestBothSync = await guestBothSyncPromise;
    const hostRoundResult = await hostRoundResultPromise;
    const guestRoundResult = await guestRoundResultPromise;

    assert.deepEqual(hostBothSync.moveSync, {
      hostSubmitted: true,
      guestSubmitted: true,
      submittedCount: 2,
      bothSubmitted: true,
      updatedAt: hostBothSync.moveSync.updatedAt
    });
    assert.deepEqual(guestBothSync, hostBothSync);
    assert.deepEqual(hostRoundResult, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "water",
      hostResult: "lose",
      guestResult: "win"
    });
    assert.deepEqual(guestRoundResult, hostRoundResult);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: joining a missing room emits room:error", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let guest = null;

  try {
    const port = await foundation.start();
    guest = await connectClient(port);

    const errorPromise = waitForEvent(guest, "room:error");
    guest.emit("room:join", { roomCode: "ZZZ999" });
    const error = await errorPromise;

    assert.deepEqual(error, {
      code: "ROOM_NOT_FOUND",
      message: "Room code not found."
    });
  } finally {
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: joining a full room emits room:error", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let host = null;
  let guest = null;
  let lateGuest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);
    lateGuest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create");
    const room = await createdPromise;

    guest.emit("room:join", { roomCode: room.roomCode });
    await waitForEvent(guest, "room:joined");
    await waitForEvent(host, "room:update");

    const errorPromise = waitForEvent(lateGuest, "room:error");
    lateGuest.emit("room:join", { roomCode: room.roomCode });
    const error = await errorPromise;

    assert.deepEqual(error, {
      code: "ROOM_FULL",
      message: "Room is already full."
    });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    lateGuest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: disconnect cleanup updates waiting rooms and removes empty rooms", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let host = null;
  let guest = null;
  let replacementGuest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create");
    const room = await createdPromise;

    const hostUpdateOnJoinPromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode });
    await waitForEvent(guest, "room:joined");
    await hostUpdateOnJoinPromise;

    const hostUpdateOnGuestLeavePromise = waitForEvent(host, "room:update");
    guest.disconnect();
    const waitingRoom = await hostUpdateOnGuestLeavePromise;

    assert.equal(waitingRoom.status, "waiting");
    assert.equal(waitingRoom.host.socketId, host.id);
    assert.equal(waitingRoom.guest, null);

    host.disconnect();
    replacementGuest = await connectClient(port);

    const missingRoomErrorPromise = waitForEvent(replacementGuest, "room:error");
    replacementGuest.emit("room:join", { roomCode: room.roomCode });
    const error = await missingRoomErrorPromise;

    assert.deepEqual(error, {
      code: "ROOM_NOT_FOUND",
      message: "Room code not found."
    });
    assert.equal(foundation.roomStore.getRoom(room.roomCode), null);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    replacementGuest?.disconnect();
    await foundation.stop();
  }
});
