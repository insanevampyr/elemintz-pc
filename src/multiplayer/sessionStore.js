import crypto from "node:crypto";

const DEFAULT_SESSION_GRACE_MS = 60000;
const MAX_USERNAME_LENGTH = 32;

function normalizeUsername(username) {
  const normalized = String(username ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_USERNAME_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function buildSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function buildSessionId() {
  return crypto.randomUUID();
}

function toPublicSession(session) {
  if (!session) {
    return null;
  }

  return {
    token: session.token,
    sessionId: session.sessionId,
    username: session.username,
    profileKey: session.profileKey ?? session.username,
    accountId: session.accountId ?? null,
    authenticated: Boolean(session.authenticated),
    issuedAt: session.issuedAt,
    resumedAt: session.resumedAt ?? null,
    lastSeenAt: session.lastSeenAt ?? null
  };
}

export function createSessionStore({
  logger = console,
  now = () => Date.now(),
  gracePeriodMs = DEFAULT_SESSION_GRACE_MS
} = {}) {
  const sessionsByToken = new Map();
  const tokenByUsername = new Map();
  const tokenBySocketId = new Map();
  const expiryTimers = new Map();

  function clearExpiry(token) {
    const existing = expiryTimers.get(token);
    if (!existing) {
      return;
    }

    clearTimeout(existing);
    expiryTimers.delete(token);
  }

  function destroySession(token) {
    const session = sessionsByToken.get(token);
    if (!session) {
      return false;
    }

    clearExpiry(token);
    sessionsByToken.delete(token);
    if (session.username) {
      tokenByUsername.delete(session.username);
    }
    if (session.socketId) {
      tokenBySocketId.delete(session.socketId);
    }
    return true;
  }

  function scheduleExpiry(token) {
    clearExpiry(token);
    const timerId = setTimeout(() => {
      expiryTimers.delete(token);
      const session = sessionsByToken.get(token);
      if (!session || session.connected) {
        return;
      }

      logger.info?.("[Session] expired disconnected session", {
        sessionId: session.sessionId,
        username: session.username
      });
      destroySession(token);
    }, gracePeriodMs);

    timerId.unref?.();
    expiryTimers.set(token, timerId);
  }

  function attachSocket(session, socketId, { resumedAt = null } = {}) {
    if (session.socketId && session.socketId !== socketId) {
      tokenBySocketId.delete(session.socketId);
    }

    clearExpiry(session.token);
    session.socketId = socketId;
    session.connected = true;
    session.lastSeenAt = new Date(now()).toISOString();
    if (resumedAt) {
      session.resumedAt = resumedAt;
    }
    tokenBySocketId.set(socketId, session.token);
  }

  function issueSession({
    username,
    socketId,
    accountId = null,
    email = null,
    profileKey = null,
    authenticated = false,
    replaceDisconnected = false
  }) {
    const safeUsername = normalizeUsername(username);
    if (!safeUsername) {
      return {
        ok: false,
        error: {
          code: "SESSION_USERNAME_REQUIRED",
          message: "A valid username is required to start an online session."
        }
      };
    }

    const existingSocketToken = tokenBySocketId.get(socketId);
    if (existingSocketToken) {
      const existingSocketSession = sessionsByToken.get(existingSocketToken);
      if (existingSocketSession?.username === safeUsername) {
        return {
          ok: true,
          session: toPublicSession(existingSocketSession)
        };
      }

      destroySession(existingSocketToken);
    }

    const existingToken = tokenByUsername.get(safeUsername);
    if (existingToken) {
      const existingSession = sessionsByToken.get(existingToken);
      if (existingSession?.connected && existingSession.socketId === socketId) {
        return {
          ok: true,
          session: toPublicSession(existingSession)
        };
      }

      if (existingSession?.connected && existingSession.socketId !== socketId) {
        return {
          ok: false,
          error: {
            code: "SESSION_USERNAME_ACTIVE",
            message: "This username already has an active online session."
          }
        };
      }

      if (existingSession && !existingSession.connected) {
        if (replaceDisconnected) {
          destroySession(existingToken);
        } else {
          return {
            ok: false,
            error: {
              code: "SESSION_RESUME_REQUIRED",
              message: "This disconnected online session must be resumed with its server token."
            }
          };
        }
      }
    }

    const issuedAt = new Date(now()).toISOString();
    const session = {
      token: buildSessionToken(),
      sessionId: buildSessionId(),
      username: safeUsername,
      profileKey: normalizeUsername(profileKey) ?? safeUsername,
      accountId: String(accountId ?? "").trim() || null,
      email: String(email ?? "").trim().toLowerCase() || null,
      authenticated: Boolean(authenticated),
      socketId: null,
      connected: false,
      issuedAt,
      resumedAt: null,
      lastSeenAt: issuedAt
    };

    sessionsByToken.set(session.token, session);
    tokenByUsername.set(session.username, session.token);
    attachSocket(session, socketId);
    logger.info?.("[Session] issued", {
      sessionId: session.sessionId,
      username: session.username
    });

    return {
      ok: true,
      session: toPublicSession(session)
    };
  }

  function resumeSession({ token, socketId }) {
    const safeToken = String(token ?? "").trim();
    if (!safeToken) {
      return {
        ok: false,
        error: {
          code: "SESSION_TOKEN_REQUIRED",
          message: "A valid session token is required to resume this online session."
        }
      };
    }

    const existingSocketToken = tokenBySocketId.get(socketId);
    if (existingSocketToken && existingSocketToken !== safeToken) {
      destroySession(existingSocketToken);
    }

    const session = sessionsByToken.get(safeToken);
    if (!session) {
      return {
        ok: false,
        error: {
          code: "SESSION_NOT_FOUND",
          message: "This online session is no longer valid."
        }
      };
    }

    if (session.connected && session.socketId && session.socketId !== socketId) {
      return {
        ok: false,
        error: {
          code: "SESSION_ALREADY_ACTIVE",
          message: "This online session is already active on another connection."
        }
      };
    }

    attachSocket(session, socketId, { resumedAt: new Date(now()).toISOString() });
    logger.info?.("[Session] resumed", {
      sessionId: session.sessionId,
      username: session.username
    });

    return {
      ok: true,
      session: toPublicSession(session)
    };
  }

  function getSessionBySocket(socketId) {
    const token = tokenBySocketId.get(socketId);
    return token ? sessionsByToken.get(token) ?? null : null;
  }

  function getSessionByToken(token) {
    const safeToken = String(token ?? "").trim();
    return safeToken ? sessionsByToken.get(safeToken) ?? null : null;
  }

  function disconnectSocket(socketId) {
    const token = tokenBySocketId.get(socketId);
    if (!token) {
      return null;
    }

    tokenBySocketId.delete(socketId);
    const session = sessionsByToken.get(token);
    if (!session) {
      return null;
    }

    session.connected = false;
    session.socketId = null;
    session.lastSeenAt = new Date(now()).toISOString();
    scheduleExpiry(token);
    logger.info?.("[Session] detached socket", {
      sessionId: session.sessionId,
      username: session.username
    });
    return toPublicSession(session);
  }

  return {
    issueSession,
    resumeSession,
    getSessionBySocket,
    getSessionByToken,
    disconnectSocket,
    destroySession,
    toPublicSession
  };
}

export { DEFAULT_SESSION_GRACE_MS };
