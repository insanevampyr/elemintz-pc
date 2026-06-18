import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { io as createClient } from "socket.io-client";

import {
  MULTIPLAYER_FOUNDATION_PHASE,
  buildOnlineMatchStateFromRoom,
  buildRewardDecision,
  buildRewardSummary,
  createMultiplayerFoundation
} from "../../src/multiplayer/foundation.js";
import { createTimestampedLogger } from "../../src/multiplayer/logger.js";
import { MultiplayerAccountStore } from "../../src/multiplayer/accountStore.js";
import { AnnouncementStore } from "../../src/multiplayer/announcementStore.js";
import { BoostEventStore } from "../../src/multiplayer/boostEventStore.js";
import { FeedbackStore } from "../../src/multiplayer/feedbackStore.js";
import { MultiplayerProfileAuthority } from "../../src/multiplayer/profileAuthority.js";
import { createSessionStore } from "../../src/multiplayer/sessionStore.js";
import { ShopRotationStore } from "../../src/multiplayer/shopRotationStore.js";
import { createRoomStore, getTotalOwnedCards, updateMatchCompletion } from "../../src/multiplayer/rooms.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { AdminGrantStore } from "../../src/state/adminGrantStore.js";
import { getDailyResetWindow } from "../../src/state/dailyChallengesSystem.js";
import { getXpThresholds } from "../../src/state/levelRewardsSystem.js";
import { DEFAULT_STARTING_TOKENS } from "../../src/state/storeSystem.js";

const FIXED_DAY7_LOGIN_NOW_MS = Date.parse("2026-06-08T19:05:00-05:00");

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

function waitForEvents(socket, eventName, count) {
  return new Promise((resolve) => {
    const results = [];
    const handleEvent = (payload) => {
      results.push(payload);
      if (results.length >= count) {
        socket.off(eventName, handleEvent);
        resolve(results);
      }
    };

    socket.on(eventName, handleEvent);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStoreSocket(id) {
  return { id };
}

test("multiplayer rooms: featured rival join seeds an asymmetric 8 vs 12 boss hand", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("host-featured");
  const guest = createStoreSocket("guest-featured");

  const created = store.createRoom(host, { username: "Hero" });
  assert.equal(created.ok, true);

  const joined = store.joinRoom(guest, created.room.roomCode, {
    username: "Crownfire Duelist",
    bot: true,
    aiDifficulty: "hard",
    featuredRivalId: "crownfire_duelist"
  });
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.room.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
  assert.deepEqual(joined.room.guestHand, { fire: 3, water: 3, earth: 3, wind: 3 });
  assert.equal(joined.room.featuredRivalId, "crownfire_duelist");
});

test("multiplayer rooms: featured rival rematch reset preserves the asymmetric boss hand counts", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("host-featured-rematch");
  const guest = createStoreSocket("guest-featured-rematch");

  const created = store.createRoom(host, { username: "Hero" });
  const joined = store.joinRoom(guest, created.room.roomCode, {
    username: "Crownfire Duelist",
    bot: true,
    aiDifficulty: "hard",
    featuredRivalId: "crownfire_duelist"
  });
  assert.equal(joined.ok, true);

  const completed = store.completeMatch(host.id, { winner: "guest", reason: "manual_test" });
  assert.equal(completed.ok, true);

  const firstReady = store.readyRematch(host.id);
  assert.equal(firstReady.ok, true);
  assert.equal(firstReady.rematchStarted, false);

  const secondReady = store.readyRematch(guest.id);
  assert.equal(secondReady.ok, true);
  assert.equal(secondReady.rematchStarted, true);
  assert.deepEqual(secondReady.room.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
  assert.deepEqual(secondReady.room.guestHand, { fire: 3, water: 3, earth: 3, wind: 3 });
  assert.equal(secondReady.room.featuredRivalId, "crownfire_duelist");
});

async function bootstrapSession(socket, username) {
  return new Promise((resolve) => {
    socket.emit("session:bootstrap", { username }, resolve);
  });
}

async function resumeSession(socket, sessionToken) {
  return new Promise((resolve) => {
    socket.emit("session:resume", { sessionToken }, resolve);
  });
}

async function loginAccount(socket, { email, password }) {
  return new Promise((resolve) => {
    socket.emit("auth:login", { email, password }, resolve);
  });
}

async function registerAccount(socket, { username, email, password }) {
  return new Promise((resolve) => {
    socket.emit("auth:register", { username, email, password }, resolve);
  });
}

async function emitWithAck(socket, eventName, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(eventName, payload, resolve);
  });
}

function createCompletedLocalMatchState({
  mode = "pve",
  winner = "p1",
  endReason = null,
  round = 3,
  difficulty = "normal",
  featuredRivalId = null,
  gauntletRivalId = null
} = {}) {
  return {
    status: "completed",
    mode,
    difficulty,
    ...(featuredRivalId ? { featuredRivalId } : {}),
    ...(gauntletRivalId ? { gauntletRivalId } : {}),
    winner,
    endReason,
    round,
    history: [
      {
        round: 1,
        result: winner === "draw" ? "none" : winner,
        p1Card: "fire",
        p2Card: "earth",
        warClashes: 0,
        capturedCards: winner === "draw" ? 0 : 2,
        capturedOpponentCards: winner === "draw" ? 0 : 1
      }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: {
      totalCards: 8,
      startedAt: "2026-05-12T12:00:00.000Z",
      endedAt: "2026-05-12T12:03:00.000Z"
    }
  };
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

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-mp-rewards-"));
}

async function submitRoundPair(host, guest, hostMove, guestMove, laterSyncCount = 2) {
  const hostFirstSync = waitForEvent(host, "room:moveSync");
  const guestFirstSync = waitForEvent(guest, "room:moveSync");
  host.emit("room:submitMove", { move: hostMove });
  await hostFirstSync;
  await guestFirstSync;

  const hostLaterSyncs = waitForEvents(host, "room:moveSync", laterSyncCount);
  const guestLaterSyncs = waitForEvents(guest, "room:moveSync", laterSyncCount);
  const hostRoundResult = waitForEvent(host, "room:roundResult");
  const guestRoundResult = waitForEvent(guest, "room:roundResult");
  guest.emit("room:submitMove", { move: guestMove });

  return {
    hostRoundResult: await hostRoundResult,
    guestRoundResult: await guestRoundResult,
    hostLaterSyncs: await hostLaterSyncs,
    guestLaterSyncs: await guestLaterSyncs
  };
}

const OPENING_WIN_SEQUENCE = [
  ["fire", "earth"],
  ["fire", "earth"],
  ["water", "fire"],
  ["earth", "wind"],
  ["wind", "water"]
];

function createOnlinePersistencePersister(coordinator) {
  return async ({ room, summary, decision, settlementKey }) => {
    const matchState = buildOnlineMatchStateFromRoom(room);
    const rewardDecision = decision ?? room?.rewardSettlement?.decision ?? null;
    const hostUsername =
      rewardDecision?.participants?.hostUsername ?? summary?.settledHostUsername ?? null;
    const guestUsername =
      rewardDecision?.participants?.guestUsername ?? summary?.settledGuestUsername ?? null;

    if (hostUsername) {
      await coordinator.recordOnlineMatchResult({
        username: hostUsername,
        perspective: "p1",
        matchState,
        settlementKey
      });
      await coordinator.applyOnlineRewardSettlementDecision({
        username: hostUsername,
        settlementKey,
        rewardDecision,
        participantRole: "host"
      });
    }

    if (guestUsername) {
      await coordinator.recordOnlineMatchResult({
        username: guestUsername,
        perspective: "p2",
        matchState,
        settlementKey
      });
      await coordinator.applyOnlineRewardSettlementDecision({
        username: guestUsername,
        settlementKey,
        rewardDecision,
        participantRole: "guest"
      });
    }
  };
}

function createOnlineDisconnectTracker(coordinator) {
  return async ({ type, username, occurredAt }) => {
    if (type === "live_match_disconnect") {
      await coordinator.recordOnlineLiveMatchDisconnect({ username, occurredAt });
      return;
    }

    if (type === "reconnect_resume") {
      await coordinator.recordOnlineReconnectResume({ username, occurredAt });
      return;
    }

    if (type === "reconnect_timeout_expired") {
      await coordinator.recordOnlineReconnectTimeoutExpiration({ username, occurredAt });
    }
  };
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
      phase: MULTIPLAYER_FOUNDATION_PHASE,
      transport: "socket.io"
    });
    assert.equal(logEntries.length, 0);
    assert.equal(typeof foundation.io.on, "function");
  } finally {
    await foundation.stop();
  }
});

test("multiplayer rooms: invalid or missing visibility defaults rooms to private and keeps them out of the public list", () => {
  const store = createRoomStore({
    random: (() => {
      const values = [0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
      let index = 0;
      return () => values[index++] ?? 0;
    })()
  });

  const hostOne = createStoreSocket("host-private-default");
  const hostTwo = createStoreSocket("host-private-invalid");
  const firstRoom = store.createRoom(hostOne, { username: "DefaultPrivateHost" });
  const secondRoom = store.createRoom(hostTwo, {
    username: "InvalidPrivateHost",
    visibility: "friends_only"
  });

  assert.equal(firstRoom.ok, true);
  assert.equal(secondRoom.ok, true);
  assert.equal(firstRoom.room.visibility, "private");
  assert.equal(secondRoom.room.visibility, "private");
  assert.deepEqual(store.listPublicRooms(), []);
});

test("multiplayer rooms: public room list includes only safe waiting public rooms", () => {
  const store = createRoomStore({
    random: (() => {
      const values = [
        0, 0, 0, 0, 0, 0,
        0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
        0.4, 0.4, 0.4, 0.4, 0.4, 0.4,
        0.5, 0.5, 0.5, 0.5, 0.5, 0.5
      ];
      let index = 0;
      return () => values[index++] ?? 0.6;
    })()
  });

  const waitingHost = createStoreSocket("waiting-host");
  const fullHost = createStoreSocket("full-host");
  const fullGuest = createStoreSocket("full-guest");
  const pausedHost = createStoreSocket("paused-host");
  const pausedGuest = createStoreSocket("paused-guest");
  const expiredHost = createStoreSocket("expired-host");
  const expiredGuest = createStoreSocket("expired-guest");
  const closingHost = createStoreSocket("closing-host");
  const closingGuest = createStoreSocket("closing-guest");
  const completeHost = createStoreSocket("complete-host");
  const completeGuest = createStoreSocket("complete-guest");
  const privateHost = createStoreSocket("private-host");

  const waitingRoom = store.createRoom(waitingHost, {
    username: "WaitingHost",
    visibility: "public",
    equippedCosmetics: {
      avatar: "avatar_crystal_soul",
      background: "bg_verdant_shrine"
    }
  });
  const fullRoom = store.createRoom(fullHost, { username: "FullHost", visibility: "public" });
  const pausedRoom = store.createRoom(pausedHost, { username: "PausedHost", visibility: "public" });
  const expiredRoom = store.createRoom(expiredHost, { username: "ExpiredHost", visibility: "public" });
  const closingRoom = store.createRoom(closingHost, { username: "ClosingHost", visibility: "public" });
  const completeRoom = store.createRoom(completeHost, { username: "CompleteHost", visibility: "public" });
  const privateRoom = store.createRoom(privateHost, { username: "PrivateHost", visibility: "private" });

  store.joinRoom(fullGuest, fullRoom.room.roomCode, { username: "FullGuest" });
  store.joinRoom(pausedGuest, pausedRoom.room.roomCode, { username: "PausedGuest" });
  store.joinRoom(expiredGuest, expiredRoom.room.roomCode, { username: "ExpiredGuest" });
  store.joinRoom(closingGuest, closingRoom.room.roomCode, { username: "ClosingGuest" });
  store.joinRoom(completeGuest, completeRoom.room.roomCode, { username: "CompleteGuest" });

  store.submitMove(pausedHost.id, "fire");
  store.submitMove(expiredHost.id, "fire");
  store.removeSocket(pausedHost.id);
  store.removeSocket(expiredHost.id);
  store.expireDisconnectedRoom(expiredRoom.room.roomCode);
  store.completeMatch(closingHost.id, { winner: "host", reason: "manual" });
  store.removeSocket(closingHost.id);
  store.completeMatch(completeHost.id, { winner: "host", reason: "manual" });

  assert.equal(waitingRoom.room.visibility, "public");
  assert.equal(waitingRoom.room.status, "waiting");
  assert.equal(waitingRoom.room.guest, null);
  assert.equal(privateRoom.room.visibility, "private");
  assert.deepEqual(store.listPublicRooms(), [
    {
      roomCode: waitingRoom.room.roomCode,
      createdAt: waitingRoom.room.createdAt,
      hostUsername: "WaitingHost",
      hostCosmetics: {
        avatar: "avatar_crystal_soul",
        background: "bg_verdant_shrine",
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
      visibility: "public",
      status: "waiting"
    }
  ]);
});

test("multiplayer foundation: room:listPublic returns summarized waiting public rooms only", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} }
  });

  try {
    const port = await foundation.start();
    const host = await connectClient(port);
    const guest = await connectClient(port);
    const browser = await connectClient(port);

    try {
      await bootstrapSession(host, "PublicHost");
      await bootstrapSession(guest, "GuestPlayer");
      await bootstrapSession(browser, "BrowserUser");

      const createdPromise = waitForEvent(host, "room:created");
      host.emit("room:create", { visibility: "public" });
      const room = await createdPromise;

      const waitingList = await new Promise((resolve) => {
        browser.emit("room:listPublic", {}, resolve);
      });

      assert.deepEqual(waitingList, {
        ok: true,
        rooms: [
          {
            roomCode: room.roomCode,
            createdAt: room.createdAt,
            hostUsername: "PublicHost",
            hostCosmetics: room.host.equippedCosmetics,
            visibility: "public",
            status: "waiting"
          }
        ]
      });

      const joinedPromise = waitForEvent(guest, "room:joined");
      const hostUpdatePromise = waitForEvent(host, "room:update");
      guest.emit("room:join", { roomCode: room.roomCode });
      await joinedPromise;
      await hostUpdatePromise;

      const fullList = await new Promise((resolve) => {
        browser.emit("room:listPublic", {}, resolve);
      });

      assert.deepEqual(fullList, {
        ok: true,
        rooms: []
      });
    } finally {
      host.disconnect();
      guest.disconnect();
      browser.disconnect();
    }
  } finally {
    await foundation.stop();
  }
});

test("multiplayer foundation: room:listPublic returns ok true with an empty rooms array when nothing is public", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const browser = await connectClient(port);

    try {
      await bootstrapSession(browser, "BrowserUser");

      const response = await new Promise((resolve) => {
        browser.emit("room:listPublic", {}, resolve);
      });

      assert.deepEqual(response, {
        ok: true,
        rooms: []
      });
    } finally {
      browser.disconnect();
    }
  } finally {
    await foundation.stop();
  }
});

test("multiplayer foundation: room:listPublic always acks a readable auth failure", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const browser = await connectClient(port);

    try {
      const response = await new Promise((resolve) => {
        browser.emit("room:listPublic", { sessionToken: "missing-token" }, resolve);
      });

      assert.deepEqual(response, {
        ok: false,
        error: {
          code: "SESSION_NOT_FOUND",
          message: "This online session is no longer valid."
        }
      });
    } finally {
      browser.disconnect();
    }
  } finally {
    await foundation.stop();
  }
});

test("session store: authenticated connected username count ignores unauthenticated, disconnected, and duplicate usernames", () => {
  const store = createSessionStore({
    logger: { info: () => {} }
  });

  const firstSession = store.issueSession({
    username: "CountedUser",
    socketId: "socket-1",
    authenticated: true
  });
  const unauthenticatedSession = store.issueSession({
    username: "GuestUser",
    socketId: "socket-2",
    authenticated: false
  });
  const disconnectedSession = store.issueSession({
    username: "DisconnectedUser",
    socketId: "socket-3",
    authenticated: true
  });

  assert.equal(firstSession.ok, true);
  assert.equal(unauthenticatedSession.ok, true);
  assert.equal(disconnectedSession.ok, true);
  store.disconnectSocket("socket-3");

  const duplicateAttempt = store.issueSession({
    username: "CountedUser",
    socketId: "socket-4",
    authenticated: true
  });

  assert.equal(duplicateAttempt.ok, false);
  assert.equal(store.getAuthenticatedConnectedUsernameCount(), 1);
});

