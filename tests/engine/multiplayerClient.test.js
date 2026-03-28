import test from "node:test";
import assert from "node:assert/strict";

import { MultiplayerClient } from "../../src/main/multiplayer/multiplayerClient.js";

function createMockRoom({ roomCode, host, guest = null, status = "waiting" }) {
  return {
    roomCode,
    createdAt: "2026-03-20T12:00:00.000Z",
    host,
    guest,
    status,
    closingAt: null,
    disconnectState: null,
    hostScore: 0,
    guestScore: 0,
    roundNumber: 1,
    lastOutcomeType: null,
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: {
      hostReady: false,
      guestReady: false
    },
    rewardSettlement: null,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    warPot: { host: [], guest: [] },
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
  };
}

class FakeSocket {
  constructor() {
    this.id = "socket-1";
    this.connected = true;
    this.conn = { transport: { name: "websocket" } };
    this.listeners = new Map();
    this.sentEvents = [];
    this.sessionUsername = null;
    this.sessionAuthenticated = false;
    queueMicrotask(() => {
      this.serverEmit("connect");
    });
  }

  on(eventName, listener) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }

    this.listeners.get(eventName).add(listener);
    return this;
  }

  once(eventName, listener) {
    const wrapped = (...args) => {
      this.off(eventName, wrapped);
      listener(...args);
    };
    return this.on(eventName, wrapped);
  }

  off(eventName, listener) {
    this.listeners.get(eventName)?.delete(listener);
    return this;
  }

  emit(eventName, payload, ack) {
    this.sentEvents.push({ eventName, payload });

    if (eventName === "session:bootstrap") {
      queueMicrotask(() => {
        this.sessionUsername = payload?.username ?? null;
        this.sessionAuthenticated = false;
        ack?.({
          ok: true,
          session: {
            token: "session-token-1",
            sessionId: "session-id-1",
            username: this.sessionUsername,
            profileKey: this.sessionUsername,
            accountId: null,
            authenticated: false
          }
        });
      });
    }

    if (eventName === "auth:register" || eventName === "auth:login") {
      queueMicrotask(() => {
        this.sessionUsername = payload?.username ?? "RegisteredUser";
        this.sessionAuthenticated = true;
        ack?.({
          ok: true,
          account: {
            accountId: "account-id-1",
            email: payload?.email ?? "player@example.com",
            username: this.sessionUsername,
            profileKey: this.sessionUsername,
            createdAt: "2026-03-28T12:00:00.000Z",
            updatedAt: "2026-03-28T12:00:00.000Z"
          },
          session: {
            token: "session-token-1",
            sessionId: "session-id-1",
            username: this.sessionUsername,
            profileKey: this.sessionUsername,
            accountId: "account-id-1",
            authenticated: true
          }
        });
      });
    }

    if (eventName === "session:resume") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          session: {
            token: payload?.sessionToken ?? "session-token-1",
            sessionId: "session-id-1",
            username: "VampyrLee",
            profileKey: "VampyrLee",
            accountId: this.sessionAuthenticated ? "account-id-1" : null,
            authenticated: this.sessionAuthenticated
          }
        });
      });
    }

    if (eventName === "session:logout") {
      queueMicrotask(() => {
        this.sessionUsername = null;
        this.sessionAuthenticated = false;
        ack?.({ ok: true });
      });
    }

    if (eventName === "room:create") {
      queueMicrotask(() => {
        this.serverEmit(
          "room:created",
          createMockRoom({
            roomCode: "ABC123",
            host: {
              socketId: this.id,
              username: this.sessionUsername ?? payload?.username ?? null,
              equippedCosmetics: payload?.equippedCosmetics ?? null
            }
          })
        );
      });
    }

    if (eventName === "room:join") {
      queueMicrotask(() => {
        this.serverEmit(
          "room:joined",
          createMockRoom({
            roomCode: payload?.roomCode ?? "ABC123",
            status: "full",
            host: {
              socketId: "host-1",
              username: "ExistingHost",
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
                badge: "badge_arena_legend",
                title: "title_war_master"
              }
            },
            guest: {
              socketId: this.id,
              username: this.sessionUsername ?? payload?.username ?? null,
              equippedCosmetics: payload?.equippedCosmetics ?? null
            }
          })
        );
      });
    }

    if (eventName === "profile:get") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          profile: {
            authority: "server",
            source: "multiplayer",
            profile: {
              username: this.sessionUsername ?? payload?.username ?? null,
              tokens: 225,
              playerXP: 18,
              playerLevel: 1,
              equippedCosmetics: createEquippedCosmetics(),
              ownedCosmetics: {}
            },
            progression: {
              xp: {
                playerXP: 18,
                playerLevel: 1
              },
              dailyChallenges: { challenges: [] },
              weeklyChallenges: { challenges: [] },
              dailyLogin: { eligible: false }
            }
          }
        });
      });
    }

    return true;
  }

  disconnect() {
    this.connected = false;
    this.serverEmit("disconnect", "io client disconnect");
  }

  serverEmit(eventName, payload) {
    const listeners = [...(this.listeners.get(eventName) ?? [])];
    for (const listener of listeners) {
      listener(payload);
    }
  }
}

