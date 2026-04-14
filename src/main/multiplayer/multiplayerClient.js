import fs from "node:fs";
import path from "node:path";
import { io as createSocket } from "socket.io-client";
import { JsonStore } from "../../state/storage/jsonStore.js";
import { formatServerTimestamp } from "../../multiplayer/logger.js";

export const DEFAULT_MULTIPLAYER_SERVER_URL = "https://uncatchable-jonelle-pronouncedly.ngrok-free.dev";
const MULTIPLAYER_SESSION_SCHEMA_VERSION = 1;
const MULTIPLAYER_SESSION_FILENAME = "multiplayer-session.json";
const AUTHENTICATED_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const ROOM_ACTION_TIMEOUT_MS = 2000;
const SUBMIT_MOVE_TIMEOUT_MS = 2000;
const INVALID_SESSION_ERROR_CODES = new Set([
  "SESSION_NOT_FOUND",
  "SESSION_TOKEN_REQUIRED",
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "AUTH_REQUIRED"
]);

function clonePlayer(player) {
  return player
    ? {
        ...player,
        equippedCosmetics: player.equippedCosmetics
          ? {
              ...player.equippedCosmetics,
              elementCardVariant: {
                ...(player.equippedCosmetics.elementCardVariant ?? {})
              }
            }
          : null
      }
    : null;
}

function cloneServerMatchState(matchState) {
  return matchState
    ? {
        roomCode: matchState.roomCode ?? null,
        matchId: matchState.matchId ?? null,
        players: {
          host: matchState.players?.host ? { ...matchState.players.host } : null,
          guest: matchState.players?.guest ? { ...matchState.players.guest } : null
        },
        currentRound: Number(matchState.currentRound ?? 1),
        activeStep: matchState.activeStep
          ? {
              id: matchState.activeStep.id ?? null,
              round: Number(matchState.activeStep.round ?? 1),
              type: matchState.activeStep.type ?? null,
              warDepth: Number(matchState.activeStep.warDepth ?? 0),
              status: matchState.activeStep.status ?? null
            }
          : null,
        playerHands: {
          host: { ...(matchState.playerHands?.host ?? {}) },
          guest: { ...(matchState.playerHands?.guest ?? {}) }
        },
        warState: {
          active: Boolean(matchState.warState?.active),
          depth: Number(matchState.warState?.depth ?? 0)
        },
        pendingActions: {
          host: matchState.pendingActions?.host ? { ...matchState.pendingActions.host } : null,
          guest: matchState.pendingActions?.guest ? { ...matchState.pendingActions.guest } : null
        },
        matchStatus: matchState.matchStatus ?? "waiting",
        lastResolvedOutcome: matchState.lastResolvedOutcome
          ? {
              stepId: matchState.lastResolvedOutcome.stepId ?? null,
              resolvedAt: matchState.lastResolvedOutcome.resolvedAt ?? null,
              round: Number(matchState.lastResolvedOutcome.round ?? 0),
              type: matchState.lastResolvedOutcome.type ?? null,
              winner: matchState.lastResolvedOutcome.winner ?? null,
              hostMove: matchState.lastResolvedOutcome.hostMove ?? null,
              guestMove: matchState.lastResolvedOutcome.guestMove ?? null
            }
          : null,
        turnState: matchState.turnState
          ? {
              waitingOn: Array.isArray(matchState.turnState.waitingOn)
                ? [...matchState.turnState.waitingOn]
                : [],
              lockedIn: Array.isArray(matchState.turnState.lockedIn)
                ? [...matchState.turnState.lockedIn]
                : [],
              resolutionReady: Boolean(matchState.turnState.resolutionReady)
            }
          : null
      }
    : null;
}

function cloneRewardSettlement(rewardSettlement) {
  return rewardSettlement
    ? {
        granted: Boolean(rewardSettlement.granted),
        grantedAt: rewardSettlement.grantedAt ?? null,
        settlementKey: rewardSettlement.settlementKey ?? null,
        decision: rewardSettlement.decision
          ? {
              matchId: rewardSettlement.decision.matchId ?? null,
              roomCode: rewardSettlement.decision.roomCode ?? null,
              winner: rewardSettlement.decision.winner ?? null,
              isDraw: Boolean(rewardSettlement.decision.isDraw),
              settlementKey: rewardSettlement.decision.settlementKey ?? null,
              rewards: {
                host: { ...(rewardSettlement.decision.rewards?.host ?? {}) },
                guest: { ...(rewardSettlement.decision.rewards?.guest ?? {}) }
              },
              participants: {
                hostUsername: rewardSettlement.decision.participants?.hostUsername ?? null,
                guestUsername: rewardSettlement.decision.participants?.guestUsername ?? null
              },
              decidedAt: rewardSettlement.decision.decidedAt ?? null
            }
          : null,
        summary: rewardSettlement.summary
          ? {
              granted: Boolean(rewardSettlement.summary.granted),
              winner: rewardSettlement.summary.winner ?? null,
              settledHostUsername: rewardSettlement.summary.settledHostUsername ?? null,
              settledGuestUsername: rewardSettlement.summary.settledGuestUsername ?? null,
              hostRewards: { ...(rewardSettlement.summary.hostRewards ?? {}) },
              guestRewards: { ...(rewardSettlement.summary.guestRewards ?? {}) }
            }
          : null
      }
    : null;
}

function cloneAdminGrantNotice(notice) {
  return notice
    ? {
        transactionId: notice.transactionId ?? null,
        targetUsername: notice.targetUsername ?? null,
        message: notice.message ?? "",
        payload: {
          xp: Number(notice.payload?.xp ?? 0),
          tokens: Number(notice.payload?.tokens ?? 0),
          chests: Array.isArray(notice.payload?.chests)
            ? notice.payload.chests.map((entry) => ({
                chestType: entry?.chestType ?? null,
                amount: Number(entry?.amount ?? 0)
              }))
            : []
        },
        timestamp: notice.timestamp ?? null
      }
    : null;
}

function toRoundResultOutcomeType(authoritativeOutcomeType) {
  const safeType = String(authoritativeOutcomeType ?? "").trim();
  if (safeType === "win") {
    return "resolved";
  }

  if (safeType === "war_start" || safeType === "war_continue") {
    return "war";
  }

  if (safeType === "war_resolved") {
    return "war_resolved";
  }

  if (safeType === "no_effect") {
    return "no_effect";
  }

  return null;
}

function toRoundSideResult(authoritativeOutcomeType, authoritativeWinner, side) {
  const safeType = String(authoritativeOutcomeType ?? "").trim();
  const safeWinner = String(authoritativeWinner ?? "").trim();
  const safeSide = String(side ?? "").trim();

  if (safeType === "no_effect") {
    return "no_effect";
  }

  if (safeType === "war_start" || safeType === "war_continue") {
    return "war";
  }

  if (safeWinner === "host" || safeWinner === "guest") {
    return safeWinner === safeSide ? "win" : "lose";
  }

  return "no_effect";
}

function buildRoundResultFromRoomSnapshot(room, matchSnapshot, lastResolvedOutcome) {
  if (!room || !matchSnapshot || !lastResolvedOutcome) {
    return null;
  }

  const outcomeType = toRoundResultOutcomeType(lastResolvedOutcome.type);
  if (!outcomeType) {
    return null;
  }

  return {
    roomCode: room.roomCode ?? matchSnapshot.roomCode ?? null,
    round: Number(lastResolvedOutcome.round ?? 0),
    hostMove: lastResolvedOutcome.hostMove ?? null,
    guestMove: lastResolvedOutcome.guestMove ?? null,
    outcomeType,
    hostScore: Number(room.hostScore ?? 0),
    guestScore: Number(room.guestScore ?? 0),
    roundNumber: Number(room.roundNumber ?? matchSnapshot.currentRound ?? 1),
    lastOutcomeType: outcomeType,
    matchComplete: Boolean(room.matchComplete),
    winner: room.winner ?? null,
    winReason: room.winReason ?? null,
    rematch: {
      hostReady: Boolean(room.rematch?.hostReady),
      guestReady: Boolean(room.rematch?.guestReady)
    },
    rewardSettlement: room.rewardSettlement ? cloneRewardSettlement(room.rewardSettlement) : null,
    hostHand: { ...(room.hostHand ?? {}) },
    guestHand: { ...(room.guestHand ?? {}) },
    warPot: {
      host: Array.isArray(room.warPot?.host) ? [...room.warPot.host] : [],
      guest: Array.isArray(room.warPot?.guest) ? [...room.warPot.guest] : []
    },
    warActive: Boolean(room.warActive),
    warDepth: Number(room.warDepth ?? 0),
    warRounds: Array.isArray(room.warRounds) ? room.warRounds.map((entry) => ({ ...entry })) : [],
    hostResult: toRoundSideResult(lastResolvedOutcome.type, lastResolvedOutcome.winner, "host"),
    guestResult: toRoundSideResult(lastResolvedOutcome.type, lastResolvedOutcome.winner, "guest")
  };
}

