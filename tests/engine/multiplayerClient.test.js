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

  emit(eventName, payload) {
    this.sentEvents.push({ eventName, payload });

    if (eventName === "room:create") {
      queueMicrotask(() => {
        this.serverEmit(
          "room:created",
          createMockRoom({
            roomCode: "ABC123",
            host: {
              socketId: this.id,
              username: payload?.username ?? null,
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
              username: payload?.username ?? null,
              equippedCosmetics: payload?.equippedCosmetics ?? null
            }
          })
        );
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

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:create",
    payload: {
      username: "VampyrLee",
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

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:join",
    payload: {
      roomCode: "abc123",
      username: "VampyrLee",
      equippedCosmetics
    }
  });

  assert.deepEqual(client.getState().room?.guest?.equippedCosmetics, equippedCosmetics);
});