test("session store: remembered authenticated sessions survive store recreation and expire after 30 days", async () => {
  const dataDir = await createTempDataDir();
  const baseNow = Date.parse("2026-03-01T12:00:00.000Z");

  try {
    const initialStore = createSessionStore({
      logger: { info: () => {}, warn: () => {} },
      dataDir,
      now: () => baseNow
    });
    const issued = initialStore.issueSession({
      username: "RememberedUser",
      socketId: "socket-remembered-1",
      authenticated: true,
      rememberSession: true
    });
    assert.equal(issued.ok, true);
    initialStore.disconnectSocket("socket-remembered-1");

    const recreatedStore = createSessionStore({
      logger: { info: () => {}, warn: () => {} },
      dataDir,
      now: () => baseNow + (1000 * 60 * 60 * 24 * 7)
    });
    const resumed = recreatedStore.resumeSession({
      token: issued.session.token,
      socketId: "socket-remembered-2"
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.session?.rememberSession, true);

    const expiredStore = createSessionStore({
      logger: { info: () => {}, warn: () => {} },
      dataDir,
      now: () => baseNow + (1000 * 60 * 60 * 24 * 31)
    });
    const expiredResume = expiredStore.resumeSession({
      token: issued.session.token,
      socketId: "socket-remembered-3"
    });
    assert.equal(expiredResume.ok, false);
    assert.equal(expiredResume.error?.code, "SESSION_EXPIRED");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: presence:getOnlineCount returns only authenticated connected usernames", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({ dataDir });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    accountStore,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    accountStore,
    profileAuthority,
    logger: { info: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const authOne = await connectClient(port);
    const authTwo = await connectClient(port);
    const unauthenticated = await connectClient(port);

    try {
      await registerAccount(authOne, {
        username: "CountPlayerOne",
        email: "count-one@example.com",
        password: "password123"
      });
      await registerAccount(authTwo, {
        username: "CountPlayerTwo",
        email: "count-two@example.com",
        password: "password123"
      });
      await bootstrapSession(unauthenticated, "BrowserOnly");

      const response = await new Promise((resolve) => {
        authOne.emit("presence:getOnlineCount", {}, resolve);
      });

      assert.deepEqual(response, {
        ok: true,
        result: {
          onlineNow: 2
        }
      });
    } finally {
      authOne.disconnect();
      authTwo.disconnect();
      unauthenticated.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: announcements:list returns an empty list safely when announcements.json is missing", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const announcementStore = new AnnouncementStore({
    dataDir,
    logger: { warn: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} },
    announcementStore
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "AnnouncementUser");

      const response = await new Promise((resolve) => {
        client.emit("announcements:list", {}, resolve);
      });

      assert.equal(response?.ok, true);
      assert.deepEqual(response?.result?.announcements, []);
      assert.deepEqual(response?.result?.snapshot?.profile?.seenAnnouncements ?? {}, {});
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: announcements:list parses UTF-8 BOM JSON and still filters active announcements by priority", async () => {
  const dataDir = await createTempDataDir();
  const announcementsPath = path.join(dataDir, "server-data", "announcements.json");
  await fs.mkdir(path.dirname(announcementsPath), { recursive: true });
  await fs.writeFile(
    announcementsPath,
    `\ufeff${JSON.stringify([
      {
        id: "patch-low",
        title: "Patch Low",
        message: "Lower priority active announcement.",
        type: "patch",
        priority: 1,
        active: true,
        dismissible: true,
        startsAt: null,
        endsAt: null
      },
      {
        id: "patch-top",
        title: "Patch Top",
        message: "Highest priority visible announcement.",
        type: "patch",
        priority: 10,
        active: true,
        dismissible: true,
        startsAt: null,
        endsAt: null
      },
      {
        id: "inactive",
        title: "Inactive",
        message: "Should not render.",
        active: false
      },
      {
        id: "future",
        title: "Future",
        message: "Starts later.",
        active: true,
        startsAt: "2099-01-01T00:00:00.000Z"
      },
      {
        id: "expired",
        title: "Expired",
        message: "Already ended.",
        active: true,
        endsAt: "2020-01-01T00:00:00.000Z"
      }
    ])}`,
    "utf8"
  );

  const coordinator = new StateCoordinator({ dataDir });
  const announcementStore = new AnnouncementStore({
    dataDir,
    logger: { warn: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} },
    announcementStore
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "AnnouncementUser");

      const bomResponse = await new Promise((resolve) => {
        client.emit("announcements:list", {}, resolve);
      });

      assert.equal(bomResponse?.ok, true);
      assert.deepEqual(
        bomResponse?.result?.announcements?.map((announcement) => announcement.id),
        ["patch-top", "patch-low"]
      );
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
  }

  const filteredCoordinator = new StateCoordinator({ dataDir });
  await filteredCoordinator.profiles.updateProfile("DismissedUser", (current) => ({
    ...current,
    username: "DismissedUser",
    seenAnnouncements: {
      ...(current?.seenAnnouncements ?? {}),
      "announcement:patch-top": true
    }
  }));
  const filteredAuthority = new MultiplayerProfileAuthority({
    coordinator: filteredCoordinator,
    logger: { info: () => {} },
    announcementStore: new AnnouncementStore({
      dataDir,
      logger: { warn: () => {} }
    })
  });
  const filteredFoundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority: filteredAuthority,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await filteredFoundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "DismissedUser");

      const response = await new Promise((resolve) => {
        client.emit("announcements:list", {}, resolve);
      });

      assert.equal(response?.ok, true);
      assert.deepEqual(
        response?.result?.announcements?.map((announcement) => announcement.id),
        ["patch-low"]
      );
    } finally {
      client.disconnect();
    }
  } finally {
    await filteredFoundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: announcements:list ignores malformed JSON without crashing", async () => {
  const dataDir = await createTempDataDir();
  const malformedPath = path.join(dataDir, "server-data", "announcements.json");
  await fs.mkdir(path.dirname(malformedPath), { recursive: true });
  await fs.writeFile(malformedPath, "{not-json", "utf8");

  const coordinator = new StateCoordinator({ dataDir });
  const announcementStore = new AnnouncementStore({
    dataDir,
    logger: { warn: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} },
    announcementStore
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "AnnouncementUser");

      const malformedResponse = await new Promise((resolve) => {
        client.emit("announcements:list", {}, resolve);
      });

      assert.equal(malformedResponse?.ok, true);
      assert.deepEqual(malformedResponse?.result?.announcements, []);
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: shopRotation:getActive seeds approved defaults when rotation files are missing", async () => {
  const dataDir = await createTempDataDir();
  const anchorMs = Date.parse("2026-05-15T00:00:00.000Z");
  const rotationLengthMs = 7 * 24 * 60 * 60 * 1000;
  const rotationOrder = [
    "void-week-01",
    "flame-king-weekend-01",
    "lucky-drop-01",
    "celestial-feature-01",
    "frostveil-court-01",
    "goldbound-relics-01",
    "neon-arcana-01",
    "vampire-elegance-01",
    "lycan-power-01"
  ];
  const expectedRotations = {
    "void-week-01": {
      title: "Void Week",
      message: "Void Collection cosmetics are featured this week.",
      featuredCosmeticIds: [
        "avatar_voidbound_entity",
        "cardback_void_tease",
        "void_card_back",
        "void_altar_background",
        "title_void_doll"
      ],
      allowLimitedCosmeticIds: [
        "avatar_voidbound_entity",
        "void_card_back",
        "void_altar_background"
      ]
    },
    "flame-king-weekend-01": {
      title: "Flame King Week",
      message: "Rule the arena with Flame King Collection cosmetics.",
      featuredCosmeticIds: [
        "avatar_inferno_crown_f",
        "avatar_inferno_crown_m",
        "cardback_flame_tyrant",
        "lava_throne_background",
        "fire_variant_crownfire",
        "title_crownless_king"
      ],
      allowLimitedCosmeticIds: [
        "avatar_inferno_crown_f",
        "avatar_inferno_crown_m",
        "lava_throne_background",
        "fire_variant_crownfire"
      ]
    },
    "lucky-drop-01": {
      title: "Lucky Drop",
      message: "Lucky Collection cosmetics are featured in the Store.",
      featuredCosmeticIds: [
        "avatar_arcane_gambler",
        "avatar_mimic_entity",
        "elemental_chest_cardback",
        "cardback_lucky_you"
      ],
      allowLimitedCosmeticIds: ["elemental_chest_cardback"]
    },
    "celestial-feature-01": {
      title: "Celestial Feature",
      message: null,
      featuredCosmeticIds: [
        "avatar_astral_archon",
        "avatar_golden_menace",
        "bg_celestial_observatory",
        "celestial_void_background",
        "title_divine_menace"
      ],
      allowLimitedCosmeticIds: [
        "avatar_astral_archon",
        "avatar_golden_menace",
        "bg_celestial_observatory"
      ]
    },
    "frostveil-court-01": {
      title: "Frostveil Court",
      message: null,
      featuredCosmeticIds: [
        "avatar_frostveil_heir",
        "cardback_glacier_sigil",
        "fire_variant_aurora_flare",
        "earth_variant_icebound_crag",
        "wind_variant_sleet_spiral",
        "water_variant_frostbloom",
        "title_shiverborne"
      ],
      allowLimitedCosmeticIds: ["cardback_glacier_sigil"]
    },
    "goldbound-relics-01": {
      title: "Goldbound Relics",
      message: null,
      featuredCosmeticIds: [
        "avatar_aurelian_archon",
        "cardback_goldbound_relic",
        "fire_variant_goldbound_relics",
        "earth_variant_goldbound_relics",
        "wind_variant_goldbound_relics",
        "water_variant_goldbound_relics",
        "title_goldbound"
      ],
      allowLimitedCosmeticIds: ["cardback_goldbound_relic"]
    },
    "neon-arcana-01": {
      title: "Neon Arcana",
      message: null,
      featuredCosmeticIds: [
        "cardback_neon_arcana",
        "title_spellwired",
        "avatar_neon_pyre_entity",
        "avatar_neon_tide_entity",
        "avatar_neon_stone_entity",
        "avatar_neon_gale_entity",
        "earth_variant_neon_arcana",
        "fire_variant_neon_arcana",
        "water_variant_neon_arcana",
        "wind_variant_neon_arcana"
      ],
      allowLimitedCosmeticIds: []
    },
    "vampire-elegance-01": {
      title: "Vampire Elegance",
      message: null,
      featuredCosmeticIds: [
        "avatar_vampire_female",
        "avatar_vampire_male",
        "cardback_blood_gem",
        "cardback_winged_coffin",
        "fire_variant_flame_wings",
        "earth_variant_stone_graves",
        "wind_variant_wings_wind",
        "water_variant_blood_wings"
      ],
      allowLimitedCosmeticIds: []
    },
    "lycan-power-01": {
      title: "Lycan Power",
      message: null,
      featuredCosmeticIds: [
        "avatar_lycan_female",
        "avatar_lycan_male",
        "cardback_lycan_pack",
        "background_bg_lycan_law",
        "fire_variant_fire_paw",
        "earth_variant_stone_paw",
        "wind_variant_lycan_duo",
        "water_variant_water_wolf"
      ],
      allowLimitedCosmeticIds: []
    }
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    shopRotationStore: new ShopRotationStore({
      dataDir,
      logger: { warn: () => {} }
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "RotationUser");

      const response = await new Promise((resolve) => {
        client.emit("shopRotation:getActive", {}, resolve);
      });
      const nowMs = Date.now();
      const elapsedMs = Math.max(0, nowMs - anchorMs);
      const rotationIndex = Math.floor(elapsedMs / rotationLengthMs);
      const expectedRotationId = rotationOrder[rotationIndex % rotationOrder.length];
      const expectedRotation = expectedRotations[expectedRotationId];
      const expectedStartsAtMs = anchorMs + rotationIndex * rotationLengthMs;

      assert.deepEqual(response, {
        ok: true,
        result: {
          rotation: {
            activeRotationId: expectedRotationId,
            title: expectedRotation.title,
            message: expectedRotation.message,
            startsAt: new Date(expectedStartsAtMs).toISOString(),
            endsAt: new Date(expectedStartsAtMs + rotationLengthMs).toISOString(),
            featuredCosmeticIds: expectedRotation.featuredCosmeticIds,
            allowLimitedCosmeticIds: expectedRotation.allowLimitedCosmeticIds
          }
        }
      });
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: shopRotation:getActive parses UTF-8 BOM JSON, skips duplicates and unknown ids, and returns active featured ids", async () => {
  const dataDir = await createTempDataDir();
  const rotationPath = path.join(dataDir, "server-data", "shop-rotation.json");
  const schedulePath = path.join(dataDir, "server-data", "shop-rotation-schedule.json");
  await fs.mkdir(path.dirname(rotationPath), { recursive: true });
  await fs.writeFile(
    rotationPath,
    `\ufeff${JSON.stringify({
      activeRotationId: "void-week-01",
      title: "Void Week",
      message: "Void Collection cosmetics are featured this week.",
      startsAt: null,
      endsAt: null,
      featuredCosmeticIds: [
        "avatar_voidbound_entity",
        "cardback_void_tease",
        "cardback_void_tease",
        "missing_cosmetic_id",
        "void_card_back"
      ],
      allowLimitedCosmeticIds: [
        "avatar_voidbound_entity",
        "avatar_voidbound_entity",
        "supporter_card_back",
        "missing_cosmetic_id",
        "void_card_back"
      ]
    })}`,
    "utf8"
  );
  await fs.writeFile(
    schedulePath,
    JSON.stringify({
      enabled: false,
      mode: "weekly",
      rotationLengthDays: 7,
      anchorDate: "2026-05-18T00:00:00.000Z",
      rotationOrder: ["void-week-01"],
      rotations: {
        "void-week-01": {
          title: "Void Week",
          featuredCosmeticIds: ["avatar_voidbound_entity"]
        }
      }
    }),
    "utf8"
  );

  const foundation = createMultiplayerFoundation({
    port: 0,
    shopRotationStore: new ShopRotationStore({
      dataDir,
      logger: { warn: () => {} }
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "RotationUser");

      const response = await new Promise((resolve) => {
        client.emit("shopRotation:getActive", {}, resolve);
      });

      assert.equal(response?.ok, true);
      assert.deepEqual(response?.result?.rotation, {
        activeRotationId: "void-week-01",
        title: "Void Week",
        message: "Void Collection cosmetics are featured this week.",
        startsAt: null,
        endsAt: null,
        featuredCosmeticIds: [
          "avatar_voidbound_entity",
          "cardback_void_tease",
          "void_card_back"
        ],
        allowLimitedCosmeticIds: [
          "avatar_voidbound_entity",
          "void_card_back"
        ]
      });
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: shopRotation:getActive ignores malformed, future, and expired rotations without crashing", async () => {
  const dataDir = await createTempDataDir();
  const rotationPath = path.join(dataDir, "server-data", "shop-rotation.json");
  const schedulePath = path.join(dataDir, "server-data", "shop-rotation-schedule.json");
  await fs.mkdir(path.dirname(rotationPath), { recursive: true });
  await fs.writeFile(rotationPath, "{ nope", "utf8");
  await fs.writeFile(
    schedulePath,
    JSON.stringify({
      enabled: false,
      mode: "weekly",
      rotationLengthDays: 7,
      anchorDate: "2026-05-18T00:00:00.000Z",
      rotationOrder: ["void-week-01"],
      rotations: {
        "void-week-01": {
          title: "Void Week",
          featuredCosmeticIds: ["avatar_voidbound_entity"]
        }
      }
    }),
    "utf8"
  );

  const malformedFoundation = createMultiplayerFoundation({
    port: 0,
    shopRotationStore: new ShopRotationStore({
      dataDir,
      logger: { warn: () => {} }
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await malformedFoundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "RotationUser");

      const malformedResponse = await new Promise((resolve) => {
        client.emit("shopRotation:getActive", {}, resolve);
      });

      assert.deepEqual(malformedResponse, {
        ok: true,
        result: {
          rotation: null
        }
      });
    } finally {
      client.disconnect();
    }
  } finally {
    await malformedFoundation.stop();
  }

  await fs.writeFile(
    rotationPath,
    JSON.stringify({
      activeRotationId: "future-rotation",
      title: "Future Rotation",
      startsAt: "2099-01-01T00:00:00.000Z",
      endsAt: null,
      featuredCosmeticIds: ["avatar_voidbound_entity"]
    }),
    "utf8"
  );

  const futureFoundation = createMultiplayerFoundation({
    port: 0,
    shopRotationStore: new ShopRotationStore({
      dataDir,
      logger: { warn: () => {} }
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await futureFoundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "RotationUser");

      const futureResponse = await new Promise((resolve) => {
        client.emit("shopRotation:getActive", {}, resolve);
      });

      assert.deepEqual(futureResponse, {
        ok: true,
        result: {
          rotation: null
        }
      });
    } finally {
      client.disconnect();
    }
  } finally {
    await futureFoundation.stop();
  }

  await fs.writeFile(
    rotationPath,
    JSON.stringify({
      activeRotationId: "expired-rotation",
      title: "Expired Rotation",
      startsAt: null,
      endsAt: "2020-01-01T00:00:00.000Z",
      featuredCosmeticIds: ["avatar_voidbound_entity"]
    }),
    "utf8"
  );

  const expiredFoundation = createMultiplayerFoundation({
    port: 0,
    shopRotationStore: new ShopRotationStore({
      dataDir,
      logger: { warn: () => {} }
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await expiredFoundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "RotationUser");

      const expiredResponse = await new Promise((resolve) => {
        client.emit("shopRotation:getActive", {}, resolve);
      });

      assert.deepEqual(expiredResponse, {
        ok: true,
        result: {
          rotation: null
        }
      });
    } finally {
      client.disconnect();
    }
  } finally {
    await expiredFoundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("shop rotation store: missing schedule file seeds the approved weekly default and resolves the scheduled rotation", async () => {
  const dataDir = await createTempDataDir();
  const rotationPath = path.join(dataDir, "server-data", "shop-rotation.json");
  const schedulePath = path.join(dataDir, "server-data", "shop-rotation-schedule.json");
  await fs.mkdir(path.dirname(rotationPath), { recursive: true });
  await fs.writeFile(
    rotationPath,
    JSON.stringify({
      activeRotationId: "manual-void",
      title: "Manual Void",
      message: "Manual fallback rotation.",
      featuredCosmeticIds: ["avatar_voidbound_entity"],
      allowLimitedCosmeticIds: ["avatar_voidbound_entity"]
    }),
    "utf8"
  );

  const store = new ShopRotationStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    const rotation = await store.getActiveRotation({ now: new Date("2026-05-16T12:00:00.000Z") });
    const scheduleJson = JSON.parse(await fs.readFile(schedulePath, "utf8"));

    assert.deepEqual(rotation, {
      activeRotationId: "void-week-01",
      title: "Void Week",
      message: "Void Collection cosmetics are featured this week.",
      startsAt: "2026-05-15T00:00:00.000Z",
      endsAt: "2026-05-22T00:00:00.000Z",
      featuredCosmeticIds: [
        "avatar_voidbound_entity",
        "cardback_void_tease",
        "void_card_back",
        "void_altar_background",
        "title_void_doll"
      ],
      allowLimitedCosmeticIds: [
        "avatar_voidbound_entity",
        "void_card_back",
        "void_altar_background"
      ]
    });
    assert.deepEqual(scheduleJson, {
      enabled: true,
      mode: "weekly",
      rotationLengthDays: 7,
      anchorDate: "2026-05-15T00:00:00.000Z",
      rotationOrder: [
        "void-week-01",
        "flame-king-weekend-01",
        "lucky-drop-01",
        "celestial-feature-01",
        "frostveil-court-01",
        "goldbound-relics-01",
        "neon-arcana-01",
        "vampire-elegance-01",
        "lycan-power-01"
      ],
      rotations: {
        "void-week-01": {
          title: "Void Week",
          message: "Void Collection cosmetics are featured this week.",
          featuredCosmeticIds: [
            "avatar_voidbound_entity",
            "cardback_void_tease",
            "void_card_back",
            "void_altar_background",
            "title_void_doll"
          ],
          allowLimitedCosmeticIds: [
            "avatar_voidbound_entity",
            "void_card_back",
            "void_altar_background"
          ]
        },
        "flame-king-weekend-01": {
          title: "Flame King Week",
          message: "Rule the arena with Flame King Collection cosmetics.",
          featuredCosmeticIds: [
            "avatar_inferno_crown_f",
            "avatar_inferno_crown_m",
            "cardback_flame_tyrant",
            "lava_throne_background",
            "fire_variant_crownfire",
            "title_crownless_king"
          ],
          allowLimitedCosmeticIds: [
            "avatar_inferno_crown_f",
            "avatar_inferno_crown_m",
            "lava_throne_background",
            "fire_variant_crownfire"
          ]
        },
        "lucky-drop-01": {
          title: "Lucky Drop",
          message: "Lucky Collection cosmetics are featured in the Store.",
          featuredCosmeticIds: [
            "avatar_arcane_gambler",
            "avatar_mimic_entity",
            "elemental_chest_cardback",
            "cardback_lucky_you"
          ],
          allowLimitedCosmeticIds: ["elemental_chest_cardback"]
        },
        "celestial-feature-01": {
          title: "Celestial Feature",
          featuredCosmeticIds: [
            "avatar_astral_archon",
            "avatar_golden_menace",
            "bg_celestial_observatory",
            "celestial_void_background",
            "title_divine_menace"
          ],
          allowLimitedCosmeticIds: [
            "avatar_astral_archon",
            "avatar_golden_menace",
            "bg_celestial_observatory"
          ]
        },
        "frostveil-court-01": {
          title: "Frostveil Court",
          featuredCosmeticIds: [
            "avatar_frostveil_heir",
            "cardback_glacier_sigil",
            "fire_variant_aurora_flare",
            "earth_variant_icebound_crag",
            "wind_variant_sleet_spiral",
            "water_variant_frostbloom",
            "title_shiverborne"
          ],
          allowLimitedCosmeticIds: ["cardback_glacier_sigil"]
        },
        "goldbound-relics-01": {
          title: "Goldbound Relics",
          featuredCosmeticIds: [
            "avatar_aurelian_archon",
            "cardback_goldbound_relic",
            "fire_variant_goldbound_relics",
            "earth_variant_goldbound_relics",
            "wind_variant_goldbound_relics",
            "water_variant_goldbound_relics",
            "title_goldbound"
          ],
          allowLimitedCosmeticIds: ["cardback_goldbound_relic"]
        },
        "neon-arcana-01": {
          title: "Neon Arcana",
          featuredCosmeticIds: [
            "cardback_neon_arcana",
            "title_spellwired",
            "avatar_neon_pyre_entity",
            "avatar_neon_tide_entity",
            "avatar_neon_stone_entity",
            "avatar_neon_gale_entity",
            "earth_variant_neon_arcana",
            "fire_variant_neon_arcana",
            "water_variant_neon_arcana",
            "wind_variant_neon_arcana"
          ],
          allowLimitedCosmeticIds: []
        },
        "vampire-elegance-01": {
          title: "Vampire Elegance",
          featuredCosmeticIds: [
            "avatar_vampire_female",
            "avatar_vampire_male",
            "cardback_blood_gem",
            "cardback_winged_coffin",
            "fire_variant_flame_wings",
            "earth_variant_stone_graves",
            "wind_variant_wings_wind",
            "water_variant_blood_wings"
          ],
          allowLimitedCosmeticIds: []
        },
        "lycan-power-01": {
          title: "Lycan Power",
          featuredCosmeticIds: [
            "avatar_lycan_female",
            "avatar_lycan_male",
            "cardback_lycan_pack",
            "background_bg_lycan_law",
            "fire_variant_fire_paw",
            "earth_variant_stone_paw",
            "wind_variant_lycan_duo",
            "water_variant_water_wolf"
          ],
          allowLimitedCosmeticIds: []
        }
      }
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("shop rotation store: malformed schedule falls back safely to manual rotation", async () => {
  const dataDir = await createTempDataDir();
  const serverDataDir = path.join(dataDir, "server-data");
  const rotationPath = path.join(serverDataDir, "shop-rotation.json");
  const schedulePath = path.join(serverDataDir, "shop-rotation-schedule.json");
  await fs.mkdir(serverDataDir, { recursive: true });
  await fs.writeFile(
    rotationPath,
    JSON.stringify({
      activeRotationId: "manual-flame",
      title: "Manual Flame",
      featuredCosmeticIds: ["avatar_inferno_crown_f"]
    }),
    "utf8"
  );
  await fs.writeFile(schedulePath, "{ nope", "utf8");

  const store = new ShopRotationStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    const rotation = await store.getActiveRotation({ now: new Date("2026-05-16T12:00:00.000Z") });
    assert.deepEqual(rotation, {
      activeRotationId: "manual-flame",
      title: "Manual Flame",
      message: null,
      startsAt: null,
      endsAt: null,
      featuredCosmeticIds: ["avatar_inferno_crown_f"],
      allowLimitedCosmeticIds: []
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("shop rotation store: disabled and future-dated schedules fall back safely to manual rotation", async () => {
  const dataDir = await createTempDataDir();
  const serverDataDir = path.join(dataDir, "server-data");
  const rotationPath = path.join(serverDataDir, "shop-rotation.json");
  const schedulePath = path.join(serverDataDir, "shop-rotation-schedule.json");
  await fs.mkdir(serverDataDir, { recursive: true });
  await fs.writeFile(
    rotationPath,
    JSON.stringify({
      activeRotationId: "manual-lucky",
      title: "Manual Lucky",
      featuredCosmeticIds: ["avatar_arcane_gambler"]
    }),
    "utf8"
  );

  const store = new ShopRotationStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    await fs.writeFile(
      schedulePath,
      JSON.stringify({
        enabled: false,
        mode: "weekly",
        rotationLengthDays: 7,
        anchorDate: "2026-05-18T00:00:00.000Z",
        rotationOrder: ["void-week-01"],
        rotations: {
          "void-week-01": {
            title: "Void Week",
            featuredCosmeticIds: ["avatar_voidbound_entity"]
          }
        }
      }),
      "utf8"
    );

    const disabledRotation = await store.getActiveRotation({ now: new Date("2026-05-16T12:00:00.000Z") });
    assert.equal(disabledRotation?.activeRotationId, "manual-lucky");

    await fs.writeFile(
      schedulePath,
      JSON.stringify({
        enabled: true,
        mode: "weekly",
        rotationLengthDays: 7,
        anchorDate: "2099-01-01T00:00:00.000Z",
        rotationOrder: ["void-week-01"],
        rotations: {
          "void-week-01": {
            title: "Void Week",
            featuredCosmeticIds: ["avatar_voidbound_entity"]
          }
        }
      }),
      "utf8"
    );

    const futureRotation = await store.getActiveRotation({ now: new Date("2026-05-16T12:00:00.000Z") });
    assert.equal(futureRotation?.activeRotationId, "manual-lucky");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("shop rotation store: valid weekly schedule resolves modulo rotation windows and preserves hardening", async () => {
  const dataDir = await createTempDataDir();
  const serverDataDir = path.join(dataDir, "server-data");
  const schedulePath = path.join(serverDataDir, "shop-rotation-schedule.json");
  await fs.mkdir(serverDataDir, { recursive: true });
  await fs.writeFile(
    schedulePath,
    `\ufeff${JSON.stringify({
      enabled: true,
      mode: "weekly",
      rotationLengthDays: 7,
      anchorDate: "2026-05-18T00:00:00.000Z",
      rotationOrder: ["void-week-01", "flame-king-weekend-01"],
      rotations: {
        "void-week-01": {
          title: "Void Week",
          message: "Void Collection cosmetics are featured this week.",
          featuredCosmeticIds: [
            "avatar_voidbound_entity",
            "avatar_voidbound_entity",
            "supporter_card_back",
            "missing_cosmetic_id",
            "void_card_back"
          ]
        },
        "flame-king-weekend-01": {
          title: "Flame King Week",
          featuredCosmeticIds: ["avatar_inferno_crown_f"],
          allowLimitedCosmeticIds: [
            "avatar_voidbound_entity",
            "avatar_voidbound_entity",
            "supporter_card_back",
            "missing_cosmetic_id",
            "void_card_back"
          ]
        }
      }
    })}`,
    "utf8"
  );

  const store = new ShopRotationStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    const rotation = await store.getActiveRotation({ now: new Date("2026-06-05T12:00:00.000Z") });

    assert.deepEqual(rotation, {
      activeRotationId: "void-week-01",
      title: "Void Week",
      message: "Void Collection cosmetics are featured this week.",
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-06-08T00:00:00.000Z",
      featuredCosmeticIds: ["avatar_voidbound_entity", "void_card_back"],
      allowLimitedCosmeticIds: []
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("shop rotation store: unknown rotation keys in schedule order fall back safely to manual rotation", async () => {
  const dataDir = await createTempDataDir();
  const serverDataDir = path.join(dataDir, "server-data");
  const rotationPath = path.join(serverDataDir, "shop-rotation.json");
  const schedulePath = path.join(serverDataDir, "shop-rotation-schedule.json");
  await fs.mkdir(serverDataDir, { recursive: true });
  await fs.writeFile(
    rotationPath,
    JSON.stringify({
      activeRotationId: "manual-celestial",
      title: "Manual Celestial",
      featuredCosmeticIds: ["avatar_astral_archon"]
    }),
    "utf8"
  );
  await fs.writeFile(
    schedulePath,
    JSON.stringify({
      enabled: true,
      mode: "weekly",
      rotationLengthDays: 7,
      anchorDate: "2026-05-18T00:00:00.000Z",
      rotationOrder: ["missing-rotation-key"],
      rotations: {
        "void-week-01": {
          title: "Void Week",
          featuredCosmeticIds: ["avatar_voidbound_entity"]
        }
      }
    }),
    "utf8"
  );

  const store = new ShopRotationStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    const rotation = await store.getActiveRotation({ now: new Date("2026-05-20T12:00:00.000Z") });
    assert.deepEqual(rotation, {
      activeRotationId: "manual-celestial",
      title: "Manual Celestial",
      message: null,
      startsAt: null,
      endsAt: null,
      featuredCosmeticIds: ["avatar_astral_archon"],
      allowLimitedCosmeticIds: []
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("boost event store: missing file creates boost-event.json and returns null active event", async () => {
  const dataDir = await createTempDataDir();
  const store = new BoostEventStore({
    dataDir,
    logger: { warn: () => {} }
  });
  const filePath = path.join(dataDir, "server-data", "boost-event.json");

  try {
    const activeEvent = await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") });
    const fileContents = await fs.readFile(filePath, "utf8");

    assert.equal(activeEvent, null);
    assert.equal(fileContents, "{}\n");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("boost event store: disabled, future, expired, and malformed configs resolve to null safely", async () => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "server-data", "boost-event.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const store = new BoostEventStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        enabled: false,
        title: "Disabled Boost",
        message: "Disabled boost message.",
        startsAt: null,
        endsAt: null,
        scope: "online",
        excludeDifficulties: [],
        xpMultiplier: 2,
        tokenMultiplier: 1
      }),
      "utf8"
    );
    assert.equal(await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") }), null);

    await fs.writeFile(
      filePath,
      JSON.stringify({
        enabled: true,
        title: "Future Boost",
        message: "Starts later.",
        startsAt: "2099-01-01T00:00:00.000Z",
        endsAt: null,
        scope: "online",
        excludeDifficulties: [],
        xpMultiplier: 2,
        tokenMultiplier: 1
      }),
      "utf8"
    );
    assert.equal(await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") }), null);

    await fs.writeFile(
      filePath,
      JSON.stringify({
        enabled: true,
        title: "Expired Boost",
        message: "Already ended.",
        startsAt: null,
        endsAt: "2020-01-01T00:00:00.000Z",
        scope: "online",
        excludeDifficulties: [],
        xpMultiplier: 2,
        tokenMultiplier: 1
      }),
      "utf8"
    );
    assert.equal(await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") }), null);

    await fs.writeFile(filePath, "{ nope", "utf8");
    assert.equal(await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") }), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("boost event store: valid active event returns normalized payload and invalid config reads as null", async () => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "server-data", "boost-event.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const store = new BoostEventStore({
    dataDir,
    logger: { warn: () => {} }
  });

  try {
    await fs.writeFile(
      filePath,
      `\ufeff${JSON.stringify({
        enabled: true,
        title: " Online Players X2 XP Weekend ",
        message: " Earn double XP in Online Play this weekend. ",
        startsAt: "2026-05-15T18:00:00.000Z",
        endsAt: "2026-05-25T06:00:00.000Z",
        scope: "ONLINE",
        excludeDifficulties: ["easy", "easy"],
        xpMultiplier: 2,
        tokenMultiplier: 1.5
      })}`,
      "utf8"
    );

    const activeEvent = await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") });
    assert.deepEqual(activeEvent, {
      enabled: true,
      title: "Online Players X2 XP Weekend",
      message: "Earn double XP in Online Play this weekend.",
      startsAt: "2026-05-15T18:00:00.000Z",
      endsAt: "2026-05-25T06:00:00.000Z",
      scope: "online",
      excludeDifficulties: ["easy"],
      targets: {
        pve_normal: false,
        pve_hard: false,
        pve_easy: false,
        featured_rival_base: false,
        gauntlet_base: false,
        online_pvp: true,
        local_pvp_casual: false
      },
      targetSummary: "Online PvP",
      xpMultiplier: 2,
      tokenMultiplier: 1.5
    });

    await fs.writeFile(
      filePath,
      JSON.stringify({
        enabled: true,
        title: "Invalid Multiplier",
        message: "Bad config.",
        startsAt: null,
        endsAt: null,
        scope: "online",
        excludeDifficulties: [],
        xpMultiplier: 11,
        tokenMultiplier: 1
      }),
      "utf8"
    );
    assert.equal(await store.readConfig(), null);
    assert.equal(await store.getActiveEvent({ now: new Date("2026-05-16T12:00:00.000Z") }), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: boostEvent:getActive returns null safely for invalid or inactive config", async () => {
  const dataDir = await createTempDataDir();
  const filePath = path.join(dataDir, "server-data", "boost-event.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({
      enabled: true,
      title: "Invalid Scope",
      message: "Should not expose publicly.",
      startsAt: null,
      endsAt: null,
      scope: "ranked_only",
      excludeDifficulties: [],
      xpMultiplier: 2,
      tokenMultiplier: 1
    }),
    "utf8"
  );

  const foundation = createMultiplayerFoundation({
    port: 0,
    boostEventStore: new BoostEventStore({
      dataDir,
      logger: { warn: () => {} }
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "BoostUser");

      const response = await new Promise((resolve) => {
        client.emit("boostEvent:getActive", {}, resolve);
      });

      assert.deepEqual(response, {
        ok: true,
        result: {
          boostEvent: null
        }
      });
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: admin boost event routes validate, persist, read, and clear config", async () => {
  const dataDir = await createTempDataDir();
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const boostEventStore = new BoostEventStore({
    dataDir,
    logger: { warn: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    accountStore,
    boostEventStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const filePath = path.join(dataDir, "server-data", "boost-event.json");
  let adminClient = null;
  let playerClient = null;

  try {
    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });
    await accountStore.register({
      email: "player@example.com",
      password: "PlayerPass123",
      username: "RegularPlayer"
    });

    const port = await foundation.start();
    adminClient = await connectClient(port);
    playerClient = await connectClient(port);

    const adminLogin = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    const playerLogin = await loginAccount(playerClient, {
      email: "player@example.com",
      password: "PlayerPass123"
    });
    assert.equal(adminLogin?.ok, true);
    assert.equal(playerLogin?.ok, true);

    const invalidMultiplierResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:upsertBoostEvent",
        {
          sessionToken: adminLogin?.session?.token,
          enabled: true,
          title: "Bad Multiplier",
          message: "Nope.",
          startsAt: null,
          endsAt: null,
          scope: "online",
          excludeDifficulties: [],
          xpMultiplier: 0.5,
          tokenMultiplier: 1
        },
        resolve
      );
    });
    assert.equal(invalidMultiplierResponse?.ok, false);
    assert.equal(invalidMultiplierResponse?.error?.code, "BOOST_EVENT_XP_MULTIPLIER_INVALID");

    const invalidScopeResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:upsertBoostEvent",
        {
          sessionToken: adminLogin?.session?.token,
          enabled: true,
          title: "Bad Scope",
          message: "Nope.",
          startsAt: null,
          endsAt: null,
          scope: "ranked_only",
          excludeDifficulties: [],
          xpMultiplier: 2,
          tokenMultiplier: 1
        },
        resolve
      );
    });
    assert.equal(invalidScopeResponse?.ok, false);
    assert.equal(invalidScopeResponse?.error?.code, "BOOST_EVENT_SCOPE_INVALID");

    const invalidExcludeDifficultiesResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:upsertBoostEvent",
        {
          sessionToken: adminLogin?.session?.token,
          enabled: true,
          title: "Bad Targets",
          message: "Nope.",
          startsAt: null,
          endsAt: null,
          targets: {
            pve_normal: false,
            pve_hard: false,
            pve_easy: false,
            featured_rival_base: false,
            gauntlet_base: false,
            online_pvp: true,
            local_pvp_casual: false
          },
          excludeDifficulties: "easy",
          xpMultiplier: 2,
          tokenMultiplier: 1
        },
        resolve
      );
    });
    assert.equal(invalidExcludeDifficultiesResponse?.ok, false);
    assert.equal(
      invalidExcludeDifficultiesResponse?.error?.code,
      "BOOST_EVENT_EXCLUDE_DIFFICULTIES_INVALID"
    );

    const explicitTargetOmittedExclusionsResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:upsertBoostEvent",
        {
          sessionToken: adminLogin?.session?.token,
          enabled: true,
          title: "Online Only Weekend",
          message: "Earn boosted online rewards this weekend.",
          startsAt: "2026-05-10T00:00:00.000Z",
          endsAt: "2026-06-29T00:00:00.000Z",
          targets: {
            pve_normal: false,
            pve_hard: false,
            pve_easy: false,
            featured_rival_base: false,
            gauntlet_base: false,
            online_pvp: true,
            local_pvp_casual: false
          },
          xpMultiplier: 2,
          tokenMultiplier: 1.5
        },
        resolve
      );
    });
    assert.equal(explicitTargetOmittedExclusionsResponse?.ok, true);
    assert.deepEqual(explicitTargetOmittedExclusionsResponse?.result?.config, {
      enabled: true,
      title: "Online Only Weekend",
      message: "Earn boosted online rewards this weekend.",
      startsAt: "2026-05-10T00:00:00.000Z",
      endsAt: "2026-06-29T00:00:00.000Z",
      scope: "online",
      excludeDifficulties: [],
      targets: {
        pve_normal: false,
        pve_hard: false,
        pve_easy: false,
        featured_rival_base: false,
        gauntlet_base: false,
        online_pvp: true,
        local_pvp_casual: false
      },
      targetSummary: "Online PvP",
      xpMultiplier: 2,
      tokenMultiplier: 1.5
    });

    const upsertResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:upsertBoostEvent",
        {
          sessionToken: adminLogin?.session?.token,
          enabled: true,
          title: "Elemental Boost Week",
          message: "Earn 1.5x XP and Tokens in eligible modes this week.",
          startsAt: "2026-05-10T00:00:00.000Z",
          endsAt: "2026-06-29T00:00:00.000Z",
          scope: "all",
          excludeDifficulties: ["easy", "easy"],
          xpMultiplier: 1.5,
          tokenMultiplier: 1.5
        },
        resolve
      );
    });

    assert.equal(upsertResponse?.ok, true);
    assert.deepEqual(upsertResponse?.result?.config, {
      enabled: true,
      title: "Elemental Boost Week",
      message: "Earn 1.5x XP and Tokens in eligible modes this week.",
      startsAt: "2026-05-10T00:00:00.000Z",
      endsAt: "2026-06-29T00:00:00.000Z",
      scope: "all",
      excludeDifficulties: ["easy"],
      targets: {
        pve_normal: true,
        pve_hard: true,
        pve_easy: false,
        featured_rival_base: true,
        gauntlet_base: true,
        online_pvp: true,
        local_pvp_casual: false
      },
      targetSummary: "Normal AI, Hard AI, Featured Rival, Gauntlet, Online PvP",
      xpMultiplier: 1.5,
      tokenMultiplier: 1.5
    });
    assert.deepEqual(upsertResponse?.result?.activeEvent, upsertResponse?.result?.config);

    const storedJson = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.deepEqual(storedJson, upsertResponse?.result?.config);

    const adminReadResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:getBoostEvent",
        {
          sessionToken: adminLogin?.session?.token
        },
        resolve
      );
    });
    assert.equal(adminReadResponse?.ok, true);
    assert.deepEqual(adminReadResponse?.result?.config, upsertResponse?.result?.config);
    assert.deepEqual(adminReadResponse?.result?.activeEvent, upsertResponse?.result?.config);

    const publicReadResponse = await new Promise((resolve) => {
      playerClient.emit(
        "boostEvent:getActive",
        {
          sessionToken: playerLogin?.session?.token
        },
        resolve
      );
    });
    assert.equal(publicReadResponse?.ok, true);
    assert.deepEqual(publicReadResponse?.result?.boostEvent, upsertResponse?.result?.config);

    const hiddenWhenMissingAllowlist = await new Promise((resolve) => {
      playerClient.emit(
        "admin:getBoostEvent",
        {
          sessionToken: playerLogin?.session?.token
        },
        resolve
      );
    });
    assert.equal(hiddenWhenMissingAllowlist?.ok, false);
    assert.equal(hiddenWhenMissingAllowlist?.error?.code, "ADMIN_ACCESS_DENIED");

    const clearResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:clearBoostEvent",
        {
          sessionToken: adminLogin?.session?.token
        },
        resolve
      );
    });
    assert.deepEqual(clearResponse, {
      ok: true,
      result: {
        cleared: true,
        config: null,
        activeEvent: null
      }
    });

    const adminReadAfterClear = await new Promise((resolve) => {
      adminClient.emit(
        "admin:getBoostEvent",
        {
          sessionToken: adminLogin?.session?.token
        },
        resolve
      );
    });
    assert.deepEqual(adminReadAfterClear, {
      ok: true,
      result: {
        config: null,
        activeEvent: null
      }
    });

    const publicReadAfterClear = await new Promise((resolve) => {
      playerClient.emit(
        "boostEvent:getActive",
        {
          sessionToken: playerLogin?.session?.token
        },
        resolve
      );
    });
    assert.deepEqual(publicReadAfterClear, {
      ok: true,
      result: {
        boostEvent: null
      }
    });
  } finally {
    adminClient?.disconnect();
    playerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: announcements:dismiss persists seenAnnouncements and hides the dismissed announcement", async () => {
  const dataDir = await createTempDataDir();
  const announcementsPath = path.join(dataDir, "server-data", "announcements.json");
  await fs.mkdir(path.dirname(announcementsPath), { recursive: true });
  await fs.writeFile(
    announcementsPath,
    JSON.stringify([
      {
        id: "patch-2-1-9",
        title: "v2.1.9 Patch Live",
        message: "Fixed the Profile reward popup loop reported by Bane.",
        type: "patch",
        priority: 10,
        active: true,
        dismissible: true,
        startsAt: null,
        endsAt: null
      }
    ]),
    "utf8"
  );

  const coordinator = new StateCoordinator({ dataDir });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} },
    announcementStore: new AnnouncementStore({
      dataDir,
      logger: { warn: () => {} }
    })
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "AnnouncementUser");

      const beforeDismiss = await new Promise((resolve) => {
        client.emit("announcements:list", {}, resolve);
      });
      assert.deepEqual(
        beforeDismiss?.result?.announcements?.map((announcement) => announcement.id),
        ["patch-2-1-9"]
      );

      const dismissResponse = await new Promise((resolve) => {
        client.emit("announcements:dismiss", { id: "patch-2-1-9" }, resolve);
      });

      assert.equal(dismissResponse?.ok, true);
      assert.equal(
        dismissResponse?.result?.snapshot?.profile?.seenAnnouncements?.["announcement:patch-2-1-9"],
        true
      );
      assert.deepEqual(dismissResponse?.result?.announcements, []);

      const afterDismiss = await new Promise((resolve) => {
        client.emit("announcements:list", {}, resolve);
      });

      assert.equal(afterDismiss?.ok, true);
      assert.deepEqual(afterDismiss?.result?.announcements, []);
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: feedback:submit writes readable JSON without sensitive fields", async () => {
  const dataDir = await createTempDataDir();
  const feedbackStore = new FeedbackStore({
    dataDir,
    logger: { warn: () => {} },
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    feedbackStore,
    logger: { info: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "FeedbackUser");
      const response = await new Promise((resolve) => {
        client.emit(
          "feedback:submit",
          {
            username: "ImposterUser",
            category: "Bug / Error",
            message: "Public rooms did not appear in the browser.",
            includeDebugInfo: true,
            password: "secret-password",
            email: "hidden@example.com",
            sessionToken: "do-not-store",
            clientContext: {
              screen: "online_play",
              connectionStatus: "connected",
              roomCode: "ROOM123",
              recentErrorMessage: "Timed out."
            }
          },
          resolve
        );
      });

      assert.equal(response?.ok, true);
      assert.equal(typeof response?.result?.feedbackId, "string");

      const feedbackPath = path.join(dataDir, "server-data", "feedback.jsonl");
      const raw = await fs.readFile(feedbackPath, "utf8");
      const entries = JSON.parse(raw);
      assert.equal(Array.isArray(entries), true);
      assert.equal(entries.length, 1);

      const entry = entries[0];
      assert.equal(entry.category, "Bug / Error");
      assert.equal(entry.message, "Public rooms did not appear in the browser.");
      assert.equal(entry.user?.username, "FeedbackUser");
      assert.equal(entry.client?.screen, "online_play");
      assert.equal(entry.client?.roomCode, "ROOM123");
      assert.equal(entry.server?.source, "multiplayer");
      assert.equal("password" in entry, false);
      assert.equal("email" in entry, false);
      assert.match(raw, /^\[\n  \{/);
      assert.match(raw, /\n  }\n\]\n?$/);
      assert.equal(raw.includes("secret-password"), false);
      assert.equal(raw.includes("hidden@example.com"), false);
      assert.equal(raw.includes("do-not-store"), false);
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
  }
});

test("multiplayer foundation: feedback:submit preserves fields and upgrades legacy JSONL files to pretty JSON", async () => {
  const dataDir = await createTempDataDir();
  const feedbackPath = path.join(dataDir, "server-data", "feedback.jsonl");
  await fs.mkdir(path.dirname(feedbackPath), { recursive: true });
  await fs.writeFile(
    feedbackPath,
    `${JSON.stringify({
      feedbackId: "fb_legacy",
      timestamp: "2026-05-01T00:00:00.000Z",
      category: "Suggestion",
      message: "Legacy entry.",
      includeDebugInfo: false,
      user: { username: "LegacyUser" },
      server: {
        receivedAt: "2026-05-01T00:00:00.000Z",
        source: "multiplayer"
      }
    })}\n`,
    "utf8"
  );

  const feedbackStore = new FeedbackStore({
    dataDir,
    logger: { warn: () => {} },
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    feedbackStore,
    logger: { info: () => {}, error: () => {} }
  });

  try {
    const port = await foundation.start();
    const client = await connectClient(port);

    try {
      await bootstrapSession(client, "FeedbackUser");
      const response = await new Promise((resolve) => {
        client.emit(
          "feedback:submit",
          {
            category: "Other",
            message: "Pretty JSON please.",
            includeDebugInfo: false
          },
          resolve
        );
      });

      assert.equal(response?.ok, true);

      const raw = await fs.readFile(feedbackPath, "utf8");
      const entries = JSON.parse(raw);
      assert.equal(entries.length, 2);
      assert.equal(entries[0]?.feedbackId, "fb_legacy");
      assert.equal(entries[0]?.message, "Legacy entry.");
      assert.equal(entries[1]?.category, "Other");
      assert.equal(entries[1]?.message, "Pretty JSON please.");
      assert.equal(entries[1]?.includeDebugInfo, false);
    } finally {
      client.disconnect();
    }
  } finally {
    await foundation.stop();
  }
});

test("multiplayer foundation: feedback:submit rejects invalid categories, oversized messages, and write failures readably", async () => {
  const invalidCategoryStore = {
    appendFeedback: async (payload) => {
      const store = new FeedbackStore({
        dataDir: path.join(os.tmpdir(), "feedback-validation-probe"),
        logger: { warn: () => {} },
        random: () => 0
      });
      return store.appendFeedback(payload);
    }
  };
  const failingStore = {
    appendFeedback: async () => {
      const error = new Error("Feedback file is unavailable.");
      error.code = "FEEDBACK_WRITE_FAILED";
      throw error;
    }
  };

  const invalidCategoryFoundation = createMultiplayerFoundation({
    port: 0,
    feedbackStore: invalidCategoryStore,
    logger: { info: () => {}, error: () => {} }
  });
  const failingFoundation = createMultiplayerFoundation({
    port: 0,
    feedbackStore: failingStore,
    logger: { info: () => {}, error: () => {} }
  });

  try {
    const invalidPort = await invalidCategoryFoundation.start();
    const invalidClient = await connectClient(invalidPort);

    try {
      await bootstrapSession(invalidClient, "FeedbackUser");
      const invalidResponse = await new Promise((resolve) => {
        invalidClient.emit(
          "feedback:submit",
          {
            category: "Unknown Category",
            message: "A real message."
          },
          resolve
        );
      });

      assert.deepEqual(invalidResponse, {
        ok: false,
        error: {
          code: "FEEDBACK_CATEGORY_INVALID",
          message: "Please choose a valid feedback category."
        }
      });

      const longResponse = await new Promise((resolve) => {
        invalidClient.emit(
          "feedback:submit",
          {
            category: "Suggestion",
            message: "x".repeat(2001)
          },
          resolve
        );
      });

      assert.deepEqual(longResponse, {
        ok: false,
        error: {
          code: "FEEDBACK_MESSAGE_TOO_LONG",
          message: "Feedback messages must be 2000 characters or fewer."
        }
      });
    } finally {
      invalidClient.disconnect();
    }

    const failingPort = await failingFoundation.start();
    const failingClient = await connectClient(failingPort);

    try {
      await bootstrapSession(failingClient, "FeedbackUser");
      const failingResponse = await new Promise((resolve) => {
        failingClient.emit(
          "feedback:submit",
          {
            category: "Suggestion",
            message: "Add more filters."
          },
          resolve
        );
      });

      assert.deepEqual(failingResponse, {
        ok: false,
        error: {
          code: "FEEDBACK_WRITE_FAILED",
          message: "Feedback file is unavailable."
        }
      });
    } finally {
      failingClient.disconnect();
    }
  } finally {
    await invalidCategoryFoundation.stop();
    await failingFoundation.stop();
  }
});

test("multiplayer foundation: server-data directory is gitignored", async () => {
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  const gitignore = await fs.readFile(gitignorePath, "utf8");
  assert.match(gitignore, /^server-data\/$/m);
});

test("multiplayer logging: timestamped logger prefixes server log messages", () => {
  const entries = [];
  const logger = createTimestampedLogger(
    {
      info: (...args) => entries.push(args)
    },
    {
      clock: () => new Date("2026-03-29T14:32:10")
    }
  );

  logger.info("[Match] Host rewards persisted", { roomCode: "ABC123" });

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0][0],
    "[2026-03-29 14:32:10] [EleMintz Server] [Match] Host rewards persisted"
  );
  assert.deepEqual(entries[0][1], { roomCode: "ABC123" });
});

test("multiplayer foundation: profile:get returns the server-authoritative profile snapshot", async () => {
  const authorityCalls = [];
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: {
      getProfile: async (username) => {
        authorityCalls.push(username);
        return {
          authority: "server",
          source: "multiplayer",
          username,
          profile: {
            username,
            playerXP: 20,
            playerLevel: 2,
            equippedCosmetics: {
              avatar: "default_avatar"
            }
          },
          cosmetics: {
            equipped: {
              avatar: "default_avatar",
              background: "storm_background"
            },
            owned: {
              background: ["storm_background"]
            }
          },
          stats: {
            summary: {
              wins: 7,
              losses: 3,
              gamesPlayed: 10,
              warsEntered: 2,
              warsWon: 1,
              cardsCaptured: 14
            },
            modes: {
              online: {
                wins: 7,
                losses: 3
              }
            }
          },
          currency: {
            tokens: 250
          },
          progression: {
            xp: {
              playerXP: 20,
              playerLevel: 2
            },
            dailyChallenges: { challenges: [] },
            weeklyChallenges: { challenges: [] },
            dailyLogin: { eligible: false }
          }
        };
      }
    }
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const response = await new Promise((resolve) => {
      client.emit("profile:get", { username: "AuthorityUser" }, resolve);
    });

    assert.deepEqual(authorityCalls, ["AuthorityUser", "AuthorityUser"]);
    assert.equal(response.ok, true);
    assert.equal(response.profile.authority, "server");
    assert.equal(response.profile.username, "AuthorityUser");
    assert.equal(response.profile.profile.username, "AuthorityUser");
    assert.equal(response.profile.currency.tokens, 250);
    assert.equal(response.profile.cosmetics.equipped.background, "storm_background");
    assert.equal(response.profile.stats.summary.wins, 7);
    assert.equal(response.profile.progression.xp.playerLevel, 2);
  } finally {
    client?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer foundation: gauntlet progress and milestone rewards follow server-owned session state", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let baneClient = null;
  let viewerClient = null;

  try {
    await accountStore.register({
      username: "Bane",
      email: "bane@example.com",
      password: "BanePass123"
    });
    await accountStore.register({
      username: "Viewer",
      email: "viewer@example.com",
      password: "ViewerPass123"
    });

    const port = await foundation.start();
    baneClient = await connectClient(port);
    viewerClient = await connectClient(port);

    const baneLogin = await loginAccount(baneClient, {
      email: "bane@example.com",
      password: "BanePass123"
    });
    const viewerLogin = await loginAccount(viewerClient, {
      email: "viewer@example.com",
      password: "ViewerPass123"
    });
    assert.equal(baneLogin?.ok, true);
    assert.equal(viewerLogin?.ok, true);

    const firstSession = await emitWithAck(baneClient, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "pyro_maniac"
    });
    assert.equal(firstSession?.ok, true);

    const firstRunStart = await emitWithAck(baneClient, "profile:recordGauntletStats", {
      sessionToken: baneLogin?.session?.token,
      localMatchSessionId: firstSession?.result?.session?.sessionId,
      runStarted: true,
      currentStreak: 0,
      claimedMilestoneStreaks: []
    });
    assert.equal(firstRunStart?.ok, true);

    const firstWin = await emitWithAck(baneClient, "profile:recordGauntletStats", {
      sessionToken: baneLogin?.session?.token,
      localMatchSessionId: firstSession?.result?.session?.sessionId,
      matchWon: true,
      currentStreak: 1,
      claimedMilestoneStreaks: []
    });

    assert.equal(firstWin?.ok, true);
    assert.equal(firstWin?.result?.profile?.gauntletRuns, 1);
    assert.equal(firstWin?.result?.profile?.gauntletWins, 1);
    assert.equal(firstWin?.result?.profile?.gauntletRivalsDefeated, 1);
    assert.equal(firstWin?.result?.profile?.gauntletBestStreak, 1);
    assert.equal(firstWin?.result?.gauntletSession?.status, "completed");

    const secondSession = await emitWithAck(baneClient, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "tide_witch",
      previousSessionId: firstWin?.result?.gauntletSession?.sessionId
    });
    assert.equal(secondSession?.ok, true);

    const secondWin = await emitWithAck(baneClient, "profile:recordGauntletStats", {
      sessionToken: baneLogin?.session?.token,
      localMatchSessionId: secondSession?.result?.session?.sessionId,
      matchWon: true,
      currentStreak: 2,
      claimedMilestoneStreaks: firstWin?.result?.claimedMilestoneStreaks ?? []
    });

    assert.equal(secondWin?.ok, true);
    assert.equal(secondWin?.result?.profile?.gauntletRuns, 1);
    assert.equal(secondWin?.result?.profile?.gauntletWins, 2);
    assert.equal(secondWin?.result?.profile?.gauntletRivalsDefeated, 2);
    assert.equal(secondWin?.result?.profile?.gauntletBestStreak, 2);

    const thirdSession = await emitWithAck(baneClient, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "stonewall",
      previousSessionId: secondWin?.result?.gauntletSession?.sessionId
    });
    assert.equal(thirdSession?.ok, true);

    const thirdWin = await emitWithAck(baneClient, "profile:recordGauntletStats", {
      sessionToken: baneLogin?.session?.token,
      localMatchSessionId: thirdSession?.result?.session?.sessionId,
      matchWon: true,
      currentStreak: 3,
      claimedMilestoneStreaks: secondWin?.result?.claimedMilestoneStreaks ?? []
    });
    assert.equal(thirdWin?.ok, true);
    assert.equal(thirdWin?.result?.profile?.gauntletWins, 3);
    assert.equal(thirdWin?.result?.profile?.gauntletBestStreak, 3);
    assert.deepEqual(thirdWin?.result?.claimedMilestoneStreaks, [3]);
    assert.ok(Array.isArray(thirdWin?.result?.milestoneRewards));

    const duplicateThirdWin = await emitWithAck(baneClient, "profile:recordGauntletStats", {
      sessionToken: baneLogin?.session?.token,
      localMatchSessionId: thirdSession?.result?.session?.sessionId,
      matchWon: true,
      currentStreak: 3,
      claimedMilestoneStreaks: secondWin?.result?.claimedMilestoneStreaks ?? []
    });
    assert.equal(duplicateThirdWin?.ok, false);
    assert.equal(duplicateThirdWin?.error?.code, "LOCAL_MATCH_SESSION_ALREADY_COMPLETED");

    const viewedDuringRun = await emitWithAck(viewerClient, "profile:view", {
      sessionToken: viewerLogin?.session?.token,
      username: "Bane"
    });

    assert.equal(viewedDuringRun?.ok, true);
    assert.equal(viewedDuringRun?.profile?.profile?.gauntletBestStreak, 3);
    assert.equal(viewedDuringRun?.profile?.profile?.gauntletRuns, 1);
    assert.equal(viewedDuringRun?.profile?.profile?.gauntletWins, 3);
    assert.equal(viewedDuringRun?.profile?.profile?.gauntletRivalsDefeated, 3);

    const profileDuringRun = await coordinator.profiles.getProfile("Bane");
    assert.equal(profileDuringRun?.gauntletBestStreak, 3);
    assert.equal(profileDuringRun?.gauntletRuns, 1);
    assert.equal(profileDuringRun?.gauntletWins, 3);
    assert.equal(profileDuringRun?.gauntletRivalsDefeated, 3);

    const fourthSession = await emitWithAck(baneClient, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "storm_chaser",
      previousSessionId: thirdWin?.result?.gauntletSession?.sessionId
    });
    assert.equal(fourthSession?.ok, true);

    const lossResult = await emitWithAck(baneClient, "profile:recordGauntletStats", {
      sessionToken: baneLogin?.session?.token,
      localMatchSessionId: fourthSession?.result?.session?.sessionId,
      runEndedWithLoss: true,
      currentStreak: 3,
      claimedMilestoneStreaks: thirdWin?.result?.claimedMilestoneStreaks ?? []
    });

    assert.equal(lossResult?.ok, true);
    assert.equal(lossResult?.result?.profile?.gauntletRuns, 1);
    assert.equal(lossResult?.result?.profile?.gauntletWins, 3);
    assert.equal(lossResult?.result?.profile?.gauntletLosses, 1);
    assert.equal(lossResult?.result?.profile?.gauntletRivalsDefeated, 3);
    assert.equal(lossResult?.result?.gauntletSession?.status, "lost");

    const profileAfterLoss = await coordinator.profiles.getProfile("Bane");
    assert.equal(profileAfterLoss?.gauntletRuns, 1);
    assert.equal(profileAfterLoss?.gauntletWins, 3);
    assert.equal(profileAfterLoss?.gauntletLosses, 1);
    assert.equal(profileAfterLoss?.gauntletBestStreak, 3);
  } finally {
    baneClient?.disconnect();
    viewerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: forged gauntlet streak and milestone payloads are rejected without server-owned session state", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    })
  });
  let owner = null;
  let other = null;

  try {
    const port = await foundation.start();
    owner = await connectClient(port);
    other = await connectClient(port);

    const ownerAuth = await registerAccount(owner, {
      username: "GauntletOwner",
      email: "gauntlet-owner@example.com",
      password: "PlayerPass123"
    });
    const otherAuth = await registerAccount(other, {
      username: "GauntletOther",
      email: "gauntlet-other@example.com",
      password: "PlayerPass123"
    });
    assert.equal(ownerAuth?.ok, true);
    assert.equal(otherAuth?.ok, true);

    const started = await emitWithAck(owner, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "pyro_maniac"
    });
    assert.equal(started?.ok, true);
    const gauntletSessionId = started?.result?.session?.sessionId;

    const noSession = await emitWithAck(owner, "profile:recordGauntletStats", {
      sessionToken: ownerAuth?.session?.token,
      runStarted: true,
      matchWon: true,
      currentStreak: 1,
      claimedMilestoneStreaks: []
    });
    const foreignSession = await emitWithAck(other, "profile:recordGauntletStats", {
      sessionToken: otherAuth?.session?.token,
      localMatchSessionId: gauntletSessionId,
      matchWon: true,
      currentStreak: 1,
      claimedMilestoneStreaks: []
    });
    const inflatedStreak = await emitWithAck(owner, "profile:recordGauntletStats", {
      sessionToken: ownerAuth?.session?.token,
      localMatchSessionId: gauntletSessionId,
      matchWon: true,
      currentStreak: 99,
      claimedMilestoneStreaks: []
    });
    const forgedMilestones = await emitWithAck(owner, "profile:recordGauntletStats", {
      sessionToken: ownerAuth?.session?.token,
      localMatchSessionId: gauntletSessionId,
      matchWon: true,
      currentStreak: 1,
      claimedMilestoneStreaks: [3]
    });

    assert.equal(noSession?.ok, false);
    assert.equal(noSession?.error?.code, "LOCAL_MATCH_SESSION_REQUIRED");
    assert.equal(foreignSession?.ok, false);
    assert.equal(foreignSession?.error?.code, "LOCAL_MATCH_SESSION_ACCESS_DENIED");
    assert.equal(inflatedStreak?.ok, false);
    assert.equal(inflatedStreak?.error?.code, "LOCAL_MATCH_GAUNTLET_STREAK_MISMATCH");
    assert.equal(forgedMilestones?.ok, false);
    assert.equal(forgedMilestones?.error?.code, "LOCAL_MATCH_GAUNTLET_MILESTONE_MISMATCH");

    const ownerProfile = await coordinator.profiles.getProfile("GauntletOwner");
    assert.equal(ownerProfile?.gauntletRuns, 0);
    assert.equal(ownerProfile?.gauntletWins, 0);
    assert.equal(ownerProfile?.gauntletBestStreak, 0);
    assert.equal(ownerProfile?.gauntletLosses, 0);
    assert.equal(ownerProfile?.gauntletRivalsDefeated, 0);
  } finally {
    owner?.disconnect();
    other?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: profile:view returns a sanitized public snapshot while own profile:get keeps private owner data", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let ownerClient = null;
  let viewerClient = null;

  try {
    const port = await foundation.start();
    ownerClient = await connectClient(port);
    viewerClient = await connectClient(port);

    const ownerRegister = await registerAccount(ownerClient, {
      username: "PublicRival",
      email: "public-rival@example.com",
      password: "PublicRivalPass123"
    });
    const viewerRegister = await registerAccount(viewerClient, {
      username: "PublicViewer",
      email: "public-viewer@example.com",
      password: "PublicViewerPass123"
    });
    assert.equal(ownerRegister?.ok, true);
    assert.equal(viewerRegister?.ok, true);

    await coordinator.profiles.updateProfile("PublicRival", (current) => ({
      ...current,
      title: "Spellwired",
      tokens: 725,
      playerXP: 1337,
      playerLevel: 12,
      wins: 30,
      losses: 12,
      gamesPlayed: 42,
      warsEntered: 14,
      warsWon: 9,
      longestWar: 5,
      bestWinStreak: 7,
      cardsCaptured: 88,
      featuredRivalWins: 5,
      gauntletBestStreak: 8,
      gauntletRuns: 9,
      gauntletWins: 6,
      gauntletLosses: 3,
      gauntletRivalsDefeated: 14,
      achievements: {
        first_flame: { count: 1 }
      },
      modeStats: {
        pve: { wins: 10, losses: 2, gamesPlayed: 12, cardsCaptured: 24, warsEntered: 4, warsWon: 2, longestWar: 3 }
      },
      seenAnnouncements: {
        launch_celebration: true
      },
      chests: {
        basic: 2,
        epic: 1
      },
      ownedCosmetics: {
        ...(current?.ownedCosmetics ?? {}),
        avatar: ["default_avatar", "avatar_neon_tide_entity"],
        title: ["Initiate", "title_spellwired"],
        badge: ["none", "war_machine_badge"],
        background: ["default_background"],
        cardBack: ["default_card_back", "cardback_neon_arcana"],
        elementCardVariant: [
          "default_fire_card",
          "default_water_card",
          "default_earth_card",
          "default_wind_card",
          "fire_variant_neon_arcana",
          "earth_variant_neon_arcana",
          "wind_variant_neon_arcana",
          "water_variant_neon_arcana"
        ]
      },
      equippedCosmetics: {
        avatar: "avatar_neon_tide_entity",
        title: "title_spellwired",
        badge: "war_machine_badge",
        background: "default_background",
        cardBack: "cardback_neon_arcana",
        elementCardVariant: {
          fire: "fire_variant_neon_arcana",
          earth: "earth_variant_neon_arcana",
          wind: "wind_variant_neon_arcana",
          water: "water_variant_neon_arcana"
        }
      },
      cosmeticLoadouts: [
        {
          id: "loadout_public_rival",
          name: "Main",
          equippedCosmetics: {
            avatar: "avatar_neon_tide_entity"
          }
        }
      ],
      cosmeticRandomizeAfterMatch: {
        enabled: true
      }
    }));

    const ownProfile = await new Promise((resolve) => {
      ownerClient.emit("profile:get", {}, resolve);
    });
    const viewedProfile = await new Promise((resolve) => {
      viewerClient.emit(
        "profile:view",
        {
          username: "PublicRival"
        },
        resolve
      );
    });

    assert.equal(ownProfile?.ok, true);
    assert.equal(viewedProfile?.ok, true);

    assert.equal(ownProfile?.profile?.profile?.linkedAccountId, ownerRegister?.account?.accountId);
    assert.equal(ownProfile?.profile?.profile?.chests?.basic, 2);
    assert.deepEqual(ownProfile?.profile?.profile?.seenAnnouncements, {
      launch_celebration: true
    });
    assert.ok(Array.isArray(ownProfile?.profile?.profile?.ownedCosmetics?.avatar));
    assert.ok(Array.isArray(ownProfile?.profile?.profile?.cosmeticLoadouts));

    assert.equal(viewedProfile?.profile?.profile?.username, "PublicRival");
    assert.equal(viewedProfile?.profile?.profile?.title, "Spellwired");
    assert.equal(viewedProfile?.profile?.profile?.gauntletBestStreak, 8);
    assert.equal(viewedProfile?.profile?.profile?.wins, 30);
    assert.equal(viewedProfile?.profile?.profile?.equippedCosmetics?.title, "title_spellwired");
    assert.equal(Array.isArray(viewedProfile?.profile?.profile?.trophyShelf), true);
    assert.ok((viewedProfile?.profile?.profile?.trophyShelf?.length ?? 0) > 0);

    assert.equal("linkedAccountId" in (viewedProfile?.profile?.profile ?? {}), false);
    assert.equal("chests" in (viewedProfile?.profile?.profile ?? {}), false);
    assert.equal("seenAnnouncements" in (viewedProfile?.profile?.profile ?? {}), false);
    assert.equal("ownedCosmetics" in (viewedProfile?.profile?.profile ?? {}), false);
    assert.equal("cosmeticLoadouts" in (viewedProfile?.profile?.profile ?? {}), false);
    assert.equal("cosmeticRandomizeAfterMatch" in (viewedProfile?.profile?.profile ?? {}), false);
    assert.equal("owned" in (viewedProfile?.profile?.cosmetics ?? {}), false);
    assert.equal("loadouts" in (viewedProfile?.profile?.cosmetics ?? {}), false);
    assert.equal("preferences" in (viewedProfile?.profile?.cosmetics ?? {}), false);
    assert.equal("dailyChallenges" in (viewedProfile?.profile?.progression ?? {}), false);
    assert.equal("weeklyChallenges" in (viewedProfile?.profile?.progression ?? {}), false);
    assert.equal("dailyLogin" in (viewedProfile?.profile?.progression ?? {}), false);
  } finally {
    ownerClient?.disconnect();
    viewerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: profile:view rejects missing and unknown usernames without creating default profiles", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    accountStore,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let viewerClient = null;

  try {
    const port = await foundation.start();
    viewerClient = await connectClient(port);

    const viewerRegister = await registerAccount(viewerClient, {
      username: "PublicViewer",
      email: "public-viewer@example.com",
      password: "PublicViewerPass123"
    });
    assert.equal(viewerRegister?.ok, true);

    const missingUsername = await emitWithAck(viewerClient, "profile:view", {});
    const unknownProfile = await emitWithAck(viewerClient, "profile:view", {
      username: "MissingRemoteUser"
    });

    assert.equal(missingUsername?.ok, false);
    assert.equal(missingUsername?.error?.code, "PROFILE_VIEW_FAILED");
    assert.match(String(missingUsername?.error?.message ?? ""), /username is required/i);

    assert.equal(unknownProfile?.ok, false);
    assert.equal(unknownProfile?.error?.code, "PROFILE_NOT_FOUND");
    assert.match(String(unknownProfile?.error?.message ?? ""), /MissingRemoteUser/);

    const created = await coordinator.profiles.getProfile("MissingRemoteUser");
    assert.equal(created, null);
  } finally {
    viewerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: profile:view resolves visible account usernames through account profileKey", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    accountStore,
    logger: { info: () => {}, warn: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let viewerClient = null;

  try {
    const port = await foundation.start();
    viewerClient = await connectClient(port);

    const viewerRegister = await registerAccount(viewerClient, {
      username: "PublicViewer",
      email: "public-viewer@example.com",
      password: "PublicViewerPass123"
    });
    assert.equal(viewerRegister?.ok, true);

    await coordinator.profiles.ensureProfile("ProfileKeyOnlyUser");
    await coordinator.profiles.updateProfile("ProfileKeyOnlyUser", (current) => ({
      ...current,
      tokens: 404,
      wins: 17,
      warsEntered: 9,
      cardsCaptured: 31,
      gauntletBestStreak: 6,
      equippedCosmetics: {
        ...(current?.equippedCosmetics ?? {}),
        avatar: "avatar_neon_tide_entity",
        title: "title_spellwired",
        badge: "war_machine_badge",
        cardBack: "cardback_neon_arcana"
      }
    }));
    await accountStore.register({
      username: "VisibleSearchName",
      profileKey: "ProfileKeyOnlyUser",
      email: "visible-search@example.com",
      password: "VisibleSearchPass123"
    });

    const viewedProfile = await emitWithAck(viewerClient, "profile:view", {
      username: "VisibleSearchName"
    });

    assert.equal(viewedProfile?.ok, true);
    assert.equal(viewedProfile?.profile?.profile?.username, "ProfileKeyOnlyUser");
    assert.equal(viewedProfile?.profile?.profile?.tokens, 404);
    assert.equal(viewedProfile?.profile?.profile?.wins, 17);
    assert.equal(viewedProfile?.profile?.profile?.warsEntered, 9);
    assert.equal(viewedProfile?.profile?.profile?.cardsCaptured, 31);
    assert.equal(viewedProfile?.profile?.profile?.gauntletBestStreak, 6);
    assert.equal(viewedProfile?.profile?.profile?.equippedCosmetics?.title, "title_spellwired");
    assert.equal("linkedAccountId" in (viewedProfile?.profile?.profile ?? {}), false);
  } finally {
    viewerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: admin lookup returns the authoritative profile snapshot by username", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let adminClient = null;

  try {
    await coordinator.profiles.ensureProfile("LookupTarget");
    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });
    const port = await foundation.start();
    adminClient = await connectClient(port);
    const login = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    assert.equal(login?.ok, true);

    const response = await new Promise((resolve) => {
      adminClient.emit(
        "admin:lookupUser",
        {
          sessionToken: login?.session?.token,
          username: "LookupTarget"
        },
        resolve
      );
    });

    assert.equal(response?.ok, true);
    assert.equal(response?.profile?.username, "LookupTarget");
    assert.equal(response?.profile?.authority, "server");
    assert.ok(Array.isArray(response?.cosmetics?.catalog?.avatar));
    assert.ok(response?.cosmetics?.owned?.avatar?.includes("default_avatar"));
  } finally {
    adminClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: admin grants apply once, notify the player, and update confirmation status", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let adminClient = null;
  let playerClient = null;

  try {
    const profileBefore = await coordinator.profiles.ensureProfile("GrantTarget");
    const tokensBefore = Number(profileBefore?.tokens ?? 0);
    const xpBefore = Number(profileBefore?.playerXP ?? 0);
    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });

    const port = await foundation.start();
    adminClient = await connectClient(port);
    playerClient = await connectClient(port);
    const adminLogin = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    assert.equal(adminLogin?.ok, true);
    const playerSession = await bootstrapSession(playerClient, "GrantTarget");
    assert.equal(playerSession?.ok, true);

    const noticePromise = waitForEvent(playerClient, "admin:grantNotice");
    const grantResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "grant-transaction-1",
          username: "GrantTarget",
          xp: 25,
          tokens: 40,
          chests: [{ chestType: "epic", amount: 2 }]
        },
        resolve
      );
    });

    const notice = await noticePromise;
    assert.equal(grantResponse?.ok, true);
    assert.equal(grantResponse?.result?.transactionId, "grant-transaction-1");
    assert.equal(grantResponse?.result?.status, "success");
    assert.equal(grantResponse?.result?.confirmationStatus, "awaiting_player");
    assert.equal(notice?.transactionId, "grant-transaction-1");
    assert.match(notice?.message ?? "", /EleMintz has sent you/i);

    const profileAfterGrant = await coordinator.profiles.getProfile("GrantTarget");
    assert.ok(Number(profileAfterGrant?.tokens ?? 0) >= tokensBefore + 40);
    assert.equal(Number(profileAfterGrant?.playerXP ?? 0), xpBefore + 25);
    assert.equal(Number(profileAfterGrant?.chests?.epic ?? 0), Number(profileBefore?.chests?.epic ?? 0) + 2);

    const duplicateResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "grant-transaction-1",
          username: "GrantTarget",
          xp: 25,
          tokens: 40,
          chests: [{ chestType: "epic", amount: 2 }]
        },
        resolve
      );
    });

    const profileAfterDuplicate = await coordinator.profiles.getProfile("GrantTarget");
    assert.equal(duplicateResponse?.ok, true);
    assert.equal(duplicateResponse?.duplicate, true);
    assert.equal(Number(profileAfterDuplicate?.tokens ?? 0), Number(profileAfterGrant?.tokens ?? 0));
    assert.equal(Number(profileAfterDuplicate?.playerXP ?? 0), Number(profileAfterGrant?.playerXP ?? 0));
    assert.equal(Number(profileAfterDuplicate?.chests?.epic ?? 0), Number(profileAfterGrant?.chests?.epic ?? 0));

    const grantStatusPromise = waitForEvent(adminClient, "admin:grantStatus");
    const confirmResponse = await new Promise((resolve) => {
      playerClient.emit("admin:confirmGrantReceipt", { transactionId: "grant-transaction-1" }, resolve);
    });
    const grantStatus = await grantStatusPromise;

    assert.equal(confirmResponse?.ok, true);
    assert.equal(confirmResponse?.result?.confirmationStatus, "confirmed");
    assert.equal(grantStatus?.transactionId, "grant-transaction-1");
    assert.equal(grantStatus?.confirmationStatus, "confirmed");
  } finally {
    adminClient?.disconnect();
    playerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: offline admin notices persist, deliver on next authenticated login, and do not re-grant rewards", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let adminClient = null;
  let playerClient = null;
  let resumeClient = null;

  try {
    const profileBefore = await coordinator.profiles.ensureProfile("OfflineGrantTarget");
    const tokensBefore = Number(profileBefore?.tokens ?? 0);
    const xpBefore = Number(profileBefore?.playerXP ?? 0);
    const chestBefore = Number(profileBefore?.chests?.legendary ?? 0);

    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });
    await accountStore.register({
      email: "offlinegrant@example.com",
      password: "PlayerPass123",
      username: "OfflineGrantTarget"
    });

    const port = await foundation.start();
    adminClient = await connectClient(port);
    const adminLogin = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    assert.equal(adminLogin?.ok, true);

    const offlineGrantResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "offline-grant-login-1",
          username: "OfflineGrantTarget",
          xp: 10,
          tokens: 15,
          chests: [{ chestType: "legendary", amount: 1 }]
        },
        resolve
      );
    });

    assert.equal(offlineGrantResponse?.ok, true);
    assert.equal(offlineGrantResponse?.result?.confirmationStatus, "player_offline");

    const ledgerAfterGrant = await adminGrantStore.getByTransactionId("offline-grant-login-1");
    assert.equal(ledgerAfterGrant?.confirmationStatus, "player_offline");
    assert.equal(ledgerAfterGrant?.deliveredAt, null);

    const profileAfterGrant = await coordinator.profiles.getProfile("OfflineGrantTarget");
    assert.equal(Number(profileAfterGrant?.playerXP ?? 0), xpBefore + 10);
    assert.ok(Number(profileAfterGrant?.tokens ?? 0) >= tokensBefore + 15);
    assert.equal(Number(profileAfterGrant?.chests?.legendary ?? 0), chestBefore + 1);

    playerClient = await connectClient(port);
    const deferredNotice = waitForEvent(playerClient, "admin:grantNotice");
    const playerLogin = await loginAccount(playerClient, {
      email: "offlinegrant@example.com",
      password: "PlayerPass123"
    });
    assert.equal(playerLogin?.ok, true);
    const deliveredNotice = await deferredNotice;

    assert.equal(deliveredNotice?.transactionId, "offline-grant-login-1");
    assert.match(deliveredNotice?.message ?? "", /15 Tokens/i);

    const profileAfterLogin = await coordinator.profiles.getProfile("OfflineGrantTarget");
    assert.equal(Number(profileAfterLogin?.playerXP ?? 0), Number(profileAfterGrant?.playerXP ?? 0));
    assert.equal(Number(profileAfterLogin?.tokens ?? 0), Number(profileAfterGrant?.tokens ?? 0));
    assert.equal(
      Number(profileAfterLogin?.chests?.legendary ?? 0),
      Number(profileAfterGrant?.chests?.legendary ?? 0)
    );

    const ledgerAfterDelivery = await adminGrantStore.getByTransactionId("offline-grant-login-1");
    assert.equal(ledgerAfterDelivery?.confirmationStatus, "delivered");
    assert.ok(ledgerAfterDelivery?.deliveredAt);

    const confirmResponse = await new Promise((resolve) => {
      playerClient.emit("admin:confirmGrantReceipt", { transactionId: "offline-grant-login-1" }, resolve);
    });
    assert.equal(confirmResponse?.ok, true);
    assert.equal(confirmResponse?.result?.confirmationStatus, "confirmed");

    const ledgerAfterConfirm = await adminGrantStore.getByTransactionId("offline-grant-login-1");
    assert.equal(ledgerAfterConfirm?.confirmationStatus, "confirmed");
    assert.ok(ledgerAfterConfirm?.confirmedAt);

    playerClient.disconnect();
    playerClient = null;
    resumeClient = await connectClient(port);
    let redelivered = false;
    resumeClient.on("admin:grantNotice", () => {
      redelivered = true;
    });
    const resumed = await resumeSession(resumeClient, playerLogin?.session?.token);
    assert.equal(resumed?.ok, true);
    await wait(50);
    assert.equal(redelivered, false);
  } finally {
    adminClient?.disconnect();
    playerClient?.disconnect();
    resumeClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: Founder Status grants supporter pass, fills missing founder items, and queues a notice", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let adminClient = null;
  let playerClient = null;

  try {
    await coordinator.profiles.updateProfile("FounderTarget", {
      supporterPass: false,
      ownedCosmetics: {
        avatar: ["default_avatar"],
        cardBack: ["default_card_back"],
        background: ["default_background"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none", "supporter_badge"],
        title: ["Initiate"]
      },
      equippedCosmetics: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      }
    });

    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });

    const port = await foundation.start();
    adminClient = await connectClient(port);
    playerClient = await connectClient(port);
    const adminLogin = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    assert.equal(adminLogin?.ok, true);
    const playerSession = await bootstrapSession(playerClient, "FounderTarget");
    assert.equal(playerSession?.ok, true);

    const noticePromise = waitForEvent(playerClient, "admin:grantNotice");
    const grantResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantFounderStatus",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "founder-grant-1",
          username: "FounderTarget"
        },
        resolve
      );
    });
    const notice = await noticePromise;

    assert.equal(grantResponse?.ok, true);
    assert.equal(grantResponse?.result?.grantType, "founder_status_grant");
    assert.equal(grantResponse?.result?.result?.founderStatusActive, true);
    assert.equal(grantResponse?.result?.result?.supporterPassActivated, true);
    assert.deepEqual(
      grantResponse?.result?.result?.grantedItems?.map((item) => item.cosmeticId).sort(),
      ["Arena Founder", "founder_deluxe_card_back"].sort()
    );
    assert.deepEqual(
      grantResponse?.result?.result?.skippedItems?.map((item) => item.cosmeticId),
      ["supporter_badge"]
    );
    assert.match(notice?.message ?? "", /Founder Status/i);
    assert.match(notice?.message ?? "", /Arena Founder Title/i);
    assert.match(notice?.message ?? "", /Founder Badge/i);
    assert.match(notice?.message ?? "", /Founder Deluxe Card Back/i);

    const profileAfterGrant = await coordinator.profiles.getProfile("FounderTarget");
    assert.equal(profileAfterGrant?.supporterPass, true);
    assert.ok(profileAfterGrant?.ownedCosmetics?.title?.includes("Arena Founder"));
    assert.ok(profileAfterGrant?.ownedCosmetics?.badge?.includes("supporter_badge"));
    assert.ok(profileAfterGrant?.ownedCosmetics?.cardBack?.includes("founder_deluxe_card_back"));

    const secondResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantFounderStatus",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "founder-grant-2",
          username: "FounderTarget"
        },
        resolve
      );
    });

    assert.equal(secondResponse?.ok, true);
    assert.equal(secondResponse?.result?.result?.supporterPassActivated, false);
    assert.deepEqual(secondResponse?.result?.result?.grantedItems ?? [], []);
    assert.deepEqual(
      secondResponse?.result?.result?.skippedItems?.map((item) => item.cosmeticId).sort(),
      ["Arena Founder", "founder_deluxe_card_back", "supporter_badge"].sort()
    );
    assert.equal(secondResponse?.result?.confirmationStatus, "confirmed");
  } finally {
    adminClient?.disconnect();
    playerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: offline admin notices deliver on valid session resume without duplicate reward application", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let adminClient = null;
  let playerClient = null;
  let resumeClient = null;

  try {
    await coordinator.profiles.ensureProfile("ResumeGrantTarget");
    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });
    await accountStore.register({
      email: "resumegrant@example.com",
      password: "PlayerPass123",
      username: "ResumeGrantTarget"
    });

    const port = await foundation.start();
    adminClient = await connectClient(port);
    playerClient = await connectClient(port);

    const adminLogin = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    assert.equal(adminLogin?.ok, true);

    const playerLogin = await loginAccount(playerClient, {
      email: "resumegrant@example.com",
      password: "PlayerPass123"
    });
    assert.equal(playerLogin?.ok, true);
    playerClient.disconnect();
    playerClient = null;

    const profileBeforeGrant = await coordinator.profiles.getProfile("ResumeGrantTarget");
    const grantResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "offline-grant-resume-1",
          username: "ResumeGrantTarget",
          xp: 12,
          tokens: 18,
          chests: [{ chestType: "epic", amount: 1 }]
        },
        resolve
      );
    });

    assert.equal(grantResponse?.ok, true);
    assert.equal(grantResponse?.result?.confirmationStatus, "player_offline");

    const profileAfterGrant = await coordinator.profiles.getProfile("ResumeGrantTarget");
    assert.equal(Number(profileAfterGrant?.playerXP ?? 0), Number(profileBeforeGrant?.playerXP ?? 0) + 12);
    assert.ok(Number(profileAfterGrant?.tokens ?? 0) >= Number(profileBeforeGrant?.tokens ?? 0) + 18);
    assert.equal(
      Number(profileAfterGrant?.chests?.epic ?? 0),
      Number(profileBeforeGrant?.chests?.epic ?? 0) + 1
    );

    resumeClient = await connectClient(port);
    const deferredNotice = waitForEvent(resumeClient, "admin:grantNotice");
    const resumed = await resumeSession(resumeClient, playerLogin?.session?.token);
    assert.equal(resumed?.ok, true);
    const deliveredNotice = await deferredNotice;
    assert.equal(deliveredNotice?.transactionId, "offline-grant-resume-1");

    const profileAfterResume = await coordinator.profiles.getProfile("ResumeGrantTarget");
    assert.equal(Number(profileAfterResume?.playerXP ?? 0), Number(profileAfterGrant?.playerXP ?? 0));
    assert.equal(Number(profileAfterResume?.tokens ?? 0), Number(profileAfterGrant?.tokens ?? 0));
    assert.equal(Number(profileAfterResume?.chests?.epic ?? 0), Number(profileAfterGrant?.chests?.epic ?? 0));

    const ledgerAfterResume = await adminGrantStore.getByTransactionId("offline-grant-resume-1");
    assert.equal(ledgerAfterResume?.confirmationStatus, "delivered");
    assert.ok(ledgerAfterResume?.deliveredAt);
  } finally {
    adminClient?.disconnect();
    playerClient?.disconnect();
    resumeClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: admin cosmetic grants return updated authoritative ownership and reject duplicate ownership cleanly", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let adminClient = null;
  let playerClient = null;

  try {
    await coordinator.profiles.ensureProfile("CosmeticGrantTarget");
    await accountStore.register({
      email: "insanevampyr@gmail.com",
      password: "AdminPass123",
      username: "VampyrLee"
    });

    const port = await foundation.start();
    adminClient = await connectClient(port);
    playerClient = await connectClient(port);
    const adminLogin = await loginAccount(adminClient, {
      email: "insanevampyr@gmail.com",
      password: "AdminPass123"
    });
    assert.equal(adminLogin?.ok, true);
    const playerSession = await bootstrapSession(playerClient, "CosmeticGrantTarget");
    assert.equal(playerSession?.ok, true);

    const noticePromise = waitForEvent(playerClient, "admin:grantNotice");
    const grantResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "cosmetic-grant-1",
          username: "CosmeticGrantTarget",
          cosmetic: {
            type: "avatar",
            cosmeticId: "fireavatarF"
          }
        },
        resolve
      );
    });
    const notice = await noticePromise;

    assert.equal(grantResponse?.ok, true);
    assert.equal(grantResponse?.result?.status, "success");
    assert.equal(
      grantResponse?.result?.result?.applied?.cosmetic?.cosmeticId,
      "fireavatarF"
    );
    assert.ok(
      grantResponse?.result?.result?.cosmetics?.owned?.avatar?.includes("fireavatarF")
    );
    assert.match(notice?.message ?? "", /Fire Avatar/);
    assert.doesNotMatch(notice?.message ?? "", /avatar:fireavatarF/);

    const invalidCosmeticResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "cosmetic-grant-invalid",
          username: "CosmeticGrantTarget",
          cosmetic: {
            type: "avatar",
            cosmeticId: "not_a_real_avatar"
          }
        },
        resolve
      );
    });

    assert.equal(invalidCosmeticResponse?.ok, false);
    assert.match(
      invalidCosmeticResponse?.error?.message ?? "",
      /cosmetic item not found/i
    );

    const duplicateOwnershipResponse = await new Promise((resolve) => {
      adminClient.emit(
        "admin:grantRewards",
        {
          sessionToken: adminLogin?.session?.token,
          transactionId: "cosmetic-grant-2",
          username: "CosmeticGrantTarget",
          cosmetic: {
            type: "avatar",
            cosmeticId: "fireavatarF"
          }
        },
        resolve
      );
    });

    assert.equal(duplicateOwnershipResponse?.ok, false);
    assert.match(
      duplicateOwnershipResponse?.error?.message ?? "",
      /already owned/i
    );
  } finally {
    adminClient?.disconnect();
    playerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: admin requests reject authenticated accounts outside the server allowlist", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const adminGrantStore = new AdminGrantStore({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    profileAuthority,
    accountStore,
    adminGrantStore,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  let client = null;

  try {
    await coordinator.profiles.ensureProfile("LookupTarget");
    await accountStore.register({
      email: "player@example.com",
      password: "PlayerPass123",
      username: "RegularPlayer"
    });

    const port = await foundation.start();
    client = await connectClient(port);
    const login = await loginAccount(client, {
      email: "player@example.com",
      password: "PlayerPass123"
    });
    assert.equal(login?.ok, true);

    const response = await new Promise((resolve) => {
      client.emit(
        "admin:lookupUser",
        {
          sessionToken: login?.session?.token,
          username: "LookupTarget"
        },
        resolve
      );
    });

    assert.equal(response?.ok, false);
    assert.equal(response?.error?.code, "ADMIN_ACCESS_DENIED");
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer profile authority: authenticated online profiles load normalized authoritative cosmetic snapshots", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const authority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });

  try {
    await coordinator.profiles.store.write([
      {
        username: "CosmeticAuthorityUser",
        ownedCosmetics: {
          avatar: ["default_avatar", "fireavatarF"],
          cardBack: ["default_card_back"],
          background: ["backgrounds/fireBattleArena.png"],
          elementCardVariant: ["arcane_fire_card"],
          badge: [],
          title: []
        },
        equippedCosmetics: {
          avatar: "fireavatarF",
          cardBack: "default_card_back",
          background: "backgrounds/fireBattleArena.png",
          elementCardVariant: "arcane_element_cards",
          badge: "default_badge",
          title: "Initiate"
        },
        cosmeticLoadouts: null,
        cosmeticRandomizeAfterMatch: {
          background: true
        }
      }
    ]);

    const snapshot = await authority.getProfile("CosmeticAuthorityUser");

    assert.equal(snapshot.authority, "server");
    assert.equal(snapshot.cosmetics.authority, "server");
    assert.equal(snapshot.cosmetics.source, "profileAuthority");
    assert.deepEqual(Object.keys(snapshot.cosmetics.snapshot.owned), [
      "avatar",
      "cardBack",
      "background",
      "elementCardVariant",
      "badge",
      "title"
    ]);
    assert.deepEqual(Object.keys(snapshot.cosmetics.snapshot.equipped), [
      "avatar",
      "cardBack",
      "background",
      "elementCardVariant",
      "badge",
      "title"
    ]);
    assert.equal(snapshot.cosmetics.snapshot.equipped.background, "fire_background");
    assert.equal(snapshot.cosmetics.snapshot.equipped.elementCardVariant.fire, "arcane_fire_card");
    assert.ok(snapshot.cosmetics.snapshot.owned.avatar.includes("fireavatarF"));
    assert.equal(Array.isArray(snapshot.cosmetics.snapshot.loadouts), true);
    assert.equal(snapshot.cosmetics.snapshot.preferences.background, true);
    assert.equal(snapshot.profile.equippedCosmetics.background, snapshot.cosmetics.snapshot.equipped.background);
    assert.equal(snapshot.profile.ownedCosmetics.avatar.includes("fireavatarF"), true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: malformed non-function ack payload does not crash profile authority handlers", async () => {
  const authorityCalls = [];
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: {
      getProfile: async (username) => {
        authorityCalls.push(username);
        return {
          authority: "server",
          username,
          profile: {
            username
          }
        };
      }
    }
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const bootstrapResponse = await new Promise((resolve) => {
      client.emit("session:bootstrap", { username: "AckSafetyUser" }, resolve);
    });
    assert.equal(bootstrapResponse?.ok, true);

    client.emit("profile:get", {}, "not-a-function");
    await wait(25);

    const validResponse = await new Promise((resolve) => {
      client.emit("profile:get", {}, resolve);
    });

    assert.equal(validResponse?.ok, true);
    assert.equal(validResponse?.profile?.profile?.username, "AckSafetyUser");
    assert.deepEqual(authorityCalls, ["AckSafetyUser", "AckSafetyUser", "AckSafetyUser"]);
  } finally {
    client?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer foundation: profile:getCosmetics returns the server-authoritative cosmetic snapshot for online accounts", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.store.write([
      {
        username: "ServerCosmeticsUser",
        ownedCosmetics: {
          avatar: ["default_avatar", "avatar_storm_oracle"],
          cardBack: ["default_card_back"],
          background: ["fire_background"],
          elementCardVariant: ["default_fire_card"],
          badge: ["default_badge"],
          title: ["title_initiate", "title_element_sovereign"]
        },
        equippedCosmetics: {
          avatar: "avatar_storm_oracle",
          cardBack: "default_card_back",
          background: "fire_background",
          elementCardVariant: {
            fire: "default_fire_card",
            water: "default_water_card",
            earth: "default_earth_card",
            wind: "default_wind_card"
          },
          badge: "default_badge",
          title: "title_element_sovereign"
        }
      }
    ]);

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "ServerCosmeticsUser");
    assert.equal(session?.ok, true);

    const response = await new Promise((resolve) => {
      client.emit("profile:getCosmetics", {}, resolve);
    });

    assert.equal(response?.ok, true);
    assert.equal(response?.cosmetics?.authority, "server");
    assert.equal(response?.cosmetics?.source, "stateCoordinator");
    assert.equal(response?.cosmetics?.snapshot?.equipped?.avatar, "avatar_storm_oracle");
    assert.equal(response?.cosmetics?.equipped?.avatar, "avatar_storm_oracle");
    assert.equal(response?.cosmetics?.snapshot?.owned?.title.includes("title_element_sovereign"), true);
    assert.equal(Array.isArray(response?.cosmetics?.snapshot?.loadouts), true);
    assert.equal(Array.isArray(response?.cosmetics?.catalog?.avatar), true);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative online cosmetic equip accepts owned cosmetics and rejects invalid values", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("EquipAuthorityUser", (current) => ({
      ...current,
      ownedCosmetics: {
        ...current.ownedCosmetics,
        avatar: [...current.ownedCosmetics.avatar, "avatar_storm_oracle"]
      }
    }));

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "EquipAuthorityUser");
    assert.equal(session?.ok, true);

    const ownedEquip = await new Promise((resolve) => {
      client.emit(
        "profile:equipCosmetic",
        { type: "avatar", cosmeticId: "avatar_storm_oracle" },
        resolve
      );
    });
    assert.equal(ownedEquip?.ok, true);
    assert.equal(ownedEquip?.result?.snapshot?.cosmetics?.snapshot?.equipped?.avatar, "avatar_storm_oracle");

    const unownedEquip = await new Promise((resolve) => {
      client.emit(
        "profile:equipCosmetic",
        { type: "avatar", cosmeticId: "avatar_fourfold_lord" },
        resolve
      );
    });
    assert.equal(unownedEquip?.ok, false);
    assert.equal(unownedEquip?.error?.code, "PROFILE_COSMETIC_WRITE_FAILED");

    const invalidTypeEquip = await new Promise((resolve) => {
      client.emit(
        "profile:equipCosmetic",
        { type: "not_a_category", cosmeticId: "avatar_storm_oracle" },
        resolve
      );
    });
    assert.equal(invalidTypeEquip?.ok, false);
    assert.equal(invalidTypeEquip?.error?.code, "PROFILE_COSMETIC_WRITE_FAILED");

    const cosmeticsAfterFailures = await new Promise((resolve) => {
      client.emit("profile:getCosmetics", {}, resolve);
    });
    assert.equal(cosmeticsAfterFailures?.ok, true);
    assert.equal(cosmeticsAfterFailures?.cosmetics?.snapshot?.equipped?.avatar, "avatar_storm_oracle");
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative store purchase deducts tokens and rejects duplicate rebuys", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    const beforeProfile = await coordinator.profiles.ensureProfile("StoreAuthorityUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "StoreAuthorityUser");
    assert.equal(session?.ok, true);

    const firstPurchase = await new Promise((resolve) => {
      client.emit(
        "profile:buyStoreItem",
        { type: "avatar", cosmeticId: "fireavatarF" },
        resolve
      );
    });
    const profileAfterFirst = await coordinator.profiles.getProfile("StoreAuthorityUser");

    const secondPurchase = await new Promise((resolve) => {
      client.emit(
        "profile:buyStoreItem",
        { type: "avatar", cosmeticId: "fireavatarF" },
        resolve
      );
    });
    const profileAfterSecond = await coordinator.profiles.getProfile("StoreAuthorityUser");

    assert.equal(firstPurchase?.ok, true);
    assert.equal(firstPurchase?.result?.purchase?.status, "purchased");
    assert.equal(
      profileAfterFirst?.tokens,
      (beforeProfile?.tokens ?? 0) - Number(firstPurchase?.result?.purchase?.price ?? 0)
    );
    assert.ok(profileAfterFirst?.ownedCosmetics?.avatar?.includes("fireavatarF"));
    assert.equal(secondPurchase?.ok, true);
    assert.equal(secondPurchase?.result?.purchase?.status, "already-owned");
    assert.equal(profileAfterSecond?.tokens, profileAfterFirst?.tokens);
    assert.equal(
      profileAfterSecond?.ownedCosmetics?.avatar?.filter((item) => item === "fireavatarF").length,
      1
    );
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: bootstrap sessions cannot access or mutate claimed profiles", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const createFoundation = () =>
    createMultiplayerFoundation({
      port: 0,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      accountStore,
      profileAuthority
    });
  let foundation = createFoundation();
  let ownerClient = null;
  let attackerClient = null;

  try {
    let port = await foundation.start();
    ownerClient = await connectClient(port);

    const ownerRegister = await registerAccount(ownerClient, {
      username: "ClaimedVictim",
      email: "claimed-victim@example.com",
      password: "VictimPass123"
    });
    assert.equal(ownerRegister?.ok, true);

    await coordinator.profiles.updateProfile("ClaimedVictim", (current) => ({
      ...current,
      tokens: 400,
      playerXP: 0,
      chests: {
        ...(current?.chests ?? {}),
        basic: 1
      }
    }));
    const beforeProfile = await coordinator.profiles.getProfile("ClaimedVictim");

    ownerClient.disconnect();
    ownerClient = null;
    await foundation.stop();

    foundation = createFoundation();
    port = await foundation.start();
    attackerClient = await connectClient(port);

    const bootstrap = await bootstrapSession(attackerClient, "ClaimedVictim");
    assert.equal(bootstrap?.ok, true);
    assert.equal(Boolean(bootstrap?.session?.authenticated), false);

    const ownProfileRead = await new Promise((resolve) => {
      attackerClient.emit("profile:get", {}, resolve);
    });
    const cosmeticsRead = await new Promise((resolve) => {
      attackerClient.emit("profile:getCosmetics", {}, resolve);
    });
    const purchaseAttempt = await new Promise((resolve) => {
      attackerClient.emit(
        "profile:buyStoreItem",
        { type: "avatar", cosmeticId: "fireavatarF" },
        resolve
      );
    });
    const dailyAttempt = await new Promise((resolve) => {
      attackerClient.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const chestAttempt = await new Promise((resolve) => {
      attackerClient.emit("profile:openChest", { chestType: "basic" }, resolve);
    });
    const gauntletAttempt = await new Promise((resolve) => {
      attackerClient.emit(
        "profile:recordGauntletStats",
        {
          runStarted: true,
          matchWon: true,
          currentStreak: 3,
          claimedMilestoneStreaks: []
        },
        resolve
      );
    });

    for (const response of [
      ownProfileRead,
      cosmeticsRead,
      purchaseAttempt,
      dailyAttempt,
      chestAttempt,
      gauntletAttempt
    ]) {
      assert.equal(response?.ok, false);
      assert.equal(response?.error?.code, "PROFILE_AUTH_REQUIRED");
    }

    const afterProfile = await coordinator.profiles.getProfile("ClaimedVictim");
    assert.equal(afterProfile?.tokens, beforeProfile?.tokens);
    assert.equal(afterProfile?.playerXP, beforeProfile?.playerXP);
    assert.equal(afterProfile?.chests?.basic, beforeProfile?.chests?.basic);
    assert.deepEqual(afterProfile?.ownedCosmetics?.avatar ?? [], beforeProfile?.ownedCosmetics?.avatar ?? []);
    assert.equal(afterProfile?.gauntletRuns, beforeProfile?.gauntletRuns);
    assert.equal(afterProfile?.gauntletWins, beforeProfile?.gauntletWins);
    assert.equal(afterProfile?.gauntletBestStreak, beforeProfile?.gauntletBestStreak);
  } finally {
    ownerClient?.disconnect();
    attackerClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: authenticated claimed-profile sessions keep legitimate private profile, store, daily login, and chest flows", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const profileAuthority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    accountStore,
    profileAuthority
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const registerResult = await registerAccount(client, {
      username: "ClaimedLegitUser",
      email: "claimed-legit@example.com",
      password: "ClaimedPass123"
    });
    assert.equal(registerResult?.ok, true);
    assert.equal(Boolean(registerResult?.session?.authenticated), true);

    await coordinator.profiles.updateProfile("ClaimedLegitUser", (current) => ({
      ...current,
      tokens: 400,
      playerXP: 0,
      chests: {
        ...(current?.chests ?? {}),
        basic: 1
      }
    }));

    const profileRead = await new Promise((resolve) => {
      client.emit("profile:get", {}, resolve);
    });
    const purchase = await new Promise((resolve) => {
      client.emit(
        "profile:buyStoreItem",
        { type: "avatar", cosmeticId: "fireavatarF" },
        resolve
      );
    });
    const dailyClaim = await new Promise((resolve) => {
      client.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const chestOpen = await new Promise((resolve) => {
      client.emit("profile:openChest", { chestType: "basic" }, resolve);
    });

    assert.equal(profileRead?.ok, true);
    assert.equal(profileRead?.profile?.profile?.username, "ClaimedLegitUser");
    assert.equal(purchase?.ok, true);
    assert.equal(purchase?.result?.purchase?.status, "purchased");
    assert.equal(dailyClaim?.ok, true);
    assert.equal(dailyClaim?.result?.granted, true);
    assert.equal(chestOpen?.ok, true);
    assert.equal(chestOpen?.result?.consumed, 1);

    const profileAfter = await coordinator.profiles.getProfile("ClaimedLegitUser");
    assert.ok(profileAfter?.ownedCosmetics?.avatar?.includes("fireavatarF"));
    assert.equal(profileAfter?.chests?.basic, 0);
    assert.ok(profileAfter?.tokens > 0);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: authenticated claimed user can start local PvE, Featured Rival, and Gauntlet sessions", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const auth = await registerAccount(client, {
      username: "LocalSessionOwner",
      email: "local-session-owner@example.com",
      password: "PlayerPass123"
    });
    assert.equal(auth?.ok, true);

    const pve = await emitWithAck(client, "profile:startLocalPveMatch", {
      aiDifficulty: "hard"
    });
    const featured = await emitWithAck(client, "profile:startFeaturedRivalMatch", {
      aiDifficulty: "hard",
      featuredRivalId: "crownfire_duelist"
    });
    const gauntlet = await emitWithAck(client, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "pyro_maniac"
    });

    assert.equal(pve?.ok, true);
    assert.equal(pve?.result?.session?.mode, "pve");
    assert.equal(pve?.result?.session?.aiDifficulty, "hard");
    assert.equal(pve?.result?.session?.status, "active");

    assert.equal(featured?.ok, true);
    assert.equal(featured?.result?.session?.mode, "featured_rival");
    assert.equal(featured?.result?.session?.featuredRivalId, "crownfire_duelist");

    assert.equal(gauntlet?.ok, true);
    assert.equal(gauntlet?.result?.session?.mode, "gauntlet");
    assert.equal(gauntlet?.result?.session?.gauntletRivalId, "pyro_maniac");
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: bootstrap and cross-user local match session starts are rejected for claimed profiles", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore
  });
  const createFoundation = () =>
    createMultiplayerFoundation({
      port: 0,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      profileAuthority: new MultiplayerProfileAuthority({
        coordinator,
        logger: { info: () => {} }
      }),
      accountStore
    });
  let owner = null;
  let bootstrap = null;
  let attacker = null;
  let activeFoundation = foundation;

  try {
    let port = await activeFoundation.start();
    owner = await connectClient(port);
    attacker = await connectClient(port);

    const ownerAuth = await registerAccount(owner, {
      username: "ClaimedLocalSessionUser",
      email: "claimed-local-session@example.com",
      password: "PlayerPass123"
    });
    const attackerAuth = await registerAccount(attacker, {
      username: "OtherClaimedUser",
      email: "other-claimed-user@example.com",
      password: "PlayerPass123"
    });
    assert.equal(ownerAuth?.ok, true);
    assert.equal(attackerAuth?.ok, true);

    owner.disconnect();
    owner = null;
    attacker.disconnect();
    attacker = null;
    await activeFoundation.stop();

    activeFoundation = createFoundation();
    port = await activeFoundation.start();
    bootstrap = await connectClient(port);
    attacker = await connectClient(port);

    const bootstrapSessionResult = await bootstrapSession(bootstrap, "ClaimedLocalSessionUser");
    assert.equal(bootstrapSessionResult?.ok, true);
    assert.equal(Boolean(bootstrapSessionResult?.session?.authenticated), false);

    const attackerLogin = await loginAccount(attacker, {
      email: "other-claimed-user@example.com",
      password: "PlayerPass123"
    });
    assert.equal(attackerLogin?.ok, true);

    const bootstrapStart = await emitWithAck(bootstrap, "profile:startLocalPveMatch", {
      aiDifficulty: "normal"
    });
    const crossUserStart = await emitWithAck(attacker, "profile:startLocalPveMatch", {
      username: "ClaimedLocalSessionUser",
      aiDifficulty: "normal"
    });

    assert.equal(bootstrapStart?.ok, false);
    assert.equal(bootstrapStart?.error?.code, "PROFILE_AUTH_REQUIRED");
    assert.equal(crossUserStart?.ok, false);
    assert.equal(crossUserStart?.error?.code, "PROFILE_USERNAME_MISMATCH");
  } finally {
    owner?.disconnect();
    bootstrap?.disconnect();
    attacker?.disconnect();
    await activeFoundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: local match session state fetch is owner-only and session IDs stay unique", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    })
  });
  let owner = null;
  let other = null;

  try {
    const port = await foundation.start();
    owner = await connectClient(port);
    other = await connectClient(port);

    const ownerAuth = await registerAccount(owner, {
      username: "SessionOwnerOne",
      email: "session-owner-one@example.com",
      password: "PlayerPass123"
    });
    const otherAuth = await registerAccount(other, {
      username: "SessionOwnerTwo",
      email: "session-owner-two@example.com",
      password: "PlayerPass123"
    });
    assert.equal(ownerAuth?.ok, true);
    assert.equal(otherAuth?.ok, true);

    const first = await emitWithAck(owner, "profile:startLocalPveMatch", {
      aiDifficulty: "easy"
    });
    const second = await emitWithAck(owner, "profile:startLocalPveMatch", {
      aiDifficulty: "normal"
    });

    assert.equal(first?.ok, true);
    assert.equal(second?.ok, true);
    assert.notEqual(first?.result?.session?.sessionId, second?.result?.session?.sessionId);

    const ownerRead = await emitWithAck(owner, "profile:getLocalMatchSessionState", {
      sessionId: first?.result?.session?.sessionId
    });
    const otherRead = await emitWithAck(other, "profile:getLocalMatchSessionState", {
      sessionId: first?.result?.session?.sessionId
    });
    const abandoned = await emitWithAck(owner, "profile:abandonLocalMatchSession", {
      sessionId: first?.result?.session?.sessionId
    });

    assert.equal(ownerRead?.ok, true);
    assert.equal(ownerRead?.result?.session?.sessionId, first?.result?.session?.sessionId);
    assert.equal(otherRead?.ok, false);
    assert.equal(otherRead?.error?.code, "LOCAL_MATCH_SESSION_ACCESS_DENIED");
    assert.equal(abandoned?.ok, true);
    assert.equal(abandoned?.result?.session?.status, "abandoned");
  } finally {
    owner?.disconnect();
    other?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: local match session routes reject invalid mode, difficulty, and rival inputs", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const auth = await registerAccount(client, {
      username: "ValidationSessionUser",
      email: "validation-session-user@example.com",
      password: "PlayerPass123"
    });
    assert.equal(auth?.ok, true);

    const invalidMode = await emitWithAck(client, "profile:startLocalPveMatch", {
      mode: "gauntlet",
      aiDifficulty: "normal"
    });
    const invalidDifficulty = await emitWithAck(client, "profile:startLocalPveMatch", {
      aiDifficulty: "nightmare"
    });
    const invalidFeatured = await emitWithAck(client, "profile:startFeaturedRivalMatch", {
      aiDifficulty: "hard",
      featuredRivalId: "fake_rival"
    });
    const invalidGauntlet = await emitWithAck(client, "profile:startGauntletMatch", {
      aiDifficulty: "normal",
      gauntletRivalId: "fake_rival"
    });

    assert.equal(invalidMode?.ok, false);
    assert.equal(invalidMode?.error?.code, "LOCAL_MATCH_INVALID_MODE");
    assert.equal(invalidDifficulty?.ok, false);
    assert.equal(invalidDifficulty?.error?.code, "LOCAL_MATCH_INVALID_DIFFICULTY");
    assert.equal(invalidFeatured?.ok, false);
    assert.equal(invalidFeatured?.error?.code, "LOCAL_MATCH_INVALID_FEATURED_RIVAL");
    assert.equal(invalidGauntlet?.ok, false);
    assert.equal(invalidGauntlet?.error?.code, "LOCAL_MATCH_INVALID_GAUNTLET_RIVAL");
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative store purchase blocks the Goldbound limited card back while allowing the remaining Goldbound Relics items", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("GoldboundAuthorityUser", { tokens: 5000 });
    const beforeProfile = await coordinator.profiles.getProfile("GoldboundAuthorityUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "GoldboundAuthorityUser");
    assert.equal(session?.ok, true);

    const purchaseTargets = [
      { type: "avatar", cosmeticId: "avatar_aurelian_archon", expectedPrice: 1200 },
      { type: "title", cosmeticId: "title_goldbound", expectedPrice: 700 },
      {
        type: "cardBack",
        cosmeticId: "cardback_goldbound_relic",
        expectedPrice: 1050,
        expectedError: "Store item not found for cardBack:cardback_goldbound_relic."
      },
      { type: "elementCardVariant", cosmeticId: "fire_variant_goldbound_relics", expectedPrice: 650 },
      { type: "elementCardVariant", cosmeticId: "earth_variant_goldbound_relics", expectedPrice: 650 },
      { type: "elementCardVariant", cosmeticId: "wind_variant_goldbound_relics", expectedPrice: 650 },
      { type: "elementCardVariant", cosmeticId: "water_variant_goldbound_relics", expectedPrice: 650 }
    ];

    const responses = [];
    for (const target of purchaseTargets) {
      const response = await new Promise((resolve) => {
        client.emit("profile:buyStoreItem", { type: target.type, cosmeticId: target.cosmeticId }, resolve);
      });
      responses.push(response);
    }

    const profileAfterPurchases = await coordinator.profiles.getProfile("GoldboundAuthorityUser");

    for (let index = 0; index < purchaseTargets.length; index += 1) {
      const target = purchaseTargets[index];
      const response = responses[index];
      if (target.expectedError) {
        assert.equal(response?.ok, false, `${target.type}:${target.cosmeticId} should be blocked`);
        assert.equal(response?.error?.code, "PROFILE_STORE_WRITE_FAILED");
        assert.equal(response?.error?.message, target.expectedError);
        continue;
      }
      assert.equal(response?.ok, true, `${target.type}:${target.cosmeticId} should succeed`);
      assert.equal(response?.result?.purchase?.status, "purchased");
      assert.equal(response?.result?.purchase?.price, target.expectedPrice);
    }

    assert.ok(profileAfterPurchases?.ownedCosmetics?.avatar?.includes("avatar_aurelian_archon"));
    assert.ok(profileAfterPurchases?.ownedCosmetics?.title?.includes("title_goldbound"));
    assert.equal(profileAfterPurchases?.ownedCosmetics?.cardBack?.includes("cardback_goldbound_relic"), false);
    assert.ok(profileAfterPurchases?.ownedCosmetics?.elementCardVariant?.includes("fire_variant_goldbound_relics"));
    assert.ok(profileAfterPurchases?.ownedCosmetics?.elementCardVariant?.includes("earth_variant_goldbound_relics"));
    assert.ok(profileAfterPurchases?.ownedCosmetics?.elementCardVariant?.includes("wind_variant_goldbound_relics"));
    assert.ok(profileAfterPurchases?.ownedCosmetics?.elementCardVariant?.includes("water_variant_goldbound_relics"));
    assert.equal(profileAfterPurchases?.tokens, (beforeProfile?.tokens ?? 0) - 4500);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative store purchase lookup blocks the Frostveil limited card back while accepting the remaining Frostveil composite store keys", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("FrostveilAuthorityUser", { tokens: 5000 });
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "FrostveilAuthorityUser");
    assert.equal(session?.ok, true);

    const purchaseTargets = [
      { type: "avatar:avatar_frostveil_heir", expectedPrice: 1200, ownedType: "avatar", ownedId: "avatar_frostveil_heir" },
      { type: "title:title_shiverborne", expectedPrice: 700, ownedType: "title", ownedId: "title_shiverborne" },
      {
        type: "cardBack:cardback_glacier_sigil",
        expectedPrice: 1050,
        ownedType: "cardBack",
        ownedId: "cardback_glacier_sigil",
        expectedError: "Store item not found for cardBack:cardback_glacier_sigil."
      },
      {
        type: "elementCardVariant:fire_variant_aurora_flare",
        expectedPrice: 650,
        ownedType: "elementCardVariant",
        ownedId: "fire_variant_aurora_flare"
      },
      {
        type: "elementCardVariant:earth_variant_icebound_crag",
        expectedPrice: 650,
        ownedType: "elementCardVariant",
        ownedId: "earth_variant_icebound_crag"
      },
      {
        type: "elementCardVariant:wind_variant_sleet_spiral",
        expectedPrice: 650,
        ownedType: "elementCardVariant",
        ownedId: "wind_variant_sleet_spiral"
      },
      {
        type: "elementCardVariant:water_variant_frostbloom",
        expectedPrice: 650,
        ownedType: "elementCardVariant",
        ownedId: "water_variant_frostbloom"
      }
    ];

    for (const target of purchaseTargets) {
      const response = await new Promise((resolve) => {
        client.emit("profile:buyStoreItem", { type: target.type }, resolve);
      });
      if (target.expectedError) {
        assert.equal(response?.ok, false, `${target.type} should be blocked`);
        assert.equal(response?.error?.code, "PROFILE_STORE_WRITE_FAILED");
        assert.equal(response?.error?.message, target.expectedError);
        continue;
      }
      assert.equal(response?.ok, true, `${target.type} should succeed`);
      assert.equal(response?.result?.purchase?.status, "purchased");
      assert.equal(response?.result?.purchase?.price, target.expectedPrice);
    }

    const profileAfterPurchases = await coordinator.profiles.getProfile("FrostveilAuthorityUser");
    for (const target of purchaseTargets) {
      if (target.expectedError) {
        assert.equal(
          profileAfterPurchases?.ownedCosmetics?.[target.ownedType]?.includes(target.ownedId),
          false,
          `${target.ownedType}:${target.ownedId} should stay unavailable outside featured rotation`
        );
        continue;
      }
      assert.ok(
        profileAfterPurchases?.ownedCosmetics?.[target.ownedType]?.includes(target.ownedId),
        `${target.ownedType}:${target.ownedId} should be owned`
      );
    }
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative daily login claim grants once and rejects duplicate same-window claims", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    const beforeProfile = await coordinator.profiles.ensureProfile("DailyAuthorityUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "DailyAuthorityUser");
    assert.equal(session?.ok, true);

    const firstClaim = await new Promise((resolve) => {
      client.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const profileAfterFirst = await coordinator.profiles.getProfile("DailyAuthorityUser");

    const secondClaim = await new Promise((resolve) => {
      client.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const profileAfterSecond = await coordinator.profiles.getProfile("DailyAuthorityUser");

    assert.equal(firstClaim?.ok, true);
    assert.equal(firstClaim?.result?.granted, true);
    assert.equal(firstClaim?.result?.snapshot?.progression?.dailyLogin?.eligible, false);
    assert.equal(profileAfterFirst?.tokens, (beforeProfile?.tokens ?? 0) + 4);
    assert.equal(profileAfterFirst?.playerXP, (beforeProfile?.playerXP ?? 0) + 2);

    assert.equal(secondClaim?.ok, true);
    assert.equal(secondClaim?.result?.granted, false);
    assert.equal(profileAfterSecond?.tokens, profileAfterFirst?.tokens);
    assert.equal(profileAfterSecond?.playerXP, profileAfterFirst?.playerXP);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

async function createDailyLoginDay7AuthorityHarness({ randomValues }) {
  const dataDir = await createTempDataDir();
  const randomQueue = [...randomValues];
  const coordinator = new StateCoordinator({
    dataDir
  });
  const authority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });
  authority.claimDailyLoginReward = async (username) => {
    const result = await coordinator.claimDailyLoginReward(username, FIXED_DAY7_LOGIN_NOW_MS, {
      random: () => randomQueue.shift() ?? 1
    });
    return {
      ...result,
      snapshot: await authority.getProfile(username)
    };
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: authority
  });

  return { dataDir, coordinator, foundation };
}

async function seedDay7ReadyProfile(coordinator, username) {
  const { lastResetMs } = getDailyResetWindow(FIXED_DAY7_LOGIN_NOW_MS);
  const { lastResetMs: previousResetMs } = getDailyResetWindow(lastResetMs - 1);
  await coordinator.profiles.updateProfile(username, (current) => ({
    ...current,
    tokens: 100,
    playerXP: 0,
    dailyLoginStreakDay: 6,
    lastDailyLoginClaimDate: new Date(previousResetMs).toISOString()
  }));
}

test("multiplayer foundation: Day 7 daily login miss still grants 50 tokens and preserved XP without a chest", async () => {
  const { dataDir, coordinator, foundation } = await createDailyLoginDay7AuthorityHarness({
    randomValues: [0.5, 0.5]
  });
  let client = null;

  try {
    await seedDay7ReadyProfile(coordinator, "Day7MissUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "Day7MissUser");
    assert.equal(session?.ok, true);

    const claim = await new Promise((resolve) => {
      client.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const profileAfter = await coordinator.profiles.getProfile("Day7MissUser");

    assert.equal(claim?.ok, true);
    assert.equal(claim?.result?.granted, true);
    assert.equal(claim?.result?.streakDay, 7);
    assert.equal(claim?.result?.rewardSummary?.tokens, 50);
    assert.equal(claim?.result?.rewardSummary?.xp, 20);
    assert.equal(claim?.result?.rewardSummary?.chestAwarded, null);
    assert.equal(claim?.result?.rewardTokens, 50);
    assert.equal(claim?.result?.rewardXp, 20);
    assert.deepEqual(claim?.result?.chestGrants ?? [], []);
    assert.equal(profileAfter?.tokens, 150);
    assert.equal(profileAfter?.playerXP, 20);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: Day 7 daily login epic hit grants 50 tokens plus one Epic Chest", async () => {
  const { dataDir, coordinator, foundation } = await createDailyLoginDay7AuthorityHarness({
    randomValues: [0.5, 0.05]
  });
  let client = null;

  try {
    await seedDay7ReadyProfile(coordinator, "Day7EpicUser");
    const beforeProfile = await coordinator.profiles.getProfile("Day7EpicUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "Day7EpicUser");
    assert.equal(session?.ok, true);

    const claim = await new Promise((resolve) => {
      client.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const profileAfter = await coordinator.profiles.getProfile("Day7EpicUser");

    assert.equal(claim?.ok, true);
    assert.equal(claim?.result?.granted, true);
    assert.equal(claim?.result?.streakDay, 7);
    assert.equal(claim?.result?.rewardSummary?.tokens, 50);
    assert.equal(claim?.result?.rewardSummary?.xp, 20);
    assert.deepEqual(claim?.result?.rewardSummary?.chestAwarded, {
      chestType: "epic",
      chestLabel: "Epic Chest",
      amount: 1
    });
    assert.equal(claim?.result?.rewardTokens, 50);
    assert.equal(claim?.result?.rewardXp, 20);
    assert.deepEqual(claim?.result?.chestGrants, [{ chestType: "epic", amount: 1 }]);
    assert.equal(profileAfter?.tokens, (beforeProfile?.tokens ?? 0) + 50);
    assert.equal(profileAfter?.playerXP, (beforeProfile?.playerXP ?? 0) + 20);
    assert.equal(profileAfter?.chests?.epic, (beforeProfile?.chests?.epic ?? 0) + 1);
    assert.equal(claim?.result?.chestGrants?.length, 1);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: Day 7 daily login legendary hit grants 50 tokens plus one Legendary Chest only", async () => {
  const { dataDir, coordinator, foundation } = await createDailyLoginDay7AuthorityHarness({
    randomValues: [0.02]
  });
  let client = null;

  try {
    await seedDay7ReadyProfile(coordinator, "Day7LegendaryUser");
    const beforeProfile = await coordinator.profiles.getProfile("Day7LegendaryUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "Day7LegendaryUser");
    assert.equal(session?.ok, true);

    const claim = await new Promise((resolve) => {
      client.emit("profile:claimDailyLoginReward", {}, resolve);
    });
    const profileAfter = await coordinator.profiles.getProfile("Day7LegendaryUser");

    assert.equal(claim?.ok, true);
    assert.equal(claim?.result?.granted, true);
    assert.equal(claim?.result?.streakDay, 7);
    assert.equal(claim?.result?.rewardSummary?.tokens, 50);
    assert.equal(claim?.result?.rewardSummary?.xp, 20);
    assert.deepEqual(claim?.result?.rewardSummary?.chestAwarded, {
      chestType: "legendary",
      chestLabel: "Legendary Chest",
      amount: 1
    });
    assert.equal(claim?.result?.rewardTokens, 50);
    assert.equal(claim?.result?.rewardXp, 20);
    assert.deepEqual(claim?.result?.chestGrants, [{ chestType: "legendary", amount: 1 }]);
    assert.equal(profileAfter?.tokens, (beforeProfile?.tokens ?? 0) + 50);
    assert.equal(profileAfter?.playerXP, (beforeProfile?.playerXP ?? 0) + 20);
    assert.equal(profileAfter?.chests?.legendary, (beforeProfile?.chests?.legendary ?? 0) + 1);
    assert.equal(profileAfter?.chests?.epic ?? 0, beforeProfile?.chests?.epic ?? 0);
    assert.equal(claim?.result?.chestGrants?.length, 1);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: Daily Element Chest status and opening use the authenticated authoritative route", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("DailyChestAuthorityUser", (current) => ({
      ...current,
      tokens: 500,
      chests: {
        ...(current?.chests ?? {}),
        basic: 2,
        milestone: 1,
        epic: 1,
        legendary: 1
      }
    }));

    const beforeProfile = await coordinator.profiles.getProfile("DailyChestAuthorityUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "DailyChestAuthorityUser");
    assert.equal(session?.ok, true);

    const status = await new Promise((resolve) => {
      client.emit("profile:getDailyElementChestStatus", {}, resolve);
    });
    const opened = await new Promise((resolve) => {
      client.emit("profile:openDailyElementChest", { openType: "paid" }, resolve);
    });
    const profileAfterOpen = await coordinator.profiles.getProfile("DailyChestAuthorityUser");

    assert.equal(status?.ok, true);
    assert.equal(status?.result?.canOpenFree, true);
    assert.equal(status?.result?.paidOpenCost, 100);
    assert.equal(status?.result?.collectionProgress?.totalAvailable, 12);
    assert.equal(status?.result?.collectionProgress?.byRarity?.common?.total, 3);

    assert.equal(opened?.ok, true);
    assert.equal(opened?.result?.source, "daily_element_chest");
    assert.equal(opened?.result?.openType, "paid");
    assert.equal(opened?.result?.rarity, "common");
    assert.equal(opened?.result?.cosmetic?.cosmeticId, "title_first_light");
    assert.equal(opened?.result?.status?.paidOpenCost, 100);
    assert.equal(opened?.result?.status?.collectionProgress?.totalOwned, 1);
    assert.equal(opened?.result?.status?.collectionProgress?.byRarity?.common?.owned, 1);
    assert.equal(profileAfterOpen?.tokens, (beforeProfile?.tokens ?? 0) - 100);
    assert.ok(profileAfterOpen?.ownedCosmetics?.title?.includes("title_first_light"));
    assert.deepEqual(profileAfterOpen?.chests, beforeProfile?.chests);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: Daily Element Chest rejects invalid open types cleanly without mutating existing chest counts", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("DailyChestRejectUser", (current) => ({
      ...current,
      chests: {
        ...(current?.chests ?? {}),
        basic: 3,
        milestone: 2,
        epic: 1,
        legendary: 4
      }
    }));

    const beforeProfile = await coordinator.profiles.getProfile("DailyChestRejectUser");
    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "DailyChestRejectUser");
    assert.equal(session?.ok, true);

    const rejected = await new Promise((resolve) => {
      client.emit("profile:openDailyElementChest", { openType: "bonus" }, resolve);
    });
    const profileAfterReject = await coordinator.profiles.getProfile("DailyChestRejectUser");

    assert.equal(rejected?.ok, false);
    assert.equal(rejected?.error?.code, "PROFILE_DAILY_CHEST_WRITE_FAILED");
    assert.match(rejected?.error?.message ?? "", /openType/i);
    assert.deepEqual(profileAfterReject?.chests, beforeProfile?.chests);
    assert.deepEqual(profileAfterReject?.dailyElementChest, beforeProfile?.dailyElementChest);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: authoritative milestone reward acknowledgement clears the pending level server-side", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("MilestoneAuthorityUser", (current) => ({
      ...current,
      playerLevel: 5,
      chests: {
        ...(current?.chests ?? {}),
        milestone: 1
      },
      pendingMilestoneChestRewardLevel: 5
    }));

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "MilestoneAuthorityUser");
    assert.equal(session?.ok, true);

    const acknowledged = await new Promise((resolve) => {
      client.emit("profile:acknowledgeMilestoneChestReward", { level: 5 }, resolve);
    });
    const profileAfterAcknowledge = await coordinator.profiles.getProfile("MilestoneAuthorityUser");

    assert.equal(acknowledged?.ok, true);
    assert.equal(acknowledged?.result?.pendingMilestoneChestRewardLevel, null);
    assert.equal(acknowledged?.result?.snapshot?.profile?.pendingMilestoneChestRewardLevel, null);
    assert.equal(profileAfterAcknowledge?.pendingMilestoneChestRewardLevel, null);
    assert.equal(profileAfterAcknowledge?.chests?.milestone, 1);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative chest opening decrements inventory and persists rewards", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.grantChest({
      username: "ChestAuthorityUser",
      chestType: "epic",
      amount: 1
    });

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "ChestAuthorityUser");
    assert.equal(session?.ok, true);

    const opened = await new Promise((resolve) => {
      client.emit("profile:openChest", { chestType: "epic" }, resolve);
    });
    const profileAfterOpen = await coordinator.profiles.getProfile("ChestAuthorityUser");

    assert.equal(opened?.ok, true);
    assert.equal(opened?.result?.chestType, "epic");
    assert.equal(opened?.result?.consumed, 1);
    assert.equal(opened?.result?.remaining, 0);
    assert.equal(opened?.result?.rewards?.tokens, 40);
    assert.equal(opened?.result?.rewards?.xp, 20);
    assert.ok(opened?.result?.rewards?.cosmetic);
    assert.equal(profileAfterOpen?.chests?.epic, 0);
    assert.equal(profileAfterOpen?.tokens, DEFAULT_STARTING_TOKENS + 40);
    assert.equal(profileAfterOpen?.playerXP, 20);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative legendary chest opening decrements inventory and persists rewards", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.grantChest({
      username: "LegendaryChestAuthorityUser",
      chestType: "legendary",
      amount: 1
    });

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "LegendaryChestAuthorityUser");
    assert.equal(session?.ok, true);

    const opened = await new Promise((resolve) => {
      client.emit("profile:openChest", { chestType: "legendary" }, resolve);
    });
    const profileAfterOpen = await coordinator.profiles.getProfile("LegendaryChestAuthorityUser");

    assert.equal(opened?.ok, true);
    assert.equal(opened?.result?.chestType, "legendary");
    assert.equal(opened?.result?.consumed, 1);
    assert.equal(opened?.result?.remaining, 0);
    assert.equal(opened?.result?.rewards?.tokens, 100);
    assert.equal(opened?.result?.rewards?.xp, 50);
    assert.ok(opened?.result?.rewards?.cosmetic);
    assert.equal(profileAfterOpen?.chests?.legendary, 0);
    assert.equal(profileAfterOpen?.tokens, DEFAULT_STARTING_TOKENS + 100);
    assert.equal(profileAfterOpen?.playerXP, 50);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: repeated legendary chest opens stay stable when the first open crosses level 25", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;
  try {
    const xpThresholds = getXpThresholds();
    await coordinator.profiles.updateProfile("LegendaryRepeatUser", (current) => ({
      ...current,
      playerLevel: 24,
      playerXP: xpThresholds[24] - 10,
      chests: {
        ...(current?.chests ?? {}),
        legendary: 3
      }
    }));

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "LegendaryRepeatUser");
    assert.equal(session?.ok, true);

    const results = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const opened = await new Promise((resolve) => {
        client.emit("profile:openChest", { chestType: "legendary" }, resolve);
      });
      results.push(opened);
    }

    const profileAfterOpens = await coordinator.profiles.getProfile("LegendaryRepeatUser");

    assert.deepEqual(
      results.map((entry) => entry?.ok),
      [true, true, true]
    );
    assert.deepEqual(
      results.map((entry) => entry?.result?.remaining),
      [2, 2, 1]
    );
    assert.equal(profileAfterOpens?.chests?.legendary, 1);
    assert.ok((profileAfterOpens?.legendaryChestGrantedLevels?.["25"] ?? false) === true);
    assert.ok((profileAfterOpens?.playerLevel ?? 0) >= 25);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: mixed chest open sequence stays stable across legendary, epic, and basic opens", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;
  try {
    await coordinator.profiles.updateProfile("MixedChestUser", (current) => ({
      ...current,
      chests: {
        ...(current?.chests ?? {}),
        basic: 1,
        epic: 1,
        legendary: 3
      }
    }));

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "MixedChestUser");
    assert.equal(session?.ok, true);

    const sequence = ["legendary", "epic", "legendary", "basic", "legendary"];
    const results = [];
    for (const chestType of sequence) {
      const opened = await new Promise((resolve) => {
        client.emit("profile:openChest", { chestType }, resolve);
      });
      results.push({ chestType, opened });
    }

    const profileAfterSequence = await coordinator.profiles.getProfile("MixedChestUser");

    assert.deepEqual(
      results.map(({ opened }) => opened?.ok),
      [true, true, true, true, true]
    );
    assert.deepEqual(
      results.map(({ chestType, opened }) => [chestType, opened?.result?.chestType]),
      sequence.map((chestType) => [chestType, chestType])
    );
    assert.equal(profileAfterSequence?.chests?.legendary, 0);
    assert.equal(profileAfterSequence?.chests?.epic, 0);
    assert.equal(profileAfterSequence?.chests?.basic, 0);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

