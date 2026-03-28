import { buildOnlineMatchStateFromRoom, createMultiplayerFoundation } from "./foundation.js";
import { StateCoordinator } from "../state/stateCoordinator.js";
import os from "node:os";
import path from "node:path";

function resolveStandaloneDataDir() {
  if (process.env.ELEMINTZ_DATA_DIR) {
    return process.env.ELEMINTZ_DATA_DIR;
  }

  switch (process.platform) {
    case "win32":
      return path.join(os.homedir(), "AppData", "Roaming", "elemintz-pc", "elemintz-data");
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "elemintz-pc", "elemintz-data");
    default:
      return path.join(os.homedir(), ".config", "elemintz-pc", "elemintz-data");
  }
}

const stateCoordinator = new StateCoordinator({
  dataDir: resolveStandaloneDataDir()
});

async function rewardPersister({ room, summary, settlementKey }) {
  const hostUsername = summary?.settledHostUsername ?? null;
  const guestUsername = summary?.settledGuestUsername ?? null;
  const onlineMatchState = buildOnlineMatchStateFromRoom(room);

  if (hostUsername) {
    await stateCoordinator.recordOnlineMatchResult({
      username: hostUsername,
      perspective: "p1",
      matchState: onlineMatchState,
      settlementKey: settlementKey ? `${settlementKey}:${hostUsername}` : null
    });
    console.info("[OnlinePlay][Rewards] persisting host rewards", {
      username: hostUsername,
      rewards: summary.hostRewards
    });
    await stateCoordinator.grantOnlineMatchRewards({
      username: hostUsername,
      ...summary.hostRewards
    });
  }

  if (guestUsername) {
    await stateCoordinator.recordOnlineMatchResult({
      username: guestUsername,
      perspective: "p2",
      matchState: onlineMatchState,
      settlementKey: settlementKey ? `${settlementKey}:${guestUsername}` : null
    });
    console.info("[OnlinePlay][Rewards] persisting guest rewards", {
      username: guestUsername,
      rewards: summary.guestRewards
    });
    await stateCoordinator.grantOnlineMatchRewards({
      username: guestUsername,
      ...summary.guestRewards
    });
  }
}

async function disconnectTracker({ type, username, occurredAt }) {
  if (!username) {
    return;
  }

  if (type === "live_match_disconnect") {
    await stateCoordinator.recordOnlineLiveMatchDisconnect({ username, occurredAt });
    return;
  }

  if (type === "reconnect_resume") {
    await stateCoordinator.recordOnlineReconnectResume({ username });
    return;
  }

  if (type === "reconnect_timeout_expired") {
    await stateCoordinator.recordOnlineReconnectTimeoutExpiration({ username, occurredAt });
  }
}

const server = createMultiplayerFoundation({ rewardPersister, disconnectTracker });
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info("[Multiplayer] shutting down", { signal });

  try {
    await server.stop();
  } catch (error) {
    console.error("[Multiplayer] failed to shut down cleanly", {
      signal,
      message: error?.message,
      stack: error?.stack
    });
  }
}

server.start().catch((error) => {
  console.error("[Multiplayer] failed to start", {
    message: error?.message,
    stack: error?.stack
  });
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  shutdown("SIGINT").finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").finally(() => process.exit(0));
});
