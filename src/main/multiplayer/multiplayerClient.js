import { io as createSocket } from "socket.io-client";
import { JsonStore } from "../../state/storage/jsonStore.js";

export const DEFAULT_MULTIPLAYER_SERVER_URL = "http://127.0.0.1:3001";
const MULTIPLAYER_SESSION_SCHEMA_VERSION = 1;
const MULTIPLAYER_SESSION_FILENAME = "multiplayer-session.json";
const AUTHENTICATED_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
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
          ? {
              granted: Boolean(room.rewardSettlement.granted),
              grantedAt: room.rewardSettlement.grantedAt ?? null,
              summary: room.rewardSettlement.summary
                ? {
                    granted: Boolean(room.rewardSettlement.summary.granted),
                    winner: room.rewardSettlement.summary.winner ?? null,
                    settledHostUsername: room.rewardSettlement.summary.settledHostUsername ?? null,
                    settledGuestUsername: room.rewardSettlement.summary.settledGuestUsername ?? null,
                    hostRewards: { ...(room.rewardSettlement.summary.hostRewards ?? {}) },
                    guestRewards: { ...(room.rewardSettlement.summary.guestRewards ?? {}) }
                  }
                : null
            }
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
          ? {
              granted: Boolean(roundResult.rewardSettlement.granted),
              grantedAt: roundResult.rewardSettlement.grantedAt ?? null,
              summary: roundResult.rewardSettlement.summary
                ? {
                    granted: Boolean(roundResult.rewardSettlement.summary.granted),
                    winner: roundResult.rewardSettlement.summary.winner ?? null,
                    settledHostUsername: roundResult.rewardSettlement.summary.settledHostUsername ?? null,
                    settledGuestUsername: roundResult.rewardSettlement.summary.settledGuestUsername ?? null,
                    hostRewards: { ...(roundResult.rewardSettlement.summary.hostRewards ?? {}) },
                    guestRewards: { ...(roundResult.rewardSettlement.summary.guestRewards ?? {}) }
                  }
                : null
            }
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
    lastError: state.lastError ? { ...state.lastError } : null,
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

export class MultiplayerClient {
  constructor({
    socketFactory = createSocket,
    logger = console,
    defaultServerUrl = DEFAULT_MULTIPLAYER_SERVER_URL,
    dataDir,
    persistSession = true
  } = {}) {
    this.socketFactory = socketFactory;
    this.logger = logger;
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
      lastError: null,
      statusMessage: "Offline. Open Online Play to connect."
    };
    this.sessionToken = null;
    this.sessionBoundSocketId = null;
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
      return {
        ok: false,
        error: {
          code: "CONNECTION_FAILED",
          message: "Unable to connect to multiplayer server."
        }
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
      return response;
    }

    this.updateState({
      lastError: response?.error ? { ...response.error } : null,
      statusMessage: response?.error?.message ?? this.state.statusMessage
    });
    return response ?? {
      ok: false,
      error: {
        code: "AUTH_FAILED",
        message: "Unable to complete this authentication request."
      }
    };
  }

  async connectIsolatedSocket({ serverUrl } = {}) {
    const nextServerUrl = this.normalizeServerUrl(serverUrl);
    const socket = this.socketFactory(nextServerUrl, {
      transports: ["websocket"],
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
      const handleConnect = () => finish({ ok: true, socket });
      const handleError = (error) =>
        finish({
          ok: false,
          error: {
            code: "CONNECTION_FAILED",
            message: String(error?.message ?? "Unable to connect to multiplayer server.")
          }
        });

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
        error: connection?.error ?? {
          code: "CONNECTION_FAILED",
          message: "Unable to connect to multiplayer server."
        }
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
      this.logger.error?.("[Multiplayer][Electron] connect_error", {
        serverUrl: this.state.serverUrl,
        message: error?.message
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
        lastError: {
          code: "CONNECTION_FAILED",
          message: String(error?.message ?? "Unable to connect to multiplayer server.")
        },
        statusMessage: "Connection failed."
      });
      this.sessionBoundSocketId = null;
    };

    const onDisconnect = (reason) => {
      this.logger.info("[Multiplayer][Electron] disconnected", {
        socketId: socket.id,
        reason
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
        statusMessage: reason === "io client disconnect" ? "Disconnected." : "Connection closed."
      });
      this.sessionBoundSocketId = null;
    };

    const onRoomCreated = (room) => {
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: null,
        lastError: null,
        statusMessage: `Room ${room.roomCode} created. Waiting for another player.`
      });
    };

    const onRoomJoined = (room) => {
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: null,
        lastError: null,
        statusMessage: `Joined room ${room.roomCode}.`
      });
    };

    const onRoomUpdate = (room) => {
      const disconnectReason = room?.disconnectState?.reason ?? null;
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: room?.status === "full" ? this.state.latestRoundResult : null,
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
        lastError: null,
        statusMessage
      });
    };

    const onRoomRoundResult = (roundResult) => {
      this.logger.info?.("[OnlinePlay][MainClient] room:roundResult received", roundResult);
      const myRole =
        this.state.room?.host?.socketId === this.state.socketId
          ? "host"
          : this.state.room?.guest?.socketId === this.state.socketId
            ? "guest"
            : null;
      const perspectiveResult =
        myRole === "host"
          ? roundResult?.hostResult
          : myRole === "guest"
            ? roundResult?.guestResult
            : null;
      const outcomeLabel =
        roundResult?.outcomeType === "war_resolved"
          ? perspectiveResult === "win"
            ? "WAR Won"
            : perspectiveResult === "lose"
              ? "WAR Lost"
              : "WAR Resolved"
          : perspectiveResult === "win"
          ? "You Win"
          : perspectiveResult === "lose"
            ? "You Lose"
            : perspectiveResult === "war"
              ? "WAR Continues"
              : perspectiveResult === "no_effect"
                ? "No Effect"
              : "Round result received.";

      this.updateState({
        latestRoundResult: cloneRoundResult(roundResult),
        lastError: null,
        statusMessage: `${outcomeLabel} Room ${roundResult?.roomCode ?? ""}`.trim()
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

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    socket.on("room:created", onRoomCreated);
    socket.on("room:joined", onRoomJoined);
    socket.on("room:update", onRoomUpdate);
    socket.on("room:moveSync", onRoomMoveSync);
    socket.on("room:roundResult", onRoomRoundResult);
    socket.on("room:error", onRoomError);

    this.boundSocketListeners = {
      onConnect,
      onConnectError,
      onDisconnect,
      onRoomCreated,
      onRoomJoined,
      onRoomUpdate,
      onRoomMoveSync,
      onRoomRoundResult,
      onRoomError
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
    socket.off("room:error", this.boundSocketListeners.onRoomError);
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

    const socket = this.socketFactory(nextServerUrl, {
      transports: ["websocket"],
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
      const finish = () => {
        socket.off(successEvent, handleSuccess);
        socket.off("room:error", handleError);
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
      let waitingForRoundResult = false;

      const finish = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        socket.off("room:moveSync", handleMoveSync);
        socket.off("room:roundResult", handleRoundResult);
        socket.off("room:error", handleError);
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

        waitingForRoundResult = true;
      };

      const handleRoundResult = (roundResult) => {
        this.logger.info?.("[OnlinePlay][MainClient] submitMove roundResult received", roundResult);
        if (!waitingForRoundResult) {
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
      socket.once("room:roundResult", handleRoundResult);
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