for (const [chestType, expectedXp, expectedTokens, expectedBonus, expectedOverflow] of [
  ["basic", 0, 0, 1, 5],
  ["milestone", 0, 2, 0, 0],
  ["epic", 0, 40, 2, 20],
  ["legendary", 0, 100, 5, 50]
]) {
  test(`multiplayer foundation: server-authoritative ${chestType} chest opening at max level returns chest conversion metadata and capped progression`, async () => {
    const dataDir = await createTempDataDir();
    const coordinator = new StateCoordinator({
      dataDir,
      random: () => 0
    });
    const foundation = createMultiplayerFoundation({
      port: 0,
      logger: { info: () => {} },
      profileAuthority: new MultiplayerProfileAuthority({
        coordinator,
        logger: { info: () => {} }
      })
    });
    let client = null;

    try {
      const maxLevelXp = getXpThresholds().at(-1);
      await coordinator.profiles.updateProfile(`Max${chestType}ChestAuthorityUser`, (current) => ({
        ...current,
        playerXP: maxLevelXp,
        playerLevel: 100,
        chests: {
          ...(current?.chests ?? {}),
          basic: chestType === "basic" ? 1 : 0,
          milestone: chestType === "milestone" ? 1 : 0,
          epic: chestType === "epic" ? 1 : 0,
          legendary: chestType === "legendary" ? 1 : 0
        }
      }));

      const port = await foundation.start();
      client = await connectClient(port);

      const username = `Max${chestType}ChestAuthorityUser`;
      const session = await bootstrapSession(client, username);
      assert.equal(session?.ok, true);

      const opened = await new Promise((resolve) => {
        client.emit("profile:openChest", { chestType }, resolve);
      });
      const profileAfterOpen = await coordinator.profiles.getProfile(username);

      assert.equal(opened?.ok, true);
      assert.equal(opened?.result?.chestType, chestType);
      assert.equal(typeof opened?.result?.rewards?.xpConversionTokenBonus, "number");
      assert.equal(typeof opened?.result?.rewards?.overflowXp, "number");
      assert.equal(opened?.result?.rewards?.xp, expectedXp);
      assert.equal(opened?.result?.rewards?.tokens, expectedTokens);
      assert.equal(opened?.result?.rewards?.xpConversionTokenBonus, expectedBonus);
      assert.equal(opened?.result?.rewards?.overflowXp, expectedOverflow);
      assert.equal(profileAfterOpen?.playerXP, maxLevelXp);
      assert.equal(profileAfterOpen?.playerLevel, 100);
    } finally {
      client?.disconnect();
      await foundation.stop();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
}

test("multiplayer foundation: repeated epic chest opens stay stable after fresh session level progression", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;
  try {
    const xpThresholds = getXpThresholds();
    await coordinator.profiles.updateProfile("EpicRepeatUser", (current) => ({
      ...current,
      playerLevel: 24,
      playerXP: xpThresholds[24] - 40,
      chests: {
        ...(current?.chests ?? {}),
        epic: 3
      }
    }));

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "EpicRepeatUser");
    assert.equal(session?.ok, true);

    const results = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const opened = await new Promise((resolve) => {
        client.emit("profile:openChest", { chestType: "epic" }, resolve);
      });
      results.push(opened);
    }

    const profileAfterOpens = await coordinator.profiles.getProfile("EpicRepeatUser");

    assert.deepEqual(
      results.map((entry) => entry?.ok),
      [true, true, true]
    );
    assert.deepEqual(
      results.map((entry) => entry?.result?.chestType),
      ["epic", "epic", "epic"]
    );
    assert.equal(profileAfterOpens?.chests?.epic, 0);
    assert.ok((profileAfterOpens?.playerLevel ?? 0) >= 25);
    assert.ok((profileAfterOpens?.legendaryChestGrantedLevels?.["25"] ?? false) === true);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: server-authoritative store purchase rejects insufficient tokens and invalid items safely", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    await coordinator.profiles.updateProfile("StoreRejectUser", (current) => ({
      ...current,
      tokens: 0
    }));

    const port = await foundation.start();
    client = await connectClient(port);

    const session = await bootstrapSession(client, "StoreRejectUser");
    assert.equal(session?.ok, true);

    const insufficientPurchase = await new Promise((resolve) => {
      client.emit(
        "profile:buyStoreItem",
        { type: "avatar", cosmeticId: "fireavatarF" },
        resolve
      );
    });
    const invalidPurchase = await new Promise((resolve) => {
      client.emit(
        "profile:buyStoreItem",
        { type: "not_a_category", cosmeticId: "missing_item" },
        resolve
      );
    });
    const profileAfterFailures = await coordinator.profiles.getProfile("StoreRejectUser");

    assert.equal(insufficientPurchase?.ok, false);
    assert.equal(insufficientPurchase?.error?.code, "PROFILE_STORE_WRITE_FAILED");
    assert.equal(invalidPurchase?.ok, false);
    assert.equal(invalidPurchase?.error?.code, "PROFILE_STORE_WRITE_FAILED");
    assert.equal(profileAfterFailures?.tokens, 0);
    assert.ok(!profileAfterFailures?.ownedCosmetics?.avatar?.includes("fireavatarF"));
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: room create and join sanitize spoofed online cosmetics to the server-authoritative profile snapshot", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  await coordinator.profiles.updateProfile("AuthorityHost", (current) => ({
    ...current,
    ownedCosmetics: {
      ...current.ownedCosmetics,
      avatar: [...current.ownedCosmetics.avatar, "avatar_storm_oracle"],
      background: [...current.ownedCosmetics.background, "fire_background"],
      cardBack: [...current.ownedCosmetics.cardBack, "cardback_storm_spiral"],
      title: [...current.ownedCosmetics.title, "title_element_sovereign"],
      badge: [...current.ownedCosmetics.badge, "badge_element_veteran"]
    },
    equippedCosmetics: {
      ...current.equippedCosmetics,
      avatar: "avatar_storm_oracle",
      background: "fire_background",
      cardBack: "cardback_storm_spiral",
      title: "title_element_sovereign",
      badge: "badge_element_veteran"
    }
  }));
  await coordinator.profiles.updateProfile("AuthorityGuest", (current) => ({
    ...current,
    ownedCosmetics: {
      ...current.ownedCosmetics,
      avatar: [...current.ownedCosmetics.avatar, "avatar_fourfold_lord"],
      background: [...current.ownedCosmetics.background, "celestial_void_background"],
      cardBack: [...current.ownedCosmetics.cardBack, "cardback_elemental_nexus"],
      title: [...current.ownedCosmetics.title, "title_war_master"],
      badge: [...current.ownedCosmetics.badge, "badge_arena_legend"]
    },
    equippedCosmetics: {
      ...current.equippedCosmetics,
      avatar: "avatar_fourfold_lord",
      background: "celestial_void_background",
      cardBack: "cardback_elemental_nexus",
      title: "title_war_master",
      badge: "badge_arena_legend"
    }
  }));

  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    assert.equal((await bootstrapSession(host, "AuthorityHost"))?.ok, true);
    assert.equal((await bootstrapSession(guest, "AuthorityGuest"))?.ok, true);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", {
      equippedCosmetics: {
        avatar: "spoofed_avatar",
        background: "spoofed_background",
        cardBack: "spoofed_cardback",
        elementCardVariant: {
          fire: "spoofed_fire_variant"
        },
        title: "spoofed_title",
        badge: "spoofed_badge"
      }
    });
    const createdRoom = await createdPromise;

    assert.equal(createdRoom.host.equippedCosmetics.avatar, "avatar_storm_oracle");
    assert.equal(createdRoom.host.equippedCosmetics.background, "fire_background");
    assert.equal(createdRoom.host.equippedCosmetics.cardBack, "cardback_storm_spiral");
    assert.equal(createdRoom.host.equippedCosmetics.title, "title_element_sovereign");
    assert.equal(createdRoom.host.equippedCosmetics.badge, "badge_element_veteran");

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", {
      roomCode: createdRoom.roomCode,
      equippedCosmetics: {
        avatar: "spoofed_guest_avatar",
        background: "spoofed_guest_background",
        cardBack: "spoofed_guest_cardback",
        title: "spoofed_guest_title",
        badge: "spoofed_guest_badge"
      }
    });
    const joinedRoom = await joinedPromise;
    await hostUpdatePromise;

    assert.equal(joinedRoom.guest.equippedCosmetics.avatar, "avatar_fourfold_lord");
    assert.equal(joinedRoom.guest.equippedCosmetics.background, "celestial_void_background");
    assert.equal(joinedRoom.guest.equippedCosmetics.cardBack, "cardback_elemental_nexus");
    assert.equal(joinedRoom.guest.equippedCosmetics.title, "title_war_master");
    assert.equal(joinedRoom.guest.equippedCosmetics.badge, "badge_arena_legend");
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: auth register persists a hashed account record and issues an authenticated session", async () => {
  const dataDir = await createTempDataDir();
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  let linkedAccount = null;
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    accountStore,
    profileAuthority: {
      assertProfileClaimAvailable: async () => null,
      linkProfileToAccount: async ({ username, accountId }) => {
        linkedAccount = { username, accountId };
        return {
          username,
          profile: {
            username,
            linkedAccountId: accountId
          }
        };
      },
      getProfile: async (username) => ({
        username,
        profile: { username }
      })
    }
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const response = await new Promise((resolve) => {
      client.emit(
        "auth:register",
        {
          email: "founder@example.com",
          password: "password123",
          username: "FounderUser"
        },
        resolve
      );
    });

    assert.equal(response?.ok, true);
    assert.equal(response?.account?.email, "founder@example.com");
    assert.equal(response?.account?.username, "FounderUser");
    assert.equal(response?.session?.authenticated, true);
    assert.equal(typeof response?.session?.accountId, "string");
    assert.equal(response?.session?.profileKey, "FounderUser");
    assert.deepEqual(linkedAccount, {
      username: "FounderUser",
      accountId: response?.account?.accountId
    });

    const accountsPath = path.join(dataDir, "accounts.json");
    const stored = JSON.parse(await fs.readFile(accountsPath, "utf8"));
    assert.equal(stored.accounts.length, 1);
    assert.equal(stored.accounts[0].email, "founder@example.com");
    assert.equal(stored.accounts[0].passwordHash === "password123", false);
    assert.equal(stored.accounts[0].passwordHash.startsWith("scrypt$"), true);

    const duplicateEmail = await new Promise((resolve) => {
      client.emit(
        "auth:register",
        {
          email: "founder@example.com",
          password: "password123",
          username: "FounderUserTwo"
        },
        resolve
      );
    });
    assert.deepEqual(duplicateEmail, {
      ok: false,
      error: {
        code: "ACCOUNT_EMAIL_IN_USE",
        message: "This email is already registered."
      }
    });
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: auth register links an existing username profile instead of duplicating it", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  await coordinator.profiles.ensureProfile("LegacyUser");
  await coordinator.profiles.updateProfile("LegacyUser", (current) => ({
    ...current,
    wins: 9,
    playerXP: 42,
    tokens: 333
  }));

  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    }),
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const response = await new Promise((resolve) => {
      client.emit(
        "auth:register",
        {
          email: "legacy@example.com",
          password: "password123",
          username: "LegacyUser"
        },
        resolve
      );
    });

    assert.equal(response?.ok, true);
    assert.equal(response?.account?.username, "LegacyUser");

    const linkedProfile = await coordinator.profiles.getProfile("LegacyUser");
    assert.equal(linkedProfile?.wins, 9);
    assert.equal(linkedProfile?.playerXP, 42);
    assert.equal(linkedProfile?.tokens, 333);
    assert.equal(linkedProfile?.linkedAccountId, response?.account?.accountId);

    const profiles = await coordinator.profiles.listProfiles();
    assert.equal(profiles.filter((profile) => profile.username === "LegacyUser").length, 1);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: auth register rejects claiming a profile already linked to another account", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  await coordinator.profiles.ensureProfile("ClaimedUser", {
    linkedAccountId: "existing-account-id"
  });

  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    accountStore,
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    })
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const response = await new Promise((resolve) => {
      client.emit(
        "auth:register",
        {
          email: "claimed@example.com",
          password: "password123",
          username: "ClaimedUser"
        },
        resolve
      );
    });

    assert.deepEqual(response, {
      ok: false,
      error: {
        code: "PROFILE_ALREADY_CLAIMED",
        message: "Profile ClaimedUser is already linked to another account."
      }
    });

    const accounts = await accountStore.readState();
    assert.equal(accounts.accounts.length, 0);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: auth login rejects bad credentials and binds profile reads to the authenticated account session", async () => {
  const dataDir = await createTempDataDir();
  const authorityCalls = [];
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  await accountStore.register({
    email: "player@example.com",
    password: "password123",
    username: "AccountBoundUser"
  });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    accountStore,
    profileAuthority: {
      getProfile: async (username) => {
        authorityCalls.push(username);
        return {
          username,
          profile: { username, equippedCosmetics: {} },
          progression: {
            xp: { playerXP: 0, playerLevel: 1 },
            dailyChallenges: { challenges: [] },
            weeklyChallenges: { challenges: [] },
            dailyLogin: { eligible: false }
          }
        };
      }
    }
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);

    const invalidLogin = await new Promise((resolve) => {
      client.emit(
        "auth:login",
        {
          email: "player@example.com",
          password: "wrong-password"
        },
        resolve
      );
    });
    assert.deepEqual(invalidLogin, {
      ok: false,
      error: {
        code: "ACCOUNT_LOGIN_FAILED",
        message: "Invalid email or password."
      }
    });

    const validLogin = await new Promise((resolve) => {
      client.emit(
        "auth:login",
        {
          email: "player@example.com",
          password: "password123"
        },
        resolve
      );
    });
    assert.equal(validLogin?.ok, true);
    assert.equal(validLogin?.session?.authenticated, true);
    assert.equal(validLogin?.session?.username, "AccountBoundUser");

    const profileResponse = await new Promise((resolve) => {
      client.emit("profile:get", {}, resolve);
    });
    assert.equal(profileResponse?.ok, true);
    assert.equal(profileResponse?.profile?.profile?.username, "AccountBoundUser");
    assert.deepEqual(authorityCalls, ["AccountBoundUser"]);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer foundation: remembered authenticated sessions resume after restart beyond the old reconnect grace window", async () => {
  const dataDir = await createTempDataDir();
  const accountStore = new MultiplayerAccountStore({
    dataDir,
    logger: { info: () => {} }
  });
  await accountStore.register({
    email: "remember@example.com",
    password: "password123",
    username: "RememberFoundationUser"
  });

  const createFoundation = () =>
    createMultiplayerFoundation({
      port: 0,
      logger: { info: () => {} },
      dataDir,
      accountStore,
      profileAuthority: {
        getProfile: async (username) => ({
          username,
          profile: { username, equippedCosmetics: {} },
          progression: {
            xp: { playerXP: 0, playerLevel: 1 },
            dailyChallenges: { challenges: [] },
            weeklyChallenges: { challenges: [] },
            dailyLogin: { eligible: false }
          }
        })
      }
    });

  let foundation = createFoundation();
  let client = null;
  let reconnectClient = null;

  try {
    const firstPort = await foundation.start();
    client = await connectClient(firstPort);

    const login = await new Promise((resolve) => {
      client.emit(
        "auth:login",
        {
          email: "remember@example.com",
          password: "password123",
          rememberSession: true
        },
        resolve
      );
    });

    assert.equal(login?.ok, true);
    assert.equal(login?.session?.rememberSession, true);
    assert.equal(typeof login?.session?.expiresAt, "string");

    client.disconnect();
    await foundation.stop();

    foundation = createFoundation();
    const secondPort = await foundation.start();
    reconnectClient = await connectClient(secondPort);

    const resumed = await resumeSession(reconnectClient, login?.session?.token);
    assert.equal(resumed?.ok, true);
    assert.equal(resumed?.session?.username, "RememberFoundationUser");
    assert.equal(resumed?.session?.rememberSession, true);
  } finally {
    reconnectClient?.disconnect();
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer rooms: preset taunts broadcast through the existing room update flow", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} }
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "HostTaunter" });
    const room = await createdPromise;

    const guestJoinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "GuestTaunter" });
    await guestJoinedPromise;
    await hostJoinUpdatePromise;

    const hostTauntUpdate = waitForEvent(host, "room:update");
    const guestTauntUpdate = waitForEvent(guest, "room:update");
    host.emit("room:sendTaunt", { line: "⚔️ WAR!" });

    const hostRoom = await hostTauntUpdate;
    const guestRoom = await guestTauntUpdate;

    assert.equal(hostRoom.taunts.length, 1);
    assert.equal(hostRoom.taunts[0].speaker, "HostTaunter");
    assert.equal(hostRoom.taunts[0].text, "⚔️ WAR!");
    assert.equal(guestRoom.taunts[0].speaker, "HostTaunter");
    assert.equal(guestRoom.taunts[0].text, "⚔️ WAR!");
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: removed taunt presets are rejected by room validation", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("host-expressions");
  const guest = createStoreSocket("guest-expressions");

  const created = store.createRoom(host, { username: "HostTaunter" });
  assert.equal(created.ok, true);
  const joined = store.joinRoom(guest, created.room.roomCode, { username: "GuestTaunter" });
  assert.equal(joined.ok, true);

  const rejected = store.sendTaunt(host.id, "Your move.");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error?.code, "TAUNT_INVALID");
  assert.equal(rejected.error?.message, "Expression line is invalid.");
});

