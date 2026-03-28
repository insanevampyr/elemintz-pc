import http from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { createRoomStore } from "./rooms.js";
import { getBasicChestDropChance, rollBasicChest } from "../shared/basicChestDrop.js";

const DEFAULT_PORT = 3001;
const ROUND_RESET_DELAY_MS = 1700;
const ROOM_CLEANUP_DELAY_MS = 30000;
const ROOM_RECONNECT_TIMEOUT_MS = 60000;
const MAX_SETTLED_USERNAME_LENGTH = 32;
export const MULTIPLAYER_FOUNDATION_PHASE = 22;
const DEVELOPMENT_PHASE_LABEL = "Online-Only Conversion — Phase 2B";

function logRoomEvent(logger, message, details = {}) {
  logger.info("[Multiplayer] " + message, details);
}

function logMatchEvent(logger, message, details = {}) {
  logger.info("[Match] " + message, details);
}

function normalizeSettledUsername(username) {
  const normalized = String(username ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SETTLED_USERNAME_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function buildSettledIdentity(room, logger = console) {
  const settledHostUsername = normalizeSettledUsername(room?.host?.username);
  const settledGuestUsername = normalizeSettledUsername(room?.guest?.username);

  if (
    settledHostUsername &&
    settledGuestUsername &&
    settledHostUsername === settledGuestUsername
  ) {
    logger?.warn?.("[OnlinePlay][Authority] duplicate room usernames cannot settle rewards", {
      username: settledHostUsername,
      roomCode: room?.roomCode ?? null
    });
    return {
      settledHostUsername: null,
      settledGuestUsername: null
    };
  }

  return {
    settledHostUsername,
    settledGuestUsername
  };
}

function rollChestDrop({ random, outcome, role, logger }) {
  const chance = getBasicChestDropChance(outcome, { mode: "online" });
  const awarded = rollBasicChest(outcome, { mode: "online", random });
  logger?.info?.("[OnlinePlay][Rewards] chest roll result", {
    role,
    outcome,
    chance,
    awarded
  });
  return awarded ? 1 : 0;
}

function buildRewardSummary(room, { random = Math.random, logger = console } = {}) {
  if (!room?.matchComplete || !room?.winner) {
    return null;
  }

  const settledIdentity = buildSettledIdentity(room, logger);

  if (room.winner === "draw") {
    const hostChest = rollChestDrop({
      random,
      outcome: "draw",
      role: "host",
      logger
    });
    const guestChest = rollChestDrop({
      random,
      outcome: "draw",
      role: "guest",
      logger
    });
    return {
      granted: true,
      winner: "draw",
      ...settledIdentity,
      hostRewards: { tokens: 10, xp: 10, basicChests: hostChest },
      guestRewards: { tokens: 10, xp: 10, basicChests: guestChest }
    };
  }

  if (room.winner === "host") {
    const hostChest = rollChestDrop({
      random,
      outcome: "win",
      role: "host",
      logger
    });
    const guestChest = rollChestDrop({
      random,
      outcome: "loss",
      role: "guest",
      logger
    });
    return {
      granted: true,
      winner: "host",
      ...settledIdentity,
      hostRewards: { tokens: 25, xp: 20, basicChests: hostChest },
      guestRewards: { tokens: 5, xp: 5, basicChests: guestChest }
    };
  }

  if (room.winner === "guest") {
    const hostChest = rollChestDrop({
      random,
      outcome: "loss",
      role: "host",
      logger
    });
    const guestChest = rollChestDrop({
      random,
      outcome: "win",
      role: "guest",
      logger
    });
    return {
      granted: true,
      winner: "guest",
      ...settledIdentity,
      hostRewards: { tokens: 5, xp: 5, basicChests: hostChest },
      guestRewards: { tokens: 25, xp: 20, basicChests: guestChest }
    };
  }

  return null;
}

function resolvePerspectiveResultFromRoomWinner(roomWinner) {
  if (roomWinner === "host") {
    return "p1";
  }

  if (roomWinner === "guest") {
    return "p2";
  }

  return "draw";
}

function resolvePerspectiveResultFromRound(entry) {
  if (entry?.hostResult === "win") {
    return "p1";
  }

  if (entry?.guestResult === "win") {
    return "p2";
  }

  return "none";
}

function buildOnlineHistoryFromRoundHistory(roundHistory = []) {
  const history = [];

  for (let index = 0; index < roundHistory.length; index += 1) {
    const entry = roundHistory[index];
    const outcomeType = String(entry?.outcomeType ?? "");

    if (outcomeType === "war") {
      let warClashes = 1;
      let resolvedWinner = "none";
      let capturedOpponentCards = 0;
      let cursor = index + 1;

      while (cursor < roundHistory.length) {
        const nextEntry = roundHistory[cursor];
        const nextOutcomeType = String(nextEntry?.outcomeType ?? "");

        if (nextOutcomeType === "war" || nextOutcomeType === "no_effect") {
          warClashes += 1;
          cursor += 1;
          continue;
        }

        if (nextOutcomeType === "war_resolved") {
          warClashes += 1;
          resolvedWinner = resolvePerspectiveResultFromRound(nextEntry);
          capturedOpponentCards = resolvedWinner === "p1" || resolvedWinner === "p2" ? warClashes : 0;
          cursor += 1;
        }

        break;
      }

      history.push({
        result: resolvedWinner,
        warClashes,
        capturedOpponentCards,
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      index = cursor - 1;
      continue;
    }

    if (outcomeType === "war_resolved") {
      history.push({
        result: resolvePerspectiveResultFromRound(entry),
        warClashes: 1,
        capturedOpponentCards: 1,
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    if (outcomeType === "resolved") {
      history.push({
        result: resolvePerspectiveResultFromRound(entry),
        warClashes: 0,
        capturedOpponentCards: entry?.hostResult === "win" || entry?.guestResult === "win" ? 1 : 0,
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    history.push({
      result: "none",
      warClashes: 0,
      capturedOpponentCards: 0,
      p1Card: String(entry?.hostMove ?? "").toLowerCase(),
      p2Card: String(entry?.guestMove ?? "").toLowerCase()
    });
  }

  return history;
}

function buildOnlineMatchStateFromRoom(room) {
  const history = buildOnlineHistoryFromRoundHistory(room?.roundHistory ?? []);

  return {
    status: "completed",
    endReason: room?.winReason ?? null,
    winner: resolvePerspectiveResultFromRoomWinner(room?.winner),
    mode: "online_pvp",
    round: Math.max(0, Number(room?.roundNumber ?? 1) - 1),
    history,
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: {
      totalCards: 16
    }
  };
}

export function createMultiplayerFoundation({
  port = Number(process.env.PORT) || DEFAULT_PORT,
  logger = console,
  random = Math.random,
  roundResetDelayMs = ROUND_RESET_DELAY_MS,
  roomCleanupDelayMs = ROOM_CLEANUP_DELAY_MS,
  roomReconnectTimeoutMs = ROOM_RECONNECT_TIMEOUT_MS,
  disconnectTracker = null,
  rewardPersister = null,
  profileAuthority = null
} = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const roomStore = createRoomStore({ random });
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const roomResetTimers = new Map();
  const roomCleanupTimers = new Map();
  const roomReconnectTimers = new Map();

  // Phase 18 foundation: private 2-player room lifecycle plus authoritative
  // move submission sync, round resolution, repeat-round reset, WAR chain
  // state, match-complete/rematch flow, and persistent online hand counts
  // plus hand-exhaustion match completion, reconnect pause/resume timeout,
  // no-contest disconnect expiry, disconnect countdown/reminder support,
  // silent disconnect tracking, online match reward settlement, state
  // clarity polish, and synced equipped cosmetic identity in room snapshots.
  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "elemintz-multiplayer",
      phase: MULTIPLAYER_FOUNDATION_PHASE,
      transport: "socket.io"
    });
  });

  function clearRoundReset(roomCode) {
    if (!roomCode) {
      return;
    }

    const existingTimer = roomResetTimers.get(roomCode);
    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    roomResetTimers.delete(roomCode);
  }

  function scheduleRoundReset(roomCode, { clearWarState = false } = {}) {
    clearRoundReset(roomCode);
    logger.info("[OnlinePlay][Server] scheduling round reset", {
      roomCode,
      delayMs: roundResetDelayMs,
      clearWarState
    });

    const timerId = setTimeout(() => {
      roomResetTimers.delete(roomCode);
      const resetRoom = roomStore.resetRound(roomCode, { clearWarState });
      if (!resetRoom) {
        return;
      }

      logger.info("[OnlinePlay][Server] round reset for next turn", {
        roomCode: resetRoom.roomCode,
        moveSync: resetRoom.moveSync
      });
      io.to(resetRoom.roomCode).emit("room:moveSync", resetRoom);
    }, roundResetDelayMs);

    timerId.unref?.();
    roomResetTimers.set(roomCode, timerId);
  }

  function clearRoomCleanup(roomCode) {
    if (!roomCode) {
      return;
    }

    const existingTimer = roomCleanupTimers.get(roomCode);
    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    roomCleanupTimers.delete(roomCode);
  }

  function clearReconnectExpiry(roomCode) {
    if (!roomCode) {
      return;
    }

    const existingTimer = roomReconnectTimers.get(roomCode);
    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    roomReconnectTimers.delete(roomCode);
  }

  function scheduleReconnectExpiry(roomCode) {
    if (!roomCode) {
      return null;
    }

    clearReconnectExpiry(roomCode);
    const expiresAt = new Date(Date.now() + roomReconnectTimeoutMs).toISOString();
    roomStore.setDisconnectExpiresAt(roomCode, expiresAt);
    logger.info("[OnlinePlay][Server] scheduling reconnect expiry", {
      roomCode,
      delayMs: roomReconnectTimeoutMs,
      expiresAt
    });

    const timerId = setTimeout(() => {
      roomReconnectTimers.delete(roomCode);
      const expiredRoom = roomStore.expireDisconnectedRoom(roomCode);
      if (!expiredRoom) {
        return;
      }

      if (typeof disconnectTracker === "function") {
        void disconnectTracker({
          type: "reconnect_timeout_expired",
          username: expiredRoom.disconnectState?.disconnectedUsername ?? null,
          roomCode,
          occurredAt: expiredRoom.disconnectState?.expiresAt ?? new Date().toISOString()
        });
      }

      scheduleRoomCleanup(roomCode);
      const nextRoom = roomStore.getRoom(roomCode) ?? expiredRoom;
      io.to(roomCode).emit("room:update", nextRoom);
      logger.info("[OnlinePlay][Server] reconnect window expired; room marked no contest", {
        roomCode
      });
    }, roomReconnectTimeoutMs);

    timerId.unref?.();
    roomReconnectTimers.set(roomCode, timerId);
    return expiresAt;
  }

  function scheduleRoomCleanup(roomCode) {
    if (!roomCode) {
      return null;
    }

    clearRoomCleanup(roomCode);
    const closingAt = new Date(Date.now() + roomCleanupDelayMs).toISOString();
    roomStore.setClosingAt(roomCode, closingAt);
    logger.info("[OnlinePlay][Server] scheduling room cleanup", {
      roomCode,
      delayMs: roomCleanupDelayMs,
      closingAt
    });

    const timerId = setTimeout(() => {
      roomCleanupTimers.delete(roomCode);
      roomStore.removeRoom(roomCode);
      logger.info("[OnlinePlay][Server] room cleaned up", {
        roomCode
      });
    }, roomCleanupDelayMs);

    timerId.unref?.();
    roomCleanupTimers.set(roomCode, timerId);
    return closingAt;
  }

  async function settleCompletedMatchRewards(room) {
    if (!room?.matchComplete) {
      return room;
    }

    if (room?.rewardSettlement?.granted) {
      logMatchEvent(logger, "Settlement skipped", {
        roomCode: room.roomCode,
        winner: room.winner
      });
      return room;
    }

    logMatchEvent(logger, "Settlement start", {
      roomCode: room.roomCode,
      winner: room.winner,
      hostUsername: room.host?.username ?? null,
      guestUsername: room.guest?.username ?? null
    });

    const authoritativeRoom = roomStore.getRoom(room.roomCode) ?? null;
    const settlementRoom = {
      ...room,
      host: authoritativeRoom?.host ?? room.host ?? null,
      guest: authoritativeRoom?.guest ?? room.guest ?? null
    };

    const summary = buildRewardSummary(settlementRoom, { random, logger });
    if (!summary) {
      return room;
    }

    logMatchEvent(logger, "Host reward package", {
      roomCode: room.roomCode,
      username: room.host?.username ?? null,
      rewards: summary.hostRewards
    });
    logMatchEvent(logger, "Guest reward package", {
      roomCode: room.roomCode,
      username: room.guest?.username ?? null,
      rewards: summary.guestRewards
    });

    try {
      if (typeof rewardPersister === "function") {
        await rewardPersister({
          room,
          summary,
          settlementKey: roomStore.getCurrentMatchSettlementKey(room.roomCode)
        });
      }
      logMatchEvent(logger, "Settlement persisted", {
        roomCode: room.roomCode,
        winner: summary.winner
      });
    } catch (error) {
      logger.error?.("[OnlinePlay][Rewards] persistence failed", {
        roomCode: room.roomCode,
        message: error?.message,
        stack: error?.stack
      });
      return room;
    }

    return roomStore.setRewardSettlement(room.roomCode, summary) ?? room;
  }

  io.on("connection", (socket) => {
    logRoomEvent(logger, "Client connected", {
      socketId: socket.id,
      transport: socket.conn.transport.name,
      phase: DEVELOPMENT_PHASE_LABEL
    });

    socket.on("room:create", (payload = {}) => {
      const result = roomStore.createRoom(socket, payload);

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      socket.join(result.room.roomCode);
      socket.emit("room:created", result.room);
      logRoomEvent(logger, "Room created", {
        roomCode: result.room.roomCode,
        username: result.room.host?.username ?? null,
        createdAt: result.room.createdAt ?? null
      });
    });

    socket.on("room:join", (payload = {}) => {
      const result = roomStore.joinRoom(socket, payload.roomCode, payload);

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      socket.join(result.room.roomCode);
      clearReconnectExpiry(result.room.roomCode);
      clearRoomCleanup(result.room.roomCode);
      if (result.reconnected && typeof disconnectTracker === "function") {
        void disconnectTracker({
          type: "reconnect_resume",
          username: String(payload?.username ?? "").trim() || null,
          roomCode: result.room.roomCode,
          occurredAt: result.room?.disconnectState?.resumedAt ?? new Date().toISOString()
        });
      }
      if (result.reconnected && result.room?.moveSync?.bothSubmitted && !result.room.matchComplete) {
        scheduleRoundReset(result.room.roomCode, {
          clearWarState: result.room.lastOutcomeType === "war_resolved"
        });
      }
      socket.emit("room:joined", result.room);
      io.to(result.room.roomCode).emit("room:update", result.room);
      const joinedUsername = String(payload?.username ?? "").trim();
      logRoomEvent(logger, result.reconnected ? "Player rejoined room" : "Player joined room", {
        roomCode: result.room.roomCode,
        username: joinedUsername || result.room.guest?.username || null,
        hostUsername: result.room.host?.username ?? null,
        guestUsername: result.room.guest?.username ?? null,
        status: result.room.status
      });
      if (result.room.status === "full" && Array.isArray(result.room.roundHistory) && result.room.roundHistory.length === 0) {
        logMatchEvent(logger, "Start", {
          roomCode: result.room.roomCode,
          hostUsername: result.room.host?.username ?? null,
          guestUsername: result.room.guest?.username ?? null
        });
      }
    });

    socket.on("room:submitMove", async (payload = {}) => {
      logger.info("[OnlinePlay][Server] room:submitMove received", {
        socketId: socket.id,
        move: payload?.move ?? null
      });
      const roomCode = roomStore.getRoomCodeForSocket(socket.id);
      const roomBefore = roomCode ? roomStore.getRoom(roomCode) : null;
      logger.info("[OnlinePlay][Server] submitMove validation context", {
        socketId: socket.id,
        roomCode,
        roomStatus: roomBefore?.status ?? null,
        hasHost: Boolean(roomBefore?.host),
        hasGuest: Boolean(roomBefore?.guest)
      });
      const result = roomStore.submitMove(socket.id, payload.move);
      logger.info("[OnlinePlay][Server] submitMove validation result", {
        socketId: socket.id,
        ok: result.ok,
        errorCode: result.error?.code ?? null,
        roomCode: result.room?.roomCode ?? roomCode
      });

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      if (result.room?.matchComplete) {
        const settledRoom = await settleCompletedMatchRewards(result.room);
        result.room = settledRoom;
        logMatchEvent(logger, "End", {
          roomCode: settledRoom.roomCode,
          winner: settledRoom.winner ?? "draw",
          hostUsername: settledRoom.host?.username ?? null,
          guestUsername: settledRoom.guest?.username ?? null,
          winReason: settledRoom.winReason ?? null
        });
        if (result.roundResult) {
          result.roundResult = {
            ...result.roundResult,
            ...(settledRoom.rewardSettlement ? { rewardSettlement: settledRoom.rewardSettlement } : {})
          };
        }
      }

      logger.info("[OnlinePlay][Server] broadcasting room:moveSync", {
        roomCode: result.room.roomCode,
        moveSync: result.room.moveSync
      });
      io.to(result.room.roomCode).emit("room:moveSync", result.room);

      if (result.roundResult) {
        logger.info("[OnlinePlay][Server] about to emit room:roundResult", result.roundResult);
        io.to(result.room.roomCode).emit("room:roundResult", result.roundResult);
        if (!result.room.matchComplete) {
          scheduleRoundReset(result.room.roomCode, {
            clearWarState: result.roundResult.outcomeType === "war_resolved"
          });
        }
      }
    });

    socket.on("room:sendTaunt", (payload = {}) => {
      const result = roomStore.sendTaunt(socket.id, payload.line);

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      io.to(result.room.roomCode).emit("room:update", result.room);
    });

    socket.on("room:readyRematch", () => {
      const result = roomStore.readyRematch(socket.id);

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      clearRoundReset(result.room.roomCode);
      io.to(result.room.roomCode).emit("room:update", result.room);
    });

    socket.on("profile:get", async (payload = {}, respond = () => {}) => {
      if (typeof profileAuthority?.getProfile !== "function") {
        respond({
          ok: false,
          error: {
            code: "PROFILE_AUTHORITY_UNAVAILABLE",
            message: "Server profile authority is not available."
          }
        });
        return;
      }

      try {
        const snapshot = await profileAuthority.getProfile(payload?.username);
        logRoomEvent(logger, "Profile snapshot served", {
          username: payload?.username ?? null,
          socketId: socket.id
        });
        respond({
          ok: true,
          profile: snapshot
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_READ_FAILED",
            message: String(error?.message ?? "Unable to read authoritative profile.")
          }
        });
      }
    });

    socket.on("disconnect", (reason) => {
      const roomResult = roomStore.removeSocket(socket.id);
      clearRoundReset(roomResult.removedRoomCode ?? roomResult.room?.roomCode ?? null);
      void (async () => {
        let nextRoom = roomResult.room;

        if (nextRoom?.matchComplete) {
          nextRoom = await settleCompletedMatchRewards(nextRoom);
        }

        if (nextRoom && roomResult.shouldScheduleReconnectExpiry && typeof disconnectTracker === "function") {
          await disconnectTracker({
            type: "live_match_disconnect",
            username: nextRoom.disconnectState?.disconnectedUsername ?? null,
            roomCode: nextRoom.roomCode,
            occurredAt:
              (nextRoom.disconnectState?.disconnectedRole === "host"
                ? nextRoom.host?.disconnectedAt
                : nextRoom.disconnectState?.disconnectedRole === "guest"
                  ? nextRoom.guest?.disconnectedAt
                  : null) ?? new Date().toISOString()
          });
        }

        if (nextRoom && roomResult.shouldScheduleReconnectExpiry) {
          scheduleReconnectExpiry(nextRoom.roomCode);
          nextRoom = roomStore.getRoom(nextRoom.roomCode) ?? nextRoom;
        }

        if (nextRoom && roomResult.shouldScheduleCleanup) {
          clearReconnectExpiry(nextRoom.roomCode);
          scheduleRoomCleanup(nextRoom.roomCode);
          nextRoom = roomStore.getRoom(nextRoom.roomCode) ?? nextRoom;
        }

        if (nextRoom) {
          io.to(nextRoom.roomCode).emit("room:update", nextRoom);
        }

        logRoomEvent(logger, "Client disconnected", {
          socketId: socket.id,
          reason,
          roomCode: nextRoom?.roomCode ?? roomResult.removedRoomCode ?? null,
          username:
            nextRoom?.disconnectState?.disconnectedUsername ??
            nextRoom?.host?.username ??
            nextRoom?.guest?.username ??
            null
        });
        if (nextRoom?.disconnectState?.disconnectedUsername) {
          logRoomEvent(logger, "Player left room", {
            roomCode: nextRoom.roomCode,
            username: nextRoom.disconnectState.disconnectedUsername,
            status: nextRoom.status
          });
        }
      })();
    });
  });

  let listeningPort = null;

  return {
    app,
    httpServer,
    io,
    roomStore,
    async start() {
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          httpServer.off("error", reject);
          listeningPort = httpServer.address()?.port ?? port;
          resolve();
        });
      });

      return listeningPort;
    },
    async stop() {
      io.removeAllListeners();
      for (const roomCode of roomResetTimers.keys()) {
        clearRoundReset(roomCode);
      }
      for (const roomCode of roomCleanupTimers.keys()) {
        clearRoomCleanup(roomCode);
      }
      for (const roomCode of roomReconnectTimers.keys()) {
        clearReconnectExpiry(roomCode);
      }
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    getPort() {
      return listeningPort;
    }
  };
}

export {
  DEFAULT_PORT,
  ROUND_RESET_DELAY_MS,
  ROOM_RECONNECT_TIMEOUT_MS,
  buildOnlineMatchStateFromRoom,
  buildRewardSummary
};
