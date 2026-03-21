import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { io as createClient } from "socket.io-client";

import { buildOnlineMatchStateFromRoom, createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { onlinePlayScreen } from "../../src/renderer/ui/screens/onlinePlayScreen.js";

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

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-online-challenge-validation-"));
}

async function createFullRoom(host, guest, hostUsername, guestUsername) {
  const createdPromise = waitForEvent(host, "room:created");
  host.emit("room:create", { username: hostUsername });
  const room = await createdPromise;

  const joinedPromise = waitForEvent(guest, "room:joined");
  const hostJoinUpdatePromise = waitForEvent(host, "room:update");
  guest.emit("room:join", { roomCode: room.roomCode, username: guestUsername });
  await joinedPromise;
  await hostJoinUpdatePromise;

  return room;
}

async function playRound(host, guest, hostMove, guestMove, laterSyncCount = 2) {
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

  await hostRoundResult;
  await guestRoundResult;
  await hostLaterSyncs;
  await guestLaterSyncs;
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

test("online challenge mapping: completed online match using all four elements increments shared challenge progress", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} },
    roundResetDelayMs: 20,
    rewardPersister: createOnlinePersistencePersister(coordinator),
    random: () => 0.99
  });
  let host = null;
  let guest = null;

  try {
    const port = await foundation.start();
    host = await connectClient(port);
    guest = await connectClient(port);

    const room = await createFullRoom(host, guest, "ElementsHost", "ElementsGuest");
    const exhaustionSequence = [
      ["fire", "earth"],
      ["water", "fire"],
      ["earth", "wind"],
      ["wind", "water"],
      ["fire", "earth"],
      ["water", "fire"],
      ["earth", "wind"],
      ["wind", "water"]
    ];

    for (let index = 0; index < exhaustionSequence.length; index += 1) {
      const [hostMove, guestMove] = exhaustionSequence[index];
      await playRound(host, guest, hostMove, guestMove, index === exhaustionSequence.length - 1 ? 1 : 2);
    }

    const hostProfile = await coordinator.profiles.ensureProfile("ElementsHost");
    const hostChallenges = await coordinator.getDailyChallenges("ElementsHost");

    assert.equal(hostProfile.dailyChallenges.daily.progress.matchesPlayed, 1);
    assert.equal(hostProfile.dailyChallenges.weekly.progress.matchesPlayed, 1);
    assert.equal(hostProfile.dailyChallenges.daily.progress.usedAllElementsInMatch, 1);
    assert.equal(hostProfile.dailyChallenges.weekly.progress.usedAllElementsInMatch, 1);
    assert.equal(
      hostChallenges.daily.challenges.find((item) => item.id === "daily_use_all_4_elements")?.progress ?? 0,
      1
    );
    assert.equal(
      hostChallenges.weekly.challenges.find((item) => item.id === "weekly_use_all_4_elements_10x")?.progress ?? 0,
      1
    );
    assert.equal(foundation.roomStore.getRoom(room.roomCode)?.matchComplete ?? false, true);
  } finally {
    host?.disconnect();
    guest?.disconnect();
    await foundation.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("online challenge mapping: WAR outcomes increment WAR challenge progress and screen counters stay separated", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });

  try {
    await coordinator.profiles.ensureProfile("WarHost");
    await coordinator.profiles.updateProfile("WarHost", {
      ...(await coordinator.profiles.ensureProfile("WarHost")),
      chests: { basic: 2, epic: 0, legendary: 0 }
    });
    await coordinator.profiles.ensureProfile("WarGuest");

    const matchState = buildOnlineMatchStateFromRoom({
      winner: "host",
      winReason: "hand_exhaustion",
      roundNumber: 8,
      roundHistory: [
        { hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war" },
        { hostMove: "water", guestMove: "fire", outcomeType: "war_resolved", hostResult: "win", guestResult: "lose" },
        { hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose" },
        { hostMove: "wind", guestMove: "water", outcomeType: "resolved", hostResult: "win", guestResult: "lose" },
        { hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose" },
        { hostMove: "water", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose" },
        { hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose" }
      ]
    });

    await coordinator.recordOnlineMatchResult({
      username: "WarHost",
      perspective: "p1",
      matchState,
      settlementKey: "validation:war-host"
    });

    const hostProfile = await coordinator.profiles.ensureProfile("WarHost");
    const challengeView = await coordinator.getDailyChallenges("WarHost");

    assert.equal(hostProfile.dailyChallenges.daily.progress.matchesPlayed, 1);
    assert.equal(hostProfile.dailyChallenges.weekly.progress.matchesPlayed, 1);
    assert.equal(hostProfile.dailyChallenges.daily.progress.warsWon, 1);
    assert.equal(hostProfile.dailyChallenges.weekly.progress.warsWon, 1);

    const html = onlinePlayScreen.render({
      backgroundImage: "",
      profile: hostProfile,
      multiplayer: {
        connectionStatus: "connected",
        room: {
          roomCode: "WAR123",
          status: "full",
          host: { socketId: "local-socket", username: "WarHost" },
          guest: { socketId: "guest-socket", username: "WarGuest" },
          rewardSettlement: {
            granted: true,
            summary: {
              settledHostUsername: "WarHost",
              settledGuestUsername: "WarGuest",
              hostRewards: { tokens: 25, xp: 20, basicChests: 0 },
              guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          matchComplete: true,
          winner: "host",
          winReason: "hand_exhaustion",
          rematch: { hostReady: false, guestReady: false }
        }
      },
      onlineChallengeSummary: {
        daily: challengeView.daily,
        weekly: challengeView.weekly
      }
    });

    assert.match(html, /Basic Chests Waiting:<\/strong> 2 Basic Chests/);
    assert.ok(!html.includes("Rewards Ready/Claimed"));
    assert.match(html, /Visible Completed:<\/strong> \d+/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
