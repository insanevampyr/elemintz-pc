import http from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

const DEFAULT_PORT = 3001;

export function createMultiplayerFoundation({
  port = Number(process.env.PORT) || DEFAULT_PORT,
  logger = console
} = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Phase 1 foundation only: deployment health, Socket.IO bootstrap, and
  // connect/disconnect logging. Room lifecycle, matchmaking, gameplay sync,
  // and move resolution intentionally do not exist yet.
  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "elemintz-multiplayer",
      phase: 1,
      transport: "socket.io"
    });
  });

  io.on("connection", (socket) => {
    logger.info("[Multiplayer] client connected", {
      socketId: socket.id,
      transport: socket.conn.transport.name
    });

    socket.on("disconnect", (reason) => {
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
