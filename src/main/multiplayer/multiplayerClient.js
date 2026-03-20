import { io as createSocket } from "socket.io-client";

export const DEFAULT_MULTIPLAYER_SERVER_URL = "http://127.0.0.1:3001";

function cloneRoom(room) {
  return room
    ? {
        roomCode: room.roomCode,
        createdAt: room.createdAt,
        host: room.host ? { ...room.host } : null,
        guest: room.guest ? { ...room.guest } : null,
        status: room.status,
        moveSync: room.moveSync ? { ...room.moveSync } : null
      }
    : null;
}

function cloneRoundResult(roundResult) {
  return roundResult
    ? {
        roomCode: roundResult.roomCode,
        hostMove: roundResult.hostMove,
        guestMove: roundResult.guestMove,
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
    room: cloneRoom(state.room),
    latestRoundResult: cloneRoundResult(state.latestRoundResult),
    lastError: state.lastError ? { ...state.lastError } : null,
    statusMessage: state.statusMessage
  };
}

export class MultiplayerClient {
  constructor({
    socketFactory = createSocket,
    logger = console,
    defaultServerUrl = DEFAULT_MULTIPLAYER_SERVER_URL
  } = {}) {
    this.socketFactory = socketFactory;
    this.logger = logger;
    this.defaultServerUrl = defaultServerUrl;
    this.socket = null;
    this.connectPromise = null;
    this.boundSocketListeners = null;
    this.subscribers = new Set();
    this.state = {
      serverUrl: defaultServerUrl,
      connectionStatus: "disconnected",
      socketId: null,
      room: null,
      latestRoundResult: null,
      lastError: null,
      statusMessage: "Offline. Open Online Play to connect."
    };
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
    };

    const onConnectError = (error) => {
      this.logger.error?.("[Multiplayer][Electron] connect_error", {
        serverUrl: this.state.serverUrl,
        message: error?.message
      });
      this.updateState({
        connectionStatus: "disconnected",
        socketId: null,
        room: null,
        latestRoundResult: null,
        lastError: {
          code: "CONNECTION_FAILED",
          message: String(error?.message ?? "Unable to connect to multiplayer server.")
        },
        statusMessage: "Connection failed."
      });
    };

    const onDisconnect = (reason) => {
      this.logger.info("[Multiplayer][Electron] disconnected", {
        socketId: socket.id,
        reason
      });
      this.updateState({
        connectionStatus: "disconnected",
        socketId: null,
        room: null,
        latestRoundResult: null,
        statusMessage: reason === "io client disconnect" ? "Disconnected." : "Connection closed."
      });
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
      this.updateState({
        room: cloneRoom(room),
        latestRoundResult: room?.status === "full" ? this.state.latestRoundResult : null,
        lastError: null,
        statusMessage:
          room?.status === "full"
            ? `Room ${room.roomCode} is full.`
            : `Room ${room?.roomCode ?? ""} is waiting for another player.`.trim()
      });
    };

    const onRoomMoveSync = (room) => {
      const submittedCount = Number(room?.moveSync?.submittedCount ?? 0);
      const statusMessage =
        submittedCount >= 2
          ? `Both players submitted moves for room ${room.roomCode}.`
          : `${submittedCount}/2 move submission${submittedCount === 1 ? "" : "s"} received for room ${room.roomCode}.`;

      this.updateState({
        room: cloneRoom(room),
        lastError: null,
        statusMessage
      });
    };

    const onRoomRoundResult = (roundResult) => {
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
        perspectiveResult === "win"
          ? "You Win"
          : perspectiveResult === "lose"
            ? "You Lose"
            : perspectiveResult === "draw"
              ? "Draw"
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
    const connected = await this.ensureConnected(options);
    if (!connected || !this.socket) {
      return this.getState();
    }

    const socket = this.socket;
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
        payload
      });
      socket.emit(eventName, payload);
    });
  }

  async createRoom({ serverUrl } = {}) {
    return this.runRoomAction("room:create", undefined, "room:created", { serverUrl });
  }

  async joinRoom({ roomCode, serverUrl } = {}) {
    return this.runRoomAction("room:join", { roomCode }, "room:joined", { serverUrl });
  }

  async submitMove({ move, serverUrl } = {}) {
    this.logger.info?.("[OnlinePlay][MainClient] submitMove entered", {
      move
    });
    return this.runRoomAction("room:submitMove", { move }, "room:moveSync", { serverUrl });
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
      room: null,
      latestRoundResult: null,
      lastError: null,
      serverUrl: preserveServerUrl ? this.state.serverUrl : this.defaultServerUrl,
      statusMessage: silent ? this.state.statusMessage : "Disconnected."
    });

    return this.getState();
  }
}