test("multiplayer rooms: synced equipped cosmetics persist through room snapshots and reconnect resume", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roomReconnectTimeoutMs: 1000
  });
  let host = null;
  let guest = null;
  let reconnectClient = null;
  let guestSession = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);
    guestSession = await bootstrapSession(guest, "CosmeticGuest");
    assert.equal(guestSession?.ok, true);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", {
      username: "CosmeticHost",
      equippedCosmetics: {
        avatar: "avatar_fourfold_lord",
        background: "bg_elemental_throne",
        cardBack: "cardback_elemental_nexus",
        elementCardVariant: {
          fire: "fire_variant_phoenix",
          water: "water_variant_crystal",
          earth: "earth_variant_titan",
          wind: "wind_variant_storm_eye"
        },
        title: "War Master",
        badge: "badge_arena_legend"
      }
    });
    const createdRoom = await createdPromise;

    assert.equal(createdRoom.host.equippedCosmetics.avatar, "avatar_fourfold_lord");
    assert.equal(createdRoom.host.equippedCosmetics.background, "bg_elemental_throne");
    assert.equal(createdRoom.host.equippedCosmetics.cardBack, "cardback_elemental_nexus");
    assert.equal(createdRoom.host.equippedCosmetics.title, "War Master");
    assert.equal(createdRoom.host.equippedCosmetics.badge, "badge_arena_legend");
    assert.equal(createdRoom.host.equippedCosmetics.elementCardVariant.fire, "fire_variant_phoenix");

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", {
      roomCode: createdRoom.roomCode,
      username: "CosmeticGuest",
      equippedCosmetics: {
        avatar: "avatar_storm_oracle",
        background: "bg_storm_temple",
        cardBack: "cardback_storm_spiral",
        elementCardVariant: {
          fire: "fire_variant_ember",
          water: "water_variant_tidal_spirit",
          earth: "earth_variant_rooted_monolith",
          wind: "wind_variant_sky_serpent"
        },
        title: "Element Sovereign",
        badge: "badge_element_veteran"
      }
    });
    const joinedRoom = await joinedPromise;
    await hostJoinUpdatePromise;

    assert.equal(joinedRoom.guest.equippedCosmetics.avatar, "avatar_storm_oracle");
    assert.equal(joinedRoom.guest.equippedCosmetics.background, "bg_storm_temple");
    assert.equal(joinedRoom.guest.equippedCosmetics.cardBack, "cardback_storm_spiral");
    assert.equal(joinedRoom.guest.equippedCosmetics.title, "Element Sovereign");
    assert.equal(joinedRoom.guest.equippedCosmetics.badge, "badge_element_veteran");
    assert.equal(joinedRoom.guest.equippedCosmetics.elementCardVariant.wind, "wind_variant_sky_serpent");

    const hostMoveSyncUpdate = waitForEvent(host, "room:moveSync");
    const guestMoveSyncUpdate = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostMoveSyncUpdate;
    await guestMoveSyncUpdate;

    const hostPausedUpdate = waitForEvent(host, "room:update");
    guest.disconnect();
    const pausedRoom = await hostPausedUpdate;
    assert.equal(pausedRoom.guest.equippedCosmetics.avatar, "avatar_storm_oracle");
    assert.equal(pausedRoom.guest.equippedCosmetics.background, "bg_storm_temple");

    reconnectClient = await connectClient(port);
    const resumedGuestSession = await resumeSession(reconnectClient, guestSession.session.token);
    assert.equal(resumedGuestSession?.ok, true);
    const reconnectJoined = waitForEvent(reconnectClient, "room:joined");
    reconnectClient.emit("room:join", { roomCode: createdRoom.roomCode });
    const resumedRoom = await reconnectJoined;

    assert.equal(resumedRoom.host.equippedCosmetics.avatar, "avatar_fourfold_lord");
    assert.equal(resumedRoom.guest.equippedCosmetics.avatar, "avatar_storm_oracle");
    assert.equal(resumedRoom.host.equippedCosmetics.elementCardVariant.earth, "earth_variant_titan");
    assert.equal(resumedRoom.guest.equippedCosmetics.elementCardVariant.water, "water_variant_tidal_spirit");
  } finally {
    host?.disconnect();
    guest?.disconnect();
    reconnectClient?.disconnect();
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
    assert.equal(room.hostScore, 0);
    assert.equal(room.guestScore, 0);
    assert.equal(room.hostCardsTaken, 0);
    assert.equal(room.guestCardsTaken, 0);
    assert.equal(room.totalWarClashes, 0);
    assert.equal(room.roundNumber, 1);
    assert.equal(room.lastOutcomeType, null);
    assert.equal(room.matchComplete, false);
    assert.equal(room.winner, null);
    assert.equal(room.winReason, null);
    assert.deepEqual(room.rematch, { hostReady: false, guestReady: false });
    assert.deepEqual(room.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(room.guestHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(room.warPot, { host: [], guest: [] });
    assert.equal(room.warActive, false);
    assert.equal(room.warDepth, 0);
    assert.deepEqual(room.warRounds, []);
    assert.deepEqual(room.roundHistory, []);
    assert.deepEqual(room.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
    assert.deepEqual(room.serverMatchState, {
      roomCode: room.roomCode,
      matchId: `${room.roomCode}:match:1`,
      players: {
        host: {
          socketId: host.id,
          sessionId: room.host.sessionId ?? null,
          username: room.host.username ?? null
        },
        guest: null
      },
      activeStep: {
        id: `${room.roomCode}:match:1:round:1:step:round:warDepth:0`,
        round: 1,
        type: "round",
        warDepth: 0,
        status: "collecting"
      },
      currentRound: 1,
      playerHands: {
        host: { fire: 2, water: 2, earth: 2, wind: 2 },
        guest: { fire: 2, water: 2, earth: 2, wind: 2 }
      },
      hostCardsTaken: 0,
      guestCardsTaken: 0,
      totalWarClashes: 0,
      warState: {
        active: false,
        depth: 0
      },
      pendingActions: {
        host: null,
        guest: null
      },
      matchStatus: "waiting",
      lastResolvedOutcome: null,
      matchTimer: {
        active: false,
        durationMs: 300000,
        startedAt: null,
        expiresAt: null,
        remainingMs: 300000
      },
      turnTimer: {
        active: false,
        stepId: `${room.roomCode}:match:1:round:1:step:round:warDepth:0`,
        durationMs: 20000,
        startedAt: null,
        expiresAt: null
      },
      turnState: {
        waitingOn: ["host", "guest"],
        lockedIn: [],
        resolutionReady: false
      }
    });
  } finally {
    host?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: room join succeeds, notifies both players, and starts the authoritative turn timer", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    onlineTurnTimerDurationMs: 20000
  });
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
    let guestReceivedRedundantUpdate = false;
    const handleGuestUpdate = () => {
      guestReceivedRedundantUpdate = true;
    };
    guest.on("room:update", handleGuestUpdate);
    guest.emit("room:join", { roomCode: createdRoom.roomCode.toLowerCase() });

    const joinedRoom = await guestJoinedPromise;
    const hostUpdate = await hostUpdatePromise;
    await wait(50);
    guest.off("room:update", handleGuestUpdate);

    assert.equal(joinedRoom.status, "full");
    assert.equal(joinedRoom.roomCode, createdRoom.roomCode);
    assert.equal(joinedRoom.host.socketId, host.id);
    assert.equal(joinedRoom.guest.socketId, guest.id);
    assert.equal(joinedRoom.hostScore, 0);
    assert.equal(joinedRoom.guestScore, 0);
    assert.equal(joinedRoom.roundNumber, 1);
    assert.equal(joinedRoom.lastOutcomeType, null);
    assert.equal(joinedRoom.matchComplete, false);
    assert.equal(joinedRoom.winner, null);
    assert.equal(joinedRoom.winReason, null);
    assert.deepEqual(joinedRoom.rematch, { hostReady: false, guestReady: false });
    assert.deepEqual(joinedRoom.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(joinedRoom.guestHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(joinedRoom.warPot, { host: [], guest: [] });
    assert.equal(joinedRoom.warActive, false);
    assert.equal(joinedRoom.warDepth, 0);
    assert.deepEqual(joinedRoom.warRounds, []);
    assert.deepEqual(joinedRoom.roundHistory, []);
    assert.deepEqual(joinedRoom.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
    assert.equal(joinedRoom.matchTimer?.active, true);
    assert.equal(joinedRoom.matchTimer?.durationMs, 300000);
    assert.equal(joinedRoom.serverMatchState?.matchTimer?.active, true);
    assert.equal(joinedRoom.serverMatchState?.matchTimer?.durationMs, 300000);
    assert.equal(joinedRoom.serverMatchState?.turnTimer?.active, true);
    assert.equal(
      joinedRoom.serverMatchState?.turnTimer?.stepId,
      `${createdRoom.roomCode}:match:1:round:1:step:round:warDepth:0`
    );
    assert.equal(joinedRoom.serverMatchState?.turnTimer?.durationMs, 20000);
    assert.equal(hostUpdate.serverMatchState?.turnTimer?.stepId, joinedRoom.serverMatchState?.turnTimer?.stepId);
    assert.equal(hostUpdate.serverMatchState?.turnTimer?.expiresAt, joinedRoom.serverMatchState?.turnTimer?.expiresAt);
    assert.deepEqual(hostUpdate, joinedRoom);
    assert.equal(guestReceivedRedundantUpdate, false);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: duplicate room usernames are rejected before a second seat is assigned", async () => {
  const foundation = createMultiplayerFoundation({ port: 0, logger: { info: () => {} } });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "DuplicateName" });
    const room = await createdPromise;

    const errorPromise = waitForEvent(guest, "room:error");
    guest.emit("room:join", { roomCode: room.roomCode, username: "DuplicateName" });

    assert.deepEqual(await errorPromise, {
      code: "SESSION_USERNAME_ACTIVE",
      message: "This username already has an active online session."
    });
    assert.equal(foundation.roomStore.getRoom(room.roomCode)?.guest, null);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: move submissions sync, resolve one round, and reset for the next round", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
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
    assert.deepEqual(hostMoveSync.hostHand, { fire: 1, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(hostMoveSync.guestHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(hostMoveSync.warPot, { host: [], guest: [] });
    assert.deepEqual(hostMoveSync.serverMatchState, {
      roomCode: room.roomCode,
      matchId: `${room.roomCode}:match:1`,
      players: {
        host: {
          socketId: host.id,
          sessionId: hostMoveSync.host.sessionId ?? null,
          username: hostMoveSync.host.username ?? null
        },
        guest: {
          socketId: guest.id,
          sessionId: hostMoveSync.guest.sessionId ?? null,
          username: hostMoveSync.guest.username ?? null
        }
      },
      activeStep: {
        id: `${room.roomCode}:match:1:round:1:step:round:warDepth:0`,
        round: 1,
        type: "round",
        warDepth: 0,
        status: "collecting"
      },
      currentRound: 1,
      playerHands: {
        host: { fire: 1, water: 2, earth: 2, wind: 2 },
        guest: { fire: 2, water: 2, earth: 2, wind: 2 }
      },
      hostCardsTaken: 0,
      guestCardsTaken: 0,
      totalWarClashes: 0,
      warState: {
        active: false,
        depth: 0
      },
      pendingActions: {
        host: {
          selectedCard: "fire",
          submittedAt: hostMoveSync.moveSync.updatedAt
        },
        guest: null
      },
      matchStatus: "active",
      lastResolvedOutcome: null,
      matchTimer: {
        active: true,
        durationMs: 300000,
        startedAt: hostMoveSync.serverMatchState.matchTimer.startedAt,
        expiresAt: hostMoveSync.serverMatchState.matchTimer.expiresAt,
        remainingMs: hostMoveSync.serverMatchState.matchTimer.remainingMs
      },
      turnTimer: {
        active: true,
        stepId: `${room.roomCode}:match:1:round:1:step:round:warDepth:0`,
        durationMs: 20000,
        startedAt: hostMoveSync.serverMatchState.turnTimer.startedAt,
        expiresAt: hostMoveSync.serverMatchState.turnTimer.expiresAt
      },
      turnState: {
        waitingOn: ["guest"],
        lockedIn: ["host"],
        resolutionReady: false
      }
    });
    assert.deepEqual(guestMoveSync, hostMoveSync);

    const hostLaterSyncsPromise = waitForEvents(host, "room:moveSync", 2);
    const guestLaterSyncsPromise = waitForEvents(guest, "room:moveSync", 2);
    const hostRoundResultPromise = waitForEvent(host, "room:roundResult");
    const guestRoundResultPromise = waitForEvent(guest, "room:roundResult");
    const hostServerRoundResultPromise = waitForEvent(host, "room:serverRoundResult");
    const guestServerRoundResultPromise = waitForEvent(guest, "room:serverRoundResult");
    guest.emit("room:submitMove", { move: "water" });

    const [hostBothSync, hostResetSync] = await hostLaterSyncsPromise;
    const [guestBothSync, guestResetSync] = await guestLaterSyncsPromise;
    const hostRoundResult = await hostRoundResultPromise;
    const guestRoundResult = await guestRoundResultPromise;
    const hostServerRoundResult = await hostServerRoundResultPromise;
    const guestServerRoundResult = await guestServerRoundResultPromise;

    assert.deepEqual(hostBothSync.moveSync, {
      hostSubmitted: true,
      guestSubmitted: true,
      submittedCount: 2,
      bothSubmitted: true,
      updatedAt: hostBothSync.moveSync.updatedAt
    });
    assert.equal(hostBothSync.hostScore, 0);
    assert.equal(hostBothSync.guestScore, 1);
    assert.equal(hostBothSync.roundNumber, 2);
    assert.equal(hostBothSync.lastOutcomeType, "resolved");
    assert.equal(hostBothSync.warActive, false);
    assert.equal(hostBothSync.warDepth, 0);
    assert.deepEqual(hostBothSync.warRounds, []);
    assert.equal(hostBothSync.serverMatchState?.turnTimer?.active, false);
    assert.deepEqual(guestBothSync, hostBothSync);
    assert.deepEqual(hostRoundResult, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "water",
      round: 1,
      outcomeType: "resolved",
      hostScore: 0,
      guestScore: 1,
      capturedCards: 2,
      capturedOpponentCards: 1,
      roundNumber: 2,
      lastOutcomeType: "resolved",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 3, water: 2, earth: 2, wind: 2 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      hostResult: "lose",
      guestResult: "win"
    });
    assert.deepEqual(guestRoundResult, hostRoundResult);
    assert.deepEqual(guestServerRoundResult, hostServerRoundResult);
    assert.equal(hostServerRoundResult.roomCode, room.roomCode);
    assert.equal(hostServerRoundResult.matchId, `${room.roomCode}:match:1`);
    assert.equal(hostServerRoundResult.stepId, `${room.roomCode}:match:1:round:1:step:round:warDepth:0`);
    assert.deepEqual(hostServerRoundResult.submittedCards, {
      host: "fire",
      guest: "water"
    });
    assert.equal(hostServerRoundResult.authoritativeOutcomeType, "win");
    assert.equal(hostServerRoundResult.authoritativeWinner, "guest");
    assert.equal(hostServerRoundResult.matchSnapshot.currentRound, 2);
    assert.equal(hostServerRoundResult.matchSnapshot.activeStep.id, `${room.roomCode}:match:1:round:2:step:round:warDepth:0`);
    assert.deepEqual(hostServerRoundResult.matchSnapshot.lastResolvedOutcome, {
      stepId: `${room.roomCode}:match:1:round:1:step:round:warDepth:0`,
      resolvedAt: hostServerRoundResult.matchSnapshot.lastResolvedOutcome.resolvedAt,
      round: 1,
      type: "win",
      winner: "guest",
      hostMove: "fire",
      guestMove: "water"
    });
    assert.deepEqual(hostServerRoundResult.animation, {
      clearWarStateAfterDelay: false,
      matchComplete: false
    });
    assert.deepEqual(hostResetSync.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
    assert.equal(hostResetSync.hostScore, 0);
    assert.equal(hostResetSync.guestScore, 1);
    assert.equal(hostResetSync.roundNumber, 2);
    assert.equal(hostResetSync.lastOutcomeType, "resolved");
    assert.deepEqual(hostResetSync.hostHand, { fire: 1, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(hostResetSync.guestHand, { fire: 3, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(hostResetSync.warPot, { host: [], guest: [] });
    assert.equal(hostResetSync.warActive, false);
    assert.equal(hostResetSync.warDepth, 0);
    assert.deepEqual(hostResetSync.warRounds, []);
    assert.equal(hostResetSync.serverMatchState?.turnTimer?.active, true);
    assert.equal(
      hostResetSync.serverMatchState?.turnTimer?.stepId,
      `${room.roomCode}:match:1:round:2:step:round:warDepth:0`
    );
    assert.deepEqual(guestResetSync, hostResetSync);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer foundation: authoritative turn timer auto-picks the missing guest move and restarts for the WAR continuation step", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    onlineTurnTimerDurationMs: 40
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    const firstSyncPromise = waitForEvent(host, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    const firstSync = await firstSyncPromise;
    assert.equal(firstSync.serverMatchState?.turnTimer?.active, true);

    const laterSyncsPromise = waitForEvents(host, "room:moveSync", 2);
    const roundResultPromise = waitForEvent(host, "room:roundResult");
    const serverRoundResultPromise = waitForEvent(host, "room:serverRoundResult");

    const [resolvedSync, resetSync] = await laterSyncsPromise;
    const roundResult = await roundResultPromise;
    const serverRoundResult = await serverRoundResultPromise;

    assert.equal(roundResult.hostMove, "fire");
    assert.equal(roundResult.guestMove, "fire");
    assert.equal(roundResult.outcomeType, "war");
    assert.equal(serverRoundResult.submittedCards.host, "fire");
    assert.equal(serverRoundResult.submittedCards.guest, "fire");
    assert.equal(resolvedSync.serverMatchState?.turnTimer?.active, false);
    assert.equal(resetSync.serverMatchState?.turnTimer?.active, true);
    assert.equal(resetSync.serverMatchState?.activeStep?.type, "war");
    assert.equal(
      resetSync.serverMatchState?.turnTimer?.stepId,
      `${room.roomCode}:match:1:round:2:step:war:warDepth:1`
    );
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer foundation: authoritative turn timer auto-picks both missing moves and emits one resolved step", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    onlineTurnTimerDurationMs: 40
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);
    const moveSyncsPromise = waitForEvents(host, "room:moveSync", 2);
    const roundResultPromise = waitForEvent(host, "room:roundResult");
    const serverRoundResultPromise = waitForEvent(host, "room:serverRoundResult");

    const [resolvedSync, resetSync] = await moveSyncsPromise;
    const roundResult = await roundResultPromise;
    const serverRoundResult = await serverRoundResultPromise;

    assert.equal(roundResult.hostMove, "fire");
    assert.equal(roundResult.guestMove, "fire");
    assert.equal(roundResult.outcomeType, "war");
    assert.equal(serverRoundResult.submittedCards.host, "fire");
    assert.equal(serverRoundResult.submittedCards.guest, "fire");
    assert.equal(resolvedSync.moveSync?.bothSubmitted, true);
    assert.equal(resolvedSync.serverMatchState?.turnTimer?.active, false);
    assert.equal(resetSync.serverMatchState?.turnTimer?.active, true);
    assert.equal(
      resetSync.serverMatchState?.turnTimer?.stepId,
      `${room.roomCode}:match:1:round:2:step:war:warDepth:1`
    );
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: match timer timeout uses the existing owned-card rule and resolves active WAR cleanly", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("host-match-timer-war");
  const guest = createStoreSocket("guest-match-timer-war");

  const created = store.createRoom(host, { username: "HostTimerWar" });
  assert.equal(created.ok, true);
  const joined = store.joinRoom(guest, created.room.roomCode, { username: "GuestTimerWar" });
  assert.equal(joined.ok, true);

  const activated = store.activateMatchTimer(created.room.roomCode, {
    durationMs: 300000,
    startedAt: "2026-05-07T12:00:00.000Z"
  });
  assert.equal(activated.ok, true);
  assert.equal(activated.room.serverMatchState?.matchTimer?.active, true);

  const firstHostMove = store.submitMove(host.id, "fire");
  assert.equal(firstHostMove.ok, true);
  const firstRound = store.submitMove(guest.id, "earth");
  assert.equal(firstRound.ok, true);
  assert.equal(firstRound.roundResult?.hostResult, "win");
  assert.equal(firstRound.room.hostScore, 1);
  assert.equal(firstRound.room.guestScore, 0);

  const reset = store.resetRound(created.room.roomCode);
  assert.equal(reset.matchComplete, false);

  const warHostMove = store.submitMove(host.id, "fire");
  assert.equal(warHostMove.ok, true);
  const warRound = store.submitMove(guest.id, "fire");
  assert.equal(warRound.ok, true);
  assert.equal(warRound.roundResult?.outcomeType, "war");
  assert.equal(warRound.room.warActive, true);
  assert.deepEqual(warRound.room.warPot, {
    host: ["fire"],
    guest: ["fire"]
  });

  const expired = store.expireMatchTimer(created.room.roomCode);
  assert.equal(expired.ok, true);
  assert.equal(expired.room.matchComplete, true);
  assert.equal(expired.room.winner, "host");
  assert.equal(expired.room.winReason, "time_limit");
  assert.equal(expired.room.warActive, false);
  assert.deepEqual(expired.room.warPot, { host: [], guest: [] });
  assert.equal(expired.room.matchTimer?.active, false);
  assert.equal(expired.room.serverMatchState?.matchTimer?.active, false);
  assert.equal(
    getTotalOwnedCards(expired.room.hostHand, expired.room.warPot?.host),
    9
  );
  assert.equal(
    getTotalOwnedCards(expired.room.guestHand, expired.room.warPot?.guest),
    7
  );
});

test("multiplayer rooms: match timer timeout draws on tied owned-card counts and stays single-complete after manual completion", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("host-match-timer-draw");
  const guest = createStoreSocket("guest-match-timer-draw");

  const created = store.createRoom(host, { username: "HostTimerDraw" });
  const joined = store.joinRoom(guest, created.room.roomCode, { username: "GuestTimerDraw" });
  assert.equal(created.ok, true);
  assert.equal(joined.ok, true);

  const activated = store.activateMatchTimer(created.room.roomCode, {
    durationMs: 300000,
    startedAt: "2026-05-07T12:00:00.000Z"
  });
  assert.equal(activated.ok, true);

  const expired = store.expireMatchTimer(created.room.roomCode);
  assert.equal(expired.ok, true);
  assert.equal(expired.room.matchComplete, true);
  assert.equal(expired.room.winner, "draw");
  assert.equal(expired.room.winReason, "time_limit");
  assert.equal(expired.room.matchTimer?.active, false);

  const afterCompletionExpiry = store.expireMatchTimer(created.room.roomCode);
  assert.equal(afterCompletionExpiry.ok, false);
  assert.equal(afterCompletionExpiry.reason, "stale_or_unavailable");
  assert.equal(afterCompletionExpiry.room.matchComplete, true);
  assert.equal(afterCompletionExpiry.room.winner, "draw");
});

test("multiplayer foundation: match timer expiry during active WAR emits terminal room:update without an extra authoritative round result", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 120,
    onlineMatchTimerDurationMs: 90,
    onlineTurnTimerDurationMs: 500
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSync;
    await guestFirstSync;

    const warRoundResultPromise = waitForEvent(host, "room:roundResult");
    const warServerRoundResultPromise = waitForEvent(host, "room:serverRoundResult");
    guest.emit("room:submitMove", { move: "fire" });

    const warRoundResult = await warRoundResultPromise;
    const warServerRoundResult = await warServerRoundResultPromise;
    assert.equal(warRoundResult.outcomeType, "war");
    assert.equal(warServerRoundResult.authoritativeOutcomeType, "war_start");

    const extraRoundResults = [];
    const extraServerRoundResults = [];
    const extraMoveSyncs = [];
    const captureRoundResult = (payload) => extraRoundResults.push(payload);
    const captureServerRoundResult = (payload) => extraServerRoundResults.push(payload);
    const captureMoveSync = (payload) => extraMoveSyncs.push(payload);
    host.on("room:roundResult", captureRoundResult);
    host.on("room:serverRoundResult", captureServerRoundResult);
    host.on("room:moveSync", captureMoveSync);

    const terminalUpdate = await Promise.race([
      waitForEvent(host, "room:update"),
      wait(400).then(() => {
        throw new Error("Timed out waiting for terminal room:update after match timer expiry.");
      })
    ]);

    await wait(160);

    assert.equal(terminalUpdate.roomCode, room.roomCode);
    assert.equal(terminalUpdate.matchComplete, true);
    assert.equal(terminalUpdate.winReason, "time_limit");
    assert.equal(terminalUpdate.warActive, false);
    assert.deepEqual(terminalUpdate.warPot, { host: [], guest: [] });
    assert.equal(terminalUpdate.serverMatchState?.matchTimer?.active, false);
    assert.equal(extraRoundResults.length, 0);
    assert.equal(extraServerRoundResults.length, 0);
    assert.equal(extraMoveSyncs.length, 0);

    const roomAfterTimeout = foundation.roomStore.getRoom(room.roomCode);
    assert.equal(roomAfterTimeout?.matchComplete, true);
    assert.equal(roomAfterTimeout?.winReason, "time_limit");
    assert.equal(roomAfterTimeout?.warActive, false);
    assert.equal(roomAfterTimeout?.serverMatchState?.turnTimer?.active, false);

    host.off("room:roundResult", captureRoundResult);
    host.off("room:serverRoundResult", captureServerRoundResult);
    host.off("room:moveSync", captureMoveSync);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer foundation: match timer expiry during a pending WAR continuation leaves no later reset or resolution mutation", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    onlineMatchTimerDurationMs: 95,
    onlineTurnTimerDurationMs: 500
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);
    const openingWar = await submitRoundPair(host, guest, "fire", "fire", 2);
    const warResetSync = openingWar.hostLaterSyncs.at(-1);
    assert.equal(openingWar.hostRoundResult.outcomeType, "war");
    assert.equal(warResetSync?.warActive, true);
    assert.equal(warResetSync?.serverMatchState?.activeStep?.type, "war");

    const pendingWarSyncPromise = waitForEvent(host, "room:moveSync");
    host.emit("room:submitMove", { move: "water" });
    const pendingWarSync = await pendingWarSyncPromise;
    assert.equal(pendingWarSync.moveSync?.hostSubmitted, true);
    assert.equal(pendingWarSync.moveSync?.guestSubmitted, false);
    assert.equal(pendingWarSync.warActive, true);

    const extraRoundResults = [];
    const extraServerRoundResults = [];
    const extraMoveSyncs = [];
    const captureRoundResult = (payload) => extraRoundResults.push(payload);
    const captureServerRoundResult = (payload) => extraServerRoundResults.push(payload);
    const captureMoveSync = (payload) => extraMoveSyncs.push(payload);
    host.on("room:roundResult", captureRoundResult);
    host.on("room:serverRoundResult", captureServerRoundResult);
    host.on("room:moveSync", captureMoveSync);

    const terminalUpdate = await Promise.race([
      waitForEvent(host, "room:update"),
      wait(400).then(() => {
        throw new Error("Timed out waiting for terminal room:update during pending WAR continuation.");
      })
    ]);

    await wait(120);

    assert.equal(terminalUpdate.roomCode, room.roomCode);
    assert.equal(terminalUpdate.matchComplete, true);
    assert.equal(terminalUpdate.winReason, "time_limit");
    assert.equal(terminalUpdate.warActive, false);
    assert.deepEqual(terminalUpdate.warPot, { host: [], guest: [] });
    assert.equal(terminalUpdate.serverMatchState?.turnTimer?.active, false);
    assert.equal(extraRoundResults.length, 0);
    assert.equal(extraServerRoundResults.length, 0);
    assert.equal(extraMoveSyncs.length, 0);

    const roomAfterTimeout = foundation.roomStore.getRoom(room.roomCode);
    assert.equal(roomAfterTimeout?.matchComplete, true);
    assert.equal(roomAfterTimeout?.winReason, "time_limit");
    assert.equal(roomAfterTimeout?.warActive, false);
    assert.deepEqual(roomAfterTimeout?.moveSync, terminalUpdate.moveSync);

    host.off("room:roundResult", captureRoundResult);
    host.off("room:serverRoundResult", captureServerRoundResult);
    host.off("room:moveSync", captureMoveSync);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: rematch resets the authoritative match timer to a fresh inactive 5-minute state", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("host-match-timer-rematch");
  const guest = createStoreSocket("guest-match-timer-rematch");

  const created = store.createRoom(host, { username: "HostTimerRematch" });
  const joined = store.joinRoom(guest, created.room.roomCode, { username: "GuestTimerRematch" });
  assert.equal(created.ok, true);
  assert.equal(joined.ok, true);

  const activated = store.activateMatchTimer(created.room.roomCode, {
    durationMs: 300000,
    startedAt: "2026-05-07T12:00:00.000Z"
  });
  assert.equal(activated.ok, true);

  const completed = store.completeMatch(host.id, {
    winner: "host",
    reason: "manual_test"
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.room.matchTimer?.active, false);

  const firstReady = store.readyRematch(host.id);
  assert.equal(firstReady.ok, true);
  assert.equal(firstReady.rematchStarted, false);

  const secondReady = store.readyRematch(guest.id);
  assert.equal(secondReady.ok, true);
  assert.equal(secondReady.rematchStarted, true);
  assert.equal(secondReady.room.matchComplete, false);
  assert.equal(secondReady.room.matchTimer?.active, false);
  assert.equal(secondReady.room.matchTimer?.durationMs, 300000);
  assert.equal(secondReady.room.matchTimer?.remainingMs, 300000);
  assert.equal(secondReady.room.serverMatchState?.matchTimer?.active, false);
  assert.equal(secondReady.room.serverMatchState?.matchTimer?.durationMs, 300000);
  assert.equal(secondReady.room.serverMatchState?.matchTimer?.remainingMs, 300000);
});

test("multiplayer rooms: near-simultaneous and same-tick submits resolve one round exactly once", async () => {
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
    assert.equal(roomAfterFirstRound.hostCardsTaken, 1);
    assert.equal(roomAfterFirstRound.guestCardsTaken, 0);
    assert.equal(roomAfterFirstRound.totalWarClashes, 0);
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
    assert.equal(roomAfterSecondRound.hostCardsTaken, 2);
    assert.equal(roomAfterSecondRound.guestCardsTaken, 0);
    assert.equal(roomAfterSecondRound.totalWarClashes, 0);
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

test("multiplayer rooms: rapid repeat submits count only one move per player before reset", async () => {
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
      code: "MOVE_STEP_RESOLVED",
      message: "This resolution step already completed on the server."
    });
    assert.equal(hostRoundResults.length, 1);
    assert.equal(guestRoundResults.length, 1);
    assert.equal(hostRoundResults[0].round, 1);
    assert.equal(hostRoundResults[0].roundNumber, 2);
    assert.equal(rewardPersisterCalls.length, 0);

    const roomAfterSpam = foundation.roomStore.getRoom(createdRoom.roomCode);
    assert.equal(roomAfterSpam.roundNumber, 2);
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

test("multiplayer rooms: unmatched move pairs resolve to no_effect for both players", async () => {
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

    const roundResultPromise = waitForEvent(host, "room:roundResult");
    const hostFirstSyncPromise = waitForEvent(host, "room:moveSync");
    const guestFirstSyncPromise = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSyncPromise;
    await guestFirstSyncPromise;
    const serverRoundResultPromise = waitForEvent(host, "room:serverRoundResult");
    guest.emit("room:submitMove", { move: "wind" });

    const roundResult = await roundResultPromise;
    const serverRoundResult = await serverRoundResultPromise;
    assert.deepEqual(roundResult, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "wind",
      round: 1,
      outcomeType: "no_effect",
      hostScore: 0,
      guestScore: 0,
      roundNumber: 2,
      lastOutcomeType: "no_effect",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      capturedCards: 0,
      capturedOpponentCards: 0,
      hostResult: "no_effect",
      guestResult: "no_effect"
    });
    assert.equal(serverRoundResult.authoritativeOutcomeType, "no_effect");
    assert.equal(serverRoundResult.authoritativeWinner, null);
    assert.equal(serverRoundResult.matchSnapshot.lastResolvedOutcome.type, "no_effect");
    assert.equal(serverRoundResult.matchSnapshot.lastResolvedOutcome.winner, null);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: same move pairs resolve to war for both players", async () => {
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

    const roundResultPromise = waitForEvent(host, "room:roundResult");
    const hostFirstSyncPromise = waitForEvent(host, "room:moveSync");
    const guestFirstSyncPromise = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSyncPromise;
    await guestFirstSyncPromise;
    const serverRoundResultPromise = waitForEvent(host, "room:serverRoundResult");
    guest.emit("room:submitMove", { move: "fire" });

    const roundResult = await roundResultPromise;
    const serverRoundResult = await serverRoundResultPromise;
    assert.deepEqual(roundResult, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "fire",
      round: 1,
      outcomeType: "war",
      hostScore: 0,
      guestScore: 0,
      roundNumber: 2,
      lastOutcomeType: "war",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 1, water: 2, earth: 2, wind: 2 },
      warPot: { host: ["fire"], guest: ["fire"] },
      warActive: true,
      warDepth: 1,
      warRounds: [
        {
          round: 1,
          hostMove: "fire",
          guestMove: "fire",
          outcomeType: "war"
        }
      ],
      capturedCards: 0,
      capturedOpponentCards: 0,
      hostResult: "war",
      guestResult: "war"
    });
    assert.equal(serverRoundResult.authoritativeOutcomeType, "war_start");
    assert.equal(serverRoundResult.authoritativeWinner, null);
    assert.equal(serverRoundResult.matchSnapshot.lastResolvedOutcome.type, "war_start");
    assert.equal(serverRoundResult.matchSnapshot.activeStep.type, "war");
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: match state scores and round history persist across multiple rounds", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
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

    const hostRoundOneFirstSync = waitForEvent(host, "room:moveSync");
    const guestRoundOneFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostRoundOneFirstSync;
    await guestRoundOneFirstSync;

    const hostRoundOneLaterSyncs = waitForEvents(host, "room:moveSync", 2);
    const guestRoundOneLaterSyncs = waitForEvents(guest, "room:moveSync", 2);
    const hostRoundOneResult = waitForEvent(host, "room:roundResult");
    const guestRoundOneResult = waitForEvent(guest, "room:roundResult");
    guest.emit("room:submitMove", { move: "earth" });
    await hostRoundOneResult;
    await guestRoundOneResult;
    await hostRoundOneLaterSyncs;
    await guestRoundOneLaterSyncs;

    const hostRoundTwoFirstSync = waitForEvent(host, "room:moveSync");
    const guestRoundTwoFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostRoundTwoFirstSync;
    await guestRoundTwoFirstSync;

    const hostRoundTwoLaterSyncs = waitForEvents(host, "room:moveSync", 2);
    const guestRoundTwoLaterSyncs = waitForEvents(guest, "room:moveSync", 2);
    const hostRoundTwoResult = waitForEvent(host, "room:roundResult");
    const guestRoundTwoResult = waitForEvent(guest, "room:roundResult");
    guest.emit("room:submitMove", { move: "wind" });
    const secondRoundResult = await hostRoundTwoResult;
    await guestRoundTwoResult;
    await hostRoundTwoLaterSyncs;
    await guestRoundTwoLaterSyncs;

    const finalRoom = foundation.roomStore.getRoom(room.roomCode);

    assert.deepEqual(secondRoundResult, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "wind",
      round: 2,
      outcomeType: "no_effect",
      hostScore: 1,
      guestScore: 0,
      roundNumber: 3,
      lastOutcomeType: "no_effect",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 2, water: 2, earth: 3, wind: 2 },
      guestHand: { fire: 2, water: 2, earth: 1, wind: 2 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      capturedCards: 0,
      capturedOpponentCards: 0,
      hostResult: "no_effect",
      guestResult: "no_effect"
    });
    assert.equal(finalRoom.hostScore, 1);
    assert.equal(finalRoom.guestScore, 0);
    assert.equal(finalRoom.roundNumber, 3);
    assert.equal(finalRoom.lastOutcomeType, "no_effect");
    assert.deepEqual(finalRoom.roundHistory, [
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
        hostMove: "fire",
        guestMove: "wind",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer foundation: online completed history uses stored per-card capture values", () => {
  const matchState = buildOnlineMatchStateFromRoom({
    winner: "host",
    winReason: "hand_exhaustion",
    roundNumber: 4,
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
  });

  assert.deepEqual(matchState.history, [
    {
      result: "none",
      warClashes: 0,
      capturedCards: 0,
      capturedOpponentCards: 0,
      p1Card: "fire",
      p2Card: "fire"
    },
    {
      result: "none",
      warClashes: 0,
      capturedCards: 0,
      capturedOpponentCards: 0,
      p1Card: "water",
      p2Card: "water"
    },
    {
      result: "p1",
      warClashes: 3,
      capturedCards: 6,
      capturedOpponentCards: 3,
      p1Card: "earth",
      p2Card: "wind"
    }
  ]);
});

test("multiplayer rooms: repeated same-card rounds increase war depth", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
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

    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSync;
    await guestFirstSync;

    const hostWarSyncsOne = waitForEvents(host, "room:moveSync", 2);
    const guestWarSyncsOne = waitForEvents(guest, "room:moveSync", 2);
    const warStartResult = waitForEvent(host, "room:roundResult");
    guest.emit("room:submitMove", { move: "fire" });
    await warStartResult;
    await hostWarSyncsOne;
    await guestWarSyncsOne;

    const hostSecondSync = waitForEvent(host, "room:moveSync");
    const guestSecondSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "water" });
    await hostSecondSync;
    await guestSecondSync;

    const hostWarSyncsTwo = waitForEvents(host, "room:moveSync", 2);
    const guestWarSyncsTwo = waitForEvents(guest, "room:moveSync", 2);
    const repeatedWarServerResultPromise = waitForEvent(host, "room:serverRoundResult");
    const repeatedWarResult = await Promise.all([
      waitForEvent(host, "room:roundResult"),
      (async () => {
        guest.emit("room:submitMove", { move: "water" });
        return waitForEvent(guest, "room:roundResult");
      })()
    ]);
    const repeatedWarServerResult = await repeatedWarServerResultPromise;
    await hostWarSyncsTwo;
    await guestWarSyncsTwo;

    assert.deepEqual(repeatedWarResult[0], {
      roomCode: room.roomCode,
      hostMove: "water",
      guestMove: "water",
      round: 2,
      outcomeType: "war",
      hostScore: 0,
      guestScore: 0,
      roundNumber: 3,
      lastOutcomeType: "war",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 1, water: 1, earth: 2, wind: 2 },
      guestHand: { fire: 1, water: 1, earth: 2, wind: 2 },
      warPot: { host: ["fire", "water"], guest: ["fire", "water"] },
      warActive: true,
      warDepth: 2,
      warRounds: [
        {
          round: 1,
          hostMove: "fire",
          guestMove: "fire",
          outcomeType: "war"
        },
        {
          round: 2,
          hostMove: "water",
          guestMove: "water",
          outcomeType: "war"
        }
      ],
      capturedCards: 0,
      capturedOpponentCards: 0,
      hostResult: "war",
      guestResult: "war"
    });
    assert.equal(repeatedWarServerResult.authoritativeOutcomeType, "war_continue");
    assert.equal(repeatedWarServerResult.matchSnapshot.lastResolvedOutcome.type, "war_continue");
    assert.equal(repeatedWarServerResult.matchSnapshot.warState.depth, 2);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: no_effect during war keeps war active without changing score", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
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

    let sync = waitForEvent(host, "room:moveSync");
    let guestSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await sync;
    await guestSync;
    let laterSyncs = waitForEvents(host, "room:moveSync", 2);
    let laterGuestSyncs = waitForEvents(guest, "room:moveSync", 2);
    let warStart = waitForEvent(host, "room:roundResult");
    guest.emit("room:submitMove", { move: "fire" });
    await warStart;
    await laterSyncs;
    await laterGuestSyncs;

    sync = waitForEvent(host, "room:moveSync");
    guestSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await sync;
    await guestSync;
    laterSyncs = waitForEvents(host, "room:moveSync", 2);
    laterGuestSyncs = waitForEvents(guest, "room:moveSync", 2);
    const noEffectDuringWar = waitForEvent(host, "room:roundResult");
    guest.emit("room:submitMove", { move: "wind" });
    const result = await noEffectDuringWar;
    await laterSyncs;
    await laterGuestSyncs;

    assert.deepEqual(result, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "wind",
      round: 2,
      outcomeType: "no_effect",
      hostScore: 0,
      guestScore: 0,
      roundNumber: 3,
      lastOutcomeType: "no_effect",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 0, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 1, water: 2, earth: 2, wind: 1 },
      warPot: { host: ["fire", "fire"], guest: ["fire", "wind"] },
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
          hostMove: "fire",
          guestMove: "wind",
          outcomeType: "no_effect"
        }
      ],
      capturedCards: 0,
      capturedOpponentCards: 0,
      hostResult: "no_effect",
      guestResult: "no_effect"
    });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: decisive win during war resolves war and awards one score", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
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

    let sync = waitForEvent(host, "room:moveSync");
    let guestSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await sync;
    await guestSync;
    let laterSyncs = waitForEvents(host, "room:moveSync", 2);
    let laterGuestSyncs = waitForEvents(guest, "room:moveSync", 2);
    let warStart = waitForEvent(host, "room:roundResult");
    guest.emit("room:submitMove", { move: "fire" });
    await warStart;
    await laterSyncs;
    await laterGuestSyncs;

    sync = waitForEvent(host, "room:moveSync");
    guestSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "water" });
    await sync;
    await guestSync;
    laterSyncs = waitForEvents(host, "room:moveSync", 2);
    laterGuestSyncs = waitForEvents(guest, "room:moveSync", 2);
    const warResolved = waitForEvent(host, "room:roundResult");
    const serverRoundResultPromise = waitForEvent(host, "room:serverRoundResult");
    guest.emit("room:submitMove", { move: "fire" });
    const result = await warResolved;
    const serverRoundResult = await serverRoundResultPromise;
    const [, resetSync] = await laterSyncs;
    await laterGuestSyncs;

    assert.deepEqual(result, {
      roomCode: room.roomCode,
      hostMove: "water",
      guestMove: "fire",
      round: 2,
      outcomeType: "war_resolved",
      hostScore: 1,
      guestScore: 0,
      roundNumber: 3,
      lastOutcomeType: "war_resolved",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 4, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 0, water: 2, earth: 2, wind: 2 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      capturedCards: 4,
      capturedOpponentCards: 2,
      hostResult: "win",
      guestResult: "lose"
    });
    assert.equal(serverRoundResult.authoritativeOutcomeType, "war_resolved");
    assert.equal(serverRoundResult.authoritativeWinner, "host");
    assert.equal(serverRoundResult.matchSnapshot.lastResolvedOutcome.type, "war_resolved");
    assert.equal(serverRoundResult.matchSnapshot.warState.active, false);
    assert.equal(resetSync.hostScore, 1);
    assert.equal(resetSync.guestScore, 0);
    assert.equal(resetSync.hostCardsTaken, 2);
    assert.equal(resetSync.guestCardsTaken, 0);
    assert.equal(resetSync.totalWarClashes, 1);
    assert.equal(serverRoundResult.matchSnapshot.hostCardsTaken, 2);
    assert.equal(serverRoundResult.matchSnapshot.guestCardsTaken, 0);
    assert.equal(serverRoundResult.matchSnapshot.totalWarClashes, 1);
    assert.equal(resetSync.warActive, false);
    assert.equal(resetSync.warDepth, 0);
    assert.deepEqual(resetSync.warRounds, []);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: reaching 5 points alone does not end the match if cards remain", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    let finalResult = null;
    for (let index = 0; index < OPENING_WIN_SEQUENCE.length; index += 1) {
      const [hostMove, guestMove] = OPENING_WIN_SEQUENCE[index];
      const round = await submitRoundPair(host, guest, hostMove, guestMove, 2);
      finalResult = round.hostRoundResult;
    }

    assert.deepEqual(finalResult, {
      roomCode: room.roomCode,
      hostMove: "wind",
      guestMove: "water",
      round: 5,
      outcomeType: "resolved",
      hostScore: 5,
      guestScore: 0,
      roundNumber: 6,
      lastOutcomeType: "resolved",
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 3, water: 3, earth: 4, wind: 3 },
      guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      capturedCards: 2,
      capturedOpponentCards: 1,
      hostResult: "win",
      guestResult: "lose"
    });
    assert.equal(finalResult.hostScore, 5);
    assert.equal(finalResult.matchComplete, false);

    const nextRound = await submitRoundPair(host, guest, "earth", "wind", 2);
    assert.equal(nextRound.hostRoundResult.matchComplete, false);
    assert.equal(nextRound.hostRoundResult.winReason, null);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: normal non-WAR play ends by hand exhaustion", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    const exhaustionSequence = [...OPENING_WIN_SEQUENCE, ["earth", "wind"], ["wind", "water"], ["water", "fire"]];
    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const pair = exhaustionSequence[index];
      const [hostMove, guestMove] = pair;
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const finalRoom = foundation.roomStore.getRoom(room.roomCode);
    assert.equal(finalRoom.matchComplete, true);
    assert.equal(finalRoom.winner, "host");
    assert.equal(finalRoom.winReason, "hand_exhaustion");
    assert.equal(getTotalOwnedCards(finalRoom.hostHand, finalRoom.warPot.host), 16);
    assert.equal(getTotalOwnedCards(finalRoom.guestHand, finalRoom.warPot.guest), 0);
    assert.deepEqual(finalRoom.guestHand, { fire: 0, water: 0, earth: 0, wind: 0 });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: illegal move is rejected when the player has no copies left", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    await createFullRoom(host, guest);

    await submitRoundPair(host, guest, "fire", "water");
    await submitRoundPair(host, guest, "fire", "water");

    const illegalMoveError = waitForEvent(host, "room:error");
    host.emit("room:submitMove", { move: "fire" });

    assert.deepEqual(await illegalMoveError, {
      code: "ILLEGAL_MOVE_NOT_IN_HAND",
      message: "That element is no longer available in this hand."
    });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: authoritative submit rejects a fatigued element when alternatives exist", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("local-fatigue-host");
  const guest = createStoreSocket("local-fatigue-guest");
  const created = store.createRoom(host, { username: "Host" });
  const joined = store.joinRoom(guest, created.room.roomCode, { username: "Guest" });

  assert.equal(created.ok, true);
  assert.equal(joined.ok, true);

  let result = store.submitMove(host.id, "fire");
  assert.equal(result.ok, true);
  result = store.submitMove(guest.id, "earth");
  assert.equal(result.ok, true);

  result = store.submitMove(host.id, "fire");
  assert.equal(result.ok, true);
  result = store.submitMove(guest.id, "earth");
  assert.equal(result.ok, true);

  const fatigued = store.submitMove(host.id, "fire");
  assert.equal(fatigued.ok, false);
  assert.deepEqual(fatigued.error, {
    code: "MOVE_FATIGUED",
    message: "This Elemint must rest for 1 turn."
  });
});

