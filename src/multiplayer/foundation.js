import http from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { ONLINE_TURN_TIMER_DURATION_MS, createRoomStore } from "./rooms.js";
import { createSessionStore } from "./sessionStore.js";
import { createLocalMatchSessionStore } from "./localMatchSessions.js";
import { DEFAULT_TIMESTAMPED_LOGGER } from "./logger.js";
import { getBasicChestDropChance, rollBasicChest } from "../shared/basicChestDrop.js";
import { getCosmeticDefinition } from "../state/cosmeticSystem.js";
import { applyBoostEventToBaseMatchRewards } from "../shared/boostEventRules.js";
import { AI_DIFFICULTY } from "../engine/ai.js";
import { getGauntletRivalById } from "../engine/index.js";

const DEFAULT_PORT = 3001;
const ROUND_RESET_DELAY_MS = 1700;
const ROOM_CLEANUP_DELAY_MS = 30000;
const ROOM_RECONNECT_TIMEOUT_MS = 60000;
const ONLINE_TURN_TIMER_DURATION_MS_DEFAULT = ONLINE_TURN_TIMER_DURATION_MS;
const MAX_SETTLED_USERNAME_LENGTH = 32;
const VALID_ADMIN_CHEST_TYPES = new Set(["basic", "milestone", "epic", "legendary"]);
const VALID_FEATURED_RIVAL_IDS = new Set(["crownfire_duelist"]);
export const MULTIPLAYER_FOUNDATION_PHASE = 22;
const DEVELOPMENT_PHASE_LABEL = "Unified Server Progression + Tester Stabilization";
const LOCAL_MATCH_MODES = Object.freeze({
  PVE: "pve",
  LOCAL_PVP: "local_pvp",
  FEATURED_RIVAL: "featured_rival",
  GAUNTLET: "gauntlet"
});

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
  const customMessage = String(entry?.result?.noticeMessage ?? payload?.noticeMessage ?? "").trim();
  const summary = formatAdminGrantSummary({
    xp: payload?.xp ?? 0,
    tokens: payload?.tokens ?? 0,
    chests: payload?.chests ?? [],
    cosmetic: payload?.cosmetic ?? null
  });

  return {
    transactionId: entry?.transactionId ?? null,
    targetUsername: entry?.targetUsername ?? null,
    message: customMessage || `EleMintz has sent you ${summary}. Click OK to confirm.`,
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

function formatFounderRewardItemNames(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item?.displayName ?? "").trim())
    .filter(Boolean);
}