function buildAuthoritativeRoundResultFromRoomSnapshot(room) {
  const matchSnapshot = cloneServerMatchState(room?.serverMatchState);
  const lastResolvedOutcome = matchSnapshot?.lastResolvedOutcome ?? null;
  if (!room || !matchSnapshot || !lastResolvedOutcome?.stepId) {
    return null;
  }

  const roundResult = buildRoundResultFromRoomSnapshot(room, matchSnapshot, lastResolvedOutcome);
  if (!roundResult) {
    return null;
  }

  return {
    roomCode: room.roomCode ?? matchSnapshot.roomCode ?? null,
    matchId: matchSnapshot.matchId ?? null,
    stepId: lastResolvedOutcome.stepId ?? null,
    submittedCards: {
      host: lastResolvedOutcome.hostMove ?? null,
      guest: lastResolvedOutcome.guestMove ?? null
    },
    authoritativeOutcomeType: lastResolvedOutcome.type ?? null,
    authoritativeWinner: lastResolvedOutcome.winner ?? null,
    roundResult,
    matchSnapshot,
    animation: {
      clearWarStateAfterDelay: lastResolvedOutcome.type === "war_resolved",
      matchComplete: Boolean(room.matchComplete)
    },
    syncSource: "room_snapshot"
  };
}

function cloneAuthoritativeRoundResult(result) {
  return result
    ? {
        roomCode: result.roomCode ?? null,
        matchId: result.matchId ?? null,
        stepId: result.stepId ?? null,
        submittedCards: {
          host: result.submittedCards?.host ?? null,
          guest: result.submittedCards?.guest ?? null
        },
        authoritativeOutcomeType: result.authoritativeOutcomeType ?? null,
        authoritativeWinner: result.authoritativeWinner ?? null,
        roundResult: cloneRoundResult(result.roundResult),
        matchSnapshot: cloneServerMatchState(result.matchSnapshot),
        animation: result.animation
          ? {
              clearWarStateAfterDelay: Boolean(result.animation.clearWarStateAfterDelay),
              matchComplete: Boolean(result.animation.matchComplete)
            }
          : null,
        syncSource: result.syncSource ?? null
      }
    : null;
}

function parseStepId(stepId) {
  const value = String(stepId ?? "").trim();
  if (!value) {
    return null;
  }

  const matchId = value.includes(":round:") ? value.slice(0, value.indexOf(":round:")) : null;
  const roundMatch = value.match(/:round:(\d+):/);
  const typeMatch = value.match(/:step:([^:]+):/);
  const warDepthMatch = value.match(/:warDepth:(\d+)$/);

  return {
    raw: value,
    matchId,
    round: Number(roundMatch?.[1] ?? 0),
    type: typeMatch?.[1] ?? null,
    warDepth: Number(warDepthMatch?.[1] ?? 0)
  };
}

function compareStepIdentity(left, right) {
  const leftStep = parseStepId(left);
  const rightStep = parseStepId(right);

  if (!leftStep || !rightStep) {
    return 0;
  }

  if (leftStep.matchId && rightStep.matchId && leftStep.matchId !== rightStep.matchId) {
    return 0;
  }

  if (leftStep.round !== rightStep.round) {
    return leftStep.round - rightStep.round;
  }

  const typeRank = (value) => (value === "war" ? 1 : value === "round" ? 0 : -1);
  if (typeRank(leftStep.type) !== typeRank(rightStep.type)) {
    return typeRank(leftStep.type) - typeRank(rightStep.type);
  }

  return leftStep.warDepth - rightStep.warDepth;
}

function extractRoomSnapshotIdentity(room) {
  const matchId = String(room?.serverMatchState?.matchId ?? "").trim();
  const activeStepId = String(room?.serverMatchState?.activeStep?.id ?? "").trim();
  const lastResolvedStepId = String(room?.serverMatchState?.lastResolvedOutcome?.stepId ?? "").trim();

  return {
    matchId: matchId || null,
    activeStepId: activeStepId || null,
    lastResolvedStepId: lastResolvedStepId || null
  };
}

function getRewardSettlementKey(room) {
  const settlementKey = String(
    room?.rewardSettlement?.decision?.settlementKey ??
      room?.rewardSettlement?.settlementKey ??
      ""
  ).trim();

  return settlementKey || null;
}

function cloneRoom(room) {
  return room
    ? {
        roomCode: room.roomCode,
        createdAt: room.createdAt,
        host: clonePlayer(room.host),
        guest: clonePlayer(room.guest),
        status: room.status,
        closingAt: room.closingAt ?? null,
        disconnectState: room.disconnectState
          ? {
              active: Boolean(room.disconnectState.active),
              disconnectedRole: room.disconnectState.disconnectedRole ?? null,
              disconnectedUsername: room.disconnectState.disconnectedUsername ?? null,
              remainingUsername: room.disconnectState.remainingUsername ?? null,
              reason: room.disconnectState.reason ?? null,
              expiresAt: room.disconnectState.expiresAt ?? null,
              resumedAt: room.disconnectState.resumedAt ?? null
            }
          : null,
        hostScore: Number(room.hostScore ?? 0),
        guestScore: Number(room.guestScore ?? 0),
        roundNumber: Number(room.roundNumber ?? 1),
        lastOutcomeType: room.lastOutcomeType ?? null,
        matchComplete: Boolean(room.matchComplete),
        winner: room.winner ?? null,
        winReason: room.winReason ?? null,
        rematch: {
          hostReady: Boolean(room.rematch?.hostReady),
          guestReady: Boolean(room.rematch?.guestReady)
        },
        rewardSettlement: room.rewardSettlement
          ? cloneRewardSettlement(room.rewardSettlement)
          : null,
        hostHand: { ...(room.hostHand ?? {}) },
        guestHand: { ...(room.guestHand ?? {}) },
        warPot: {
          host: Array.isArray(room.warPot?.host) ? [...room.warPot.host] : [],
          guest: Array.isArray(room.warPot?.guest) ? [...room.warPot.guest] : []
        },
        warActive: Boolean(room.warActive),
        warDepth: Number(room.warDepth ?? 0),
        warRounds: Array.isArray(room.warRounds) ? room.warRounds.map((entry) => ({ ...entry })) : [],
        roundHistory: Array.isArray(room.roundHistory) ? room.roundHistory.map((entry) => ({ ...entry })) : [],
        moveSync: room.moveSync ? { ...room.moveSync } : null,
        serverMatchState: cloneServerMatchState(room.serverMatchState),
        taunts: Array.isArray(room.taunts) ? room.taunts.map((entry) => ({ ...entry })) : []
      }
    : null;
}