function createEquippedCosmetics() {
  return {
    avatar: "avatar_crystal_soul",
    background: "bg_verdant_shrine",
    cardBack: "cardback_arcane_galaxy",
    elementCardVariant: {
      fire: "fire_variant_crownfire",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_transparent_crystal",
      wind: "wind_variant_vortex_spirit"
    },
    badge: "badge_element_initiate",
    title: "title_apprentice"
  };
}

test("multiplayer client: room create emits equipped cosmetics in the socket payload", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const equippedCosmetics = createEquippedCosmetics();
  await client.createRoom({
    username: "VampyrLee",
    equippedCosmetics
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "VampyrLee"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:create",
    payload: {
      equippedCosmetics
    }
  });

  assert.deepEqual(client.getState().room?.host?.equippedCosmetics, equippedCosmetics);
});

test("multiplayer client: room join emits equipped cosmetics in the socket payload", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const equippedCosmetics = createEquippedCosmetics();
  await client.joinRoom({
    roomCode: "abc123",
    username: "VampyrLee",
    equippedCosmetics
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "VampyrLee"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:join",
    payload: {
      roomCode: "abc123",
      equippedCosmetics
    }
  });

  assert.deepEqual(client.getState().room?.guest?.equippedCosmetics, equippedCosmetics);
});

test("multiplayer client: server profile requests return authoritative snapshots", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const snapshot = await client.getProfile({
    username: "ServerOwnedUser"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "ServerOwnedUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:get",
    payload: {}
  });
  assert.equal(snapshot?.authority, "server");
  assert.equal(snapshot?.profile?.username, "ServerOwnedUser");
  assert.equal(snapshot?.progression?.xp?.playerXP, 18);
});

test("multiplayer client: authenticated login reuses the server-issued session for later room actions", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const loginResult = await client.login({
    email: "player@example.com",
    password: "password123"
  });

  assert.equal(loginResult?.ok, true);
  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "auth:login",
    payload: {
      email: "player@example.com",
      password: "password123"
    }
  });
  assert.equal(client.getState().session?.authenticated, true);
  assert.equal(client.getState().session?.accountId, "account-id-1");

  const equippedCosmetics = createEquippedCosmetics();
  await client.createRoom({
    equippedCosmetics
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:create",
    payload: {
      equippedCosmetics
    }
  });
});

test("multiplayer client: logout clears the stored session identity", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  await client.login({
    email: "player@example.com",
    password: "password123"
  });
  await client.logout();

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "session:logout",
    payload: {}
  });
  assert.equal(client.getState().session?.active, false);
  assert.equal(client.getState().session?.accountId, null);
  assert.equal(client.getState().session?.authenticated, false);
});