function buildFounderGrantNoticeMessage(grantedItems, skippedItems) {
  const allNames = formatFounderRewardItemNames([...(grantedItems ?? []), ...(skippedItems ?? [])]);
  const uniqueNames = [...new Set(allNames)].map((name) =>
    name === "Arena Founder" ? "Arena Founder Title" : name
  );
  const summary =
    uniqueNames.length > 0
      ? uniqueNames.join(", ")
      : "Arena Founder title, Founder Badge, and Founder Deluxe Card Back";
  return `EleMintz has granted Founder Status to your account. You received: ${summary}. Click OK to confirm.`;
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

function buildRewardSummary(room, { random = Math.random, logger = DEFAULT_TIMESTAMPED_LOGGER, boostEvent = null } = {}) {
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
    const hostBoostedRewards = applyBoostEventToBaseMatchRewards({
      boostEvent,
      matchState: { mode: "online_pvp" },
      xp: 10,
      tokens: 10
    });
    const guestBoostedRewards = applyBoostEventToBaseMatchRewards({
      boostEvent,
      matchState: { mode: "online_pvp" },
      xp: 10,
      tokens: 10
    });
    return {
      granted: true,
      winner: "draw",
      ...settledIdentity,
      hostRewards: { tokens: hostBoostedRewards.tokens, xp: hostBoostedRewards.xp, basicChests: hostChest },
      guestRewards: { tokens: guestBoostedRewards.tokens, xp: guestBoostedRewards.xp, basicChests: guestChest }
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
    const hostBoostedRewards = applyBoostEventToBaseMatchRewards({
      boostEvent,
      matchState: { mode: "online_pvp" },
      xp: 20,
      tokens: 25
    });
    const guestBoostedRewards = applyBoostEventToBaseMatchRewards({
      boostEvent,
      matchState: { mode: "online_pvp" },
      xp: 5,
      tokens: 5
    });
    return {
      granted: true,
      winner: "host",
      ...settledIdentity,
      hostRewards: { tokens: hostBoostedRewards.tokens, xp: hostBoostedRewards.xp, basicChests: hostChest },
      guestRewards: { tokens: guestBoostedRewards.tokens, xp: guestBoostedRewards.xp, basicChests: guestChest }
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
    const hostBoostedRewards = applyBoostEventToBaseMatchRewards({
      boostEvent,
      matchState: { mode: "online_pvp" },
      xp: 5,
      tokens: 5
    });
    const guestBoostedRewards = applyBoostEventToBaseMatchRewards({
      boostEvent,
      matchState: { mode: "online_pvp" },
      xp: 20,
      tokens: 25
    });
    return {
      granted: true,
      winner: "guest",
      ...settledIdentity,
      hostRewards: { tokens: hostBoostedRewards.tokens, xp: hostBoostedRewards.xp, basicChests: hostChest },
      guestRewards: { tokens: guestBoostedRewards.tokens, xp: guestBoostedRewards.xp, basicChests: guestChest }
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
  const priorChainOutcomes = [];

  for (let cursor = resolvedIndex - 1; cursor >= 0; cursor -= 1) {
    const priorOutcomeType = String(roundHistory[cursor]?.outcomeType ?? "");

    if (priorOutcomeType === "war" || priorOutcomeType === "no_effect") {
      priorChainOutcomes.unshift(priorOutcomeType);
      continue;
    }

    break;
  }

  while (priorChainOutcomes[0] === "no_effect") {
    priorChainOutcomes.shift();
  }

  return 1 + priorChainOutcomes.length;
}

function resolveTerminalWarClashes(entry) {
  const explicitDepth = Number(entry?.warDepth);
  if (Number.isFinite(explicitDepth) && explicitDepth > 0) {
    return Math.max(1, Math.floor(explicitDepth));
  }

  const roundCount = Array.isArray(entry?.warRounds) ? entry.warRounds.length : 0;
  if (roundCount > 0) {
    return Math.max(1, roundCount);
  }

  return 1;
}

function hasTerminalWarMetadata(entry) {
  const explicitDepth = Number(entry?.warDepth);
  if (Number.isFinite(explicitDepth) && explicitDepth > 0) {
    return true;
  }

  return Array.isArray(entry?.warRounds) && entry.warRounds.length > 0;
}

function buildOnlineHistoryFromRoundHistory(roundHistory = [], roomWinner = null, matchComplete = false) {
  const history = [];

  for (let index = 0; index < roundHistory.length; index += 1) {
    const entry = roundHistory[index];
    const outcomeType = String(entry?.outcomeType ?? "");
    const isTerminalCompletedWar =
      matchComplete &&
      index === roundHistory.length - 1 &&
      (
        outcomeType === "war" ||
        (outcomeType === "no_effect" && hasTerminalWarMetadata(entry))
      );

    if (outcomeType === "war" || isTerminalCompletedWar) {
      history.push({
        result: isTerminalCompletedWar ? resolvePerspectiveResultFromRoomWinner(roomWinner) : "none",
        warClashes: isTerminalCompletedWar ? resolveTerminalWarClashes(entry) : 0,
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
  const history = buildOnlineHistoryFromRoundHistory(
    room?.roundHistory ?? [],
    room?.winner ?? null,
    Boolean(room?.matchComplete)
  );

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
  onlineTurnTimerDurationMs = ONLINE_TURN_TIMER_DURATION_MS_DEFAULT,
  disconnectTracker = null,
  rewardPersister = null,
  profileAuthority = null,
  accountStore = null,
  adminGrantStore = null,
  feedbackStore = null,
  boostEventStore = null,
  shopRotationStore = null,
  dataDir = null
} = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const roomStore = createRoomStore({ random });
  const sessionStore = createSessionStore({
    logger,
    gracePeriodMs: roomReconnectTimeoutMs,
    dataDir
  });
  const localMatchSessions = createLocalMatchSessionStore();
  const inFlightFounderGrants = new Map();
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const roomResetTimers = new Map();
  const roomTurnTimers = new Map();
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

  function clearTurnTimerSchedule(roomCode) {
    if (!roomCode) {
      return;
    }

    const existingTimer = roomTurnTimers.get(roomCode);
    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    roomTurnTimers.delete(roomCode);
  }

  function clearRoomTurnTimer(roomCode, options = {}) {
    clearTurnTimerSchedule(roomCode);
    return roomStore.clearTurnTimer(roomCode, {
      durationMs: onlineTurnTimerDurationMs,
      ...options
    });
  }

  async function handleRoomTurnTimerExpired(roomCode, expectedStepId) {
    clearTurnTimerSchedule(roomCode);
    const result = roomStore.expireTurnTimer(roomCode, { stepId: expectedStepId });
    if (!result?.room) {
      return;
    }

    if (!result.ok) {
      if (result.room) {
        io.to(result.room.roomCode).emit("room:update", result.room);
      }
      return;
    }

    if (result.room.matchComplete) {
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
    io.to(result.room.roomCode).emit("room:moveSync", result.room);
    if (result.roundResult) {
      io.to(result.room.roomCode).emit("room:roundResult", result.roundResult);
      if (authoritativeRoundResult) {
        io.to(result.room.roomCode).emit("room:serverRoundResult", authoritativeRoundResult);
      }
      if (!result.room.matchComplete) {
        scheduleRoundReset(result.room.roomCode, {
          clearWarState: result.roundResult.outcomeType === "war_resolved"
        });
      }
    } else {
      io.to(result.room.roomCode).emit("room:update", result.room);
    }
  }

  function ensureRoomTurnTimer(roomCode) {
    clearTurnTimerSchedule(roomCode);
    const activation = roomStore.activateTurnTimer(roomCode, {
      durationMs: onlineTurnTimerDurationMs
    });

    if (!activation?.ok || !activation.room?.serverMatchState?.turnTimer?.active) {
      return activation?.room ?? null;
    }

    const turnTimer = activation.room.serverMatchState.turnTimer;
    const delayMs = Math.max(0, Date.parse(turnTimer.expiresAt ?? "") - Date.now());
    const timerId = setTimeout(() => {
      void handleRoomTurnTimerExpired(roomCode, turnTimer.stepId);
    }, delayMs);
    timerId.unref?.();
    roomTurnTimers.set(roomCode, timerId);
    return activation.room;
  }

  function scheduleRoundReset(roomCode, { clearWarState = false } = {}) {
    clearRoundReset(roomCode);
    clearTurnTimerSchedule(roomCode);
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
      const timedRoom = ensureRoomTurnTimer(resetRoom.roomCode) ?? resetRoom;

      logger.info("[OnlinePlay][Server] round reset for next turn", {
        roomCode: timedRoom.roomCode,
        moveSync: timedRoom.moveSync
      });
      io.to(timedRoom.roomCode).emit("room:moveSync", timedRoom);
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

  function buildClaimedProfileAuthError(username) {
    return {
      ok: false,
      error: {
        code: "PROFILE_AUTH_REQUIRED",
        message: username
          ? `An authenticated EleMintz account session is required for claimed profile '${username}'.`
          : "An authenticated EleMintz account session is required for this claimed profile."
      }
    };
  }

  function buildLocalMatchSessionError(error, fallbackCode = "LOCAL_MATCH_SESSION_FAILED") {
    return {
      ok: false,
      error: {
        code: error?.code ?? fallbackCode,
        message: error?.message ?? "Unable to manage the local match session."
      }
    };
  }

  function assertSessionUsernameMatch(session, requestedUsername) {
    const normalizedRequested = normalizeSettledUsername(requestedUsername);
    if (!normalizedRequested) {
      return;
    }

    const normalizedSessionUsername = normalizeSettledUsername(
      session?.profileKey ?? session?.username
    );
    if (normalizedRequested !== normalizedSessionUsername) {
      const error = new Error("Authenticated sessions can only manage their own local match sessions.");
      error.code = "PROFILE_USERNAME_MISMATCH";
      throw error;
    }
  }

  function normalizeLocalMatchMode(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return Object.values(LOCAL_MATCH_MODES).includes(normalized) ? normalized : null;
  }

  function normalizeLocalMatchDifficulty(value) {
    if (value === undefined || value === null || String(value).trim().length === 0) {
      return AI_DIFFICULTY.NORMAL;
    }

    return Object.values(AI_DIFFICULTY).includes(value) ? value : null;
  }

  function normalizeFeaturedRivalId(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return VALID_FEATURED_RIVAL_IDS.has(normalized) ? normalized : null;
  }

  function normalizeGauntletRivalId(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return getGauntletRivalById(normalized)?.id ?? null;
  }

  function normalizeClaimedGauntletMilestoneStreaks(value) {
    const entries = Array.isArray(value) ? value : [];
    return [...new Set(entries.map((entry) => Math.max(0, Math.floor(Number(entry ?? 0) || 0))).filter((entry) => entry > 0))]
      .sort((left, right) => left - right);
  }

  function getGauntletSessionState(session) {
    return {
      currentStreak: Math.max(0, Math.floor(Number(session?.metadata?.currentStreak ?? 0) || 0)),
      claimedMilestoneStreaks: normalizeClaimedGauntletMilestoneStreaks(
        session?.metadata?.claimedMilestoneStreaks ?? []
      ),
      defeatedRivalIds: Array.isArray(session?.metadata?.defeatedRivalIds)
        ? session.metadata.defeatedRivalIds
            .map((entry) => normalizeGauntletRivalId(entry))
            .filter(Boolean)
        : [],
      runCounted: session?.metadata?.runCounted === true
    };
  }

  function getGauntletContinuationSessionForOwnerOrThrow(session, sessionId) {
    const previousSession = getLocalMatchSessionForOwnerOrThrow(session, sessionId);
    if (previousSession.mode !== LOCAL_MATCH_MODES.GAUNTLET) {
      const error = new Error("Only gauntlet local match sessions can continue a gauntlet run.");
      error.code = "LOCAL_MATCH_SESSION_MODE_MISMATCH";
      throw error;
    }

    if (previousSession.status !== "completed") {
      const error = new Error("Only a completed gauntlet session can continue the run.");
      error.code = "LOCAL_MATCH_SESSION_INACTIVE";
      throw error;
    }

    return previousSession;
  }

  function assertGauntletSessionPayloadMatchesServerState(session, payload = {}) {
    const serverState = getGauntletSessionState(session);
    const payloadClaimed = normalizeClaimedGauntletMilestoneStreaks(payload?.claimedMilestoneStreaks ?? []);
    const payloadCurrentStreak = Math.max(0, Math.floor(Number(payload?.currentStreak ?? 0) || 0));
    const expectedCurrentStreak = payload?.matchWon === true
      ? serverState.currentStreak + 1
      : serverState.currentStreak;

    if (payloadClaimed.join("|") !== serverState.claimedMilestoneStreaks.join("|")) {
      const error = new Error("Gauntlet milestone claims must match the server-owned gauntlet run state.");
      error.code = "LOCAL_MATCH_GAUNTLET_MILESTONE_MISMATCH";
      throw error;
    }

    if ((payload?.matchWon === true || payload?.runStarted === true) && payloadCurrentStreak !== expectedCurrentStreak) {
      const error = new Error("Gauntlet streak updates must match the server-owned gauntlet run state.");
      error.code = "LOCAL_MATCH_GAUNTLET_STREAK_MISMATCH";
      throw error;
    }
  }

  function getLocalMatchSessionForOwnerOrThrow(session, sessionId) {
    const normalizedSessionId = String(sessionId ?? "").trim();
    if (!normalizedSessionId) {
      const error = new Error("sessionId is required for local match session access.");
      error.code = "LOCAL_MATCH_SESSION_ID_REQUIRED";
      throw error;
    }

    const normalizedUsername = normalizeSettledUsername(session?.profileKey ?? session?.username);
    const ownedSession = localMatchSessions.getSessionForUsername(normalizedSessionId, normalizedUsername);
    if (ownedSession) {
      return ownedSession;
    }

    if (localMatchSessions.getSession(normalizedSessionId)) {
      const error = new Error("This local match session belongs to another user.");
      error.code = "LOCAL_MATCH_SESSION_ACCESS_DENIED";
      throw error;
    }

    const error = new Error("The requested local match session was not found.");
    error.code = "LOCAL_MATCH_SESSION_NOT_FOUND";
    throw error;
  }

  function normalizeProtectedSettlementSessionId(payload = {}) {
    return String(
      payload?.localMatchSessionId ??
        payload?.sessionId ??
        payload?.localMatchSession?.sessionId ??
        ""
    ).trim() || null;
  }

  function isProtectedPveSettlement(matchState) {
    const mode = normalizeLocalMatchMode(matchState?.mode);
    if (mode !== LOCAL_MATCH_MODES.PVE) {
      return false;
    }

    return !normalizeGauntletRivalId(matchState?.gauntletRivalId);
  }

  function getRequiredProtectedSessionMode(matchState) {
    const featuredRivalId = normalizeFeaturedRivalId(matchState?.featuredRivalId);
    return featuredRivalId ? LOCAL_MATCH_MODES.FEATURED_RIVAL : LOCAL_MATCH_MODES.PVE;
  }

  function assertProtectedSettlementSessionMatch(session, payload = {}) {
    const matchState = payload?.matchState ?? null;
    const requiredMode = getRequiredProtectedSessionMode(matchState);
    if (session?.mode !== requiredMode) {
      const error = new Error("This local match session does not match the submitted PvE match mode.");
      error.code = "LOCAL_MATCH_SESSION_MODE_MISMATCH";
      throw error;
    }

    if (session?.status === "abandoned") {
      const error = new Error("This local match session has already been abandoned.");
      error.code = "LOCAL_MATCH_SESSION_INACTIVE";
      throw error;
    }

    const safeSettlementKey = String(payload?.settlementKey ?? "").trim() || null;
    const completedSettlementKey =
      String(session?.metadata?.settlementKey ?? "").trim() || null;
    if (session?.status === "completed") {
      if (!safeSettlementKey || !completedSettlementKey || safeSettlementKey !== completedSettlementKey) {
        const error = new Error("This local match session has already been settled.");
        error.code = "LOCAL_MATCH_SESSION_ALREADY_COMPLETED";
        throw error;
      }
    } else if (session?.status !== "active") {
      const error = new Error("This local match session is no longer active.");
      error.code = "LOCAL_MATCH_SESSION_INACTIVE";
      throw error;
    }

    if (!safeSettlementKey || !safeSettlementKey.includes(session.sessionId)) {
      const error = new Error("Protected PvE settlements must use a settlement key bound to the server session.");
      error.code = "LOCAL_MATCH_SETTLEMENT_KEY_MISMATCH";
      throw error;
    }

    const expectedDifficulty = normalizeLocalMatchDifficulty(matchState?.difficulty);
    if (!expectedDifficulty) {
      const error = new Error("Protected PvE settlements require a valid AI difficulty.");
      error.code = "LOCAL_MATCH_INVALID_DIFFICULTY";
      throw error;
    }

    if (expectedDifficulty !== session?.aiDifficulty) {
      const error = new Error("This local match session does not match the submitted AI difficulty.");
      error.code = "LOCAL_MATCH_SESSION_DIFFICULTY_MISMATCH";
      throw error;
    }

    const expectedFeaturedRivalId = normalizeFeaturedRivalId(matchState?.featuredRivalId);
    const sessionFeaturedRivalId = normalizeFeaturedRivalId(session?.featuredRivalId);
    if (requiredMode === LOCAL_MATCH_MODES.FEATURED_RIVAL) {
      if (!expectedFeaturedRivalId || expectedFeaturedRivalId !== sessionFeaturedRivalId) {
        const error = new Error("This local match session does not match the submitted featured rival.");
        error.code = "LOCAL_MATCH_SESSION_FEATURED_RIVAL_MISMATCH";
        throw error;
      }
    } else if (expectedFeaturedRivalId || sessionFeaturedRivalId) {
      const error = new Error("Regular PvE settlements cannot use a featured rival local match session.");
      error.code = "LOCAL_MATCH_SESSION_FEATURED_RIVAL_MISMATCH";
      throw error;
    }
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

  function buildResolvedAccountSession(socket, account, { rememberSession = true } = {}) {
    return sessionStore.issueSession({
      username: account?.username,
      profileKey: account?.profileKey ?? account?.username,
      accountId: account?.accountId ?? null,
      email: account?.email ?? null,
      authenticated: true,
      rememberSession,
      replaceDisconnected: true,
      socketId: socket.id
    });
  }

  async function validateAuthenticatedSession(session) {
    try {
      if (!session?.authenticated) {
        return {
          ok: true,
          session
        };
      }

      if (session?.accountId && typeof accountStore?.getAccountById === "function") {
        const account = await accountStore.getAccountById(session.accountId);
        if (!account) {
          sessionStore.destroySession(session.token);
          return {
            ok: false,
            error: {
              code: "SESSION_NOT_FOUND",
              message: "This online session is no longer valid."
            }
          };
        }
      }

      if (typeof profileAuthority?.getProfile === "function") {
        const profileKey = session?.profileKey ?? session?.username ?? null;
        const profile = profileKey ? await profileAuthority.getProfile(profileKey) : null;
        if (!profile) {
          sessionStore.destroySession(session.token);
          return {
            ok: false,
            error: {
              code: "SESSION_NOT_FOUND",
              message: "This online session is no longer valid."
            }
          };
        }
      }

      return {
        ok: true,
        session
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "SESSION_VALIDATION_FAILED",
          message: String(error?.message ?? "Unable to validate this online session.")
        }
      };
    }
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

  async function ensureClaimedProfileAccess(
    socket,
    payload = {},
    {
      allowBootstrap = false,
      targetUsername = null
    } = {}
  ) {
    const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap });
    if (!sessionResult?.ok) {
      return sessionResult;
    }

    const resolvedTargetUsername =
      normalizeSettledUsername(
        targetUsername ??
          sessionResult.session?.profileKey ??
          sessionResult.session?.username
      ) ?? null;
    if (!resolvedTargetUsername || typeof profileAuthority?.isProfileClaimed !== "function") {
      return sessionResult;
    }

    const claimed = await profileAuthority.isProfileClaimed(resolvedTargetUsername);
    if (claimed && !sessionResult.session?.authenticated) {
      return buildClaimedProfileAuthError(resolvedTargetUsername);
    }

    return sessionResult;
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

      const activeBoostEvent =
        typeof boostEventStore?.getActiveEvent === "function"
          ? await boostEventStore.getActiveEvent()
          : null;
      const summary = buildRewardSummary(settlementRoom, { random, logger, boostEvent: activeBoostEvent });
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
        const roomWithTimer =
          result.room.status === "full" && !result.room.matchComplete && !result.room.moveSync?.bothSubmitted
            ? ensureRoomTurnTimer(result.room.roomCode) ?? result.room
            : clearRoomTurnTimer(result.room.roomCode) ?? result.room;
        socket.emit("room:joined", roomWithTimer);
        socket.to(roomWithTimer.roomCode).emit("room:update", roomWithTimer);
        logRoomEvent(logger, result.reconnected ? "Player rejoined room" : "Player joined room", {
          roomCode: roomWithTimer.roomCode,
          username: sessionResult.session?.username ?? result.room.guest?.username ?? null,
          hostUsername: roomWithTimer.host?.username ?? null,
          guestUsername: roomWithTimer.guest?.username ?? null,
          status: roomWithTimer.status,
          sessionId: sessionResult.session?.sessionId ?? null
        });
        if (roomWithTimer.status === "full" && Array.isArray(roomWithTimer.roundHistory) && roomWithTimer.roundHistory.length === 0) {
          logMatchEvent(logger, "Start", {
            roomCode: roomWithTimer.roomCode,
            hostUsername: roomWithTimer.host?.username ?? null,
            guestUsername: roomWithTimer.guest?.username ?? null
          });
        }
      })();
    });

    socket.on("room:listPublic", (payload = {}, respond = () => {}) => {
      void (async () => {
        respond = toAckCallback(respond);
        logRoomEvent(logger, "Public room list requested", {
          socketId: socket.id ?? null,
          username: payload?.username ?? null
        });

        try {
          const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
          if (!sessionResult?.ok) {
            const failurePayload = {
              ok: false,
              error: sessionResult.error ?? {
                code: "SESSION_REQUIRED",
                message: "A session is required to browse public rooms."
              }
            };
            socket.emit("room:publicList", failurePayload);
            respond(failurePayload);
            logRoomEvent(logger, "Public room list denied", {
              socketId: socket.id ?? null,
              errorCode: failurePayload.error?.code ?? null,
              sessionOk: false
            });
            return;
          }

          const rooms = roomStore.listPublicRooms();
          const successPayload = {
            ok: true,
            rooms
          };
          socket.emit("room:publicList", successPayload);
          respond(successPayload);
          logRoomEvent(logger, "Public rooms listed", {
            username: sessionResult.session?.username ?? null,
            count: rooms.length,
            sessionId: sessionResult.session?.sessionId ?? null,
            ackCalled: true,
            emitCalled: true
          });
        } catch (error) {
          const failurePayload = {
            ok: false,
            error: {
              code: "ROOM_LIST_ERROR",
              message: "Unable to load public rooms."
            }
          };
          socket.emit("room:publicList", failurePayload);
          respond(failurePayload);
          logger?.error?.("[Multiplayer] Public room list failed", {
            socketId: socket.id ?? null,
            message: error?.message ?? String(error)
          });
        }
      })();
    });

    socket.on("presence:getOnlineCount", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      respond({
        ok: true,
        result: {
          onlineNow:
            typeof sessionStore?.getAuthenticatedConnectedUsernameCount === "function"
              ? sessionStore.getAuthenticatedConnectedUsernameCount()
              : 0
        }
      });
    });

    socket.on("feedback:submit", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond({
          ok: false,
          error: sessionResult.error ?? {
            code: "SESSION_REQUIRED",
            message: "A session is required to send feedback."
          }
        });
        return;
      }

      if (typeof feedbackStore?.appendFeedback !== "function") {
        respond({
          ok: false,
          error: {
            code: "FEEDBACK_UNAVAILABLE",
            message: "Feedback submission is unavailable right now."
          }
        });
        return;
      }

      try {
        const result = await feedbackStore.appendFeedback({
          category: payload?.category,
          message: payload?.message,
          includeDebugInfo: payload?.includeDebugInfo !== false,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username ?? null,
          clientContext: payload?.clientContext ?? null
        });
        respond({
          ok: true,
          result: {
            feedbackId: result?.feedbackId ?? null,
            storedAt: result?.storedAt ?? null
          }
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: String(error?.code ?? "FEEDBACK_WRITE_FAILED"),
            message: String(error?.message ?? "Unable to save feedback.")
          }
        });
      }
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
        const sessionResult = buildResolvedAccountSession(socket, account, {
          rememberSession: payload?.rememberSession !== false
        });
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
        const sessionResult = buildResolvedAccountSession(socket, account, {
          rememberSession: payload?.rememberSession !== false
        });
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

    socket.on("session:resume", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const result = sessionStore.resumeSession({
        token: payload?.sessionToken,
        socketId: socket.id
      });
      if (!result?.ok) {
        respond(result);
        return;
      }

      const validationResult = await validateAuthenticatedSession(result.session);
      if (!validationResult?.ok) {
        respond(validationResult);
        return;
      }

      respond({
        ok: true,
        session: sessionStore.toPublicSession(validationResult.session)
      });
      void deliverPendingAdminNoticesForSession(validationResult.session, socket.id);
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

      if (result.roundResult) {
        clearTurnTimerSchedule(result.room.roomCode);
      } else if (result.room?.serverMatchState?.turnTimer?.active) {
        ensureRoomTurnTimer(result.room.roomCode);
        result.room = roomStore.getRoom(result.room.roomCode) ?? result.room;
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
      clearTurnTimerSchedule(result.room.roomCode);
      const roomWithTimer =
        result.room.status === "full" && !result.room.matchComplete
          ? ensureRoomTurnTimer(result.room.roomCode) ?? result.room
          : result.room;
      io.to(roomWithTimer.roomCode).emit("room:update", roomWithTimer);
    });

    socket.on("profile:get", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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

    socket.on("profile:view", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.viewProfile !== "function") {
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
        const snapshot = await profileAuthority.viewProfile(payload?.username);
        logRoomEvent(logger, "Viewed profile snapshot served", {
          targetUsername: String(payload?.username ?? "").trim() || null,
          viewerUsername: sessionResult.session?.username ?? null,
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
            code: "PROFILE_VIEW_FAILED",
            message: String(error?.message ?? "Unable to read viewed profile.")
          }
        });
      }
    });

    socket.on("profile:applyLocalMatchResult", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.applyLocalMatchResult !== "function") {
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
        const matchMode = String(payload?.matchState?.mode ?? "").trim().toLowerCase();
        if (matchMode === LOCAL_MATCH_MODES.LOCAL_PVP) {
          const error = new Error(
            "Authenticated local hotseat PvP settlements are local-only and cannot grant server rewards or stats."
          );
          error.code = "LOCAL_MATCH_UNVERIFIED_LOCAL_PVP_REJECTED";
          throw error;
        }

        let localMatchSession = null;
        if (isProtectedPveSettlement(payload?.matchState)) {
          assertSessionUsernameMatch(sessionResult.session, payload?.username);
          const localMatchSessionId = normalizeProtectedSettlementSessionId(payload);
          if (!localMatchSessionId) {
            const error = new Error(
              "Protected PvE and featured rival settlements require a server-owned local match session."
            );
            error.code = "LOCAL_MATCH_SESSION_REQUIRED";
            throw error;
          }

          localMatchSession = getLocalMatchSessionForOwnerOrThrow(
            sessionResult.session,
            localMatchSessionId
          );
          assertProtectedSettlementSessionMatch(localMatchSession, payload);
        }

        const result = await profileAuthority.applyLocalMatchResult({
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          result: payload?.matchState ?? null,
          perspective: payload?.perspective ?? "p1",
          settlementKey: payload?.settlementKey ?? null
        });

        if (localMatchSession) {
          localMatchSessions.completeSession({
            sessionId: localMatchSession.sessionId,
            username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
            metadata: {
              settlementKey: String(payload?.settlementKey ?? "").trim() || null,
              protectedMode: getRequiredProtectedSessionMode(payload?.matchState),
              aiDifficulty: localMatchSession.aiDifficulty ?? null,
              featuredRivalId: localMatchSession.featuredRivalId ?? null
            }
          });
        }

        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: error?.code ?? "PROFILE_LOCAL_MATCH_WRITE_FAILED",
            message: String(
              error?.message ?? "Unable to complete authoritative local match settlement."
            )
          }
        });
      }
    });

    socket.on("profile:applyLocalHotseatResult", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.applyLocalHotseatResult !== "function") {
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
        const matchMode = String(payload?.matchState?.mode ?? "").trim().toLowerCase();
        if (matchMode !== LOCAL_MATCH_MODES.LOCAL_PVP) {
          const error = new Error(
            "Dedicated local hotseat settlement only supports Local 2-Player match payloads."
          );
          error.code = "LOCAL_HOTSEAT_MODE_REQUIRED";
          throw error;
        }

        assertSessionUsernameMatch(sessionResult.session, payload?.username);

        const result = await profileAuthority.applyLocalHotseatResult({
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          result: payload?.matchState ?? null,
          perspective: payload?.perspective ?? "p1",
          settlementKey: payload?.settlementKey ?? null
        });

        respond({
          ok: true,
          result
        });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: error?.code ?? "PROFILE_LOCAL_HOTSEAT_WRITE_FAILED",
            message: String(
              error?.message ?? "Unable to complete authoritative local hotseat settlement."
            )
          }
        });
      }
    });

    socket.on("profile:startLocalPveMatch", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      try {
        assertSessionUsernameMatch(sessionResult.session, payload?.username);
        const requestedMode = payload?.mode;
        if (
          requestedMode !== undefined &&
          normalizeLocalMatchMode(requestedMode) !== LOCAL_MATCH_MODES.PVE
        ) {
          const error = new Error("profile:startLocalPveMatch only accepts PvE mode.");
          error.code = "LOCAL_MATCH_INVALID_MODE";
          throw error;
        }

        const aiDifficulty = normalizeLocalMatchDifficulty(payload?.aiDifficulty);
        if (!aiDifficulty) {
          const error = new Error("A valid AI difficulty is required for PvE local match sessions.");
          error.code = "LOCAL_MATCH_INVALID_DIFFICULTY";
          throw error;
        }

        const featuredRivalId =
          payload?.featuredRivalId === undefined
            ? null
            : normalizeFeaturedRivalId(payload?.featuredRivalId);
        if (payload?.featuredRivalId !== undefined && !featuredRivalId) {
          const error = new Error("A valid featured rival ID is required when starting a featured PvE match.");
          error.code = "LOCAL_MATCH_INVALID_FEATURED_RIVAL";
          throw error;
        }

        const session = localMatchSessions.createSession({
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          mode: LOCAL_MATCH_MODES.PVE,
          aiDifficulty,
          featuredRivalId,
          metadata: {
            authority: "server-local-session",
            sessionType: featuredRivalId ? LOCAL_MATCH_MODES.FEATURED_RIVAL : LOCAL_MATCH_MODES.PVE
          }
        });

        respond({
          ok: true,
          result: {
            session
          }
        });
      } catch (error) {
        respond(buildLocalMatchSessionError(error, "LOCAL_MATCH_START_FAILED"));
      }
    });

    socket.on("profile:startFeaturedRivalMatch", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      try {
        assertSessionUsernameMatch(sessionResult.session, payload?.username);
        const featuredRivalId = normalizeFeaturedRivalId(payload?.featuredRivalId);
        if (!featuredRivalId) {
          const error = new Error("A valid featured rival ID is required to start a featured rival match.");
          error.code = "LOCAL_MATCH_INVALID_FEATURED_RIVAL";
          throw error;
        }

        const aiDifficulty = normalizeLocalMatchDifficulty(payload?.aiDifficulty);
        if (!aiDifficulty) {
          const error = new Error("A valid AI difficulty is required for featured rival match sessions.");
          error.code = "LOCAL_MATCH_INVALID_DIFFICULTY";
          throw error;
        }

        const session = localMatchSessions.createSession({
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          mode: LOCAL_MATCH_MODES.FEATURED_RIVAL,
          aiDifficulty,
          featuredRivalId,
          metadata: {
            authority: "server-local-session",
            sessionType: LOCAL_MATCH_MODES.FEATURED_RIVAL
          }
        });

        respond({
          ok: true,
          result: {
            session
          }
        });
      } catch (error) {
        respond(buildLocalMatchSessionError(error, "LOCAL_MATCH_START_FAILED"));
      }
    });

    socket.on("profile:startGauntletMatch", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      try {
        assertSessionUsernameMatch(sessionResult.session, payload?.username);
        const requestedMode = payload?.mode;
        if (
          requestedMode !== undefined &&
          normalizeLocalMatchMode(requestedMode) !== LOCAL_MATCH_MODES.GAUNTLET
        ) {
          const error = new Error("profile:startGauntletMatch only accepts gauntlet mode.");
          error.code = "LOCAL_MATCH_INVALID_MODE";
          throw error;
        }

        const gauntletRivalId = normalizeGauntletRivalId(payload?.gauntletRivalId);
        if (!gauntletRivalId) {
          const error = new Error("A valid gauntlet rival ID is required to start a gauntlet match.");
          error.code = "LOCAL_MATCH_INVALID_GAUNTLET_RIVAL";
          throw error;
        }

        const aiDifficulty = normalizeLocalMatchDifficulty(payload?.aiDifficulty);
        if (!aiDifficulty) {
          const error = new Error("A valid AI difficulty is required for gauntlet match sessions.");
          error.code = "LOCAL_MATCH_INVALID_DIFFICULTY";
          throw error;
        }

        const continuationSessionId = String(
          payload?.previousSessionId ?? payload?.continuationSessionId ?? ""
        ).trim() || null;
        const inheritedSessionState = continuationSessionId
          ? getGauntletSessionState(
              getGauntletContinuationSessionForOwnerOrThrow(
                sessionResult.session,
                continuationSessionId
              )
            )
          : {
              currentStreak: 0,
              claimedMilestoneStreaks: [],
              defeatedRivalIds: [],
              runCounted: false
            };

        const session = localMatchSessions.createSession({
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          mode: LOCAL_MATCH_MODES.GAUNTLET,
          aiDifficulty,
          gauntletRivalId,
          metadata: {
            authority: "server-local-session",
            sessionType: LOCAL_MATCH_MODES.GAUNTLET,
            currentStreak: inheritedSessionState.currentStreak,
            claimedMilestoneStreaks: inheritedSessionState.claimedMilestoneStreaks,
            defeatedRivalIds: inheritedSessionState.defeatedRivalIds,
            runCounted: inheritedSessionState.runCounted,
            previousSessionId: continuationSessionId
          }
        });

        respond({
          ok: true,
          result: {
            session
          }
        });
      } catch (error) {
        respond(buildLocalMatchSessionError(error, "LOCAL_MATCH_START_FAILED"));
      }
    });

    socket.on("profile:getLocalMatchSessionState", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      try {
        assertSessionUsernameMatch(sessionResult.session, payload?.username);
        const session = getLocalMatchSessionForOwnerOrThrow(
          sessionResult.session,
          payload?.sessionId
        );
        respond({
          ok: true,
          result: {
            session: localMatchSessions.toPublicSession(session)
          }
        });
      } catch (error) {
        respond(buildLocalMatchSessionError(error, "LOCAL_MATCH_STATE_READ_FAILED"));
      }
    });

    socket.on("profile:abandonLocalMatchSession", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      try {
        assertSessionUsernameMatch(sessionResult.session, payload?.username);
        const activeSession = getLocalMatchSessionForOwnerOrThrow(
          sessionResult.session,
          payload?.sessionId
        );
        const abandoned = localMatchSessions.abandonSession({
          sessionId: activeSession.sessionId,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username
        });
        respond({
          ok: true,
          result: {
            session: abandoned
          }
        });
      } catch (error) {
        respond(buildLocalMatchSessionError(error, "LOCAL_MATCH_ABANDON_FAILED"));
      }
    });

    socket.on("profile:recordGauntletStats", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: false
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

      if (typeof profileAuthority?.recordGauntletStats !== "function") {
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
        assertSessionUsernameMatch(sessionResult.session, payload?.username);
        const localMatchSessionId = normalizeProtectedSettlementSessionId(payload);
        if (!localMatchSessionId) {
          const error = new Error("Gauntlet stat updates require a server-owned gauntlet session.");
          error.code = "LOCAL_MATCH_SESSION_REQUIRED";
          throw error;
        }

        const gauntletSession = getLocalMatchSessionForOwnerOrThrow(
          sessionResult.session,
          localMatchSessionId
        );
        if (gauntletSession.mode !== LOCAL_MATCH_MODES.GAUNTLET) {
          const error = new Error("This local match session is not a gauntlet session.");
          error.code = "LOCAL_MATCH_SESSION_MODE_MISMATCH";
          throw error;
        }
        if (!["active"].includes(gauntletSession.status)) {
          const error = new Error("This gauntlet session is no longer active.");
          error.code =
            gauntletSession.status === "completed"
              ? "LOCAL_MATCH_SESSION_ALREADY_COMPLETED"
              : "LOCAL_MATCH_SESSION_INACTIVE";
          throw error;
        }

        assertGauntletSessionPayloadMatchesServerState(gauntletSession, payload);
        const gauntletSessionState = getGauntletSessionState(gauntletSession);
        if (payload?.runStarted === true && gauntletSessionState.runCounted) {
          const error = new Error("This gauntlet run has already been started.");
          error.code = "LOCAL_MATCH_GAUNTLET_RUN_ALREADY_STARTED";
          throw error;
        }
        const authoritativeCurrentStreak =
          payload?.matchWon === true
            ? gauntletSessionState.currentStreak + 1
            : gauntletSessionState.currentStreak;

        const result = await profileAuthority.recordGauntletStats({
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          runStarted: payload?.runStarted === true,
          matchWon: payload?.matchWon === true,
          runEndedWithLoss: payload?.runEndedWithLoss === true,
          currentStreak: authoritativeCurrentStreak,
          claimedMilestoneStreaks: gauntletSessionState.claimedMilestoneStreaks
        });

        const updatedClaimedMilestoneStreaks = normalizeClaimedGauntletMilestoneStreaks(
          result?.claimedMilestoneStreaks ?? gauntletSessionState.claimedMilestoneStreaks
        );
        const updatedDefeatedRivalIds =
          payload?.matchWon === true
            ? [...gauntletSessionState.defeatedRivalIds, normalizeGauntletRivalId(gauntletSession.gauntletRivalId)].filter(Boolean)
            : gauntletSessionState.defeatedRivalIds;
        const updatedSession = localMatchSessions.updateSession({
          sessionId: gauntletSession.sessionId,
          username: sessionResult.session?.profileKey ?? sessionResult.session?.username,
          status:
            payload?.runEndedWithLoss === true
              ? "lost"
              : payload?.matchWon === true
                ? "completed"
                : "active",
          metadata: {
            authority: gauntletSession.metadata?.authority ?? "server-local-session",
            sessionType: LOCAL_MATCH_MODES.GAUNTLET,
            previousSessionId: gauntletSession.metadata?.previousSessionId ?? null,
            runCounted: gauntletSessionState.runCounted || payload?.runStarted === true,
            currentStreak: authoritativeCurrentStreak,
            claimedMilestoneStreaks: updatedClaimedMilestoneStreaks,
            defeatedRivalIds: updatedDefeatedRivalIds
          }
        });
        respond({
          ok: true,
          result: {
            ...result,
            gauntletSession: updatedSession
          }
        });
      } catch (error) {
        respond(buildLocalMatchSessionError(error, "PROFILE_GAUNTLET_STATS_WRITE_FAILED"));
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

    socket.on("admin:grantFounderStatus", async (payload = {}, respond = () => {}) => {
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
              message: "username is required for founder grants."
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
              message: "transactionId is required for founder grants."
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
      if (typeof profileAuthority?.grantFounderStatus !== "function") {
        respond(
          buildAdminError(
            {
              code: "PROFILE_AUTHORITY_UNAVAILABLE",
              message: "Server founder grant authority is not available."
            },
            "PROFILE_AUTHORITY_UNAVAILABLE"
          )
        );
        return;
      }

      const existingUsernameFlight = inFlightFounderGrants.get(targetUsername);
      if (existingUsernameFlight) {
        respond({
          ok: false,
          duplicate: true,
          error: {
            code: "ADMIN_FOUNDER_GRANT_IN_PROGRESS",
            message: "A Founder Status grant is already being processed for this username."
          }
        });
        return;
      }

      const founderGrantPayload = {
        founderStatus: true,
        founderBundle: [
          { type: "title", cosmeticId: "Arena Founder" },
          { type: "badge", cosmeticId: "supporter_badge" },
          { type: "cardBack", cosmeticId: "founder_deluxe_card_back" }
        ]
      };

      const founderFlight = (async () => {
        const transactionStart = await adminGrantStore.beginTransaction({
          transactionId,
          timestamp: new Date().toISOString(),
          adminId: adminAccess.adminIdentifier,
          targetUsername,
          grantType: "founder_status_grant",
          payload: founderGrantPayload,
          adminSocketId: socket.id
        });

        if (transactionStart.duplicate) {
          const existing = transactionStart.entry;
          if (existing?.status === "success") {
            return {
              ok: true,
              duplicate: true,
              result: buildAdminGrantStatusPayload(existing)
            };
          }

          return {
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
                  ? "This Founder Status transaction previously failed."
                  : "This Founder Status transaction is already being processed.")
            },
            result: buildAdminGrantStatusPayload(existing)
          };
        }

        try {
          const grantResult = await profileAuthority.grantFounderStatus({
            username: targetUsername
          });
          const grantedItems = Array.isArray(grantResult?.grantedItems) ? grantResult.grantedItems : [];
          const skippedItems = Array.isArray(grantResult?.skippedItems) ? grantResult.skippedItems : [];
          const noticeRequired =
            Boolean(grantResult?.supporterPassActivated) || grantedItems.length > 0;
          const noticeMessage = noticeRequired
            ? buildFounderGrantNoticeMessage(grantedItems, skippedItems)
            : null;
          const targetSocketId = noticeRequired
            ? sessionStore.getSocketIdByUsername(targetUsername)
            : null;

          let finalizedEntry = await adminGrantStore.finalizeTransaction({
            transactionId,
            status: "success",
            result: {
              profile: grantResult?.snapshot ?? null,
              founderStatusActive: Boolean(grantResult?.founderStatusActive),
              supporterPassActivated: Boolean(grantResult?.supporterPassActivated),
              grantedItems,
              skippedItems,
              noticeMessage,
              noticeQueued: Boolean(noticeRequired && targetSocketId),
              noticeRequired,
              cosmetics: grantResult?.cosmetics ?? null
            },
            confirmationStatus: noticeRequired
              ? targetSocketId
                ? "awaiting_player"
                : "player_offline"
              : "confirmed",
            error: null
          });

          if (targetSocketId) {
            finalizedEntry = await adminGrantStore.markDelivered({
              transactionId,
              confirmationStatus: "awaiting_player"
            });
            io.to(targetSocketId).emit("admin:grantNotice", buildAdminGrantNoticePayload(finalizedEntry));
          }

          return {
            ok: true,
            result: buildAdminGrantStatusPayload(finalizedEntry)
          };
        } catch (error) {
          const finalizedEntry = await adminGrantStore
            .finalizeTransaction({
              transactionId,
              status: "failure",
              result: null,
              confirmationStatus: "failed",
              error: {
                code: error?.code ?? "ADMIN_FOUNDER_GRANT_FAILED",
                message: String(error?.message ?? "Unable to apply Founder Status.")
              }
            })
            .catch(() => null);

          return {
            ...buildAdminError(error, "ADMIN_FOUNDER_GRANT_FAILED"),
            ...(finalizedEntry ? { result: buildAdminGrantStatusPayload(finalizedEntry) } : {})
          };
        }
      })();

      inFlightFounderGrants.set(targetUsername, founderFlight);
      try {
        respond(await founderFlight);
      } finally {
        if (inFlightFounderGrants.get(targetUsername) === founderFlight) {
          inFlightFounderGrants.delete(targetUsername);
        }
      }
    });

    socket.on("admin:confirmGrantReceipt", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
        const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
          allowBootstrap: true
        });
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

    socket.on("profile:acknowledgeAnnouncement", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
      if (!sessionResult?.ok) {
        respond(sessionResult);
        return;
      }

        if (typeof profileAuthority?.acknowledgeAnnouncement !== "function") {
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
          const result = await profileAuthority.acknowledgeAnnouncement({
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
              code: "PROFILE_ANNOUNCEMENT_WRITE_FAILED",
              message: String(error?.message ?? "Unable to acknowledge the announcement.")
            }
          });
        }
      });

      socket.on("announcements:list", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        if (typeof profileAuthority?.listAnnouncements !== "function") {
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
          const result = await profileAuthority.listAnnouncements(
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
              code: "ANNOUNCEMENTS_LIST_FAILED",
              message: String(error?.message ?? "Unable to load announcements.")
            }
          });
        }
      });

      socket.on("announcements:dismiss", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        if (typeof profileAuthority?.dismissAnnouncement !== "function") {
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
          const result = await profileAuthority.dismissAnnouncement({
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
              code: "ANNOUNCEMENT_DISMISS_FAILED",
              message: String(error?.message ?? "Unable to dismiss the announcement.")
            }
          });
        }
      });

      socket.on("boostEvent:getActive", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        if (typeof boostEventStore?.getActiveEvent !== "function") {
          respond({
            ok: true,
            result: {
              boostEvent: null
            }
          });
          return;
        }

        try {
          const boostEvent = await boostEventStore.getActiveEvent();
          respond({
            ok: true,
            result: {
              boostEvent
            }
          });
        } catch (error) {
          respond({
            ok: false,
            error: {
              code: "BOOST_EVENT_READ_FAILED",
              message: String(error?.message ?? "Unable to load the active boost event.")
            }
          });
        }
      });

      socket.on("shopRotation:getActive", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureSocketSession(socket, payload, { allowBootstrap: true });
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        if (typeof shopRotationStore?.getActiveRotation !== "function") {
          respond({
            ok: true,
            result: {
              rotation: null
            }
          });
          return;
        }

        try {
          const rotation = await shopRotationStore.getActiveRotation();
          respond({
            ok: true,
            result: {
              rotation
            }
          });
        } catch (error) {
          respond({
            ok: false,
            error: {
              code: "SHOP_ROTATION_READ_FAILED",
              message: String(error?.message ?? "Unable to load the featured shop rotation.")
            }
          });
        }
      });

      socket.on("admin:getBoostEvent", async (payload = {}, respond = () => {}) => {
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

        if (typeof boostEventStore?.readConfig !== "function" || typeof boostEventStore?.getActiveEvent !== "function") {
          respond({
            ok: true,
            result: {
              config: null,
              activeEvent: null
            }
          });
          return;
        }

        try {
          const config = await boostEventStore.readConfig();
          const activeEvent = await boostEventStore.getActiveEvent();
          respond({
            ok: true,
            result: {
              config,
              activeEvent
            }
          });
        } catch (error) {
          respond(buildAdminError(error, "BOOST_EVENT_READ_FAILED"));
        }
      });

      socket.on("admin:upsertBoostEvent", async (payload = {}, respond = () => {}) => {
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

        if (typeof boostEventStore?.upsertConfig !== "function" || typeof boostEventStore?.getActiveEvent !== "function") {
          respond(
            buildAdminError(
              {
                code: "BOOST_EVENT_STORE_UNAVAILABLE",
                message: "Boost event config storage is not available."
              },
              "BOOST_EVENT_STORE_UNAVAILABLE"
            )
          );
          return;
        }

        try {
          const config = await boostEventStore.upsertConfig(payload);
          const activeEvent = await boostEventStore.getActiveEvent();
          respond({
            ok: true,
            result: {
              config,
              activeEvent
            }
          });
        } catch (error) {
          respond(buildAdminError(error, error?.code ?? "BOOST_EVENT_WRITE_FAILED"));
        }
      });

      socket.on("admin:clearBoostEvent", async (payload = {}, respond = () => {}) => {
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

        if (typeof boostEventStore?.clearConfig !== "function") {
          respond(
            buildAdminError(
              {
                code: "BOOST_EVENT_STORE_UNAVAILABLE",
                message: "Boost event config storage is not available."
              },
              "BOOST_EVENT_STORE_UNAVAILABLE"
            )
          );
          return;
        }

        try {
          await boostEventStore.clearConfig();
          respond({
            ok: true,
            result: {
              cleared: true,
              config: null,
              activeEvent: null
            }
          });
        } catch (error) {
          respond(buildAdminError(error, "BOOST_EVENT_CLEAR_FAILED"));
        }
      });

      socket.on("profile:claimDailyLoginReward", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
          allowBootstrap: true
        });
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

      socket.on("profile:acknowledgeMilestoneChestReward", async (payload = {}, respond = () => {}) => {
        respond = toAckCallback(respond);
        const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
          allowBootstrap: true
        });
        if (!sessionResult?.ok) {
          respond(sessionResult);
          return;
        }

        if (typeof profileAuthority?.acknowledgeMilestoneChestReward !== "function") {
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
          const result = await profileAuthority.acknowledgeMilestoneChestReward({
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
              code: "PROFILE_MILESTONE_REWARD_WRITE_FAILED",
              message: String(
                error?.message ?? "Unable to acknowledge the milestone reward notice."
              )
            }
          });
        }
      });

      socket.on("profile:buyStoreItem", async (payload = {}, respond = () => {}) => {
      respond = toAckCallback(respond);
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      const sessionResult = await ensureClaimedProfileAccess(socket, payload, {
        allowBootstrap: true
      });
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
      clearTurnTimerSchedule(roomResult.removedRoomCode ?? roomResult.room?.roomCode ?? null);
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
      for (const roomCode of roomTurnTimers.keys()) {
        clearTurnTimerSchedule(roomCode);
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