function cloneRoundResult(roundResult) {
  return roundResult
    ? {
        roomCode: roundResult.roomCode,
        round: Number(roundResult.round ?? 0),
        hostMove: roundResult.hostMove,
        guestMove: roundResult.guestMove,
        outcomeType: roundResult.outcomeType,
        hostScore: Number(roundResult.hostScore ?? 0),
        guestScore: Number(roundResult.guestScore ?? 0),
        roundNumber: Number(roundResult.roundNumber ?? 1),
        lastOutcomeType: roundResult.lastOutcomeType ?? null,
        matchComplete: Boolean(roundResult.matchComplete),
        winner: roundResult.winner ?? null,
        winReason: roundResult.winReason ?? null,
        rematch: {
          hostReady: Boolean(roundResult.rematch?.hostReady),
          guestReady: Boolean(roundResult.rematch?.guestReady)
        },
        rewardSettlement: roundResult.rewardSettlement
          ? cloneRewardSettlement(roundResult.rewardSettlement)
          : null,
        hostHand: { ...(roundResult.hostHand ?? {}) },
        guestHand: { ...(roundResult.guestHand ?? {}) },
        warPot: {
          host: Array.isArray(roundResult.warPot?.host) ? [...roundResult.warPot.host] : [],
          guest: Array.isArray(roundResult.warPot?.guest) ? [...roundResult.warPot.guest] : []
        },
        warActive: Boolean(roundResult.warActive),
        warDepth: Number(roundResult.warDepth ?? 0),
        warRounds: Array.isArray(roundResult.warRounds) ? roundResult.warRounds.map((entry) => ({ ...entry })) : [],
        hostResult: roundResult.hostResult,
        guestResult: roundResult.guestResult
      }
    : null;
}

function cloneState(state) {
  return {
    serverUrl: state.serverUrl,
    connectionStatus: state.connectionStatus,
    socketId: state.socketId,
    session: state.session
      ? {
          active: Boolean(state.session.active),
          username: state.session.username ?? null,
          sessionId: state.session.sessionId ?? null,
          accountId: state.session.accountId ?? null,
          profileKey: state.session.profileKey ?? null,
          authenticated: Boolean(state.session.authenticated)
        }
      : {
          active: false,
          username: null,
          sessionId: null,
          accountId: null,
          profileKey: null,
          authenticated: false
        },
    room: cloneRoom(state.room),
    latestRoundResult: cloneRoundResult(state.latestRoundResult),
    latestAuthoritativeRoundResult: cloneAuthoritativeRoundResult(state.latestAuthoritativeRoundResult),
    pendingAdminGrantNotices: Array.isArray(state.pendingAdminGrantNotices)
      ? state.pendingAdminGrantNotices.map((entry) => cloneAdminGrantNotice(entry)).filter(Boolean)
      : [],
    lastError: cloneIpcSafeError(state.lastError),
    statusMessage: state.statusMessage
  };
}

function buildEmptyPersistedSessionState() {
  return {
    schemaVersion: MULTIPLAYER_SESSION_SCHEMA_VERSION,
    session: null
  };
}

function createPersistedSessionRecord({
  token,
  serverUrl,
  username,
  sessionId,
  accountId,
  profileKey,
  authenticated
} = {}) {
  if (!token || !authenticated) {
    return null;
  }

  return {
    token: String(token),
    serverUrl: String(serverUrl ?? DEFAULT_MULTIPLAYER_SERVER_URL),
    username: username ?? null,
    sessionId: sessionId ?? null,
    accountId: accountId ?? null,
    profileKey: profileKey ?? username ?? null,
    authenticated: true,
    persistedAt: new Date().toISOString()
  };
}

function isExpiredPersistedSessionRecord(session) {
  const persistedAtMs = Date.parse(session?.persistedAt ?? "");
  if (!Number.isFinite(persistedAtMs)) {
    return false;
  }

  return Date.now() - persistedAtMs > AUTHENTICATED_SESSION_MAX_AGE_MS;
}

