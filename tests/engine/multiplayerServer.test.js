import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { io as createClient } from "socket.io-client";

import {
  MULTIPLAYER_FOUNDATION_PHASE,
  buildOnlineMatchStateFromRoom,
  buildRewardSummary,
  createMultiplayerFoundation
} from "../../src/multiplayer/foundation.js";
import { MultiplayerAccountStore } from "../../src/multiplayer/accountStore.js";
import { MultiplayerProfileAuthority } from "../../src/multiplayer/profileAuthority.js";
import { getTotalOwnedCards, updateMatchCompletion } from "../../src/multiplayer/rooms.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

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
  return async ({ room, summary, settlementKey }) => {
    const matchState = buildOnlineMatchStateFromRoom(room);
    const hostUsername = summary?.settledHostUsername ?? null;
    const guestUsername = summary?.settledGuestUsername ?? null;

    if (hostUsername) {
      await coordinator.recordOnlineMatchResult({
        username: hostUsername,
        perspective: "p1",
        matchState,
        settlementKey: settlementKey ? `${settlementKey}:${hostUsername}` : null
      });
      await coordinator.grantOnlineMatchRewards({
        username: hostUsername,
        ...summary.hostRewards
      });
    }

    if (guestUsername) {
      await coordinator.recordOnlineMatchResult({
        username: guestUsername,
        perspective: "p2",
        matchState,
        settlementKey: settlementKey ? `${settlementKey}:${guestUsername}` : null
      });
      await coordinator.grantOnlineMatchRewards({
        username: guestUsername,
        ...summary.guestRewards
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
    host.emit("room:sendTaunt", { line: "Your move." });

    const hostRoom = await hostTauntUpdate;
    const guestRoom = await guestTauntUpdate;

    assert.equal(hostRoom.taunts.length, 1);
    assert.equal(hostRoom.taunts[0].speaker, "HostTaunter");
    assert.equal(hostRoom.taunts[0].text, "Your move.");
    assert.equal(guestRoom.taunts[0].speaker, "HostTaunter");
    assert.equal(guestRoom.taunts[0].text, "Your move.");
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
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
    assert.deepEqual(hostUpdate, joinedRoom);
    assert.deepEqual(guestUpdate, joinedRoom);
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
    assert.deepEqual(guestMoveSync, hostMoveSync);

    const hostLaterSyncsPromise = waitForEvents(host, "room:moveSync", 2);
    const guestLaterSyncsPromise = waitForEvents(guest, "room:moveSync", 2);
    const hostRoundResultPromise = waitForEvent(host, "room:roundResult");
    const guestRoundResultPromise = waitForEvent(guest, "room:roundResult");
    guest.emit("room:submitMove", { move: "water" });

    const [hostBothSync, hostResetSync] = await hostLaterSyncsPromise;
    const [guestBothSync, guestResetSync] = await guestLaterSyncsPromise;
    const hostRoundResult = await hostRoundResultPromise;
    const guestRoundResult = await guestRoundResultPromise;

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
    assert.deepEqual(guestBothSync, hostBothSync);
    assert.deepEqual(hostRoundResult, {
      roomCode: room.roomCode,
      hostMove: "fire",
      guestMove: "water",
      round: 1,
      outcomeType: "resolved",
      hostScore: 0,
      guestScore: 1,
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
    assert.deepEqual(guestResetSync, hostResetSync);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
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
      code: "MOVE_ALREADY_SUBMITTED",
      message: "This player already submitted a move."
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
    guest.emit("room:submitMove", { move: "wind" });

    const roundResult = await roundResultPromise;
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
      hostResult: "no_effect",
      guestResult: "no_effect"
    });
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
    guest.emit("room:submitMove", { move: "fire" });

    const roundResult = await roundResultPromise;
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
      hostResult: "war",
      guestResult: "war"
    });
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
        guestResult: "lose"
      },
      {
        round: 2,
        hostMove: "fire",
        guestMove: "wind",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect"
      }
    ]);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
  }
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
    const repeatedWarResult = await Promise.all([
      waitForEvent(host, "room:roundResult"),
      (async () => {
        guest.emit("room:submitMove", { move: "water" });
        return waitForEvent(guest, "room:roundResult");
      })()
    ]);
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
      hostResult: "war",
      guestResult: "war"
    });
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
    guest.emit("room:submitMove", { move: "fire" });
    const result = await warResolved;
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
      hostResult: "win",
      guestResult: "lose"
    });
    assert.equal(resetSync.hostScore, 1);
    assert.equal(resetSync.guestScore, 0);
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
  const rewardPersister = async ({ room, summary }) => {
    settleCalls.push({ roomCode: room.roomCode, winner: summary.winner });
    if (room.host?.username) {
      await coordinator.grantOnlineMatchRewards({
        username: room.host.username,
        ...summary.hostRewards
      });
    }
    if (room.guest?.username) {
      await coordinator.grantOnlineMatchRewards({
        username: room.guest.username,
        ...summary.guestRewards
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
    assert.equal(hostProfile.tokens, 225);
    assert.equal(hostProfile.playerXP, 20);
    assert.equal(hostProfile.chests.basic, 1);
    assert.equal(guestProfile.tokens, 205);
    assert.equal(guestProfile.playerXP, 5);
    assert.equal(guestProfile.chests.basic, 0);

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

test("multiplayer rewards: rematch reset clears prior reward settlement and allows a new grant", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const settleCalls = [];
  const rewardPersister = async ({ room, summary }) => {
    settleCalls.push({ roomCode: room.roomCode, winner: summary.winner });
    if (room.host?.username) {
      await coordinator.grantOnlineMatchRewards({
        username: room.host.username,
        ...summary.hostRewards
      });
    }
    if (room.guest?.username) {
      await coordinator.grantOnlineMatchRewards({
        username: room.guest.username,
        ...summary.guestRewards
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
    assert.equal(hostProfile.tokens, 250);
    assert.equal(hostProfile.playerXP, 40);
    assert.equal(hostProfile.chests.basic, 2);
    assert.equal(guestProfile.tokens, 210);
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
    assert.equal(resumedRoom.disconnectState.reason, "match_resumed");

    const resumedProfile = await coordinator.profiles.ensureProfile("ResumeGuest");
    assert.equal(resumedProfile.onlineDisconnectTracking.totalLiveMatchDisconnects, 1);
    assert.equal(resumedProfile.onlineDisconnectTracking.totalSuccessfulReconnectResumes, 1);
    assert.equal(resumedProfile.onlineDisconnectTracking.totalReconnectTimeoutExpirations, 0);
    assert.equal(resumedProfile.onlineDisconnectTracking.recentDisconnectTimestamps.length, 1);
    assert.equal(resumedProfile.onlineDisconnectTracking.recentExpirationTimestamps.length, 0);

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
    assert.equal(hostProfile.tokens, 233);
    assert.equal(hostProfile.playerXP, 38);
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