test("multiplayer rooms: authoritative submit allows a fatigued element when it is the only playable option", () => {
  const store = createRoomStore({ random: () => 0 });
  const host = createStoreSocket("local-fatigue-bypass-host");
  const guest = createStoreSocket("local-fatigue-bypass-guest");
  const created = store.createRoom(host, { username: "Host" });
  const joined = store.joinRoom(guest, created.room.roomCode, { username: "Guest" });

  assert.equal(created.ok, true);
  assert.equal(joined.ok, true);

  const playRound = (hostMove, guestMove) => {
    const hostResult = store.submitMove(host.id, hostMove);
    assert.equal(hostResult.ok, true);
    const guestResult = store.submitMove(guest.id, guestMove);
    assert.equal(guestResult.ok, true);
    return guestResult;
  };

  playRound("water", "wind");
  playRound("water", "wind");
  playRound("earth", "fire");
  playRound("earth", "fire");
  playRound("wind", "earth");
  playRound("wind", "earth");

  const roomAfterLosses = store.getRoom(created.room.roomCode);
  assert.deepEqual(roomAfterLosses.hostHand, { fire: 2, water: 0, earth: 0, wind: 0 });

  playRound("fire", "wind");
  playRound("fire", "wind");

  const bypass = store.submitMove(host.id, "fire");
  assert.equal(bypass.ok, true);
});