function formatConnectionErrorDetail(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function buildConnectionFailure(error, serverUrl) {
  const safeServerUrl = String(serverUrl ?? "").trim();
  const messageDetail = formatConnectionErrorDetail(error?.message) ?? "Unable to connect to multiplayer server.";
  const descriptionDetail = formatConnectionErrorDetail(error?.description);
  const contextDetail = formatConnectionErrorDetail(error?.context);
  const detailParts = [
    `message=${messageDetail}`,
    descriptionDetail ? `description=${descriptionDetail}` : null,
    contextDetail ? `context=${contextDetail}` : null
  ].filter(Boolean);

  return {
    code: "CONNECTION_FAILED",
    serverUrl: safeServerUrl || null,
    description: serializeMultiplayerLogValue(error?.description),
    context: serializeMultiplayerLogValue(error?.context),
    message:
      `Unable to connect to multiplayer server${safeServerUrl ? ` at ${safeServerUrl}` : ""}. ` +
      detailParts.join("; ")
  };
}

function serializeMultiplayerLogValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value instanceof Error) {
    return {
      name: value.name ?? "Error",
      message: value.message ?? "",
      stack: value.stack ?? null
    };
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function cloneIpcSafeValue(value) {
  const serialized = serializeMultiplayerLogValue(value);
  if (serialized == null) {
    return null;
  }

  if (typeof serialized === "object") {
    try {
      return JSON.parse(JSON.stringify(serialized));
    } catch {
      return String(serialized);
    }
  }

  return serialized;
}

function cloneIpcSafeError(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  return {
    code: error?.code != null ? String(error.code) : null,
    message: error?.message != null ? String(error.message) : null,
    serverUrl: error?.serverUrl != null ? String(error.serverUrl) : null,
    description: cloneIpcSafeValue(error?.description),
    context: cloneIpcSafeValue(error?.context)
  };
}

function cloneIpcSafeSession(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return {
    token: session?.token != null ? String(session.token) : null,
    active: Boolean(session?.active),
    username: session?.username ?? null,
    sessionId: session?.sessionId ?? null,
    accountId: session?.accountId ?? null,
    profileKey: session?.profileKey ?? null,
    authenticated: Boolean(session?.authenticated)
  };
}

function cloneIpcSafeAuthResponse(response) {
  if (!response || typeof response !== "object") {
    return response ?? null;
  }

  return {
    ...response,
    error: cloneIpcSafeError(response?.error),
    session: cloneIpcSafeSession(response?.session),
    account: cloneIpcSafeValue(response?.account)
  };
}

function appendMultiplayerClientLog(logPath, level, args) {
  if (!logPath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = JSON.stringify({
      timestamp: formatServerTimestamp(new Date()),
      level,
      entries: Array.isArray(args)
        ? args.map((entry) => serializeMultiplayerLogValue(entry))
        : []
    });
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  } catch {
    // Logging must never interrupt multiplayer startup.
  }
}

function resolveMultiplayerClientLogPath({ appDataPath, dataDir } = {}) {
  const safeAppDataPath = String(appDataPath ?? "").trim();
  if (safeAppDataPath) {
    return path.join(safeAppDataPath, "elemintz-pc", "logs", "multiplayer-client.log");
  }

  return dataDir ? path.resolve(dataDir, "..", "logs", "multiplayer-client.log") : null;
}

function createPersistentMultiplayerLogger(baseLogger = console, { dataDir, appDataPath } = {}) {
  const logPath = resolveMultiplayerClientLogPath({ appDataPath, dataDir });
  const wrap = (methodName) => {
    const method =
      typeof baseLogger?.[methodName] === "function"
        ? baseLogger[methodName].bind(baseLogger)
        : typeof baseLogger?.log === "function"
          ? baseLogger.log.bind(baseLogger)
          : null;

    return (...args) => {
      appendMultiplayerClientLog(logPath, methodName, args);
      method?.(...args);
    };
  };

  return {
    logger: {
      ...baseLogger,
      info: wrap("info"),
      warn: wrap("warn"),
      error: wrap("error"),
      log: wrap("log"),
      debug: wrap("debug")
    },
    logPath
  };
}

export class MultiplayerClient {
  constructor({
    socketFactory = createSocket,
    logger = console,
    defaultServerUrl = DEFAULT_MULTIPLAYER_SERVER_URL,
    dataDir,
    appDataPath,
    persistSession = true
  } = {}) {
    this.socketFactory = socketFactory;
    const persistentLogger = createPersistentMultiplayerLogger(logger, { dataDir, appDataPath });
    this.logger = persistentLogger.logger;
    this.logPath = persistentLogger.logPath;
    this.defaultServerUrl = defaultServerUrl;
    this.persistSession = persistSession;
    this.socket = null;
    this.connectPromise = null;
    this.boundSocketListeners = null;
    this.subscribers = new Set();
    this.sessionStore =
      persistSession
        ? new JsonStore(MULTIPLAYER_SESSION_FILENAME, { dataDir })
        : null;
    this.state = {
      serverUrl: defaultServerUrl,
      connectionStatus: "disconnected",
      socketId: null,
      session: {
        active: false,
        username: null,
        sessionId: null,
        accountId: null,
        profileKey: null,
        authenticated: false
      },
      room: null,
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      pendingAdminGrantNotices: [],
      lastError: null,
      statusMessage: "Offline. Open Online Play to connect."
    };
    this.sessionToken = null;
    this.sessionBoundSocketId = null;
    this.isOpeningChest = false;
    this.logger.info?.("[Multiplayer][Electron] persistent client log ready", {
      logPath: this.logPath
    });
  }

  async readPersistedSessionRecord() {
    if (!this.sessionStore) {
      return null;
    }

    const stored = await this.sessionStore.read(buildEmptyPersistedSessionState());
    return stored?.session && typeof stored.session === "object" ? stored.session : null;
  }

  async writePersistedSessionRecord(session = null) {
    if (!this.sessionStore) {
      return null;
    }

    const persisted = createPersistedSessionRecord({
      token: session?.token ?? this.sessionToken,
      serverUrl: this.state.serverUrl,
      username: session?.username ?? this.state.session?.username,
      sessionId: session?.sessionId ?? this.state.session?.sessionId,
      accountId: session?.accountId ?? this.state.session?.accountId,
      profileKey: session?.profileKey ?? this.state.session?.profileKey,
      authenticated: session?.authenticated ?? this.state.session?.authenticated
    });

    await this.sessionStore.write({
      schemaVersion: MULTIPLAYER_SESSION_SCHEMA_VERSION,
      session: persisted
    });
    return persisted;
  }

  async clearPersistedSessionRecord() {
    if (!this.sessionStore) {
      return;
    }

    await this.sessionStore.write(buildEmptyPersistedSessionState());
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    listener(this.getState());
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getState() {
    return cloneState(this.state);
  }

  updateState(patch) {
    this.state = {
      ...this.state,
      ...patch
    };

    const snapshot = this.getState();
    for (const listener of this.subscribers) {
      listener(snapshot);
    }
  }

  upsertPendingAdminGrantNotice(notice) {
    const cloned = cloneAdminGrantNotice(notice);
    if (!cloned?.transactionId) {
      return;
    }

    const existing = Array.isArray(this.state.pendingAdminGrantNotices)
      ? this.state.pendingAdminGrantNotices
      : [];
    const nextNotices = [
      ...existing.filter((entry) => String(entry?.transactionId ?? "") !== cloned.transactionId),
      cloned
    ].slice(-20);

    this.updateState({
      pendingAdminGrantNotices: nextNotices,
      lastError: null,
      statusMessage: "A new EleMintz reward confirmation is waiting."
    });
  }

  removePendingAdminGrantNotice(transactionId) {
    const safeTransactionId = String(transactionId ?? "").trim();
    if (!safeTransactionId) {
      return;
    }

    const existing = Array.isArray(this.state.pendingAdminGrantNotices)
      ? this.state.pendingAdminGrantNotices
      : [];
    const nextNotices = existing.filter(
      (entry) => String(entry?.transactionId ?? "").trim() !== safeTransactionId
    );

    if (nextNotices.length === existing.length) {
      return;
    }

    this.updateState({
      pendingAdminGrantNotices: nextNotices
    });
  }

  getCurrentResolvedStepId() {
    return (
      this.state.latestAuthoritativeRoundResult?.stepId ??
      this.state.room?.serverMatchState?.lastResolvedOutcome?.stepId ??
      null
    );
  }

  getCurrentSnapshotIdentity() {
    return extractRoomSnapshotIdentity(this.state.room);
  }

  shouldAcceptAuthoritativeRoundResult(result) {
    const nextStepId = String(result?.stepId ?? "").trim();
    const nextMatchId = String(result?.matchId ?? "").trim();
    if (!nextStepId || !nextMatchId) {
      return false;
    }

    const currentStepId = this.getCurrentResolvedStepId();
    const currentMatchId = String(
      this.state.latestAuthoritativeRoundResult?.matchId ??
      this.state.room?.serverMatchState?.matchId ??
      ""
    ).trim();

    if (currentStepId && currentStepId === nextStepId && currentMatchId === nextMatchId) {
      return false;
    }

    if (currentStepId && currentMatchId === nextMatchId && compareStepIdentity(nextStepId, currentStepId) < 0) {
      return false;
    }

    return true;
  }

  shouldAcceptRoomSnapshot(room, { allowEqualSnapshot = true } = {}) {
    if (!room?.serverMatchState) {
      return true;
    }

    const incoming = extractRoomSnapshotIdentity(room);
    const current = this.getCurrentSnapshotIdentity();

    if (!incoming.matchId || !current.matchId || incoming.matchId !== current.matchId) {
      return true;
    }

    const currentRoom = this.state.room;
    const currentSettlementKey = getRewardSettlementKey(currentRoom);
    const incomingSettlementKey = getRewardSettlementKey(room);

    if (currentRoom?.status === "expired" && room?.status !== "expired") {
      return false;
    }

    if (Boolean(currentRoom?.matchComplete) && !Boolean(room?.matchComplete)) {
      return false;
    }

    if (currentSettlementKey && !incomingSettlementKey) {
      return false;
    }

    if (
      currentSettlementKey &&
      incomingSettlementKey &&
      currentSettlementKey !== incomingSettlementKey
    ) {
      return false;
    }

    const incomingResolved = incoming.lastResolvedStepId;
    const currentResolved = current.lastResolvedStepId;
    if (incomingResolved && currentResolved) {
      const resolvedCompare = compareStepIdentity(incomingResolved, currentResolved);
      if (resolvedCompare < 0) {
        return false;
      }

      if (!allowEqualSnapshot && resolvedCompare === 0) {
        const incomingActive = incoming.activeStepId;
        const currentActive = current.activeStepId;
        if (incomingActive && currentActive && compareStepIdentity(incomingActive, currentActive) <= 0) {
          return false;
        }
      }
    }

    const incomingActive = incoming.activeStepId;
    const currentActive = current.activeStepId;
    if (incomingActive && currentActive) {
      const activeCompare = compareStepIdentity(incomingActive, currentActive);
      if (activeCompare < 0) {
        return false;
      }

      if (!allowEqualSnapshot && activeCompare === 0 && incomingResolved === currentResolved) {
        return false;
      }
    }

    return true;
  }

  buildAuthoritativeOutcomeLabel(result) {
    const outcomeType = String(result?.authoritativeOutcomeType ?? "").trim();
    const winner = String(result?.authoritativeWinner ?? "").trim();
    const myRole =
      this.state.room?.host?.socketId === this.state.socketId
        ? "host"
        : this.state.room?.guest?.socketId === this.state.socketId
          ? "guest"
          : null;

    if (outcomeType === "war_start") {
      return "WAR Started";
    }

    if (outcomeType === "war_continue") {
      return "WAR Continues";
    }

    if (outcomeType === "war_resolved") {
      if (winner && myRole) {
        return winner === myRole ? "WAR Won" : "WAR Lost";
      }

      return "WAR Resolved";
    }

    if (outcomeType === "no_effect") {
      return "No Effect";
    }

    if (outcomeType === "win") {
      if (winner && myRole) {
        return winner === myRole ? "You Win" : "You Lose";
      }

      return "Round Resolved";
    }

    return "Authoritative round result received.";
  }

  buildAuthoritativeStateFromRoomSnapshot(room) {
    const snapshotResult = buildAuthoritativeRoundResultFromRoomSnapshot(room);
    return snapshotResult
      ? {
          latestRoundResult: cloneRoundResult(snapshotResult.roundResult),
          latestAuthoritativeRoundResult: cloneAuthoritativeRoundResult(snapshotResult)
        }
      : {
          latestRoundResult: null,
          latestAuthoritativeRoundResult: null
        };
  }

  normalizeServerUrl(serverUrl) {
    const normalized = String(serverUrl ?? "").trim();
    return normalized.length > 0 ? normalized : this.defaultServerUrl;
  }

  applySession(session) {
    const safeSession = session
      ? {
          active: true,
          username: session.username ?? null,
          sessionId: session.sessionId ?? null,
          accountId: session.accountId ?? null,
          profileKey: session.profileKey ?? session.username ?? null,
          authenticated: Boolean(session.authenticated)
        }
      : {
          active: false,
          username: null,
          sessionId: null,
          accountId: null,
          profileKey: null,
          authenticated: false
        };

    this.sessionToken = session?.token ?? null;
    this.sessionBoundSocketId = this.state.socketId ?? null;
    this.updateState({
      session: safeSession
    });
    return safeSession;
  }

  clearSession() {
    this.sessionToken = null;
    this.sessionBoundSocketId = null;
    this.updateState({
      session: {
        active: false,
        username: null,
        sessionId: null,
        accountId: null,
        profileKey: null,
        authenticated: false
      }
    });
  }

  async invalidateSession({
    error = null,
    statusMessage = null,
    preserveServerUrl = true,
    disconnect = true
  } = {}) {
    this.clearSession();
    await this.clearPersistedSessionRecord();
    if (disconnect) {
      await this.disconnect({ preserveServerUrl, silent: true });
    }
    this.updateState({
      lastError: error ? { ...error } : null,
      statusMessage: statusMessage ?? error?.message ?? "Session expired. Please sign in again."
    });
  }

  isInvalidSessionError(error) {
    const code = String(error?.code ?? "").trim().toUpperCase();
    return INVALID_SESSION_ERROR_CODES.has(code);
  }

  async restoreSession({ serverUrl } = {}) {
    const persisted = await this.readPersistedSessionRecord();
    if (!persisted?.token || !persisted?.authenticated) {
      return {
        ok: true,
        restored: false,
        state: this.getState()
      };
    }

    if (isExpiredPersistedSessionRecord(persisted)) {
      const error = {
        code: "SESSION_EXPIRED",
        message: "Saved session expired. Please sign in again."
      };
      await this.invalidateSession({
        error,
        statusMessage: error.message,
        disconnect: false
      });
      return {
        ok: false,
        restored: false,
        invalid: true,
        state: this.getState(),
        error
      };
    }

    const nextServerUrl = this.normalizeServerUrl(serverUrl ?? persisted.serverUrl);
    this.sessionToken = persisted.token;
    this.sessionBoundSocketId = null;
    this.updateState({
      serverUrl: nextServerUrl,
      lastError: null,
      statusMessage: `Restoring online session for ${persisted.username ?? "player"}...`
    });

    const connected = await this.ensureConnected({ serverUrl: nextServerUrl });
    if (!connected || !this.socket) {
      return {
        ok: false,
        restored: false,
        transient: true,
        state: this.getState(),
        error: this.state.lastError
      };
    }

    const resumeResponse = await this.emitRequest(
      "session:resume",
      { sessionToken: persisted.token },
      { serverUrl: nextServerUrl }
    );

    if (resumeResponse?.ok && resumeResponse.session?.authenticated) {
      const restoredSession = {
        ...resumeResponse.session,
        token: resumeResponse.session?.token ?? persisted.token
      };
      this.applySession(restoredSession);
      await this.writePersistedSessionRecord(restoredSession);
      this.updateState({
        lastError: null,
        statusMessage: "Signed in. Session restored."
      });
      return {
        ok: true,
        restored: true,
        state: this.getState()
      };
    }

    await this.invalidateSession({
      error: resumeResponse?.error ?? null,
      statusMessage: resumeResponse?.error?.message ?? "Saved session expired. Please sign in again."
    });
    return {
      ok: false,
      restored: false,
      invalid: true,
      state: this.getState(),
      error: resumeResponse?.error ?? null
    };
  }

  async authenticate(eventName, payload, { serverUrl } = {}) {
    const connected = await this.ensureConnected({ serverUrl });
    if (!connected || !this.socket) {
      const error = this.state.lastError
        ? cloneIpcSafeError(this.state.lastError)
        : buildConnectionFailure(null, this.normalizeServerUrl(serverUrl));
      return {
        ok: false,
        error
      };
    }

    const response = await this.emitRequest(eventName, payload, { serverUrl });
    if (response?.ok && response.session) {
      this.applySession(response.session);
      await this.writePersistedSessionRecord(response.session);
      this.updateState({
        lastError: null,
        statusMessage:
          eventName === "auth:register"
            ? "Account created. Online session active."
            : "Signed in. Online session active."
      });
      return cloneIpcSafeAuthResponse(response);
    }

    this.updateState({
      lastError: cloneIpcSafeError(response?.error),
      statusMessage: response?.error?.message ?? this.state.statusMessage
    });
    return cloneIpcSafeAuthResponse(response) ?? {
      ok: false,
      error: {
        code: "AUTH_FAILED",
        message: "Unable to complete this authentication request."
      }
    };
  }

  async connectIsolatedSocket({ serverUrl } = {}) {
    const nextServerUrl = this.normalizeServerUrl(serverUrl);
    this.logger.info?.("[Multiplayer][Electron] isolated connect start", {
      serverUrl: nextServerUrl
    });
    const socket = this.socketFactory(nextServerUrl, {
      reconnection: false,
      autoConnect: true
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.off("connect", handleConnect);
        socket.off("connect_error", handleError);
        resolve(result);
      };
      const handleConnect = () => {
        this.logger.info?.("[Multiplayer][Electron] isolated connect success", {
          serverUrl: nextServerUrl,
          socketId: socket.id ?? null
        });
        finish({ ok: true, socket });
      };
      const handleError = (error) => {
        const failure = buildConnectionFailure(error, nextServerUrl);
        this.logger.error?.("[Multiplayer][Electron] isolated connect_error", {
          serverUrl: nextServerUrl,
          name: error?.name ?? null,
          message: error?.message ?? null,
          description: error?.description ?? null,
          context: error?.context ?? null,
          stack: error?.stack ?? null,
          failure
        });
        finish({
          ok: false,
          error: failure
        });
      };

      socket.once("connect", handleConnect);
      socket.once("connect_error", handleError);
    });
  }

  async emitIsolatedRequest(socket, eventName, payload = {}) {
    if (!socket) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(null);
      }, 5000);

      socket.emit(eventName, payload, (response) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        const safeResponse = response ?? null;
        if (this.isInvalidSessionError(safeResponse?.error) && this.state.session?.authenticated) {
          this.clearSession();
          this.updateState({
            lastError: safeResponse.error ? { ...safeResponse.error } : null,
            statusMessage: safeResponse.error?.message ?? "Session expired. Please sign in again."
          });
          void this.invalidateSession({
            error: safeResponse.error,
            statusMessage: safeResponse.error?.message ?? "Session expired. Please sign in again."
          });
        }
        resolve(safeResponse);
      });
    });
  }

  async authenticateHotseatIdentity({ mode = "login", email, password, username, serverUrl } = {}) {
    const authMode = String(mode ?? "login").trim().toLowerCase() === "register" ? "register" : "login";
    const eventName = authMode === "register" ? "auth:register" : "auth:login";
    const authPayload =
      authMode === "register"
        ? { email, password, username }
        : { email, password };
    const connection = await this.connectIsolatedSocket({ serverUrl });
    if (!connection?.ok || !connection.socket) {
      return {
        ok: false,
        error: connection?.error ?? buildConnectionFailure(null, this.normalizeServerUrl(serverUrl))
      };
    }

    const socket = connection.socket;
    try {
      const authResponse = await this.emitIsolatedRequest(socket, eventName, authPayload);
      if (!authResponse?.ok || !authResponse?.session) {
        return authResponse ?? {
          ok: false,
          error: {
            code: "AUTH_FAILED",
            message: "Unable to authenticate this account."
          }
        };
      }

      const profileResponse = await this.emitIsolatedRequest(socket, "profile:get", {});
      if (!profileResponse?.ok || !profileResponse?.profile) {
        return {
          ok: false,
          error: profileResponse?.error ?? {
            code: "PROFILE_READ_FAILED",
            message: "Unable to load the authenticated player profile."
          }
        };
      }

      await this.emitIsolatedRequest(socket, "session:logout", {});
      return {
        ok: true,
        account: authResponse.account ?? null,
        session: authResponse.session ?? null,
        profile: profileResponse.profile
      };
    } finally {
      socket.disconnect();
    }
  }

  async emitRequest(eventName, payload = {}, { serverUrl } = {}) {
    const connected = await this.ensureConnected({ serverUrl });
    if (!connected || !this.socket) {
      return null;
    }

    const socket = this.socket;
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(null);
      }, 5000);

      this.logger.info?.("[OnlinePlay][MainClient] socket request", {
        eventName,
        payload
      });
      socket.emit(eventName, payload, (response) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(response ?? null);
      });
    });
  }

  async ensureSession({ username, serverUrl } = {}) {
    const connected = await this.ensureConnected({ serverUrl });
    if (!connected || !this.socket) {
      return null;
    }

    if (this.sessionToken && this.sessionBoundSocketId === this.state.socketId) {
      return {
        token: this.sessionToken,
        sessionId: this.state.session?.sessionId ?? null,
        username: this.state.session?.username ?? null,
        profileKey: this.state.session?.profileKey ?? null,
        accountId: this.state.session?.accountId ?? null,
        authenticated: Boolean(this.state.session?.authenticated)
      };
    }

    if (this.sessionToken) {
      const resumeResponse = await this.emitRequest(
        "session:resume",
        { sessionToken: this.sessionToken },
        { serverUrl }
      );
      if (resumeResponse?.ok && resumeResponse.session) {
        this.applySession(resumeResponse.session);
        if (resumeResponse.session?.authenticated) {
          await this.writePersistedSessionRecord(resumeResponse.session);
        }
        return resumeResponse.session;
      }

      await this.invalidateSession({
        error: resumeResponse?.error ?? null,
        statusMessage: resumeResponse?.error?.message ?? this.state.statusMessage
      });
      if (!username) {
        return null;
      }
    }

    if (!username) {
      return null;
    }

    const bootstrapResponse = await this.emitRequest(
      "session:bootstrap",
      { username },
      { serverUrl }
    );
    if (bootstrapResponse?.ok && bootstrapResponse.session) {
      this.applySession(bootstrapResponse.session);
      return bootstrapResponse.session;
    }

    this.updateState({
      lastError: bootstrapResponse?.error ? { ...bootstrapResponse.error } : null,
      statusMessage: bootstrapResponse?.error?.message ?? this.state.statusMessage
    });
    return null;
  }

  bindSocket(socket) {
    const onConnect = () => {
      this.logger.info("[Multiplayer][Electron] connected", {
        socketId: socket.id,
        serverUrl: this.state.serverUrl
      });
      this.updateState({
        connectionStatus: "connected",
        socketId: socket.id,
        lastError: null,
        statusMessage: "Connected. Create a room or join one."
      });
      this.sessionBoundSocketId = null;
    };

    const onConnectError = (error) => {
      const connectionFailure = buildConnectionFailure(error, this.state.serverUrl);
      this.logger.error?.("[Multiplayer][Electron] connect_error", {
        serverUrl: this.state.serverUrl,
        name: error?.name ?? null,
        message: error?.message ?? null,
        description: error?.description ?? null,
        context: error?.context ?? null,
        stack: error?.stack ?? null,
        rawError: serializeMultiplayerLogValue(error),
        surfacedMessage: connectionFailure.message
      });
      this.updateState({
        connectionStatus: "disconnected",
        socketId: null,
        session: {
          active: false,
          username: this.state.session?.username ?? null,
          sessionId: this.state.session?.sessionId ?? null,
          accountId: this.state.session?.accountId ?? null,
          profileKey: this.state.session?.profileKey ?? null,
          authenticated: Boolean(this.state.session?.authenticated)
        },
        room: null,
        latestRoundResult: null,
        latestAuthoritativeRoundResult: null,
        lastError: connectionFailure,
        statusMessage: connectionFailure.message
      });
      this.sessionBoundSocketId = null;
    };

    const onDisconnect = (reason) => {
      const preserveAuthoritativeState = reason !== "io client disconnect";
      this.logger.info("[Multiplayer][Electron] disconnected", {
        socketId: socket.id,
        reason,
        serverUrl: this.state.serverUrl
      });
      this.updateState({
        connectionStatus: "disconnected",
        socketId: null,
        session: {
          active: false,
          username: this.state.session?.username ?? null,
          sessionId: this.state.session?.sessionId ?? null,
          accountId: this.state.session?.accountId ?? null,
          profileKey: this.state.session?.profileKey ?? null,
          authenticated: Boolean(this.state.session?.authenticated)
        },
        room: preserveAuthoritativeState ? this.state.room : null,
        latestRoundResult: preserveAuthoritativeState ? this.state.latestRoundResult : null,
        latestAuthoritativeRoundResult: preserveAuthoritativeState
          ? this.state.latestAuthoritativeRoundResult
          : null,
        statusMessage:
          reason === "io client disconnect"
            ? "Disconnected."
            : this.state.room?.roomCode
              ? `Connection closed. Room ${this.state.room.roomCode} is awaiting reconnect.`
              : "Connection closed."
      });
      this.sessionBoundSocketId = null;
    };

    const onRoomCreated = (room) => {
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: null,
        latestAuthoritativeRoundResult: null,
        lastError: null,
        statusMessage: `Room ${room.roomCode} created. Waiting for another player.`
      });
    };

    const onRoomJoined = (room) => {
      if (!this.shouldAcceptRoomSnapshot(room, { allowEqualSnapshot: false })) {
        this.logger.info?.("[OnlinePlay][MainClient] ignored stale/duplicate joined room snapshot", {
          roomCode: room?.roomCode ?? null,
          matchId: room?.serverMatchState?.matchId ?? null,
          activeStepId: room?.serverMatchState?.activeStep?.id ?? null
        });
        return;
      }

      const snapshotState = this.buildAuthoritativeStateFromRoomSnapshot(room);
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: snapshotState.latestRoundResult,
        latestAuthoritativeRoundResult: snapshotState.latestAuthoritativeRoundResult,
        lastError: null,
        statusMessage: `Joined room ${room.roomCode}.`
      });
    };

    const onRoomUpdate = (room) => {
      if (!this.shouldAcceptRoomSnapshot(room)) {
        this.logger.info?.("[OnlinePlay][MainClient] ignored stale room snapshot", {
          roomCode: room?.roomCode ?? null,
          matchId: room?.serverMatchState?.matchId ?? null,
          activeStepId: room?.serverMatchState?.activeStep?.id ?? null
        });
        return;
      }

      const disconnectReason = room?.disconnectState?.reason ?? null;
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult:
          room?.status === "full" || room?.matchComplete
            ? this.state.latestRoundResult
            : null,
        latestAuthoritativeRoundResult:
          room?.status === "full" || room?.matchComplete
            ? this.state.latestAuthoritativeRoundResult
            : null,
        lastError: null,
        statusMessage:
          room?.matchComplete
            ? `Match complete in room ${room.roomCode}. Ready up for rematch.`
            : room?.status === "paused"
            ? `Opponent disconnected in room ${room.roomCode}. Waiting for reconnect.`
            : room?.status === "expired" || disconnectReason === "disconnect_timeout_expired"
            ? `Reconnect window expired for room ${room?.roomCode ?? ""}.`.trim()
            : room?.status === "closing"
            ? `Room ${room?.roomCode ?? ""} is closing.`.trim()
            : room?.status === "full"
            ? `Room ${room.roomCode} is full.`
            : `Room ${room?.roomCode ?? ""} is waiting for another player.`.trim()
      });
    };

    const onRoomMoveSync = (room) => {
      const submittedCount = Number(room?.moveSync?.submittedCount ?? 0);
      const statusMessage =
        room?.matchComplete
          ? `Match complete in room ${room.roomCode}.`
          : submittedCount >= 2
          ? `Both players submitted moves for room ${room.roomCode}.`
          : `${submittedCount}/2 move submission${submittedCount === 1 ? "" : "s"} received for room ${room.roomCode}.`;

      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: submittedCount >= 2 ? this.state.latestRoundResult : null,
        latestAuthoritativeRoundResult:
          submittedCount >= 2 ? this.state.latestAuthoritativeRoundResult : null,
        lastError: null,
        statusMessage
      });
    };

    const onRoomRoundResult = (roundResult) => {
      this.logger.info?.("[OnlinePlay][MainClient] room:roundResult received", roundResult);
      this.updateState({
        lastError: null,
        statusMessage: `Authoritative result pending for room ${roundResult?.roomCode ?? ""}`.trim()
      });
    };

    const onServerRoundResult = (result) => {
      this.logger.info?.("[OnlinePlay][MainClient] room:serverRoundResult received", result);
      if (!this.shouldAcceptAuthoritativeRoundResult(result)) {
        this.logger.info?.("[OnlinePlay][MainClient] ignored stale/duplicate authoritative result", {
          stepId: result?.stepId ?? null,
          matchId: result?.matchId ?? null
        });
        return;
      }

      this.updateState({
        latestRoundResult: cloneRoundResult(result?.roundResult),
        latestAuthoritativeRoundResult: cloneAuthoritativeRoundResult(result),
        lastError: null,
        statusMessage: `${this.buildAuthoritativeOutcomeLabel(result)} Room ${result?.roomCode ?? ""}`.trim()
      });
    };

    const onRoomError = (error) => {
      this.updateState({
        lastError: {
          code: String(error?.code ?? "ROOM_ERROR"),
          message: String(error?.message ?? "Unable to complete room request.")
        },
        statusMessage: "Room action failed."
      });
    };

    const onAdminGrantNotice = (notice) => {
      this.logger.info?.("[OnlinePlay][MainClient] admin:grantNotice received", {
        transactionId: notice?.transactionId ?? null,
        targetUsername: notice?.targetUsername ?? null
      });
      this.upsertPendingAdminGrantNotice(notice);
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    socket.on("room:created", onRoomCreated);
    socket.on("room:joined", onRoomJoined);
    socket.on("room:update", onRoomUpdate);
    socket.on("room:moveSync", onRoomMoveSync);
    socket.on("room:roundResult", onRoomRoundResult);
    socket.on("room:serverRoundResult", onServerRoundResult);
    socket.on("room:error", onRoomError);
    socket.on("admin:grantNotice", onAdminGrantNotice);

    this.boundSocketListeners = {
      onConnect,
      onConnectError,
      onDisconnect,
      onRoomCreated,
      onRoomJoined,
      onRoomUpdate,
      onRoomMoveSync,
      onRoomRoundResult,
      onServerRoundResult,
      onRoomError,
      onAdminGrantNotice
    };
  }

  unbindSocket(socket) {
    if (!socket || !this.boundSocketListeners) {
      return;
    }

    socket.off("connect", this.boundSocketListeners.onConnect);
    socket.off("connect_error", this.boundSocketListeners.onConnectError);
    socket.off("disconnect", this.boundSocketListeners.onDisconnect);
    socket.off("room:created", this.boundSocketListeners.onRoomCreated);
    socket.off("room:joined", this.boundSocketListeners.onRoomJoined);
    socket.off("room:update", this.boundSocketListeners.onRoomUpdate);
    socket.off("room:moveSync", this.boundSocketListeners.onRoomMoveSync);
    socket.off("room:roundResult", this.boundSocketListeners.onRoomRoundResult);
    socket.off("room:serverRoundResult", this.boundSocketListeners.onServerRoundResult);
    socket.off("room:error", this.boundSocketListeners.onRoomError);
    socket.off("admin:grantNotice", this.boundSocketListeners.onAdminGrantNotice);
    this.boundSocketListeners = null;
  }

  async connect({ serverUrl } = {}) {
    const nextServerUrl = this.normalizeServerUrl(serverUrl);

    if (this.socket && this.socket.connected && this.state.serverUrl === nextServerUrl) {
      return this.getState();
    }

    if (this.connectPromise && this.state.serverUrl === nextServerUrl) {
      return this.connectPromise;
    }

    await this.disconnect({ preserveServerUrl: true, silent: true });

    this.updateState({
      serverUrl: nextServerUrl,
      connectionStatus: "connecting",
      socketId: null,
      room: null,
      lastError: null,
      statusMessage: `Connecting to ${nextServerUrl}...`
    });
    this.logger.info?.("[Multiplayer][Electron] connect start", {
      serverUrl: nextServerUrl,
      logPath: this.logPath
    });

    const socket = this.socketFactory(nextServerUrl, {
      reconnection: false,
      autoConnect: true
    });

    this.socket = socket;
    this.bindSocket(socket);

    this.connectPromise = new Promise((resolve) => {
      const finish = () => {
        socket.off("connect", handleDone);
        socket.off("connect_error", handleDone);
        this.connectPromise = null;
        resolve(this.getState());
      };

      const handleDone = () => finish();

      socket.once("connect", handleDone);
      socket.once("connect_error", handleDone);
    });

    return this.connectPromise;
  }

  async ensureConnected(options = {}) {
    const state = await this.connect(options);
    return state.connectionStatus === "connected";
  }

  async runRoomAction(eventName, payload, successEvent, options = {}) {
    const username = String(payload?.username ?? "").trim() || null;
    const connected = await this.ensureConnected(options);
    if (!connected || !this.socket) {
      return this.getState();
    }

    const session = await this.ensureSession({
      username,
      serverUrl: options?.serverUrl
    });
    if (!session) {
      return this.getState();
    }

    const socket = this.socket;
    const sanitizedPayload = { ...payload };
    delete sanitizedPayload.username;
    delete sanitizedPayload.sessionToken;
    return new Promise((resolve) => {
      let finished = false;
      const timeoutId = setTimeout(() => {
        if (finished) {
          return;
        }

        this.updateState({
          lastError: {
            code: "REQUEST_TIMEOUT",
            message: "Room action timed out."
          },
          statusMessage: "Room action timed out."
        });
        finish();
      }, ROOM_ACTION_TIMEOUT_MS);

      const finish = () => {
        if (finished) {
          return;
        }

        finished = true;
        socket.off(successEvent, handleSuccess);
        socket.off("room:error", handleError);
        clearTimeout(timeoutId);
        resolve(this.getState());
      };

      const handleSuccess = () => {
        this.logger.info?.("[OnlinePlay][MainClient] room action success", {
          eventName,
          successEvent
        });
        finish();
      };
      const handleError = (error) => {
        this.logger.info?.("[OnlinePlay][MainClient] room action error", {
          eventName,
          errorCode: error?.code ?? null
        });
        finish();
      };

      socket.once(successEvent, handleSuccess);
      socket.once("room:error", handleError);
      this.logger.info?.("[OnlinePlay][MainClient] socket emit", {
        eventName,
        payload: sanitizedPayload
      });
      socket.emit(eventName, sanitizedPayload);
    });
  }

  async runServerRequest(eventName, payload, options = {}) {
    const username = String(payload?.username ?? "").trim() || null;
    const session = await this.ensureSession({
      username,
      serverUrl: options?.serverUrl
    });
    if (!session) {
      return null;
    }
    const sanitizedPayload = { ...payload };
    delete sanitizedPayload.username;
    delete sanitizedPayload.sessionToken;
    const response = await this.emitRequest(eventName, sanitizedPayload, options);
    if (this.isInvalidSessionError(response?.error) && (this.state.session?.authenticated || this.sessionToken)) {
      await this.invalidateSession({
        error: response.error,
        statusMessage: response.error?.message ?? "Session expired. Please sign in again."
      });
      return null;
    }

    return response;
  }

  async createRoom({ serverUrl, username, equippedCosmetics } = {}) {
    return this.runRoomAction(
      "room:create",
      { username, equippedCosmetics },
      "room:created",
      { serverUrl }
    );
  }

  async register({ email, password, username, serverUrl } = {}) {
    return this.authenticate(
      "auth:register",
      { email, password, username },
      { serverUrl }
    );
  }

  async login({ email, password, serverUrl } = {}) {
    return this.authenticate(
      "auth:login",
      { email, password },
      { serverUrl }
    );
  }

  async joinRoom({ roomCode, serverUrl, username, equippedCosmetics } = {}) {
    return this.runRoomAction(
      "room:join",
      { roomCode, username, equippedCosmetics },
      "room:joined",
      { serverUrl }
    );
  }

  async submitMove({ move, serverUrl } = {}) {
    this.logger.info?.("[OnlinePlay][MainClient] submitMove entered", {
      move
    });
    const connected = await this.ensureConnected({ serverUrl });
    if (!connected || !this.socket) {
      return this.getState();
    }

    const socket = this.socket;
    return new Promise((resolve) => {
      let resolved = false;
      let waitingForAuthoritativeResult = false;
      const expectedRoomCode = this.state.room?.roomCode ?? null;
      const timeoutId = setTimeout(() => {
        this.updateState({
          lastError: {
            code: "REQUEST_TIMEOUT",
            message: "Move submission timed out while waiting for the server."
          },
          statusMessage: "Move submission timed out."
        });
        finish();
      }, SUBMIT_MOVE_TIMEOUT_MS);

      const finish = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        socket.off("room:moveSync", handleMoveSync);
        socket.off("room:serverRoundResult", handleServerRoundResult);
        socket.off("room:error", handleError);
        clearTimeout(timeoutId);
        resolve(this.getState());
      };

      const handleMoveSync = (room) => {
        const bothSubmitted = Boolean(room?.moveSync?.bothSubmitted);
        this.logger.info?.("[OnlinePlay][MainClient] submitMove moveSync received", {
          roomCode: room?.roomCode ?? null,
          bothSubmitted
        });

        if (!bothSubmitted) {
          finish();
          return;
        }

        waitingForAuthoritativeResult = true;
      };

      const handleServerRoundResult = (roundResult) => {
        this.logger.info?.("[OnlinePlay][MainClient] submitMove authoritative result received", roundResult);
        if (
          expectedRoomCode &&
          String(roundResult?.roomCode ?? "").trim() &&
          String(roundResult.roomCode).trim() !== expectedRoomCode
        ) {
          return;
        }

        finish();
      };

      const handleError = (error) => {
        this.logger.info?.("[OnlinePlay][MainClient] room action error", {
          eventName: "room:submitMove",
          errorCode: error?.code ?? null
        });
        finish();
      };

      socket.once("room:moveSync", handleMoveSync);
      socket.once("room:serverRoundResult", handleServerRoundResult);
      socket.once("room:error", handleError);
      this.logger.info?.("[OnlinePlay][MainClient] socket emit", {
        eventName: "room:submitMove",
        payload: { move }
      });
      socket.emit("room:submitMove", { move });
    });
  }

  async readyRematch({ serverUrl } = {}) {
    return this.runRoomAction("room:readyRematch", undefined, "room:update", { serverUrl });
  }

  async sendTaunt({ line, serverUrl } = {}) {
    return this.runRoomAction("room:sendTaunt", { line }, "room:update", { serverUrl });
  }

  async getProfile({ username, serverUrl } = {}) {
    const response = await this.runServerRequest("profile:get", { username }, { serverUrl });
    if (!response?.ok) {
      return null;
    }

    return response.profile ?? null;
  }

  async getCosmetics({ username, serverUrl } = {}) {
    const response = await this.runServerRequest("profile:getCosmetics", { username }, { serverUrl });
    if (!response?.ok) {
      return null;
    }

    return response.cosmetics ?? null;
  }

  async claimDailyLoginReward({ username, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:claimDailyLoginReward",
      { username },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to claim daily login reward.");
    }

    return response.result ?? null;
  }

  async buyStoreItem({ username, type, cosmeticId, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:buyStoreItem",
      { username, type, cosmeticId },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to complete store purchase.");
    }

    return response.result ?? null;
  }

  async openChest({ username, chestType, serverUrl } = {}) {
    if (this.isOpeningChest) {
      throw new Error("A chest is already being opened.");
    }

    this.isOpeningChest = true;
    try {
      const response = await this.runServerRequest(
        "profile:openChest",
        { username, chestType },
        { serverUrl }
      );
      if (!response?.ok) {
        throw new Error(response?.error?.message ?? "Unable to open chest.");
      }

      return response.result ?? null;
    } finally {
      this.isOpeningChest = false;
    }
  }

  async confirmAdminGrantNotice({ transactionId, serverUrl } = {}) {
    const safeTransactionId = String(transactionId ?? "").trim();
    if (!safeTransactionId) {
      throw new Error("transactionId is required to confirm an admin grant notice.");
    }

    const response = await this.runServerRequest(
      "admin:confirmGrantReceipt",
      {
        username: this.state.session?.username ?? null,
        transactionId: safeTransactionId
      },
      { serverUrl }
    );

    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to confirm this EleMintz reward.");
    }

    this.removePendingAdminGrantNotice(safeTransactionId);
    this.updateState({
      lastError: null,
      statusMessage: "Reward confirmation sent."
    });

    return response.result ?? null;
  }

  async equipCosmetic({ username, type, cosmeticId, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:equipCosmetic",
      { username, type, cosmeticId },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to equip cosmetic.");
    }

    return response.result ?? null;
  }

  async updateCosmeticPreferences({ username, patch, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:updateCosmeticPreferences",
      { username, patch },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to update cosmetic preferences.");
    }

    return response.result ?? null;
  }

  async randomizeOwnedCosmetics({ username, categories, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:randomizeOwnedCosmetics",
      { username, categories },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to randomize cosmetics.");
    }

    return response.result ?? null;
  }

  async saveCosmeticLoadout({ username, slotIndex, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:saveCosmeticLoadout",
      { username, slotIndex },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to save cosmetic loadout.");
    }

    return response.result ?? null;
  }

  async applyCosmeticLoadout({ username, slotIndex, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:applyCosmeticLoadout",
      { username, slotIndex },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to apply cosmetic loadout.");
    }

    return response.result ?? null;
  }

  async renameCosmeticLoadout({ username, slotIndex, name, serverUrl } = {}) {
    const response = await this.runServerRequest(
      "profile:renameCosmeticLoadout",
      { username, slotIndex, name },
      { serverUrl }
    );
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Unable to rename cosmetic loadout.");
    }

    return response.result ?? null;
  }

  async disconnect({ preserveServerUrl = true, silent = false } = {}) {
    if (this.socket) {
      const socket = this.socket;
      this.unbindSocket(socket);
      this.socket = null;
      socket.disconnect();
    }

    this.connectPromise = null;
    this.updateState({
      connectionStatus: "disconnected",
      socketId: null,
      session: {
        active: false,
        username: this.state.session?.username ?? null,
        sessionId: this.state.session?.sessionId ?? null,
        accountId: this.state.session?.accountId ?? null,
        profileKey: this.state.session?.profileKey ?? null,
        authenticated: Boolean(this.state.session?.authenticated)
      },
      room: null,
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      pendingAdminGrantNotices: [],
      lastError: null,
      serverUrl: preserveServerUrl ? this.state.serverUrl : this.defaultServerUrl,
      statusMessage: silent ? this.state.statusMessage : "Disconnected."
    });

    return this.getState();
  }

  async logout({ serverUrl } = {}) {
    if (this.socket?.connected) {
      await this.emitRequest("session:logout", {}, { serverUrl });
    }

    await this.disconnect({ preserveServerUrl: true, silent: true });
    this.clearSession();
    await this.clearPersistedSessionRecord();
    this.updateState({
      lastError: null,
      statusMessage: "Signed out."
    });
    return this.getState();
  }
}
