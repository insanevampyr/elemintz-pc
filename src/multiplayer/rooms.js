const ROOM_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_DIGITS = "23456789";

function randomChar(source, random) {
  const index = Math.floor(random() * source.length);
  return source[index] ?? source[0];
}

function generateRoomCode(random = Math.random) {
  let code = "";

  for (let index = 0; index < 3; index += 1) {
    code += randomChar(ROOM_CODE_LETTERS, random);
  }

  for (let index = 0; index < 3; index += 1) {
    code += randomChar(ROOM_CODE_DIGITS, random);
  }

  return code;
}

function sanitizeRoomCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function buildPlayer(socket) {
  return {
    socketId: socket.id,
    joinedAt: new Date().toISOString()
  };
}

function createEmptyMoveState() {
  return {
    hostMove: null,
    guestMove: null,
    updatedAt: null
  };
}

function createEmptyRoundResult() {
  return null;
}

function cloneMoveState(room) {
  const hostSubmitted = room.moves.hostMove !== null;
  const guestSubmitted = room.moves.guestMove !== null;
  const submittedCount = Number(hostSubmitted) + Number(guestSubmitted);

  return {
    hostSubmitted,
    guestSubmitted,
    submittedCount,
    bothSubmitted: hostSubmitted && guestSubmitted,
    updatedAt: room.moves.updatedAt
  };
}

function resetMoveState(room) {
  room.moves = createEmptyMoveState();
  room.latestRoundResult = createEmptyRoundResult();
}

function determineOutcome(hostMove, guestMove) {
  if (hostMove === guestMove) {
    return {
      hostResult: "draw",
      guestResult: "draw"
    };
  }

  const hostWins =
    (hostMove === "fire" && guestMove === "earth") ||
    (hostMove === "earth" && guestMove === "wind") ||
    (hostMove === "wind" && guestMove === "water") ||
    (hostMove === "water" && guestMove === "fire");

  return hostWins
    ? {
        hostResult: "win",
        guestResult: "lose"
      }
    : {
        hostResult: "lose",
        guestResult: "win"
      };
}

function buildRoundResult(room) {
  if (!room.moves.hostMove || !room.moves.guestMove) {
    return null;
  }

  return {
    roomCode: room.roomCode,
    hostMove: room.moves.hostMove,
    guestMove: room.moves.guestMove,
    ...determineOutcome(room.moves.hostMove, room.moves.guestMove)
  };
}

function cloneRoom(room) {
  return {
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    host: room.host ? { ...room.host } : null,
    guest: room.guest ? { ...room.guest } : null,
    status: room.status,
    moveSync: cloneMoveState(room)
  };
}

export function createRoomStore({ random = Math.random } = {}) {
  const rooms = new Map();
  const socketToRoom = new Map();

  function generateUniqueRoomCode() {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const roomCode = generateRoomCode(random);
      if (!rooms.has(roomCode)) {
        return roomCode;
      }
    }

    throw new Error("Unable to generate a unique room code.");
  }

  function getRoomBySocket(socketId) {
    const roomCode = socketToRoom.get(socketId);
    return roomCode ? rooms.get(roomCode) ?? null : null;
  }

  return {
    createRoom(socket) {
      if (getRoomBySocket(socket.id)) {
        return {
          ok: false,
          error: {
            code: "ROOM_ALREADY_JOINED",
            message: "This socket is already assigned to a room."
          }
        };
      }

      const roomCode = generateUniqueRoomCode();
      const room = {
        roomCode,
        createdAt: new Date().toISOString(),
        host: buildPlayer(socket),
        guest: null,
        status: "waiting",
        moves: createEmptyMoveState(),
        latestRoundResult: createEmptyRoundResult()
      };

      rooms.set(roomCode, room);
      socketToRoom.set(socket.id, roomCode);

      return {
        ok: true,
        room: cloneRoom(room)
      };
    },

    joinRoom(socket, roomCodeInput) {
      if (getRoomBySocket(socket.id)) {
        return {
          ok: false,
          error: {
            code: "ROOM_ALREADY_JOINED",
            message: "This socket is already assigned to a room."
          }
        };
      }

      const roomCode = sanitizeRoomCode(roomCodeInput);
      const room = rooms.get(roomCode);

      if (!room) {
        return {
          ok: false,
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room code not found."
          }
        };
      }

      if (room.guest) {
        return {
          ok: false,
          error: {
            code: "ROOM_FULL",
            message: "Room is already full."
          }
        };
      }

      room.guest = buildPlayer(socket);
      room.status = "full";
      resetMoveState(room);
      socketToRoom.set(socket.id, roomCode);

      return {
        ok: true,
        room: cloneRoom(room)
      };
    },

    removeSocket(socketId) {
      const roomCode = socketToRoom.get(socketId);
      if (!roomCode) {
        return { removedRoomCode: null, room: null };
      }

      socketToRoom.delete(socketId);
      const room = rooms.get(roomCode);
      if (!room) {
        return { removedRoomCode: roomCode, room: null };
      }

      if (room.host?.socketId === socketId) {
        if (room.guest) {
          room.host = room.guest;
          room.guest = null;
          room.status = "waiting";
          resetMoveState(room);
          return {
            removedRoomCode: null,
            room: cloneRoom(room)
          };
        }

        rooms.delete(roomCode);
        return {
          removedRoomCode: roomCode,
          room: null
        };
      }

      if (room.guest?.socketId === socketId) {
        room.guest = null;
        room.status = "waiting";
        resetMoveState(room);
      }

      if (!room.host && !room.guest) {
        rooms.delete(roomCode);
        return {
          removedRoomCode: roomCode,
          room: null
        };
      }

      return {
        removedRoomCode: null,
        room: cloneRoom(room)
      };
    },

    getRoom(roomCode) {
      const room = rooms.get(sanitizeRoomCode(roomCode));
      return room ? cloneRoom(room) : null;
    },

    submitMove(socketId, moveInput) {
      const room = getRoomBySocket(socketId);
      if (!room) {
        return {
          ok: false,
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room code not found."
          }
        };
      }

      if (room.status !== "full" || !room.host || !room.guest) {
        return {
          ok: false,
          error: {
            code: "ROOM_NOT_READY",
            message: "Both players must be connected before submitting moves."
          }
        };
      }

      const move = String(moveInput ?? "").trim().toLowerCase();
      if (!move) {
        return {
          ok: false,
          error: {
            code: "MOVE_INVALID",
            message: "Move selection is required."
          }
        };
      }

      const moveKey =
        room.host?.socketId === socketId
          ? "hostMove"
          : room.guest?.socketId === socketId
            ? "guestMove"
            : null;

      if (!moveKey) {
        return {
          ok: false,
          error: {
            code: "ROOM_PLAYER_NOT_FOUND",
            message: "This socket is not assigned to a room player slot."
          }
        };
      }

      if (room.moves[moveKey] !== null) {
        return {
          ok: false,
          error: {
            code: "MOVE_ALREADY_SUBMITTED",
            message: "This player already submitted a move."
          }
        };
      }

      room.moves[moveKey] = move;
      room.moves.updatedAt = new Date().toISOString();
      room.latestRoundResult = buildRoundResult(room);

      return {
        ok: true,
        room: cloneRoom(room),
        roundResult: room.latestRoundResult
      };
    },

    getRoomCodeForSocket(socketId) {
      return socketToRoom.get(socketId) ?? null;
    }
  };
}