test("multiplayer rooms: stale submit after server resolution is rejected safely", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 1000
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSync;
    await guestFirstSync;

    const hostLaterSyncs = waitForEvents(host, "room:moveSync", 1);
    const guestLaterSyncs = waitForEvents(guest, "room:moveSync", 1);
    const hostRoundResult = waitForEvent(host, "room:roundResult");
    guest.emit("room:submitMove", { move: "water" });
    await hostRoundResult;
    await hostLaterSyncs;
    await guestLaterSyncs;

    const staleMoveError = waitForEvent(host, "room:error");
    host.emit("room:submitMove", { move: "earth" });

    assert.deepEqual(await staleMoveError, {
      code: "MOVE_STEP_RESOLVED",
      message: "This resolution step already completed on the server."
    });

    const roomAfterStaleSubmit = foundation.roomStore.getRoom(room.roomCode);
    assert.equal(roomAfterStaleSubmit.roundNumber, 2);
    assert.equal(roomAfterStaleSubmit.serverMatchState.lastResolvedOutcome.type, "win");
    assert.equal(roomAfterStaleSubmit.serverMatchState.activeStep.id, `${room.roomCode}:match:1:round:2:step:round:warDepth:0`);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: active war ends immediately when one player has no legal cards left", async () => {
  const room = {
    warActive: true,
    hostHand: { fire: 0, water: 0, earth: 0, wind: 1 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    warPot: {
      host: ["fire", "water"],
      guest: ["fire", "water"]
    },
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: {
      hostReady: true,
      guestReady: true
    }
  };

  assert.equal(updateMatchCompletion(room), true);
  assert.equal(room.matchComplete, true);
  assert.equal(room.winner, "host");
  assert.equal(room.winReason, "hand_exhaustion");
  assert.deepEqual(room.rematch, {
    hostReady: false,
    guestReady: false
  });
});

