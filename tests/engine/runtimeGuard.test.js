import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";
import {
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

test("runtime guard: multiplayer health reports phase 20", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} }
  });

  try {
    const port = await foundation.start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.phase, 20);
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
