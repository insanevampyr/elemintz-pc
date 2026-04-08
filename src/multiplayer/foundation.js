import http from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { createRoomStore } from "./rooms.js";
import { createSessionStore } from "./sessionStore.js";
import { DEFAULT_TIMESTAMPED_LOGGER } from "./logger.js";
import { getBasicChestDropChance, rollBasicChest } from "../shared/basicChestDrop.js";
import { getCosmeticDefinition } from "../state/cosmeticSystem.js";

const DEFAULT_PORT = 3001;
const ROUND_RESET_DELAY_MS = 1700;
const ROOM_CLEANUP_DELAY_MS = 30000;
const ROOM_RECONNECT_TIMEOUT_MS = 60000;
const MAX_SETTLED_USERNAME_LENGTH = 32;
const VALID_ADMIN_CHEST_TYPES = new Set(["basic", "milestone", "epic", "legendary"]);
export const MULTIPLAYER_FOUNDATION_PHASE = 22;
const DEVELOPMENT_PHASE_LABEL = "Shared Authoritative Achievements - Pass 2";

function logRoomEvent(logger, message, details = {}) {
  logger.info("[Multiplayer] " + message, details);
}

function logMatchEvent(logger, message, details = {}) {
  logger.info("[Match] " + message, details);
}

function toAckCallback(respond) {
  return typeof respond === "function" ? respond : () => {};
}

function cloneAuthoritativeEquippedCosmetics(equippedCosmetics) {
  if (!equippedCosmetics || typeof equippedCosmetics !== "object" || Array.isArray(equippedCosmetics)) {
    return null;
  }

  return {
    avatar: equippedCosmetics.avatar ?? null,
    background: equippedCosmetics.background ?? null,
    cardBack: equippedCosmetics.cardBack ?? null,
    elementCardVariant:
      equippedCosmetics.elementCardVariant &&
      typeof equippedCosmetics.elementCardVariant === "object" &&
      !Array.isArray(equippedCosmetics.elementCardVariant)
        ? {
            fire: equippedCosmetics.elementCardVariant.fire ?? null,
            water: equippedCosmetics.elementCardVariant.water ?? null,
            earth: equippedCosmetics.elementCardVariant.earth ?? null,
            wind: equippedCosmetics.elementCardVariant.wind ?? null
          }
        : null,
    title: equippedCosmetics.title ?? null,
    badge: equippedCosmetics.badge ?? null
  };
}

async function attachAuthoritativeOnlineCosmetics(payload, session, profileAuthority, logger) {
  const basePayload =
    payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  const authorityUsername = session?.profileKey ?? session?.username ?? null;

  if (!authorityUsername || typeof profileAuthority?.getProfile !== "function") {
    return basePayload;
  }

  try {
    const profileSnapshot = await profileAuthority.getProfile(authorityUsername);
    const authoritativeEquipped = cloneAuthoritativeEquippedCosmetics(
      profileSnapshot?.cosmetics?.snapshot?.equipped ??
        profileSnapshot?.profile?.equippedCosmetics ??
        null
    );

    return authoritativeEquipped
      ? {
          ...basePayload,
          equippedCosmetics: authoritativeEquipped
        }
      : {
          ...basePayload,
          equippedCosmetics: undefined
        };
  } catch (error) {
    logger?.warn?.("[OnlinePlay][Cosmetics] failed to load authoritative cosmetics for room payload", {
      username: authorityUsername,
      message: error?.message ?? String(error)
    });

    return {
      ...basePayload,
      equippedCosmetics: undefined
    };
  }
}