test("multiplayer rooms: active war ends as draw when both players have no legal cards left", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    await submitRoundPair(host, guest, "fire", "fire");
    await submitRoundPair(host, guest, "fire", "fire");
    await submitRoundPair(host, guest, "water", "water");
    await submitRoundPair(host, guest, "water", "water");
    await submitRoundPair(host, guest, "earth", "earth");
    await submitRoundPair(host, guest, "earth", "earth");

    await submitRoundPair(host, guest, "wind", "wind");
    const exhaustedRound = await submitRoundPair(host, guest, "wind", "wind", 1);
    const finalRoom = foundation.roomStore.getRoom(room.roomCode);

    assert.equal(exhaustedRound.hostRoundResult.outcomeType, "war");
    assert.equal(finalRoom.matchComplete, true);
    assert.equal(finalRoom.winner, "draw");
    assert.equal(finalRoom.winReason, "hand_exhaustion");
    assert.equal(finalRoom.warActive, true);
    assert.equal(getTotalOwnedCards(finalRoom.hostHand, finalRoom.warPot.host), 8);
    assert.equal(getTotalOwnedCards(finalRoom.guestHand, finalRoom.warPot.guest), 8);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer rooms: both sides reaching zero total owned cards ends as draw with hand exhaustion", () => {
  const room = {
    warActive: false,
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    warPot: {
      host: [],
      guest: []
    },
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: {
      hostReady: true,
      guestReady: true
    }
  };

  assert.equal(updateMatchCompletion(room), true);
  assert.equal(room.matchComplete, true);
  assert.equal(room.winner, "draw");
  assert.equal(room.winReason, "hand_exhaustion");
  assert.deepEqual(room.rematch, {
    hostReady: false,
    guestReady: false
  });
});

test("multiplayer rooms: rematch ready resets the room after hand exhaustion match end", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest);

    const exhaustionSequence = [...OPENING_WIN_SEQUENCE, ["earth", "wind"], ["wind", "water"], ["water", "fire"]];
    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const pair = exhaustionSequence[index];
      const [hostMove, guestMove] = pair;
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const firstReadyHostUpdate = waitForEvent(host, "room:update");
    const firstReadyGuestUpdate = waitForEvent(guest, "room:update");
    host.emit("room:readyRematch");
    const firstReadyRoom = await firstReadyHostUpdate;
    await firstReadyGuestUpdate;

    assert.equal(firstReadyRoom.matchComplete, true);
    assert.deepEqual(firstReadyRoom.rematch, {
      hostReady: true,
      guestReady: false
    });

    const resetHostUpdate = waitForEvent(host, "room:update");
    const resetGuestUpdate = waitForEvent(guest, "room:update");
    guest.emit("room:readyRematch");
    const resetRoom = await resetHostUpdate;
    await resetGuestUpdate;

    assert.equal(resetRoom.roomCode, room.roomCode);
    assert.equal(resetRoom.matchComplete, false);
    assert.equal(resetRoom.winner, null);
    assert.equal(resetRoom.winReason, null);
    assert.deepEqual(resetRoom.rematch, {
      hostReady: false,
      guestReady: false
    });
    assert.equal(resetRoom.hostScore, 0);
    assert.equal(resetRoom.guestScore, 0);
    assert.equal(resetRoom.hostCardsTaken, 0);
    assert.equal(resetRoom.guestCardsTaken, 0);
    assert.equal(resetRoom.totalWarClashes, 0);
    assert.equal(resetRoom.roundNumber, 1);
    assert.equal(resetRoom.lastOutcomeType, null);
    assert.deepEqual(resetRoom.roundHistory, []);
    assert.deepEqual(resetRoom.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(resetRoom.guestHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(resetRoom.warPot, { host: [], guest: [] });
    assert.equal(resetRoom.warActive, false);
    assert.equal(resetRoom.warDepth, 0);
    assert.deepEqual(resetRoom.warRounds, []);
    assert.deepEqual(resetRoom.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
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

test("multiplayer rewards: completed match grants winner and loser rewards once and persists profiles", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const settleCalls = [];
  const rewardPersister = async (payload) => {
    settleCalls.push({ roomCode: payload.room.roomCode, winner: payload.summary.winner });
    if (payload.decision?.participants?.hostUsername) {
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.hostUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "host"
      });
    }
    if (payload.decision?.participants?.guestUsername) {
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.guestUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "guest"
      });
    }
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister,
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "HostRewardUser" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "GuestRewardUser" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [...OPENING_WIN_SEQUENCE, ["earth", "wind"], ["wind", "water"], ["water", "fire"]];
    let finalRound = null;
    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const pair = exhaustionSequence[index];
      const [hostMove, guestMove] = pair;
      const round = await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
      finalRound = round.hostRoundResult;
    }

    assert.equal(finalRound.matchComplete, true);
    assert.equal(finalRound.winner, "host");
    assert.equal(finalRound.winReason, "hand_exhaustion");
    assert.deepEqual(finalRound.rewardSettlement, {
      granted: true,
      grantedAt: finalRound.rewardSettlement.grantedAt,
      settlementKey: `${room.roomCode}:match:1`,
      decision: {
        matchId: `${room.roomCode}:match:1`,
        roomCode: room.roomCode,
        winner: "host",
        isDraw: false,
        rewards: {
          host: { tokens: 25, xp: 20, basicChests: 1 },
          guest: { tokens: 5, xp: 5, basicChests: 0 }
        },
        participants: {
          hostUsername: "HostRewardUser",
          guestUsername: "GuestRewardUser"
        },
        decidedAt: finalRound.rewardSettlement.grantedAt
      },
      summary: {
        granted: true,
        winner: "host",
        settledHostUsername: "HostRewardUser",
        settledGuestUsername: "GuestRewardUser",
        hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
        guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
      }
    });
    assert.equal(settleCalls.length, 1);

    const hostProfile = await coordinator.profiles.getProfile("HostRewardUser");
    const guestProfile = await coordinator.profiles.getProfile("GuestRewardUser");
    assert.equal(hostProfile.tokens, DEFAULT_STARTING_TOKENS + 25);
    assert.equal(hostProfile.playerXP, 20);
    assert.equal(hostProfile.chests.basic, 1);
    assert.deepEqual(hostProfile.onlineRewardSettlements?.appliedSettlementKeys, [
      `${room.roomCode}:match:1`
    ]);
    assert.equal(guestProfile.tokens, DEFAULT_STARTING_TOKENS + 5);
    assert.equal(guestProfile.playerXP, 5);
    assert.equal(guestProfile.chests.basic, 0);
    assert.deepEqual(guestProfile.onlineRewardSettlements?.appliedSettlementKeys, [
      `${room.roomCode}:match:1`
    ]);

    const duplicateError = waitForEvent(host, "room:error");
    host.emit("room:submitMove", { move: "fire" });
    assert.deepEqual(await duplicateError, {
      code: "MATCH_COMPLETE",
      message: "Match is complete. Both players must ready a rematch first."
    });
    assert.equal(settleCalls.length, 1);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer rewards: draw completion emits a server reward decision payload once", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const settleCalls = [];
  const rewardPersister = async (payload) => {
    settleCalls.push({
      roomCode: payload.room.roomCode,
      settlementKey: payload.settlementKey,
      winner: payload.summary.winner
    });
    if (payload.decision?.participants?.hostUsername) {
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.hostUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "host"
      });
    }
    if (payload.decision?.participants?.guestUsername) {
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.guestUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "guest"
      });
    }
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister,
    random: () => 0.5
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "DrawRewardHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "DrawRewardGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const drawSequence = [
      ["fire", "fire"],
      ["water", "water"],
      ["earth", "earth"],
      ["wind", "wind"],
      ["fire", "fire"],
      ["water", "water"],
      ["earth", "earth"],
      ["wind", "wind"]
    ];

    let finalRound = null;
    for (let index = 0; index < drawSequence.length; index += 1) {
      const [hostMove, guestMove] = drawSequence[index];
      const round = await submitRoundPair(
        host,
        guest,
        hostMove,
        guestMove,
        index === drawSequence.length - 1 ? 1 : 2
      );
      finalRound = round.hostRoundResult;
    }

    assert.equal(finalRound.matchComplete, true);
    assert.equal(finalRound.winner, "draw");
    assert.equal(finalRound.rewardSettlement.settlementKey, `${room.roomCode}:match:1`);
    assert.deepEqual(finalRound.rewardSettlement.decision, {
      matchId: `${room.roomCode}:match:1`,
      roomCode: room.roomCode,
      winner: "draw",
      isDraw: true,
      rewards: {
        host: { tokens: 10, xp: 10, basicChests: 0 },
        guest: { tokens: 10, xp: 10, basicChests: 0 }
      },
      participants: {
        hostUsername: "DrawRewardHost",
        guestUsername: "DrawRewardGuest"
      },
      decidedAt: finalRound.rewardSettlement.grantedAt
    });
    assert.equal(settleCalls.length, 1);
    assert.deepEqual(settleCalls[0], {
      roomCode: room.roomCode,
      settlementKey: `${room.roomCode}:match:1`,
      winner: "draw"
    });

    const hostProfile = await coordinator.profiles.getProfile("DrawRewardHost");
    const guestProfile = await coordinator.profiles.getProfile("DrawRewardGuest");
    assert.equal(hostProfile.tokens, DEFAULT_STARTING_TOKENS + 10);
    assert.equal(hostProfile.playerXP, 10);
    assert.equal(guestProfile.tokens, DEFAULT_STARTING_TOKENS + 10);
    assert.equal(guestProfile.playerXP, 10);
    assert.deepEqual(hostProfile.onlineRewardSettlements?.appliedSettlementKeys, [
      `${room.roomCode}:match:1`
    ]);
    assert.deepEqual(guestProfile.onlineRewardSettlements?.appliedSettlementKeys, [
      `${room.roomCode}:match:1`
    ]);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer rewards: draw summary grants fallback rewards with no chest", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "draw"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} }
      }
    ),
    {
      granted: true,
      winner: "draw",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 10, xp: 10, basicChests: 0 },
      guestRewards: { tokens: 10, xp: 10, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: draw chest uses the draw drop chance for both players", () => {
  const rolls = [0.01, 0.5];
  const random = () => rolls.shift() ?? 0.5;
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "draw"
      },
      {
        random,
        logger: { info: () => {} }
      }
    ),
    {
      granted: true,
      winner: "draw",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 10, xp: 10, basicChests: 1 },
      guestRewards: { tokens: 10, xp: 10, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: online boost scope can boost XP without changing tokens", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "host"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} },
        boostEvent: {
          enabled: true,
          scope: "online",
          excludeDifficulties: [],
          xpMultiplier: 2,
          tokenMultiplier: 1
        }
      }
    ),
    {
      granted: true,
      winner: "host",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 25, xp: 40, basicChests: 0 },
      guestRewards: { tokens: 5, xp: 10, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: explicit online target can boost online base rewards", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "host"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} },
        boostEvent: {
          enabled: true,
          targets: {
            online_pvp: true
          },
          excludeDifficulties: [],
          xpMultiplier: 2,
          tokenMultiplier: 1.5
        }
      }
    ),
    {
      granted: true,
      winner: "host",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 37, xp: 40, basicChests: 0 },
      guestRewards: { tokens: 7, xp: 10, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: online boost scope can boost tokens without changing XP", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "draw"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} },
        boostEvent: {
          enabled: true,
          scope: "online",
          excludeDifficulties: [],
          xpMultiplier: 1,
          tokenMultiplier: 1.5
        }
      }
    ),
    {
      granted: true,
      winner: "draw",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 15, xp: 10, basicChests: 0 },
      guestRewards: { tokens: 15, xp: 10, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: online boost uses floor rounding for both host and guest", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "host"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} },
        boostEvent: {
          enabled: true,
          scope: "online",
          excludeDifficulties: [],
          xpMultiplier: 1.5,
          tokenMultiplier: 1.5
        }
      }
    ),
    {
      granted: true,
      winner: "host",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 37, xp: 30, basicChests: 0 },
      guestRewards: { tokens: 7, xp: 7, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: winner chest is chance-based and not guaranteed", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "host"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} }
      }
    ),
    {
      granted: true,
      winner: "host",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 25, xp: 20, basicChests: 0 },
      guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: loser chest uses the lower chance roll", () => {
  const rolls = [0.01, 0.5];
  const random = () => rolls.shift() ?? 0.5;
  assert.deepEqual(
    buildRewardSummary(
      {
        matchComplete: true,
        winner: "guest"
      },
      {
        random,
        logger: { info: () => {} }
      }
    ),
    {
      granted: true,
      winner: "guest",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 5, xp: 5, basicChests: 1 },
      guestRewards: { tokens: 25, xp: 20, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: duplicate settled usernames disable reward persistence identities", () => {
  assert.deepEqual(
    buildRewardSummary(
      {
        roomCode: "AAA222",
        matchComplete: true,
        winner: "host",
        host: { username: "SameAccount" },
        guest: { username: "SameAccount" }
      },
      {
        random: () => 0.99,
        logger: { info: () => {}, warn: () => {} }
      }
    ),
    {
      granted: true,
      winner: "host",
      settledHostUsername: null,
      settledGuestUsername: null,
      hostRewards: { tokens: 25, xp: 20, basicChests: 0 },
      guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
    }
  );
});

test("multiplayer rewards: boosted online settlement is not boosted again during persistence", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });

  try {
    const summary = buildRewardSummary(
      {
        matchComplete: true,
        winner: "host"
      },
      {
        random: () => 0.5,
        logger: { info: () => {} },
        boostEvent: {
          enabled: true,
          scope: "online",
          excludeDifficulties: [],
          xpMultiplier: 2,
          tokenMultiplier: 2
        }
      }
    );

    const first = await coordinator.applyOnlineRewardSettlementDecision({
      username: "BoostPersistHost",
      settlementKey: "boost-settlement-1",
      rewardDecision: {
        participants: {
          hostUsername: "BoostPersistHost"
        },
        rewards: {
          host: summary.hostRewards
        }
      },
      participantRole: "host"
    });
    const duplicate = await coordinator.applyOnlineRewardSettlementDecision({
      username: "BoostPersistHost",
      settlementKey: "boost-settlement-1",
      rewardDecision: {
        participants: {
          hostUsername: "BoostPersistHost"
        },
        rewards: {
          host: summary.hostRewards
        }
      },
      participantRole: "host"
    });

    assert.equal(first.duplicate, false);
    assert.equal(first.rewards.tokens, 50);
    assert.equal(first.rewards.xp, 40);
    assert.equal(first.profile.tokens, DEFAULT_STARTING_TOKENS + 50);
    assert.equal(first.profile.playerXP, 40);
    assert.equal(duplicate.duplicate, true);

    const profile = await coordinator.profiles.getProfile("BoostPersistHost");
    assert.equal(profile.tokens, DEFAULT_STARTING_TOKENS + 50);
    assert.equal(profile.playerXP, 40);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer rewards: reward decision payload is derived from authoritative server completion state", () => {
  const decision = buildRewardDecision(
    {
      roomCode: "AAA111",
      matchSequence: 3,
      matchComplete: true,
      winner: "guest",
      serverMatchState: {
        matchId: "AAA111:match:3"
      }
    },
    {
      granted: true,
      winner: "guest",
      settledHostUsername: "HostDecisionUser",
      settledGuestUsername: "GuestDecisionUser",
      hostRewards: { tokens: 5, xp: 5, basicChests: 0 },
      guestRewards: { tokens: 25, xp: 20, basicChests: 1 }
    },
    {
      settlementKey: "AAA111:match:3",
      decidedAt: "2026-03-29T18:00:00.000Z"
    }
  );

  assert.deepEqual(decision, {
    matchId: "AAA111:match:3",
    roomCode: "AAA111",
    winner: "guest",
    isDraw: false,
    settlementKey: "AAA111:match:3",
    rewards: {
      host: { tokens: 5, xp: 5, basicChests: 0 },
      guest: { tokens: 25, xp: 20, basicChests: 1 }
    },
    participants: {
      hostUsername: "HostDecisionUser",
      guestUsername: "GuestDecisionUser"
    },
    decidedAt: "2026-03-29T18:00:00.000Z"
  });
});

