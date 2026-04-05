import { buildOnlineMatchStateFromRoom, createMultiplayerFoundation } from "./foundation.js";
import { StateCoordinator } from "../state/stateCoordinator.js";
import { MultiplayerProfileAuthority } from "./profileAuthority.js";
import { MultiplayerAccountStore } from "./accountStore.js";
import { createTimestampedLogger } from "./logger.js";
import os from "node:os";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };

const PHASE_LABEL = "Shared Authoritative Achievements - Pass 2";
const ENVIRONMENT_LABEL = process.env.NODE_ENV === "production" ? "Production" : "Development";
const logger = createTimestampedLogger(console);

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
  logger
});
const accountStore = new MultiplayerAccountStore({
  dataDir: resolveStandaloneDataDir(),
  logger
});

async function rewardPersister({ room, summary, decision, settlementKey }) {
  const rewardDecision = decision ?? room?.rewardSettlement?.decision ?? null;
  const hostUsername = rewardDecision?.participants?.hostUsername ?? summary?.settledHostUsername ?? null;
  const guestUsername = rewardDecision?.participants?.guestUsername ?? summary?.settledGuestUsername ?? null;
  const onlineMatchState = buildOnlineMatchStateFromRoom(room);

  if (hostUsername) {
    await profileAuthority.applyMatchResult({
      username: hostUsername,
      perspective: "p1",
      result: onlineMatchState,
      settlementKey,
      rewardDecision,
      participantRole: "host"
    });
    logger.info("[Match] Host rewards persisted", {
      roomCode: room?.roomCode ?? null,
      username: hostUsername,
      rewards: rewardDecision?.rewards?.host ?? summary?.hostRewards ?? null,
      settlementKey: settlementKey ?? null
    });
  }

  if (guestUsername) {
    await profileAuthority.applyMatchResult({
      username: guestUsername,
      perspective: "p2",
      result: onlineMatchState,
      settlementKey,
      rewardDecision,
      participantRole: "guest"
    });
    logger.info("[Match] Guest rewards persisted", {
      roomCode: room?.roomCode ?? null,
      username: guestUsername,
      rewards: rewardDecision?.rewards?.guest ?? summary?.guestRewards ?? null,
      settlementKey: settlementKey ?? null
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

const server = createMultiplayerFoundation({
  rewardPersister,
  disconnectTracker,
  profileAuthority,
  accountStore,
  logger
});
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("[Multiplayer] shutting down", { signal });

  try {
    await server.stop();
  } catch (error) {
    logger.error("[Multiplayer] failed to shut down cleanly", {
      signal,
      message: error?.message,
      stack: error?.stack
    });
  }
}

server.start()
  .then((listeningPort) => {
    logger.info("Started");
    logger.info(`Version: ${packageJson.version}`);
    logger.info(`Port: ${listeningPort}`);
    logger.info(`Mode: ${ENVIRONMENT_LABEL}`);
    logger.info("Systems: Multiplayer ✔ | Profile Authority ✔");
    logger.info(`Phase: ${PHASE_LABEL}`);
  })
  .catch((error) => {
    logger.error("Failed to start", {
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