function normalizeSettledUsername(username) {
  const normalized = String(username ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SETTLED_USERNAME_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function normalizeAdminTransactionId(transactionId) {
  const normalized = String(transactionId ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeAdminChestEntries(chests) {
  return (Array.isArray(chests) ? chests : [])
    .map((entry) => ({
      chestType: String(entry?.chestType ?? "").trim(),
      amount: Math.max(0, Math.floor(Number(entry?.amount ?? 0) || 0))
    }))
    .filter((entry) => entry.amount > 0 && VALID_ADMIN_CHEST_TYPES.has(entry.chestType));
}

function sanitizeAdminCosmeticEntry(cosmetic) {
  if (!cosmetic || typeof cosmetic !== "object") {
    return null;
  }

  const type = String(cosmetic.type ?? "").trim();
  const cosmeticId = String(cosmetic.cosmeticId ?? "").trim();
  if (!type || !cosmeticId) {
    return null;
  }

  return {
    type,
    cosmeticId
  };
}

function formatAdminCosmeticSummary(cosmetic) {
  const safeCosmetic = sanitizeAdminCosmeticEntry(cosmetic);
  if (!safeCosmetic) {
    return null;
  }

  const definition = getCosmeticDefinition(safeCosmetic.type, safeCosmetic.cosmeticId);
  return definition?.name ?? `${safeCosmetic.type}:${safeCosmetic.cosmeticId}`;
}

function formatAdminGrantSummary({ xp = 0, tokens = 0, chests = [], cosmetic = null } = {}) {
  const parts = [];
  const safeXp = Math.max(0, Math.floor(Number(xp ?? 0) || 0));
  const safeTokens = Math.max(0, Math.floor(Number(tokens ?? 0) || 0));
  const safeChests = sanitizeAdminChestEntries(chests);
  const cosmeticLabel = formatAdminCosmeticSummary(cosmetic);

  if (safeXp > 0) {
    parts.push(`${safeXp} XP`);
  }
  if (safeTokens > 0) {
    parts.push(`${safeTokens} Tokens`);
  }
  for (const entry of safeChests) {
    const chestLabel = `${entry.amount} ${entry.chestType.charAt(0).toUpperCase()}${entry.chestType.slice(1)} Chest${entry.amount === 1 ? "" : "s"}`;
    parts.push(chestLabel);
  }
  if (cosmeticLabel) {
    parts.push(cosmeticLabel);
  }

  if (parts.length === 0) {
    return "a reward";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function buildAdminGrantNoticePayload(entry) {
  const payload = entry?.payload ?? {};
  const summary = formatAdminGrantSummary({
    xp: payload?.xp ?? 0,
    tokens: payload?.tokens ?? 0,
    chests: payload?.chests ?? [],
    cosmetic: payload?.cosmetic ?? null
  });

  return {
    transactionId: entry?.transactionId ?? null,
    targetUsername: entry?.targetUsername ?? null,
    message: `EleMintz has sent you ${summary}. Click OK to confirm.`,
    payload: {
      xp: Math.max(0, Math.floor(Number(payload?.xp ?? 0) || 0)),
      tokens: Math.max(0, Math.floor(Number(payload?.tokens ?? 0) || 0)),
      chests: sanitizeAdminChestEntries(payload?.chests ?? []),
      cosmetic: sanitizeAdminCosmeticEntry(payload?.cosmetic ?? null)
    },
    timestamp: entry?.timestamp ?? new Date().toISOString()
  };
}

function buildAdminGrantStatusPayload(entry) {
  return {
    transactionId: entry?.transactionId ?? null,
    timestamp: entry?.timestamp ?? null,
    adminIdentifier: entry?.adminIdentifier ?? null,
    targetUsername: entry?.targetUsername ?? null,
    grantType: entry?.grantType ?? "manual_reward_grant",
    payload: entry?.payload ?? null,
    result: entry?.result ?? null,
    confirmationStatus: entry?.confirmationStatus ?? "pending",
    error: entry?.error ?? null,
    status: entry?.status ?? null,
    deliveredAt: entry?.deliveredAt ?? null,
    confirmedAt: entry?.confirmedAt ?? null
  };
}

const ADMIN_ALLOWLIST = Object.freeze([
  Object.freeze({
    username: "VampyrLee",
    email: "insanevampyr@gmail.com"
  })
]);

function buildSettledIdentity(room, logger = DEFAULT_TIMESTAMPED_LOGGER) {
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

function buildRewardSummary(room, { random = Math.random, logger = DEFAULT_TIMESTAMPED_LOGGER } = {}) {
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

function buildRewardDecision(room, summary, {
  settlementKey = null,
  decidedAt = new Date().toISOString()
} = {}) {
  if (!room?.matchComplete || !summary) {
    return null;
  }

  const matchId =
    room.serverMatchState?.matchId ??
    (room.roomCode ? `${room.roomCode}:match:${Math.max(1, Number(room.matchSequence ?? 1))}` : null);

  return {
    matchId,
    roomCode: room.roomCode ?? null,
    winner: room.winner ?? null,
    isDraw: room.winner === "draw",
    settlementKey: String(settlementKey ?? "").trim() || null,
    rewards: {
      host: { ...(summary.hostRewards ?? {}) },
      guest: { ...(summary.guestRewards ?? {}) }
    },
    participants: {
      hostUsername: summary.settledHostUsername ?? null,
      guestUsername: summary.settledGuestUsername ?? null
    },
    decidedAt
  };
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

function getStoredCapturedOpponentCards(entry, fallback = 0) {
  const explicit = Number(entry?.capturedOpponentCards);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return Math.max(0, Number(fallback) || 0);
}

function getStoredCapturedCards(entry, fallback = 0) {
  const explicit = Number(entry?.capturedCards);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return Math.max(0, Number(fallback) || 0);
}

function countWarResolutionClashes(roundHistory, resolvedIndex) {
  let warClashes = 1;

  for (let cursor = resolvedIndex - 1; cursor >= 0; cursor -= 1) {
    const priorOutcomeType = String(roundHistory[cursor]?.outcomeType ?? "");

    if (priorOutcomeType === "war" || priorOutcomeType === "no_effect") {
      warClashes += 1;
      continue;
    }

    break;
  }

  return warClashes;
}

function buildOnlineHistoryFromRoundHistory(roundHistory = []) {
  const history = [];

  for (let index = 0; index < roundHistory.length; index += 1) {
    const entry = roundHistory[index];
    const outcomeType = String(entry?.outcomeType ?? "");

    if (outcomeType === "war") {
      history.push({
        result: "none",
        warClashes: 0,
        capturedCards: 0,
        capturedOpponentCards: 0,
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    if (outcomeType === "war_resolved") {
      const warClashes = countWarResolutionClashes(roundHistory, index);
      history.push({
        result: resolvePerspectiveResultFromRound(entry),
        warClashes,
        capturedCards: getStoredCapturedCards(entry, 0),
        capturedOpponentCards: getStoredCapturedOpponentCards(entry, 0),
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    if (outcomeType === "resolved") {
      history.push({
        result: resolvePerspectiveResultFromRound(entry),
        warClashes: 0,
        capturedCards: getStoredCapturedCards(
          entry,
          entry?.hostResult === "win" || entry?.guestResult === "win" ? 2 : 0
        ),
        capturedOpponentCards: getStoredCapturedOpponentCards(
          entry,
          entry?.hostResult === "win" || entry?.guestResult === "win" ? 1 : 0
        ),
        p1Card: String(entry?.hostMove ?? "").toLowerCase(),
        p2Card: String(entry?.guestMove ?? "").toLowerCase()
      });
      continue;
    }

    history.push({
      result: "none",
      warClashes: 0,
      capturedCards: 0,
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

export function resolveRound(room, roundResult) {
  if (!room || !roundResult) {
    return null;
  }

  return {
    roomCode: room.roomCode,
    matchId: room.serverMatchState?.matchId ?? `${room.roomCode}:match:unknown`,
    stepId: room.serverMatchState?.lastResolvedOutcome?.stepId ?? null,
    submittedCards: {
      host: roundResult.hostMove ?? null,
      guest: roundResult.guestMove ?? null
    },
    authoritativeOutcomeType:
      room.serverMatchState?.lastResolvedOutcome?.type ??
      (roundResult.outcomeType === "resolved" ? "win" : roundResult.outcomeType ?? null),
    authoritativeWinner:
      room.serverMatchState?.lastResolvedOutcome?.winner ??
      (roundResult.hostResult === "win"
        ? "host"
        : roundResult.guestResult === "win"
          ? "guest"
          : null),
    roundResult: {
      ...roundResult
    },
    matchSnapshot: room.serverMatchState
      ? {
          ...room.serverMatchState,
          players: {
            host: room.serverMatchState.players?.host
              ? { ...room.serverMatchState.players.host }
              : null,
            guest: room.serverMatchState.players?.guest
              ? { ...room.serverMatchState.players.guest }
              : null
          },
          playerHands: {
            host: { ...(room.serverMatchState.playerHands?.host ?? {}) },
            guest: { ...(room.serverMatchState.playerHands?.guest ?? {}) }
          },
          warState: { ...(room.serverMatchState.warState ?? {}) },
          pendingActions: {
            host: room.serverMatchState.pendingActions?.host
              ? { ...room.serverMatchState.pendingActions.host }
              : null,
            guest: room.serverMatchState.pendingActions?.guest
              ? { ...room.serverMatchState.pendingActions.guest }
              : null
          },
          activeStep: { ...(room.serverMatchState.activeStep ?? {}) },
          lastResolvedOutcome: room.serverMatchState.lastResolvedOutcome
            ? { ...room.serverMatchState.lastResolvedOutcome }
            : null,
          turnState: {
            waitingOn: Array.isArray(room.serverMatchState.turnState?.waitingOn)
              ? [...room.serverMatchState.turnState.waitingOn]
              : [],
            lockedIn: Array.isArray(room.serverMatchState.turnState?.lockedIn)
              ? [...room.serverMatchState.turnState.lockedIn]
              : [],
            resolutionReady: Boolean(room.serverMatchState.turnState?.resolutionReady)
          }
        }
      : null,
    animation: {
      clearWarStateAfterDelay: roundResult.outcomeType === "war_resolved",
      matchComplete: Boolean(room.matchComplete)
    }
  };
}

export function createMultiplayerFoundation({
  port = Number(process.env.PORT) || DEFAULT_PORT,
  logger = DEFAULT_TIMESTAMPED_LOGGER,
  random = Math.random,
  roundResetDelayMs = ROUND_RESET_DELAY_MS,
  roomCleanupDelayMs = ROOM_CLEANUP_DELAY_MS,
  roomReconnectTimeoutMs = ROOM_RECONNECT_TIMEOUT_MS,
  disconnectTracker = null,
  rewardPersister = null,
  profileAuthority = null,
  accountStore = null,
  adminGrantStore = null
} = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const roomStore = createRoomStore({ random });
  const sessionStore = createSessionStore({ logger, gracePeriodMs: roomReconnectTimeoutMs });
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const roomResetTimers = new Map();
  const roomCleanupTimers = new Map();
  const roomReconnectTimers = new Map();
  const roomSettlementTasks = new Map();

  async function deliverPendingAdminNoticesForSession(session, targetSocketId) {
    if (!adminGrantStore || !targetSocketId) {
      return;
    }

    const targetUsername = normalizeSettledUsername(session?.profileKey ?? session?.username);
    if (!targetUsername) {
      return;
    }

    try {
      const pendingEntries = await adminGrantStore.listPendingNoticesForUsername(targetUsername);
      for (const entry of pendingEntries) {
        const deliveredEntry = await adminGrantStore.markDelivered({
          transactionId: entry?.transactionId,
          confirmationStatus: "delivered"
        });
        io.to(targetSocketId).emit("admin:grantNotice", buildAdminGrantNoticePayload(deliveredEntry));

        if (deliveredEntry?.adminSocketId) {
          io.to(deliveredEntry.adminSocketId).emit(
            "admin:grantStatus",
            buildAdminGrantStatusPayload(deliveredEntry)
          );
        }
      }
    } catch (error) {
      logger?.warn?.("[AdminGrant] Failed to deliver pending admin notices", {
        username: targetUsername,
        socketId: targetSocketId,
        message: error?.message ?? String(error)
      });
    }
  }

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
    roomStore.setClosingAt(roomCode, null);
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
    roomStore.setDisconnectExpiresAt(roomCode, null);
  }

  function buildAccountError(error, fallbackCode = "AUTH_FAILED") {
    return {
      ok: false,
      error: {
        code: String(error?.code ?? fallbackCode),
        message: String(error?.message ?? "Unable to complete this authentication request.")
      }
    };
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
      const currentRoom = roomStore.getRoom(roomCode);
      if (
        !currentRoom ||
        currentRoom.status !== "paused" ||
        currentRoom.disconnectState?.expiresAt !== expiresAt
      ) {
        return;
      }

      const expiredRoom = roomStore.expireDisconnectedRoom(roomCode);
      if (!expiredRoom || expiredRoom.status !== "expired") {
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
      const currentRoom = roomStore.getRoom(roomCode);
      if (
        !currentRoom ||
        currentRoom.closingAt !== closingAt ||
        (currentRoom.status !== "closing" && currentRoom.status !== "expired")
      ) {
        return;
      }

      roomStore.removeRoom(roomCode);
      logger.info("[OnlinePlay][Server] room cleaned up", {
        roomCode
      });
    }, roomCleanupDelayMs);

    timerId.unref?.();
    roomCleanupTimers.set(roomCode, timerId);
    return closingAt;
  }

  function buildSessionError(error, fallbackCode = "SESSION_REQUIRED") {
    return {
      ok: false,
      error: {
        code: error?.code ?? fallbackCode,
        message: error?.message ?? "A valid online session is required."
      }
    };
  }

  function buildAdminError(error, fallbackCode = "ADMIN_REQUEST_FAILED") {
    return {
      ok: false,
      error: {
        code: error?.code ?? fallbackCode,
        message: error?.message ?? "Unable to complete admin request."
      }
    };
  }

  function assertAdminAccessForSession(session) {
    const normalizedUsername = normalizeSettledUsername(session?.profileKey ?? session?.username);
    const normalizedEmail = String(session?.email ?? "").trim().toLowerCase() || null;

    if (!session?.authenticated || !normalizedUsername || !normalizedEmail) {
      const error = new Error("An authenticated EleMintz account session is required.");
      error.code = "ADMIN_AUTH_REQUIRED";
      throw error;
    }

    const match =
      ADMIN_ALLOWLIST.find(
        (entry) => entry.username === normalizedUsername && entry.email === normalizedEmail
      ) ?? null;

    if (!match) {
      const error = new Error("This EleMintz account does not have admin access.");
      error.code = "ADMIN_ACCESS_DENIED";
      throw error;
    }

    return {
      adminIdentifier: normalizedUsername
    };
  }

  async function resolveBootstrapUsername(username) {
    const requestedUsername = normalizeSettledUsername(username);
    if (!requestedUsername) {
      return null;
    }

    if (typeof profileAuthority?.getProfile !== "function") {
      return requestedUsername;
    }

    try {
      const snapshot = await profileAuthority.getProfile(requestedUsername);
      return normalizeSettledUsername(snapshot?.username ?? snapshot?.profile?.username ?? requestedUsername);
    } catch {
      return requestedUsername;
    }
  }

  function buildResolvedAccountSession(socket, account) {
    return sessionStore.issueSession({
      username: account?.username,
      profileKey: account?.profileKey ?? account?.username,
      accountId: account?.accountId ?? null,
      email: account?.email ?? null,
      authenticated: true,
      replaceDisconnected: true,
      socketId: socket.id
    });
  }

  async function ensureSocketSession(socket, payload = {}, { allowBootstrap = false } = {}) {
    const existingSession = sessionStore.getSessionBySocket(socket.id);
    if (existingSession) {
      return {
        ok: true,
        session: existingSession
      };
    }

    const sessionToken = String(payload?.sessionToken ?? "").trim();
    if (sessionToken) {
      const resumed = sessionStore.resumeSession({
        token: sessionToken,
        socketId: socket.id
      });

      if (!resumed?.ok) {
        return resumed;
      }

      return {
        ok: true,
        session: sessionStore.getSessionBySocket(socket.id) ?? resumed.session
      };
    }

    if (!allowBootstrap) {
      return buildSessionError({
        code: "SESSION_REQUIRED",
        message: "A server-issued online session is required for this action."
      });
    }

    const resolvedUsername =
      (await resolveBootstrapUsername(payload?.username)) ??
      `Guest-${String(socket.id ?? "socket").slice(0, 8)}`;

    return sessionStore.issueSession({
      username: resolvedUsername,
      socketId: socket.id
    });
  }

  async function settleCompletedMatchRewards(room) {
    if (!room?.matchComplete) {
      return room;
    }

    const settlementKey = roomStore.getCurrentMatchSettlementKey(room.roomCode);
    const existingTask = roomSettlementTasks.get(room.roomCode);
    if (existingTask?.settlementKey === settlementKey) {
      return existingTask.promise;
    }

    if (
      room?.rewardSettlement?.granted &&
      room?.rewardSettlement?.settlementKey &&
      room.rewardSettlement.settlementKey === settlementKey
    ) {
      logMatchEvent(logger, "Settlement skipped", {
        roomCode: room.roomCode,
        winner: room.winner,
        settlementKey
      });
      return room;
    }

    const settlementTask = (async () => {
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
      const grantedAt = new Date().toISOString();
      const decision = buildRewardDecision(settlementRoom, summary, {
        settlementKey,
        decidedAt: grantedAt
      });

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
            decision,
            settlementKey
          });
        }
        logMatchEvent(logger, "Settlement persisted", {
          roomCode: room.roomCode,
          winner: summary.winner,
          settlementKey
        });
      } catch (error) {
        logger.error?.("[OnlinePlay][Rewards] persistence failed", {
          roomCode: room.roomCode,
          message: error?.message,
          stack: error?.stack
        });
        return roomStore.getRoom(room.roomCode) ?? room;
      }

      const currentSettlementKey = roomStore.getCurrentMatchSettlementKey(room.roomCode);
      if (currentSettlementKey !== settlementKey) {
        logMatchEvent(logger, "Settlement skipped after room advanced", {
          roomCode: room.roomCode,
          settlementKey,
          currentSettlementKey
        });
        return roomStore.getRoom(room.roomCode) ?? room;
      }

      return (
        roomStore.setRewardSettlement(room.roomCode, summary, grantedAt, {
          settlementKey,
          decision
        }) ?? room
      );
    })();

    roomSettlementTasks.set(room.roomCode, {
      settlementKey,
      promise: settlementTask
    });

    try {
      return await settlementTask;
    } finally {
      const activeTask = roomSettlementTasks.get(room.roomCode);
      if (activeTask?.promise === settlementTask) {
        roomSettlementTasks.delete(room.roomCode);
      }
    }
  }

  io.on("connection", (socket) => {
    logRoomEvent(logger, "Client connected", {
      socketId: socket.id,
      transport: socket.conn.transport.name,
      phase: DEVELOPMENT_PHASE_LABEL
    });

    socket.on("room:create", (payload = {}) => {
      void (async () => {
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          socket.emit("room:error", sessionResult.error);
          return;
        }

        const authoritativePayload = await attachAuthoritativeOnlineCosmetics(
          payload,
          sessionResult.session,
          profileAuthority,
          logger
        );
        const result = roomStore.createRoom(socket, authoritativePayload, sessionResult.session);

        if (!result.ok) {
          socket.emit("room:error", result.error);
          return;
        }

        socket.join(result.room.roomCode);
        socket.emit("room:created", result.room);
        logRoomEvent(logger, "Room created", {
          roomCode: result.room.roomCode,
          username: result.room.host?.username ?? null,
          createdAt: result.room.createdAt ?? null,
          sessionId: sessionResult.session?.sessionId ?? null
        });
      })();
    });

    socket.on("room:join", (payload = {}) => {
      void (async () => {
        const targetRoom = roomStore.getRoom(payload?.roomCode ?? null);
        const sessionResult = await ensureSocketSession(socket, payload, {
          allowBootstrap: targetRoom?.status !== "paused"
        });
        if (!sessionResult?.ok) {
          if (targetRoom?.status === "paused" && sessionResult?.error?.code === "SESSION_REQUIRED") {
            socket.emit("room:error", {
              code: "ROOM_RECONNECT_RESERVED",
              message: "This room is reserved for the disconnected player to resume."
            });
            return;
          }

          socket.emit("room:error", sessionResult.error);
          return;
        }

        const authoritativePayload = await attachAuthoritativeOnlineCosmetics(
          payload,
          sessionResult.session,
          profileAuthority,
          logger
        );
        const result = roomStore.joinRoom(
          socket,
          authoritativePayload?.roomCode ?? payload.roomCode,
          authoritativePayload,
          sessionResult.session
        );

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
            username: sessionResult.session?.username ?? null,
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
        socket.to(result.room.roomCode).emit("room:update", result.room);
        logRoomEvent(logger, result.reconnected ? "Player rejoined room" : "Player joined room", {
          roomCode: result.room.roomCode,
          username: sessionResult.session?.username ?? result.room.guest?.username ?? null,
          hostUsername: result.room.host?.username ?? null,
          guestUsername: result.room.guest?.username ?? null,
          status: result.room.status,
          sessionId: sessionResult.session?.sessionId ?? null
        });
        if (result.room.status === "full" && Array.isArray(result.room.roundHistory) && result.room.roundHistory.length === 0) {
          logMatchEvent(logger, "Start", {
            roomCode: result.room.roomCode,
            hostUsername: result.room.host?.username ?? null,
            guestUsername: result.room.guest?.username ?? null
          });
        }
      })();
    });

    socket.on("session:bootstrap", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const result = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!result?.ok) {
        respond(result);
        return;
      }

      respond({
        ok: true,
        session: sessionStore.toPublicSession(result.session)
      });
    });

    socket.on("auth:register", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      if (
        typeof accountStore?.register !== "function" ||
        typeof profileAuthority?.assertProfileClaimAvailable !== "function" ||
        typeof profileAuthority?.linkProfileToAccount !== "function"
      ) {
        respond(buildAccountError({
          code: "AUTH_UNAVAILABLE",
          message: "Account registration is not available on this server."
        }));
        return;
      }

      try {
        const resolvedUsername =
          (await resolveBootstrapUsername(payload?.username)) ??
          normalizeSettledUsername(payload?.username);
        await profileAuthority.assertProfileClaimAvailable(resolvedUsername);
        const account = await accountStore.register({
          email: payload?.email,
          password: payload?.password,
          username: resolvedUsername,
          profileKey: resolvedUsername
        });
        await profileAuthority.linkProfileToAccount({
          username: account.username,
          accountId: account.accountId
        });
        const sessionResult = buildResolvedAccountSession(socket, account);
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        respond({
          ok: true,
          account,
          session: sessionStore.toPublicSession(sessionResult.session)
        });
      } catch (error) {
        respond(buildAccountError(error, "ACCOUNT_REGISTER_FAILED"));
      }
    });

    socket.on("auth:login", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      if (typeof accountStore?.login !== "function") {
        respond(buildAccountError({
          code: "AUTH_UNAVAILABLE",
          message: "Account login is not available on this server."
        }));
        return;
      }

      try {
        const account = await accountStore.login({
          email: payload?.email,
          password: payload?.password
        });
        const sessionResult = buildResolvedAccountSession(socket, account);
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        respond({
          ok: true,
          account,
          session: sessionStore.toPublicSession(sessionResult.session)
        });
        void deliverPendingAdminNoticesForSession(sessionResult.session, socket.id);
      } catch (error) {
        respond(buildAccountError(error, "ACCOUNT_LOGIN_FAILED"));
      }
    });

    socket.on("session:resume", (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const result = sessionStore.resumeSession({
        token: payload?.sessionToken,
        socketId: socket.id
      });
      if (!result?.ok) {
        respond(result);
        return;
      }

      respond({
        ok: true,
        session: sessionStore.toPublicSession(result.session)
      });
      void deliverPendingAdminNoticesForSession(result.session, socket.id);
    });

    socket.on("session:logout", (_payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const existingSession = sessionStore.getSessionBySocket(socket.id);
      if (!existingSession) {
        respond({ ok: true });
        return;
      }

      sessionStore.destroySession(existingSession.token);
      respond({ ok: true });
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

      const authoritativeRoundResult = resolveRound(result.room, result.roundResult);

      logger.info("[OnlinePlay][Server] broadcasting room:moveSync", {
        roomCode: result.room.roomCode,
        moveSync: result.room.moveSync
      });
      io.to(result.room.roomCode).emit("room:moveSync", result.room);

      if (result.roundResult) {
        logger.info("[OnlinePlay][Server] about to emit room:roundResult", result.roundResult);
        io.to(result.room.roomCode).emit("room:roundResult", result.roundResult);
        if (authoritativeRoundResult) {
          io.to(result.room.roomCode).emit("room:serverRoundResult", authoritativeRoundResult);
        }
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
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

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
        const snapshot = await profileAuthority.getProfile(
          sessionResult.session?.profileKey ?? sessionResult.session?.username
        );
        logRoomEvent(logger, "Profile snapshot served", {
          username: sessionResult.session?.username ?? null,
          socketId: socket.id,
          sessionId: sessionResult.session?.sessionId ?? null
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

    socket.on("admin:lookupUser", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);

      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: false });
      if (!sessionResult?.ok) {
        respond(buildAdminError(sessionResult?.error, "ADMIN_AUTH_REQUIRED"));
        return;
      }

      try {
        assertAdminAccessForSession(sessionResult.session);
      } catch (error) {
        respond(buildAdminError(error, "ADMIN_AUTH_FAILED"));
        return;
      }

      const targetUsername = normalizeSettledUsername(payload?.username);
      if (!targetUsername) {
        respond(
          buildAdminError(
            {
              code: "ADMIN_TARGET_USERNAME_REQUIRED",
              message: "username is required for admin lookup."
            },
            "ADMIN_TARGET_USERNAME_REQUIRED"
          )
        );
        return;
      }

      if (
        typeof profileAuthority?.getProfile !== "function" ||
        typeof profileAuthority?.getCosmetics !== "function"
      ) {
        respond(
          buildAdminError(
            {
              code: "PROFILE_AUTHORITY_UNAVAILABLE",
              message: "Server profile authority is not available."
            },
            "PROFILE_AUTHORITY_UNAVAILABLE"
          )
        );
        return;
      }

      try {
        const snapshot = await profileAuthority.getProfile(targetUsername);
        const cosmetics = await profileAuthority.getCosmetics(targetUsername);
        respond({
          ok: true,
          profile: snapshot,
          cosmetics
        });
      } catch (error) {
        respond(buildAdminError(error, "ADMIN_LOOKUP_FAILED"));
      }
    });

    socket.on("admin:grantRewards", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);

      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: false });
      if (!sessionResult?.ok) {
        respond(buildAdminError(sessionResult?.error, "ADMIN_AUTH_REQUIRED"));
        return;
      }

      let adminAccess = null;
      try {
        adminAccess = assertAdminAccessForSession(sessionResult.session);
      } catch (error) {
        respond(buildAdminError(error, "ADMIN_AUTH_FAILED"));
        return;
      }

      const targetUsername = normalizeSettledUsername(payload?.username);
      const transactionId = normalizeAdminTransactionId(payload?.transactionId);
      if (!targetUsername) {
        respond(
          buildAdminError(
            {
              code: "ADMIN_TARGET_USERNAME_REQUIRED",
              message: "username is required for admin grants."
            },
            "ADMIN_TARGET_USERNAME_REQUIRED"
          )
        );
        return;
      }
      if (!transactionId) {
        respond(
          buildAdminError(
            {
              code: "ADMIN_TRANSACTION_REQUIRED",
              message: "transactionId is required for admin grants."
            },
            "ADMIN_TRANSACTION_REQUIRED"
          )
        );
        return;
      }
      if (!adminGrantStore) {
        respond(
          buildAdminError(
            {
              code: "ADMIN_GRANT_STORE_UNAVAILABLE",
              message: "Admin grant persistence is not available."
            },
            "ADMIN_GRANT_STORE_UNAVAILABLE"
          )
        );
        return;
      }
      if (typeof profileAuthority?.applyAdminGrant !== "function") {
        respond(
          buildAdminError(
            {
              code: "PROFILE_AUTHORITY_UNAVAILABLE",
              message: "Server profile authority is not available."
            },
            "PROFILE_AUTHORITY_UNAVAILABLE"
          )
        );
        return;
      }

      const grantPayload = {
        xp: Math.max(0, Math.floor(Number(payload?.xp ?? 0) || 0)),
        tokens: Math.max(0, Math.floor(Number(payload?.tokens ?? 0) || 0)),
        chests: sanitizeAdminChestEntries(payload?.chests ?? []),
        cosmetic: sanitizeAdminCosmeticEntry(payload?.cosmetic ?? null)
      };

      try {
        const transactionStart = await adminGrantStore.beginTransaction({
          transactionId,
          timestamp: new Date().toISOString(),
          adminId: adminAccess.adminIdentifier,
          targetUsername,
          grantType: "manual_reward_grant",
          payload: grantPayload,
          adminSocketId: socket.id
        });

        if (transactionStart.duplicate) {
          const existing = transactionStart.entry;
          if (existing?.status === "success") {
            respond({
              ok: true,
              duplicate: true,
              result: buildAdminGrantStatusPayload(existing)
            });
            return;
          }

          respond({
            ok: false,
            duplicate: true,
            error: {
              code:
                existing?.status === "failure"
                  ? "ADMIN_GRANT_PREVIOUS_FAILURE"
                  : "ADMIN_GRANT_IN_PROGRESS",
              message:
                existing?.error?.message ??
                (existing?.status === "failure"
                  ? "This transaction previously failed."
                  : "This transaction is already being processed.")
            },
            result: buildAdminGrantStatusPayload(existing)
          });
          return;
        }

        const grantResult = await profileAuthority.applyAdminGrant({
          username: targetUsername,
          ...grantPayload
        });
        const targetSocketId = sessionStore.getSocketIdByUsername(targetUsername);
        let finalizedEntry = await adminGrantStore.finalizeTransaction({
          transactionId,
          status: "success",
          result: {
            profile: grantResult?.snapshot ?? null,
            applied: {
              xp: grantResult?.xpDelta ?? grantPayload.xp,
              tokens: grantResult?.tokenDelta ?? grantPayload.tokens,
              chests: grantResult?.chestGrants ?? grantPayload.chests,
              cosmetic: grantResult?.cosmeticGrant ?? grantPayload.cosmetic,
              levelBefore: grantResult?.levelBefore ?? null,
              levelAfter: grantResult?.levelAfter ?? null,
              levelRewards: grantResult?.levelRewards ?? []
            },
            cosmetics: grantResult?.cosmetics ?? null
          },
          confirmationStatus: targetSocketId ? "awaiting_player" : "player_offline",
          error: null
        });

        if (targetSocketId) {
          finalizedEntry = await adminGrantStore.markDelivered({
            transactionId,
            confirmationStatus: "awaiting_player"
          });
          io.to(targetSocketId).emit("admin:grantNotice", buildAdminGrantNoticePayload(finalizedEntry));
        }

        respond({
          ok: true,
          result: buildAdminGrantStatusPayload(finalizedEntry)
        });
      } catch (error) {
        const finalizedEntry = await adminGrantStore
          .finalizeTransaction({
            transactionId,
            status: "failure",
            result: null,
            confirmationStatus: "failed",
            error: {
              code: error?.code ?? "ADMIN_GRANT_FAILED",
              message: String(error?.message ?? "Unable to apply admin grant.")
            }
          })
          .catch(() => null);

        respond({
          ...buildAdminError(error, "ADMIN_GRANT_FAILED"),
          ...(finalizedEntry ? { result: buildAdminGrantStatusPayload(finalizedEntry) } : {})
        });
      }
    });

    socket.on("admin:confirmGrantReceipt", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (!adminGrantStore) {
        respond(
          buildAdminError(
            {
              code: "ADMIN_GRANT_STORE_UNAVAILABLE",
              message: "Admin grant persistence is not available."
            },
            "ADMIN_GRANT_STORE_UNAVAILABLE"
          )
        );
        return;
      }

      try {
        const entry = await adminGrantStore.confirmTransaction({
          transactionId: payload?.transactionId,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });

        if (entry?.adminSocketId) {
          io.to(entry.adminSocketId).emit("admin:grantStatus", buildAdminGrantStatusPayload(entry));
        }

        respond({
          ok: true,
          result: buildAdminGrantStatusPayload(entry)
        });
      } catch (error) {
        respond(buildAdminError(error, "ADMIN_GRANT_CONFIRM_FAILED"));
      }
    });

      socket.on("profile:getCosmetics", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.getCosmetics !== "function") {
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
        const cosmetics = await profileAuthority.getCosmetics(
          sessionResult.session?.profileKey ?? sessionResult.session?.username
        );
        respond({
          ok: true,
          cosmetics
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETICS_READ_FAILED",
            message: String(error?.message ?? "Unable to read authoritative cosmetics.")
            }
          });
        }
      });

      socket.on("profile:claimDailyLoginReward", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        if (typeof profileAuthority?.claimDailyLoginReward !== "function") {
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
          const result = await profileAuthority.claimDailyLoginReward(
            sessionResult.session?.profileKey ?? sessionResult.session?.username
          );
          respond({
            ok: true,
            result
          });
        } catch (error) {
          respond({
            ok: false,
            error: {
              code: "PROFILE_DAILY_LOGIN_WRITE_FAILED",
              message: String(error?.message ?? "Unable to complete authoritative daily login claim.")
            }
          });
        }
      });

      socket.on("profile:buyStoreItem", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.buyStoreItem !== "function") {
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
        const result = await profileAuthority.buyStoreItem({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_STORE_WRITE_FAILED",
            message: String(error?.message ?? "Unable to complete authoritative store purchase.")
          }
        });
      }
    });

      socket.on("profile:openChest", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.openChest !== "function") {
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
        const result = await profileAuthority.openChest({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_CHEST_WRITE_FAILED",
            message: String(error?.message ?? "Unable to open authoritative chest.")
          }
        });
      }
    });

    socket.on("profile:equipCosmetic", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.equipCosmetic !== "function") {
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
        const result = await profileAuthority.equipCosmetic({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETIC_WRITE_FAILED",
            message: String(error?.message ?? "Unable to update authoritative cosmetics.")
          }
        });
      }
    });

    socket.on("profile:updateCosmeticPreferences", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.updateCosmeticPreferences !== "function") {
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
        const result = await profileAuthority.updateCosmeticPreferences({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETIC_WRITE_FAILED",
            message: String(error?.message ?? "Unable to update authoritative cosmetic preferences.")
          }
        });
      }
    });

    socket.on("profile:randomizeOwnedCosmetics", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.randomizeOwnedCosmetics !== "function") {
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
        const result = await profileAuthority.randomizeOwnedCosmetics({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETIC_WRITE_FAILED",
            message: String(error?.message ?? "Unable to randomize authoritative cosmetics.")
          }
        });
      }
    });

    socket.on("profile:saveCosmeticLoadout", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.saveCosmeticLoadout !== "function") {
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
        const result = await profileAuthority.saveCosmeticLoadout({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETIC_WRITE_FAILED",
            message: String(error?.message ?? "Unable to save authoritative loadout.")
          }
        });
      }
    });

    socket.on("profile:applyCosmeticLoadout", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.applyCosmeticLoadout !== "function") {
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
        const result = await profileAuthority.applyCosmeticLoadout({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETIC_WRITE_FAILED",
            message: String(error?.message ?? "Unable to apply authoritative loadout.")
          }
        });
      }
    });

    socket.on("profile:renameCosmeticLoadout", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.renameCosmeticLoadout !== "function") {
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
        const result = await profileAuthority.renameCosmeticLoadout({
          ...payload,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "PROFILE_COSMETIC_WRITE_FAILED",
            message: String(error?.message ?? "Unable to rename authoritative loadout.")
          }
        });
      }
    });

    socket.on("disconnect", (reason) => {
      sessionStore.disconnectSocket(socket.id);
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
        httpServer.listen(port, "0.0.0.0", () => {
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
  buildRewardDecision,
  buildRewardSummary
};
