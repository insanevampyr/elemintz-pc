import http from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { createRoomStore } from "./rooms.js";

const DEFAULT_PORT = 3001;

export function createMultiplayerFoundation({
  port = Number(process.env.PORT) || DEFAULT_PORT,
  logger = console,
  random = Math.random
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
  logger.info("[OnlinePlay][Server] room:submitMove listener ready", {
    phase: 5
  });

  // Phase 5 foundation: private 2-player room lifecycle plus authoritative
  // move submission sync and one-round elemental resolution only. WAR logic,
  // multi-round flow, reconnect/resume, and persistence are still intentionally
  // out of scope.
  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "elemintz-multiplayer",
      phase: 5,
      transport: "socket.io"
    });
  });

  io.on("connection", (socket) => {
    logger.info("[Multiplayer] client connected", {
      socketId: socket.id,
      transport: socket.conn.transport.name
    });
    logger.info("[OnlinePlay][Server] socket listeners attached", {
      socketId: socket.id,
      listeners: ["room:create", "room:join", "room:submitMove", "disconnect"]
    });

    socket.on("room:create", () => {
      const result = roomStore.createRoom(socket);

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      socket.join(result.room.roomCode);
      socket.emit("room:created", result.room);
    });

    socket.on("room:join", (payload = {}) => {
      const result = roomStore.joinRoom(socket, payload.roomCode);

      if (!result.ok) {
        socket.emit("room:error", result.error);
        return;
      }

      socket.join(result.room.roomCode);
      socket.emit("room:joined", result.room);
      io.to(result.room.roomCode).emit("room:update", result.room);
    });

    socket.on("room:submitMove", (payload = {}) => {
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

      logger.info("[OnlinePlay][Server] broadcasting room:moveSync", {
        roomCode: result.room.roomCode,
        moveSync: result.room.moveSync
      });
      io.to(result.room.roomCode).emit("room:moveSync", result.room);

      if (result.roundResult) {
        logger.info("[OnlinePlay][Server] broadcasting room:roundResult", result.roundResult);
        io.to(result.room.roomCode).emit("room:roundResult", result.roundResult);
      }
    });

    socket.on("disconnect", (reason) => {
      const roomResult = roomStore.removeSocket(socket.id);
      if (roomResult.room) {
        io.to(roomResult.room.roomCode).emit("room:update", roomResult.room);
      }

      logger.info("[Multiplayer] client disconnected", {
        socketId: socket.id,
        reason
      });
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

      logger.info("[Multiplayer] server listening", {
        port: listeningPort
      });

      return listeningPort;
    },
    async stop() {
      io.removeAllListeners();
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

export { DEFAULT_PORT };