test("multiplayer rewards: settlementKey prevents duplicate persisted reward grants", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });

  try {
    await coordinator.profiles.ensureProfile("DuplicateRewardUser");

    const firstGrant = await coordinator.applyOnlineRewardSettlementDecision({
      username: "DuplicateRewardUser",
      settlementKey: "ROOM99:match:1",
      rewardDecision: {
        participants: {
          hostUsername: "DuplicateRewardUser",
          guestUsername: "OtherUser"
        },
        rewards: {
          host: { tokens: 25, xp: 20, basicChests: 1 },
          guest: { tokens: 5, xp: 5, basicChests: 0 }
        }
      },
      participantRole: "host"
    });

    const secondGrant = await coordinator.applyOnlineRewardSettlementDecision({
      username: "DuplicateRewardUser",
      settlementKey: "ROOM99:match:1",
      rewardDecision: {
        participants: {
          hostUsername: "DuplicateRewardUser",
          guestUsername: "OtherUser"
        },
        rewards: {
          host: { tokens: 25, xp: 20, basicChests: 1 },
          guest: { tokens: 5, xp: 5, basicChests: 0 }
        }
      },
      participantRole: "host"
    });

    const profile = await coordinator.profiles.getProfile("DuplicateRewardUser");
    assert.equal(firstGrant.duplicate, false);
    assert.equal(secondGrant.duplicate, true);
    assert.equal(profile.tokens, DEFAULT_STARTING_TOKENS + 25);
    assert.equal(profile.playerXP, 20);
    assert.equal(profile.chests.basic, 1);
    assert.deepEqual(profile.onlineRewardSettlements?.appliedSettlementKeys, ["ROOM99:match:1"]);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer profile authority: protected PvE and featured rival settlements reject forged or mismatched local sessions", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    }),
    adminGrantStore: new AdminGrantStore({ dataDir })
  });
  let owner = null;
  let other = null;

  try {
    const port = await foundation.start();
    owner = await connectClient(port);
    other = await connectClient(port);

    const ownerAuth = await registerAccount(owner, {
      username: "ProtectedPveOwner",
      email: "protected-pve-owner@example.com",
      password: "PlayerPass123"
    });
    const otherAuth = await registerAccount(other, {
      username: "ProtectedPveOther",
      email: "protected-pve-other@example.com",
      password: "PlayerPass123"
    });
    assert.equal(ownerAuth?.ok, true);
    assert.equal(otherAuth?.ok, true);

    const ownerPveSession = await emitWithAck(owner, "profile:startLocalPveMatch", {
      aiDifficulty: "hard"
    });
    const ownerFeaturedSession = await emitWithAck(owner, "profile:startFeaturedRivalMatch", {
      aiDifficulty: "hard",
      featuredRivalId: "crownfire_duelist"
    });
    const otherPveSession = await emitWithAck(other, "profile:startLocalPveMatch", {
      aiDifficulty: "hard"
    });

    assert.equal(ownerPveSession?.ok, true);
    assert.equal(ownerFeaturedSession?.ok, true);
    assert.equal(otherPveSession?.ok, true);

    const noSession = await emitWithAck(owner, "profile:applyLocalMatchResult", {
      perspective: "p1",
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "hard"
      }),
      settlementKey: "PVE:forged:no-session"
    });
    const nonexistentSession = await emitWithAck(owner, "profile:applyLocalMatchResult", {
      perspective: "p1",
      localMatchSessionId: "local-missing-session",
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "hard"
      }),
      settlementKey: "PVE::session:local-missing-session::forged"
    });
    const foreignSession = await emitWithAck(owner, "profile:applyLocalMatchResult", {
      perspective: "p1",
      localMatchSessionId: otherPveSession.result.session.sessionId,
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "hard"
      }),
      settlementKey: `PVE::session:${otherPveSession.result.session.sessionId}::forged`
    });
    const wrongDifficulty = await emitWithAck(owner, "profile:applyLocalMatchResult", {
      perspective: "p1",
      localMatchSessionId: ownerPveSession.result.session.sessionId,
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "normal"
      }),
      settlementKey: `PVE::session:${ownerPveSession.result.session.sessionId}::wrong-difficulty`
    });
    const featuredWithoutSession = await emitWithAck(owner, "profile:applyLocalMatchResult", {
      perspective: "p1",
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "hard",
        featuredRivalId: "crownfire_duelist"
      }),
      settlementKey: "FEATURED:forged:no-session"
    });
    const featuredModeMismatch = await emitWithAck(owner, "profile:applyLocalMatchResult", {
      perspective: "p1",
      localMatchSessionId: ownerPveSession.result.session.sessionId,
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "hard",
        featuredRivalId: "crownfire_duelist"
      }),
      settlementKey: `FEATURED::session:${ownerPveSession.result.session.sessionId}::wrong-mode`
    });

    const ownerProfile = await coordinator.profiles.getProfile("ProtectedPveOwner");

    assert.equal(noSession?.ok, false);
    assert.equal(noSession?.error?.code, "LOCAL_MATCH_SESSION_REQUIRED");
    assert.equal(nonexistentSession?.ok, false);
    assert.equal(nonexistentSession?.error?.code, "LOCAL_MATCH_SESSION_NOT_FOUND");
    assert.equal(foreignSession?.ok, false);
    assert.equal(foreignSession?.error?.code, "LOCAL_MATCH_SESSION_ACCESS_DENIED");
    assert.equal(wrongDifficulty?.ok, false);
    assert.equal(wrongDifficulty?.error?.code, "LOCAL_MATCH_SESSION_DIFFICULTY_MISMATCH");
    assert.equal(featuredWithoutSession?.ok, false);
    assert.equal(featuredWithoutSession?.error?.code, "LOCAL_MATCH_SESSION_REQUIRED");
    assert.equal(featuredModeMismatch?.ok, false);
    assert.equal(featuredModeMismatch?.error?.code, "LOCAL_MATCH_SESSION_MODE_MISMATCH");
    assert.equal(ownerProfile.gamesPlayed, 0);
    assert.equal(ownerProfile.wins, 0);
    assert.equal(ownerProfile.featuredRivalWins, 0);
    assert.equal(ownerProfile.modeStats?.pve?.gamesPlayed ?? 0, 0);
  } finally {
    owner?.disconnect();
    other?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer profile authority: authenticated PvE settlement requires a valid local session and stays idempotent", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    }),
    adminGrantStore: new AdminGrantStore({ dataDir })
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);
    const auth = await registerAccount(client, {
      username: "AuthoritativePveUser",
      email: "authoritative-pve@example.com",
      password: "PlayerPass123"
    });
    assert.equal(auth?.ok, true);

    const sessionStart = await emitWithAck(client, "profile:startLocalPveMatch", {
      aiDifficulty: "hard"
    });
    assert.equal(sessionStart?.ok, true);
    const sessionId = sessionStart?.result?.session?.sessionId;

    const first = await new Promise((resolve) => {
      client.emit(
        "profile:applyLocalMatchResult",
        {
          perspective: "p1",
          localMatchSessionId: sessionId,
          matchState: createCompletedLocalMatchState({
            mode: "pve",
            winner: "p1",
            difficulty: "hard"
          }),
          settlementKey: `PVE::session:${sessionId}::server:1`
        },
        resolve
      );
    });
    const second = await new Promise((resolve) => {
      client.emit(
        "profile:applyLocalMatchResult",
        {
          perspective: "p1",
          localMatchSessionId: sessionId,
          matchState: createCompletedLocalMatchState({
            mode: "pve",
            winner: "p1",
            difficulty: "hard"
          }),
          settlementKey: `PVE::session:${sessionId}::server:1`
        },
        resolve
      );
    });
    const sessionState = await emitWithAck(client, "profile:getLocalMatchSessionState", {
      sessionId
    });

    const profile = await coordinator.profiles.getProfile("AuthoritativePveUser");

    assert.equal(first?.ok, true);
    assert.equal(first?.result?.duplicate, false);
    assert.equal(second?.ok, true);
    assert.equal(second?.result?.duplicate, true);
    assert.equal(sessionState?.ok, true);
    assert.equal(sessionState?.result?.session?.status, "completed");
    assert.equal(profile.gamesPlayed, 1);
    assert.equal(profile.wins, 1);
    assert.ok(profile.playerXP > 0);
    assert.ok(profile.tokens > 200);
    assert.equal(profile.modeStats.pve.gamesPlayed, 1);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer profile authority: authenticated featured rival settlement requires a valid local session", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    }),
    adminGrantStore: new AdminGrantStore({ dataDir })
  });
  let client = null;

  try {
    const port = await foundation.start();
    client = await connectClient(port);
    const auth = await registerAccount(client, {
      username: "FeaturedAuthorityUser",
      email: "featured-authority@example.com",
      password: "PlayerPass123"
    });
    assert.equal(auth?.ok, true);

    const sessionStart = await emitWithAck(client, "profile:startFeaturedRivalMatch", {
      aiDifficulty: "hard",
      featuredRivalId: "crownfire_duelist"
    });
    assert.equal(sessionStart?.ok, true);
    const sessionId = sessionStart?.result?.session?.sessionId;

    const settlement = await emitWithAck(client, "profile:applyLocalMatchResult", {
      perspective: "p1",
      localMatchSessionId: sessionId,
      matchState: createCompletedLocalMatchState({
        mode: "pve",
        winner: "p1",
        difficulty: "hard",
        featuredRivalId: "crownfire_duelist"
      }),
      settlementKey: `FEATURED::session:${sessionId}::server:1`
    });

    const profile = await coordinator.profiles.getProfile("FeaturedAuthorityUser");

    assert.equal(settlement?.ok, true);
    assert.equal(settlement?.result?.duplicate, false);
    assert.equal(profile.gamesPlayed, 1);
    assert.equal(profile.wins, 1);
    assert.equal(profile.modeStats?.pve?.gamesPlayed ?? 0, 1);
    assert.equal(profile.featuredRivalWins, 1);
    assert.ok(profile.playerXP > 0);
    assert.ok(profile.tokens > 200);
  } finally {
    client?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer profile authority: authenticated local PvP settlement is rejected and cannot mutate server profiles", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    }),
    adminGrantStore: new AdminGrantStore({ dataDir })
  });
  let p1 = null;
  let p2 = null;

  try {
    const port = await foundation.start();
    p1 = await connectClient(port);
    p2 = await connectClient(port);

    const hostAuth = await registerAccount(p1, {
      username: "AuthoritativeHotseatHost",
      email: "authoritative-hotseat-host@example.com",
      password: "PlayerPass123"
    });
    const guestAuth = await registerAccount(p2, {
      username: "AuthoritativeHotseatGuest",
      email: "authoritative-hotseat-guest@example.com",
      password: "PlayerPass123"
    });
    assert.equal(hostAuth?.ok, true);
    assert.equal(guestAuth?.ok, true);

    const matchState = createCompletedLocalMatchState({ mode: "local_pvp", winner: "p1" });
    const p1Result = await new Promise((resolve) => {
      p1.emit(
        "profile:applyLocalMatchResult",
        {
          perspective: "p1",
          matchState,
          settlementKey: "LPVP:server:1"
        },
        resolve
      );
    });
    const p2Result = await new Promise((resolve) => {
      p2.emit(
        "profile:applyLocalMatchResult",
        {
          perspective: "p2",
          matchState,
          settlementKey: "LPVP:server:1"
        },
        resolve
      );
    });

    const hostProfile = await coordinator.profiles.getProfile("AuthoritativeHotseatHost");
    const guestProfile = await coordinator.profiles.getProfile("AuthoritativeHotseatGuest");

    assert.equal(p1Result?.ok, false);
    assert.equal(p1Result?.error?.code, "LOCAL_MATCH_UNVERIFIED_LOCAL_PVP_REJECTED");
    assert.equal(p2Result?.ok, false);
    assert.equal(p2Result?.error?.code, "LOCAL_MATCH_UNVERIFIED_LOCAL_PVP_REJECTED");
    assert.equal(hostProfile.gamesPlayed, 0);
    assert.equal(hostProfile.wins, 0);
    assert.equal(hostProfile.modeStats.local_pvp.wins, 0);
    assert.equal(guestProfile.gamesPlayed, 0);
    assert.equal(guestProfile.losses, 0);
    assert.equal(guestProfile.modeStats.local_pvp.losses, 0);
  } finally {
    p1?.disconnect();
    p2?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer profile authority: dedicated local hotseat settlement grants capped rewards without chests or achievements", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir, random: () => 0.01 });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    profileAuthority: new MultiplayerProfileAuthority({
      coordinator,
      logger: { info: () => {} }
    }),
    accountStore: new MultiplayerAccountStore({
      dataDir,
      logger: { info: () => {} }
    }),
    adminGrantStore: new AdminGrantStore({ dataDir })
  });
  let p1 = null;
  let p2 = null;

  try {
    const port = await foundation.start();
    p1 = await connectClient(port);
    p2 = await connectClient(port);

    assert.equal(
      (await registerAccount(p1, {
        username: "DedicatedHotseatHost",
        email: "dedicated-hotseat-host@example.com",
        password: "PlayerPass123"
      }))?.ok,
      true
    );
    assert.equal(
      (await registerAccount(p2, {
        username: "DedicatedHotseatGuest",
        email: "dedicated-hotseat-guest@example.com",
        password: "PlayerPass123"
      }))?.ok,
      true
    );

    const matchState = createCompletedLocalMatchState({ mode: "local_pvp", winner: "p1" });
    const p1Result = await emitWithAck(p1, "profile:applyLocalHotseatResult", {
      perspective: "p1",
      matchState,
      settlementKey: "LPVP:dedicated:1"
    });
    const p2Result = await emitWithAck(p2, "profile:applyLocalHotseatResult", {
      perspective: "p2",
      matchState,
      settlementKey: "LPVP:dedicated:1"
    });

    const hostProfile = await coordinator.profiles.getProfile("DedicatedHotseatHost");
    const guestProfile = await coordinator.profiles.getProfile("DedicatedHotseatGuest");

    assert.equal(p1Result?.ok, true);
    assert.equal(p2Result?.ok, true);
    assert.ok((p1Result?.result?.matchResult?.xpDelta ?? 0) >= 1);
    assert.ok((p2Result?.result?.matchResult?.xpDelta ?? 0) >= 1);
    assert.equal(hostProfile.modeStats.local_pvp.gamesPlayed, 1);
    assert.equal(guestProfile.modeStats.local_pvp.gamesPlayed, 1);
    assert.equal(hostProfile.chests.basic, 0);
    assert.equal(guestProfile.chests.basic, 0);
    assert.equal(Object.keys(hostProfile.achievements ?? {}).length, 0);
    assert.equal(Object.keys(guestProfile.achievements ?? {}).length, 0);
  } finally {
    p1?.disconnect();
    p2?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer rewards: reward application retry after a persistence failure does not double-grant", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const originalUpdateProfile = coordinator.profiles.updateProfile.bind(coordinator.profiles);
  let shouldFailOnce = true;

  try {
    await coordinator.profiles.ensureProfile("RetryRewardUser");

    coordinator.profiles.updateProfile = async (...args) => {
      if (shouldFailOnce) {
        shouldFailOnce = false;
        throw new Error("Simulated reward persistence failure");
      }
      return originalUpdateProfile(...args);
    };

    await assert.rejects(() =>
      coordinator.applyOnlineRewardSettlementDecision({
        username: "RetryRewardUser",
        settlementKey: "ROOM100:match:1",
        rewardDecision: {
          participants: {
            hostUsername: "RetryRewardUser",
            guestUsername: "RetryOtherUser"
          },
          rewards: {
            host: { tokens: 25, xp: 20, basicChests: 1 },
            guest: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        participantRole: "host"
      })
    );

    coordinator.profiles.updateProfile = originalUpdateProfile;

    const retryGrant = await coordinator.applyOnlineRewardSettlementDecision({
      username: "RetryRewardUser",
      settlementKey: "ROOM100:match:1",
      rewardDecision: {
        participants: {
          hostUsername: "RetryRewardUser",
          guestUsername: "RetryOtherUser"
        },
        rewards: {
          host: { tokens: 25, xp: 20, basicChests: 1 },
          guest: { tokens: 5, xp: 5, basicChests: 0 }
        }
      },
      participantRole: "host"
    });

    const profile = await coordinator.profiles.getProfile("RetryRewardUser");
    assert.equal(retryGrant.duplicate, false);
    assert.equal(profile.tokens, DEFAULT_STARTING_TOKENS + 25);
    assert.equal(profile.playerXP, 20);
    assert.equal(profile.chests.basic, 1);
    assert.deepEqual(profile.onlineRewardSettlements?.appliedSettlementKeys, ["ROOM100:match:1"]);
  } finally {
    coordinator.profiles.updateProfile = originalUpdateProfile;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer rewards: rematch reset clears prior reward settlement and allows a new grant", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const settleCalls = [];
  const rewardPersister = async (payload) => {
    settleCalls.push({ roomCode: payload.room.roomCode, winner: payload.summary.winner });
    if (payload.decision?.participants?.hostUsername) {
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.hostUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "host"
      });
    }
    if (payload.decision?.participants?.guestUsername) {
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.guestUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "guest"
      });
    }
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister,
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "HostRematchRewardUser" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "GuestRematchRewardUser" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [...OPENING_WIN_SEQUENCE, ["earth", "wind"], ["wind", "water"], ["water", "fire"]];
    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const pair = exhaustionSequence[index];
      const [hostMove, guestMove] = pair;
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    assert.equal(settleCalls.length, 1);

    const firstReadyHostUpdate = waitForEvent(host, "room:update");
    const firstReadyGuestUpdate = waitForEvent(guest, "room:update");
    host.emit("room:readyRematch");
    await firstReadyHostUpdate;
    await firstReadyGuestUpdate;

    const resetHostUpdate = waitForEvent(host, "room:update");
    const resetGuestUpdate = waitForEvent(guest, "room:update");
    guest.emit("room:readyRematch");
    const resetRoom = await resetHostUpdate;
    await resetGuestUpdate;

    assert.equal(resetRoom.matchComplete, false);
    assert.equal(resetRoom.rewardSettlement, undefined);

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const pair = exhaustionSequence[index];
      const [hostMove, guestMove] = pair;
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    assert.equal(settleCalls.length, 2);

    const hostProfile = await coordinator.profiles.getProfile("HostRematchRewardUser");
    const guestProfile = await coordinator.profiles.getProfile("GuestRematchRewardUser");
    assert.equal(hostProfile.tokens, DEFAULT_STARTING_TOKENS + 50);
    assert.equal(hostProfile.playerXP, 40);
    assert.equal(hostProfile.chests.basic, 2);
    assert.equal(guestProfile.tokens, DEFAULT_STARTING_TOKENS + 10);
    assert.equal(guestProfile.playerXP, 10);
    assert.equal(guestProfile.chests.basic, 0);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer online stats: completed match persists winner and loser core stats and achievements exactly once", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const settleCalls = [];
  const rewardPersister = async (payload) => {
    settleCalls.push(payload.settlementKey);
    await createOnlinePersistencePersister(coordinator)(payload);
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister,
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "OnlineWinner" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "OnlineLoser" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    assert.equal(settleCalls.length, 1);

    const winnerProfile = await coordinator.profiles.getProfile("OnlineWinner");
    const loserProfile = await coordinator.profiles.getProfile("OnlineLoser");
    const saves = await coordinator.saves.listMatchResults();

    assert.equal(winnerProfile.gamesPlayed, 1);
    assert.equal(winnerProfile.wins, 1);
    assert.equal(winnerProfile.losses, 0);
    assert.equal(winnerProfile.winStreak, 1);
    assert.equal(winnerProfile.bestWinStreak, 1);
    assert.equal(winnerProfile.warsEntered, 0);
    assert.equal(winnerProfile.warsWon, 0);
    assert.equal(winnerProfile.longestWar, 0);
    assert.equal(winnerProfile.cardsCaptured, 8);
    assert.equal(winnerProfile.achievements.first_flame.count, 1);
    assert.ok((winnerProfile.achievements.flawless_victory?.count ?? 0) >= 1);
    assert.deepEqual(winnerProfile.modeStats.online_pvp, {
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 8,
      quickWins: 0,
      timeLimitWins: 0
    });

    assert.equal(loserProfile.gamesPlayed, 1);
    assert.equal(loserProfile.wins, 0);
    assert.equal(loserProfile.losses, 1);
    assert.equal(loserProfile.winStreak, 0);
    assert.equal(loserProfile.bestWinStreak, 0);
    assert.equal(loserProfile.warsEntered, 0);
    assert.equal(loserProfile.warsWon, 0);
    assert.equal(loserProfile.longestWar, 0);
    assert.equal(loserProfile.cardsCaptured, 0);
    assert.equal(loserProfile.achievements.first_flame?.count ?? 0, 0);
    assert.deepEqual(loserProfile.modeStats.online_pvp, {
      gamesPlayed: 1,
      wins: 0,
      losses: 1,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      quickWins: 0,
      timeLimitWins: 0
    });

    assert.equal(saves.filter((entry) => entry.mode === "online_pvp").length, 2);
    assert.ok(
      saves.some(
        (entry) =>
          entry.username === "OnlineWinner" &&
          entry.mode === "online_pvp" &&
          entry.unlockedAchievements.some((achievement) => achievement.id === "first_flame")
      )
    );

    const duplicateError = waitForEvent(host, "room:error");
    host.emit("room:submitMove", { move: "fire" });
    assert.deepEqual(await duplicateError, {
      code: "MATCH_COMPLETE",
      message: "Match is complete. Both players must ready a rematch first."
    });

    const savesAfterDuplicate = await coordinator.saves.listMatchResults();
    assert.equal(savesAfterDuplicate.filter((entry) => entry.mode === "online_pvp").length, 2);
    assert.equal((await coordinator.profiles.getProfile("OnlineWinner")).wins, 1);
    assert.equal((await coordinator.profiles.getProfile("OnlineLoser")).losses, 1);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer online stats: post-match disconnect after settlement does not corrupt settled results or duplicate them", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "SettledHostUser" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "SettledGuestUser" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const savesBeforeMigration = await coordinator.saves.listMatchResults();
    const guestWaitingUpdate = waitForEvent(guest, "room:update");
    host.disconnect();
    const closingRoom = await guestWaitingUpdate;
    const savesAfterMigration = await coordinator.saves.listMatchResults();

    assert.equal(closingRoom.status, "closing");
    assert.equal(closingRoom.host?.username, "SettledHostUser");
    assert.equal(closingRoom.guest?.username, "SettledGuestUser");
    assert.equal(closingRoom.disconnectState.active, true);
    assert.equal(closingRoom.disconnectState.disconnectedRole, "host");
    assert.equal(closingRoom.disconnectState.disconnectedUsername, "SettledHostUser");
    assert.equal(closingRoom.disconnectState.remainingUsername, "SettledGuestUser");
    assert.equal(closingRoom.rewardSettlement.summary.settledHostUsername, "SettledHostUser");
    assert.equal(closingRoom.rewardSettlement.summary.settledGuestUsername, "SettledGuestUser");
    assert.equal(savesBeforeMigration.filter((entry) => entry.mode === "online_pvp").length, 2);
    assert.equal(savesAfterMigration.filter((entry) => entry.mode === "online_pvp").length, 2);

    const settledHostProfile = await coordinator.profiles.getProfile("SettledHostUser");
    const settledGuestProfile = await coordinator.profiles.getProfile("SettledGuestUser");
    assert.equal(settledHostProfile.wins, 1);
    assert.equal(settledHostProfile.modeStats.online_pvp.wins, 1);
    assert.equal(settledHostProfile.dailyChallenges.daily.progress.matchesWon, 1);
    assert.equal(settledHostProfile.dailyChallenges.daily.progress.matchesPlayed, 1);
    assert.equal(settledHostProfile.achievements.first_flame.count, 1);
    assert.equal(settledGuestProfile.losses, 1);
    assert.equal(settledGuestProfile.modeStats.online_pvp.losses, 1);
    assert.equal(settledGuestProfile.dailyChallenges.daily.progress.matchesWon, 0);
    assert.equal(settledGuestProfile.dailyChallenges.daily.progress.matchesPlayed, 1);
    assert.equal(settledGuestProfile.achievements.first_flame?.count ?? 0, 0);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer disconnect hardening: active-match disconnect pauses room, preserves state, and resumes for the same player", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    roomReconnectTimeoutMs: 120,
    roomCleanupDelayMs: 120,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    disconnectTracker: createOnlineDisconnectTracker(coordinator),
    random: () => 0.05
  });
  let host = null;
  let guest = null;
  let reconnectClient = null;
  let unauthorizedClient = null;
  let guestSession = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);
    guestSession = await bootstrapSession(guest, "ResumeGuest");
    assert.equal(guestSession?.ok, true);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "ResumeHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "ResumeGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSync;
    await guestFirstSync;

    const hostPausedUpdate = waitForEvent(host, "room:update");
    guest.disconnect();
    const pausedRoom = await hostPausedUpdate;

    assert.equal(pausedRoom.matchComplete, false);
    assert.equal(pausedRoom.winner, null);
    assert.equal(pausedRoom.winReason, null);
    assert.equal(pausedRoom.status, "paused");
    assert.equal(pausedRoom.disconnectState.active, true);
    assert.equal(pausedRoom.disconnectState.disconnectedRole, "guest");
    assert.equal(pausedRoom.disconnectState.disconnectedUsername, "ResumeGuest");
    assert.equal(pausedRoom.disconnectState.remainingUsername, "ResumeHost");
    assert.ok(pausedRoom.disconnectState.expiresAt);
    assert.deepEqual(pausedRoom.hostHand, { fire: 1, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(pausedRoom.guestHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(pausedRoom.moveSync, {
      hostSubmitted: true,
      guestSubmitted: false,
      submittedCount: 1,
      bothSubmitted: false,
      updatedAt: pausedRoom.moveSync.updatedAt
    });

    const disconnectedProfile = await coordinator.profiles.ensureProfile("ResumeGuest");
    assert.equal(disconnectedProfile.onlineDisconnectTracking.totalLiveMatchDisconnects, 1);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 0);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 0);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.recentDisconnectTimestamps.length, 1);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.recentExpirationTimestamps.length, 0);

    unauthorizedClient = await connectClient(port);
    const reservedError = waitForEvent(unauthorizedClient, "room:error");
    unauthorizedClient.emit("room:join", { roomCode: room.roomCode, username: "Intruder" });
    assert.deepEqual(await reservedError, {
      code: "ROOM_RECONNECT_RESERVED",
      message: "This room is reserved for the disconnected player to resume."
    });

    reconnectClient = await connectClient(port);
    const resumedGuestSession = await resumeSession(reconnectClient, guestSession.session.token);
    assert.equal(resumedGuestSession?.ok, true);
    const reconnectJoined = waitForEvent(reconnectClient, "room:joined");
    const hostResumedUpdate = waitForEvent(host, "room:update");
    reconnectClient.emit("room:join", { roomCode: room.roomCode });
    const rejoinedRoom = await reconnectJoined;
    const resumedRoom = await hostResumedUpdate;

    assert.equal(rejoinedRoom.status, "full");
    assert.equal(rejoinedRoom.guest.username, "ResumeGuest");
    assert.equal(rejoinedRoom.guest.connected, true);
    assert.equal(rejoinedRoom.disconnectState.active, false);
    assert.equal(rejoinedRoom.disconnectState.reason, "match_resumed");
    assert.ok(rejoinedRoom.disconnectState.resumedAt);
    assert.deepEqual(rejoinedRoom.hostHand, pausedRoom.hostHand);
    assert.deepEqual(rejoinedRoom.guestHand, pausedRoom.guestHand);
    assert.deepEqual(rejoinedRoom.moveSync, pausedRoom.moveSync);
    assert.equal(rejoinedRoom.serverMatchState?.matchId, `${room.roomCode}:match:1`);
    assert.equal(rejoinedRoom.serverMatchState?.activeStep?.id, `${room.roomCode}:match:1:round:1:step:round:warDepth:0`);
    assert.equal(rejoinedRoom.serverMatchState?.pendingActions?.host?.selectedCard, "fire");
    assert.equal(rejoinedRoom.serverMatchState?.pendingActions?.guest, null);
    assert.equal(resumedRoom.disconnectState.reason, "match_resumed");

    const resumedProfile = await coordinator.profiles.ensureProfile("ResumeGuest");
    assert.equal(resumedProfile.onlineDisconnectTracking.totalLiveMatchDisconnects, 1);
    assert.equal(resumedProfile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 1);
    assert.equal(resumedProfile.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 0);
    assert.equal(resumedProfile.onlineDisconnectTracking.recentDisconnectTimestamps.length, 1);
    assert.equal(resumedProfile.onlineDisconnectTracking.recentExpirationTimestamps.length, 0);

    await wait(170);
    const roomAfterReconnectTimeoutWindow = foundation.roomStore.getRoom(room.roomCode);
    const profileAfterReconnectTimeoutWindow = await coordinator.profiles.ensureProfile("ResumeGuest");
    assert.equal(roomAfterReconnectTimeoutWindow?.status, "full");
    assert.equal(roomAfterReconnectTimeoutWindow?.disconnectState?.reason, "match_resumed");
    assert.equal(profileAfterReconnectTimeoutWindow.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 0);

    const saves = await coordinator.saves.listMatchResults();
    const hostProfile = await coordinator.profiles.getProfile("ResumeHost");
    const guestProfile = await coordinator.profiles.getProfile("ResumeGuest");
    assert.equal(saves.filter((entry) => entry.mode === "online_pvp").length, 0);
    assert.equal(hostProfile, null);
    assert.equal(guestProfile?.wins ?? 0, 0);
    assert.equal(guestProfile?.losses ?? 0, 0);
    assert.equal(guestProfile?.gamesPlayed ?? 0, 0);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    reconnectClient?.disconnect();
    unauthorizedClient?.disconnect();
    await foundation.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer disconnect hardening: reconnect preserves war state and both-submitted move state", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 1000,
    roomReconnectTimeoutMs: 120
  });
  let host = null;
  let guest = null;
  let reconnectClient = null;
  let guestSession = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);
    guestSession = await bootstrapSession(guest, "WarGuest");
    assert.equal(guestSession?.ok, true);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "WarHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "WarGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSync;
    await guestFirstSync;

    const hostBothSync = waitForEvent(host, "room:moveSync");
    const guestBothSync = waitForEvent(guest, "room:moveSync");
    const hostRoundResult = waitForEvent(host, "room:roundResult");
    const guestRoundResult = waitForEvent(guest, "room:roundResult");
    guest.emit("room:submitMove", { move: "fire" });
    await hostBothSync;
    await guestBothSync;
    await hostRoundResult;
    await guestRoundResult;

    const hostPausedUpdate = waitForEvent(host, "room:update");
    guest.disconnect();
    const pausedRoom = await hostPausedUpdate;

    assert.equal(pausedRoom.status, "paused");
    assert.equal(pausedRoom.warActive, true);
    assert.equal(pausedRoom.warDepth, 1);
    assert.deepEqual(pausedRoom.warPot, { host: ["fire"], guest: ["fire"] });
    assert.deepEqual(pausedRoom.moveSync, {
      hostSubmitted: true,
      guestSubmitted: true,
      submittedCount: 2,
      bothSubmitted: true,
      updatedAt: pausedRoom.moveSync.updatedAt
    });

    reconnectClient = await connectClient(port);
    const hostResumedUpdate = waitForEvent(host, "room:update");
    reconnectClient.emit("room:join", { roomCode: room.roomCode, username: "" });
    const reconnectError = await Promise.race([
      waitForEvent(reconnectClient, "room:error"),
      new Promise((resolve) => setTimeout(() => resolve(null), 30))
    ]);
    assert.deepEqual(reconnectError, {
      code: "ROOM_RECONNECT_RESERVED",
      message: "This room is reserved for the disconnected player to resume."
    });

    reconnectClient.disconnect();
    reconnectClient = await connectClient(port);
    const resumedGuestSession = await resumeSession(reconnectClient, guestSession.session.token);
    assert.equal(resumedGuestSession?.ok, true);
    const joinedRoomPromise = waitForEvent(reconnectClient, "room:joined");
    reconnectClient.emit("room:join", { roomCode: room.roomCode });
    const joinedRoom = await joinedRoomPromise;
    const resumedRoom = await hostResumedUpdate;

    assert.equal(joinedRoom.status, "full");
    assert.equal(joinedRoom.warActive, true);
    assert.equal(joinedRoom.warDepth, 1);
    assert.deepEqual(joinedRoom.warPot, { host: ["fire"], guest: ["fire"] });
    assert.deepEqual(joinedRoom.moveSync, pausedRoom.moveSync);
    assert.equal(resumedRoom.disconnectState.reason, "match_resumed");

    const [hostResetSync, guestResetSync] = await Promise.all([
      waitForEvent(host, "room:moveSync"),
      waitForEvent(reconnectClient, "room:moveSync")
    ]);
    assert.deepEqual(hostResetSync.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
    assert.equal(hostResetSync.warActive, true);
    assert.equal(guestResetSync.warActive, true);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    reconnectClient?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer disconnect hardening: duplicate reconnect resume is rejected after the slot is already reclaimed", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 1000,
    roomReconnectTimeoutMs: 120
  });
  let host = null;
  let guest = null;
  let reconnectClient = null;
  let duplicateReconnectClient = null;
  let guestSession = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);
    guestSession = await bootstrapSession(guest, "DuplicateResumeGuest");
    assert.equal(guestSession?.ok, true);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "DuplicateResumeHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "DuplicateResumeGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: "fire" });
    await hostFirstSync;
    await guestFirstSync;

    const hostPausedUpdate = waitForEvent(host, "room:update");
    guest.disconnect();
    await hostPausedUpdate;

    reconnectClient = await connectClient(port);
    const resumedGuestSession = await resumeSession(reconnectClient, guestSession.session.token);
    assert.equal(resumedGuestSession?.ok, true);
    const reconnectJoined = waitForEvent(reconnectClient, "room:joined");
    reconnectClient.emit("room:join", { roomCode: room.roomCode });
    const resumedRoom = await reconnectJoined;
    assert.equal(resumedRoom.status, "full");
    assert.equal(resumedRoom.guest.connected, true);

    duplicateReconnectClient = await connectClient(port);
    const duplicateResume = await resumeSession(duplicateReconnectClient, guestSession.session.token);
    assert.equal(duplicateResume?.ok, false);
    assert.deepEqual(duplicateResume?.error, {
      code: "SESSION_ALREADY_ACTIVE",
      message: "This online session is already active on another connection."
    });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    reconnectClient?.disconnect();
    duplicateReconnectClient?.disconnect();
    await foundation.stop();
  }
});

test("multiplayer disconnect hardening: timeout expiration becomes no contest and persists nothing", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    roomReconnectTimeoutMs: 60,
    roomCleanupDelayMs: 200,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    disconnectTracker: createOnlineDisconnectTracker(coordinator),
    random: () => 0.05
  });
  let host = null;
  let guest = null;
  let reconnectClient = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "NoContestHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "NoContestGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    await submitRoundPair(host, guest, "fire", "fire", 2);

    const hostPausedUpdate = waitForEvent(host, "room:update");
    guest.disconnect();
    const pausedRoom = await hostPausedUpdate;
    assert.equal(pausedRoom.status, "paused");
    assert.equal(pausedRoom.warActive, true);

    const hostExpiredUpdate = waitForEvent(host, "room:update");
    const expiredRoom = await hostExpiredUpdate;
    assert.equal(expiredRoom.status, "expired");
    assert.equal(expiredRoom.matchComplete, false);
    assert.equal(expiredRoom.winner, null);
    assert.equal(expiredRoom.winReason, null);
    assert.equal(expiredRoom.disconnectState.reason, "disconnect_timeout_expired");
    assert.ok(expiredRoom.closingAt);
    assert.equal(expiredRoom.rewardSettlement?.granted ?? false, false);

    const disconnectedProfile = await coordinator.profiles.ensureProfile("NoContestGuest");
    assert.equal(disconnectedProfile.onlineDisconnectTracking.totalLiveMatchDisconnects, 1);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 0);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 1);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.recentDisconnectTimestamps.length, 1);
    assert.equal(disconnectedProfile.onlineDisconnectTracking.recentExpirationTimestamps.length, 1);

    const hostProfile = await coordinator.profiles.getProfile("NoContestHost");
    const guestProfile = await coordinator.profiles.getProfile("NoContestGuest");
    const saves = await coordinator.saves.listMatchResults();
    assert.equal(hostProfile, null);
    assert.equal(guestProfile?.wins ?? 0, 0);
    assert.equal(guestProfile?.losses ?? 0, 0);
    assert.equal(guestProfile?.gamesPlayed ?? 0, 0);
    assert.equal(saves.filter((entry) => entry.mode === "online_pvp").length, 0);

    reconnectClient = await connectClient(port);
    const expiredError = waitForEvent(reconnectClient, "room:error");
    reconnectClient.emit("room:join", { roomCode: room.roomCode, username: "NoContestGuest" });
    assert.deepEqual(await expiredError, {
      code: "ROOM_EXPIRED",
      message: "This room has expired and can no longer be resumed."
    });

    await new Promise((resolve) => setTimeout(resolve, 260));
    const profileAfterCleanup = await coordinator.profiles.ensureProfile("NoContestGuest");
    assert.equal(profileAfterCleanup.onlineDisconnectTracking.totalLiveMatchDisconnects, 1);
    assert.equal(profileAfterCleanup.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 0);
    assert.equal(profileAfterCleanup.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 1);
    assert.equal(profileAfterCleanup.onlineDisconnectTracking.recentDisconnectTimestamps.length, 1);
    assert.equal(profileAfterCleanup.onlineDisconnectTracking.recentExpirationTimestamps.length, 1);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    reconnectClient?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer disconnect hardening: post-match disconnect preserves settlement and makes rematch unavailable", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    roomCleanupDelayMs: 200,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    disconnectTracker: createOnlineDisconnectTracker(coordinator),
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "CompletedHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "CompletedGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const savesBeforeDisconnect = await coordinator.saves.listMatchResults();
    const guestClosingUpdate = waitForEvent(guest, "room:update");
    host.disconnect();
    const closingRoom = await guestClosingUpdate;
    const savesAfterDisconnect = await coordinator.saves.listMatchResults();

    assert.equal(closingRoom.status, "closing");
    assert.equal(closingRoom.matchComplete, true);
    assert.equal(closingRoom.winner, "host");
    assert.equal(closingRoom.winReason, "hand_exhaustion");
    assert.equal(closingRoom.disconnectState.reason, "post_match_disconnect");
    assert.equal(closingRoom.rewardSettlement.summary.settledHostUsername, "CompletedHost");
    assert.equal(closingRoom.rewardSettlement.summary.settledGuestUsername, "CompletedGuest");
    assert.equal(savesBeforeDisconnect.filter((entry) => entry.mode === "online_pvp").length, 2);
    assert.equal(savesAfterDisconnect.filter((entry) => entry.mode === "online_pvp").length, 2);

    const hostProfile = await coordinator.profiles.ensureProfile("CompletedHost");
    const guestProfile = await coordinator.profiles.ensureProfile("CompletedGuest");
    assert.equal(hostProfile.onlineDisconnectTracking.totalLiveMatchDisconnects, 0);
    assert.equal(hostProfile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 0);
    assert.equal(hostProfile.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 0);
    assert.equal(guestProfile.onlineDisconnectTracking.totalLiveMatchDisconnects, 0);
    assert.equal(guestProfile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 0);
    assert.equal(guestProfile.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 0);

    const rematchError = waitForEvent(guest, "room:error");
    guest.emit("room:readyRematch");
    assert.deepEqual(await rematchError, {
      code: "REMATCH_UNAVAILABLE",
      message: "Rematch is unavailable because this room is closing."
    });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer disconnect hardening: post-match reconnect shows final authoritative state without reopening settlement", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    roomCleanupDelayMs: 200,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    disconnectTracker: createOnlineDisconnectTracker(coordinator),
    random: () => 0.05
  });
  let host = null;
  let guest = null;
  let reconnectHost = null;
  let hostSession = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);
    hostSession = await bootstrapSession(host, "ReconnectCompletedHost");
    assert.equal(hostSession?.ok, true);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "ReconnectCompletedHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "ReconnectCompletedGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const savesBeforeDisconnect = await coordinator.saves.listMatchResults();
    const guestClosingUpdate = waitForEvent(guest, "room:update");
    host.disconnect();
    const closingRoom = await guestClosingUpdate;
    assert.equal(closingRoom.status, "closing");
    assert.equal(closingRoom.matchComplete, true);
    assert.ok(closingRoom.rewardSettlement?.decision);

    reconnectHost = await connectClient(port);
    const resumedHostSession = await resumeSession(reconnectHost, hostSession.session.token);
    assert.equal(resumedHostSession?.ok, true);
    const reconnectJoined = waitForEvent(reconnectHost, "room:joined");
    reconnectHost.emit("room:join", { roomCode: room.roomCode });
    const resumedRoom = await reconnectJoined;
    const savesAfterReconnect = await coordinator.saves.listMatchResults();

    assert.equal(resumedRoom.status, "closing");
    assert.equal(resumedRoom.matchComplete, true);
    assert.equal(resumedRoom.winner, "host");
    assert.equal(resumedRoom.winReason, "hand_exhaustion");
    assert.equal(resumedRoom.disconnectState.active, false);
    assert.equal(resumedRoom.disconnectState.reason, "match_resumed");
    assert.ok(resumedRoom.rewardSettlement?.decision);
    assert.equal(resumedRoom.rewardSettlement.decision.matchId, `${room.roomCode}:match:1`);
    assert.equal(savesAfterReconnect.filter((entry) => entry.mode === "online_pvp").length, savesBeforeDisconnect.filter((entry) => entry.mode === "online_pvp").length);

    await wait(260);
    const roomAfterReconnectCleanupWindow = foundation.roomStore.getRoom(room.roomCode);
    assert.equal(roomAfterReconnectCleanupWindow?.status, "closing");
    assert.equal(roomAfterReconnectCleanupWindow?.disconnectState?.reason, "match_resumed");

    const rematchError = waitForEvent(reconnectHost, "room:error");
    reconnectHost.emit("room:readyRematch");
    assert.deepEqual(await rematchError, {
      code: "REMATCH_UNAVAILABLE",
      message: "Rematch is unavailable because this room is closing."
    });
  } finally {
    host?.disconnect();
    guest?.disconnect();
    reconnectHost?.disconnect();
    await foundation.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer online challenges: completed match updates progress exactly once and persists challenge rewards", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const rewardPersister = createOnlinePersistencePersister(coordinator);
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister,
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const seeded = await coordinator.profiles.ensureProfile("ChallengeRewardHost");
    await coordinator.profiles.updateProfile("ChallengeRewardHost", {
      ...seeded,
      dailyChallenges: {
        ...seeded.dailyChallenges,
        daily: {
          ...seeded.dailyChallenges.daily,
          selectedBonusChallengeIds: [
            "daily_hard_ai_win_1",
            "daily_local_pvp_match_1",
            "daily_comeback_win"
          ],
          progress: {
            ...seeded.dailyChallenges.daily.progress,
            matchesWon: 1
          }
        }
      }
    });

    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "ChallengeRewardHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "ChallengeRewardGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const hostProfile = await coordinator.profiles.getProfile("ChallengeRewardHost");
    const guestProfile = await coordinator.profiles.getProfile("ChallengeRewardGuest");
    const saves = await coordinator.saves.listMatchResults();
    const hostSave = saves.find(
      (entry) => entry.username === "ChallengeRewardHost" && entry.mode === "online_pvp"
    );

    assert.equal(hostProfile.dailyChallenges.daily.progress.matchesWon, 2);
    assert.equal(hostProfile.dailyChallenges.daily.progress.matchesPlayed, 1);
    assert.equal(hostProfile.tokens, DEFAULT_STARTING_TOKENS + 31);
    assert.equal(hostProfile.playerXP, 34);
    assert.equal(guestProfile.dailyChallenges.daily.progress.matchesWon, 0);
    assert.equal(guestProfile.dailyChallenges.daily.progress.matchesPlayed, 1);
    assert.ok(hostSave.dailyRewards.some((item) => item.id === "daily_win_1_match"));
    assert.ok(hostSave.dailyRewards.some((item) => item.id === "daily_win_2_matches"));
    assert.ok(hostSave.dailyRewards.some((item) => item.id === "daily_use_all_4_elements"));

    const duplicateError = waitForEvent(host, "room:error");
    host.emit("room:submitMove", { move: "fire" });
    await duplicateError;

    const hostProfileAfterDuplicate = await coordinator.profiles.getProfile("ChallengeRewardHost");
    assert.equal(hostProfileAfterDuplicate.dailyChallenges.daily.progress.matchesWon, 2);
    assert.equal(hostProfileAfterDuplicate.dailyChallenges.daily.progress.matchesPlayed, 1);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer hardening: concurrent completion retry paths do not persist settlement twice", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const settleCalls = [];
  const rewardPersister = async (payload) => {
    settleCalls.push(payload.settlementKey);
    await wait(80);
    const matchState = buildOnlineMatchStateFromRoom(payload.room);

    if (payload.decision?.participants?.hostUsername) {
      await coordinator.recordOnlineMatchResult({
        username: payload.decision.participants.hostUsername,
        perspective: "p1",
        matchState,
        settlementKey: payload.settlementKey
      });
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.hostUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "host"
      });
    }

    if (payload.decision?.participants?.guestUsername) {
      await coordinator.recordOnlineMatchResult({
        username: payload.decision.participants.guestUsername,
        perspective: "p2",
        matchState,
        settlementKey: payload.settlementKey
      });
      await coordinator.applyOnlineRewardSettlementDecision({
        username: payload.decision.participants.guestUsername,
        settlementKey: payload.settlementKey,
        rewardDecision: payload.decision,
        participantRole: "guest"
      });
    }
  };
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    roomCleanupDelayMs: 200,
    rewardPersister,
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "ConcurrentSettleHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "ConcurrentSettleGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let index = 0; index < exhaustionSequence.length - 1; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await submitRoundPair(host, guest, hostMove, guestMove, 2);
    }

    const [finalHostMove, finalGuestMove] = exhaustionSequence[exhaustionSequence.length - 1];
    const hostFirstSync = waitForEvent(host, "room:moveSync");
    const guestFirstSync = waitForEvent(guest, "room:moveSync");
    host.emit("room:submitMove", { move: finalHostMove });
    await hostFirstSync;
    await guestFirstSync;

    const guestRoundResult = waitForEvent(guest, "room:roundResult");
    const guestClosingUpdate = waitForEvent(guest, "room:update");
    guest.emit("room:submitMove", { move: finalGuestMove });
    host.disconnect();

    const finalRound = await guestRoundResult;
    const closingRoom = await guestClosingUpdate;
    await wait(140);

    const saves = await coordinator.saves.listMatchResults();
    const hostProfile = await coordinator.profiles.getProfile("ConcurrentSettleHost");
    const guestProfile = await coordinator.profiles.getProfile("ConcurrentSettleGuest");

    assert.equal(finalRound.matchComplete, true);
    assert.equal(closingRoom.status, "closing");
    assert.equal(settleCalls.length, 1);
    assert.deepEqual(settleCalls, [`${room.roomCode}:match:1`]);
    assert.deepEqual(hostProfile.onlineRewardSettlements?.appliedSettlementKeys, [`${room.roomCode}:match:1`]);
    assert.deepEqual(guestProfile.onlineRewardSettlements?.appliedSettlementKeys, [`${room.roomCode}:match:1`]);
    assert.equal(saves.filter((entry) => entry.mode === "online_pvp").length, 2);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer online challenges: rematch updates challenge progress again for the next match only", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    random: () => 0.05
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const createdPromise = waitForEvent(host, "room:created");
    host.emit("room:create", { username: "ChallengeRematchHost" });
    const room = await createdPromise;

    const joinedPromise = waitForEvent(guest, "room:joined");
    const hostJoinUpdatePromise = waitForEvent(host, "room:update");
    guest.emit("room:join", { roomCode: room.roomCode, username: "ChallengeRematchGuest" });
    await joinedPromise;
    await hostJoinUpdatePromise;

    const exhaustionSequence = [
      ...OPENING_WIN_SEQUENCE,
      ["earth", "wind"],
      ["wind", "water"],
      ["water", "fire"]
    ];

    for (let pass = 0; pass < 2; pass += 1) {
      for (let index = 0; index < exhaustionSequence.length; index += 1) {
        const [hostMove, guestMove] = exhaustionSequence[index];
        await submitRoundPair(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
      }

      if (pass === 0) {
        const firstReadyHostUpdate = waitForEvent(host, "room:update");
        const firstReadyGuestUpdate = waitForEvent(guest, "room:update");
        host.emit("room:readyRematch");
        await firstReadyHostUpdate;
        await firstReadyGuestUpdate;

        const resetHostUpdate = waitForEvent(host, "room:update");
        const resetGuestUpdate = waitForEvent(guest, "room:update");
        guest.emit("room:readyRematch");
        await resetHostUpdate;
        await resetGuestUpdate;
      }
    }

    const hostProfile = await coordinator.profiles.getProfile("ChallengeRematchHost");
    const guestProfile = await coordinator.profiles.getProfile("ChallengeRematchGuest");

    assert.equal(hostProfile.dailyChallenges.daily.progress.matchesWon, 2);
    assert.equal(hostProfile.dailyChallenges.daily.progress.matchesPlayed, 2);
    assert.equal(guestProfile.dailyChallenges.daily.progress.matchesWon, 0);
    assert.equal(guestProfile.dailyChallenges.daily.progress.matchesPlayed, 2);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
