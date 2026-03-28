import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

class InvalidResumeSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "session:resume") {
      this.sentEvents.push({ eventName, payload });
      queueMicrotask(() => {
        ack?.({
          ok: false,
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Stored session is no longer valid."
          }
        });
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class AuthRequiredProfileSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "profile:get") {
      this.sentEvents.push({ eventName, payload });
      queueMicrotask(() => {
        ack?.({
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "Session expired. Please sign in again."
          }
        });
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-mp-client-"));
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
  const dataDir = await createTempDataDir();
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} },
    dataDir
  });

  try {
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
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: logout clears the stored session identity", async () => {
  let lastSocket = null;
  const dataDir = await createTempDataDir();
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} },
    dataDir
  });

  try {
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

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: hotseat identity authentication uses an isolated account session without replacing the primary session", async () => {
  const sockets = [];
  const client = new MultiplayerClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  const loginResult = await client.login({
    email: "player@example.com",
    password: "password123"
  });
  assert.equal(loginResult?.ok, true);

  const resolved = await client.authenticateHotseatIdentity({
    mode: "register",
    username: "HotseatGuest",
    email: "guest@example.com",
    password: "guestpassword"
  });

  assert.equal(resolved?.ok, true);
  assert.equal(resolved?.profile?.profile?.username, "HotseatGuest");
  assert.equal(client.getState().session?.authenticated, true);
  assert.equal(client.getState().session?.username, "RegisteredUser");
  assert.equal(sockets.length, 2);
  assert.deepEqual(sockets[1].sentEvents.map((entry) => entry.eventName), [
    "auth:register",
    "profile:get",
    "session:logout"
  ]);
});

test("multiplayer client: authenticated session restores from persisted storage on app restart", async () => {
  const dataDir = await createTempDataDir();
  let firstSocket = null;
  let secondSocket = null;

  try {
    const firstClient = new MultiplayerClient({
      socketFactory: () => {
        firstSocket = new FakeSocket();
        return firstSocket;
      },
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    await firstClient.login({
      email: "player@example.com",
      password: "password123"
    });

    const secondClient = new MultiplayerClient({
      socketFactory: () => {
        secondSocket = new FakeSocket();
        secondSocket.sessionAuthenticated = true;
        secondSocket.sessionUsername = "RegisteredUser";
        return secondSocket;
      },
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    const restoreResult = await secondClient.restoreSession();

    assert.equal(restoreResult?.ok, true);
    assert.equal(restoreResult?.restored, true);
    assert.deepEqual(secondSocket.sentEvents.at(0), {
      eventName: "session:resume",
      payload: {
        sessionToken: "session-token-1"
      }
    });
    assert.equal(secondClient.getState().session?.authenticated, true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: expired persisted session is cleared before restore connects", async () => {
  const dataDir = await createTempDataDir();
  let socketCreated = false;

  try {
    await fs.writeFile(
      path.join(dataDir, "multiplayer-session.json"),
      JSON.stringify({
        schemaVersion: 1,
        session: {
          token: "expired-token",
          serverUrl: "http://127.0.0.1:3001",
          username: "ExpiredUser",
          sessionId: "expired-session-id",
          accountId: "expired-account-id",
          profileKey: "ExpiredUser",
          authenticated: true,
          persistedAt: "2026-03-01T00:00:00.000Z"
        }
      }),
      "utf8"
    );

    const originalNow = Date.now;
    Date.now = () => Date.parse("2026-03-28T12:00:00.000Z");
    try {
      const client = new MultiplayerClient({
        socketFactory: () => {
          socketCreated = true;
          return new FakeSocket();
        },
        logger: { info: () => {}, error: () => {} },
        dataDir
      });

      const restoreResult = await client.restoreSession();

      assert.equal(restoreResult?.ok, false);
      assert.equal(restoreResult?.invalid, true);
      assert.equal(restoreResult?.error?.code, "SESSION_EXPIRED");
      assert.equal(socketCreated, false);
      assert.equal(client.getState().session?.authenticated, false);
    } finally {
      Date.now = originalNow;
    }

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: invalid persisted session is cleared during restore", async () => {
  const dataDir = await createTempDataDir();

  try {
    await fs.writeFile(
      path.join(dataDir, "multiplayer-session.json"),
      JSON.stringify({
        schemaVersion: 1,
        session: {
          token: "stale-token",
          serverUrl: "http://127.0.0.1:3001",
          username: "StaleUser",
          sessionId: "stale-session-id",
          accountId: "stale-account-id",
          profileKey: "StaleUser",
          authenticated: true,
          persistedAt: "2026-03-28T15:00:00.000Z"
        }
      }),
      "utf8"
    );

    const client = new MultiplayerClient({
      socketFactory: () => new InvalidResumeSocket(),
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    const restoreResult = await client.restoreSession();

    assert.equal(restoreResult?.ok, false);
    assert.equal(restoreResult?.invalid, true);
    assert.equal(client.getState().session?.authenticated, false);

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: invalid authenticated server request clears session state", async () => {
  let lastSocket = null;
  const dataDir = await createTempDataDir();

  try {
    const client = new MultiplayerClient({
      socketFactory: () => {
        lastSocket = new AuthRequiredProfileSocket();
        return lastSocket;
      },
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    await client.login({
      email: "player@example.com",
      password: "password123"
    });

    const snapshot = await client.getProfile({
      username: "RegisteredUser"
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(snapshot, null);
    assert.equal(client.getState().session?.authenticated, false);
    assert.equal(client.getState().lastError?.code, "AUTH_REQUIRED");
    assert.equal(lastSocket.connected, false);

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
