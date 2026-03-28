import { buildOnlineMatchStateFromRoom, createMultiplayerFoundation } from "./foundation.js";
import { StateCoordinator } from "../state/stateCoordinator.js";
import { MultiplayerProfileAuthority } from "./profileAuthority.js";
import os from "node:os";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };

const SERVER_NAME = "EleMintz Server";
const PHASE_LABEL = "Online-Only Conversion — Phase 2B";
const ENVIRONMENT_LABEL = process.env.NODE_ENV === "production" ? "Production" : "Development";

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
const profileAuthority = new MultiplayerProfileAuthority({
  coordinator: stateCoordinator,
  logger: console
});

async function rewardPersister({ room, summary, settlementKey }) {
  const hostUsername = summary?.settledHostUsername ?? null;
  const guestUsername = summary?.settledGuestUsername ?? null;
  const onlineMatchState = buildOnlineMatchStateFromRoom(room);

  if (hostUsername) {
    await profileAuthority.applyMatchResult({
      username: hostUsername,
      perspective: "p1",
      result: onlineMatchState,
      settlementKey: settlementKey ? `${settlementKey}:${hostUsername}` : null,
      rewards: summary.hostRewards
    });
    console.info("[Match] Host rewards persisted", {
      roomCode: room?.roomCode ?? null,
      username: hostUsername,
      rewards: summary.hostRewards
    });
  }

  if (guestUsername) {
    await profileAuthority.applyMatchResult({
      username: guestUsername,
      perspective: "p2",
      result: onlineMatchState,
      settlementKey: settlementKey ? `${settlementKey}:${guestUsername}` : null,
      rewards: summary.guestRewards
    });
    console.info("[Match] Guest rewards persisted", {
      roomCode: room?.roomCode ?? null,
      username: guestUsername,
      rewards: summary.guestRewards
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

const server = createMultiplayerFoundation({ rewardPersister, disconnectTracker, profileAuthority });
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

server.start()
  .then((listeningPort) => {
    console.info(`[${SERVER_NAME}] Started`);
    console.info(`[${SERVER_NAME}] Version: ${packageJson.version}`);
    console.info(`[${SERVER_NAME}] Port: ${listeningPort}`);
    console.info(`[${SERVER_NAME}] Mode: ${ENVIRONMENT_LABEL}`);
    console.info(`[${SERVER_NAME}] Systems: Multiplayer ✔ | Profile Authority ✔`);
    console.info(`[${SERVER_NAME}] Phase: ${PHASE_LABEL}`);
  })
  .catch((error) => {
    console.error(`[${SERVER_NAME}] Failed to start`, {
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
