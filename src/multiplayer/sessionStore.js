import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../state/paths.js";

const DEFAULT_SESSION_GRACE_MS = 60000;
const DEFAULT_DURABLE_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_USERNAME_LENGTH = 32;
const PERSISTED_SESSION_SCHEMA_VERSION = 1;
const PERSISTED_SESSION_FILENAME = "server-data/multiplayer-sessions.json";

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

function resolvePersistedSessionFilePath(dataDir) {
  if (!dataDir) {
    return null;
  }

  return path.join(resolveDataDir(dataDir), PERSISTED_SESSION_FILENAME);
}

function buildEmptyPersistedSessionState() {
  return {
    schemaVersion: PERSISTED_SESSION_SCHEMA_VERSION,
    sessions: []
  };
}

function readPersistedSessionState(filePath, logger = console) {
  if (!filePath) {
    return buildEmptyPersistedSessionState();
  }

  try {
    if (!fs.existsSync(filePath)) {
      return buildEmptyPersistedSessionState();
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : buildEmptyPersistedSessionState();
  } catch (error) {
    logger.warn?.("[Session] failed to read durable session store; ignoring saved sessions", {
      filePath,
      message: error?.message ?? String(error)
    });
    return buildEmptyPersistedSessionState();
  }
}

function writePersistedSessionState(filePath, sessions, logger = console) {
  if (!filePath) {
    return;
  }

  const payload = JSON.stringify(
    {
      schemaVersion: PERSISTED_SESSION_SCHEMA_VERSION,
      sessions
    },
    null,
    2
  );
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.tmp`;

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, payload, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort temp cleanup only.
    }
    logger.warn?.("[Session] failed to persist durable session store", {
      filePath,
      message: error?.message ?? String(error)
    });
  }
}

function normalizeIsoTimestamp(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function buildSessionExpiry(now, maxAgeMs) {
  return new Date(now + maxAgeMs).toISOString();
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
    rememberSession: Boolean(session.rememberSession),
    expiresAt: session.expiresAt ?? null,
    issuedAt: session.issuedAt,
    resumedAt: session.resumedAt ?? null,
    lastSeenAt: session.lastSeenAt ?? null
  };
}

export function createSessionStore({
  logger = console,
  now = () => Date.now(),
  gracePeriodMs = DEFAULT_SESSION_GRACE_MS,
  durableSessionMaxAgeMs = DEFAULT_DURABLE_SESSION_MAX_AGE_MS,
  dataDir = null
} = {}) {
  const sessionsByToken = new Map();
  const tokenByUsername = new Map();
  const tokenBySocketId = new Map();
  const expiryTimers = new Map();
  const expiredRememberedTokens = new Set();
  const persistencePath = resolvePersistedSessionFilePath(dataDir);

  function isSessionExpired(session) {
    const expiresAtMs = Date.parse(session?.expiresAt ?? "");
    if (!Number.isFinite(expiresAtMs)) {
      return false;
    }

    return now() >= expiresAtMs;
  }

  function buildPersistedSessionSnapshot(session) {
    if (!session?.token || !session?.authenticated || !session?.rememberSession) {
      return null;
    }

    return {
      token: session.token,
      sessionId: session.sessionId,
      username: session.username,
      profileKey: session.profileKey ?? session.username,
      accountId: session.accountId ?? null,
      email: session.email ?? null,
      authenticated: true,
      rememberSession: true,
      expiresAt: normalizeIsoTimestamp(session.expiresAt),
      issuedAt: session.issuedAt ?? new Date(now()).toISOString(),
      resumedAt: normalizeIsoTimestamp(session.resumedAt),
      lastSeenAt: normalizeIsoTimestamp(session.lastSeenAt)
    };
  }

  function persistRememberedSessions() {
    if (!persistencePath) {
      return;
    }

    const rememberedSessions = [];
    for (const session of sessionsByToken.values()) {
      if (isSessionExpired(session)) {
        continue;
      }

      const snapshot = buildPersistedSessionSnapshot(session);
      if (snapshot) {
        rememberedSessions.push(snapshot);
      }
    }

    writePersistedSessionState(persistencePath, rememberedSessions, logger);
  }

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
    expiredRememberedTokens.delete(token);
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
    persistRememberedSessions();
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
    persistRememberedSessions();
  }

  function pruneExpiredSessions() {
    for (const [token, session] of sessionsByToken.entries()) {
      if (!isSessionExpired(session)) {
        continue;
      }

      logger.info?.("[Session] expired durable session", {
        sessionId: session.sessionId,
        username: session.username
      });
      destroySession(token);
    }
  }

  function issueSession({
    username,
    socketId,
    accountId = null,
    email = null,
    profileKey = null,
    authenticated = false,
    rememberSession = false,
    replaceDisconnected = false
  }) {
    pruneExpiredSessions();
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
    const shouldRememberSession = Boolean(rememberSession && authenticated && persistencePath);
    const session = {
      token: buildSessionToken(),
      sessionId: buildSessionId(),
      username: safeUsername,
      profileKey: normalizeUsername(profileKey) ?? safeUsername,
      accountId: String(accountId ?? "").trim() || null,
      email: String(email ?? "").trim().toLowerCase() || null,
      authenticated: Boolean(authenticated),
      rememberSession: shouldRememberSession,
      expiresAt: shouldRememberSession ? buildSessionExpiry(now(), durableSessionMaxAgeMs) : null,
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
    pruneExpiredSessions();
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
      if (expiredRememberedTokens.has(safeToken)) {
        expiredRememberedTokens.delete(safeToken);
        return {
          ok: false,
          error: {
            code: "SESSION_EXPIRED",
            message: "This online session has expired."
          }
        };
      }

      return {
        ok: false,
        error: {
          code: "SESSION_NOT_FOUND",
          message: "This online session is no longer valid."
        }
      };
    }

    if (isSessionExpired(session)) {
      destroySession(safeToken);
      return {
        ok: false,
        error: {
          code: "SESSION_EXPIRED",
          message: "This online session has expired."
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
    pruneExpiredSessions();
    const token = tokenBySocketId.get(socketId);
    return token ? sessionsByToken.get(token) ?? null : null;
  }

  function getSessionByToken(token) {
    pruneExpiredSessions();
    const safeToken = String(token ?? "").trim();
    return safeToken ? sessionsByToken.get(safeToken) ?? null : null;
  }

  function getSessionByUsername(username) {
    pruneExpiredSessions();
    const safeUsername = normalizeUsername(username);
    if (!safeUsername) {
      return null;
    }

    for (const session of sessionsByToken.values()) {
      if (
        normalizeUsername(session?.username) === safeUsername ||
        normalizeUsername(session?.profileKey) === safeUsername
      ) {
        return toPublicSession(session);
      }
    }

    return null;
  }

  function getSocketIdByUsername(username) {
    pruneExpiredSessions();
    const safeUsername = normalizeUsername(username);
    if (!safeUsername) {
      return null;
    }

    for (const session of sessionsByToken.values()) {
      if (
        normalizeUsername(session?.username) === safeUsername ||
        normalizeUsername(session?.profileKey) === safeUsername
      ) {
        return session?.socketId ?? null;
      }
    }

    return null;
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
    if (session.rememberSession && session.authenticated && !isSessionExpired(session)) {
      persistRememberedSessions();
    } else {
      scheduleExpiry(token);
    }
    logger.info?.("[Session] detached socket", {
      sessionId: session.sessionId,
      username: session.username
    });
    return toPublicSession(session);
  }

  function getAuthenticatedConnectedUsernameCount() {
    pruneExpiredSessions();
    const connectedUsernames = new Set();

    for (const session of sessionsByToken.values()) {
      if (!session?.connected || !session?.authenticated) {
        continue;
      }

      const safeUsername = normalizeUsername(session.username);
      if (safeUsername) {
        connectedUsernames.add(safeUsername);
      }
    }

    return connectedUsernames.size;
  }

  function hydratePersistedRememberedSessions() {
    if (!persistencePath) {
      return;
    }

    const persistedState = readPersistedSessionState(persistencePath, logger);
    for (const entry of Array.isArray(persistedState?.sessions) ? persistedState.sessions : []) {
      const token = String(entry?.token ?? "").trim();
      const username = normalizeUsername(entry?.username);
      if (!token || !username) {
        continue;
      }

      const session = {
        token,
        sessionId: String(entry?.sessionId ?? "").trim() || buildSessionId(),
        username,
        profileKey: normalizeUsername(entry?.profileKey) ?? username,
        accountId: String(entry?.accountId ?? "").trim() || null,
        email: String(entry?.email ?? "").trim().toLowerCase() || null,
        authenticated: Boolean(entry?.authenticated),
        rememberSession: true,
        expiresAt: normalizeIsoTimestamp(entry?.expiresAt),
        socketId: null,
        connected: false,
        issuedAt: normalizeIsoTimestamp(entry?.issuedAt) ?? new Date(now()).toISOString(),
        resumedAt: normalizeIsoTimestamp(entry?.resumedAt),
        lastSeenAt: normalizeIsoTimestamp(entry?.lastSeenAt) ?? new Date(now()).toISOString()
      };

      if (!session.authenticated || isSessionExpired(session)) {
        if (session.authenticated && isSessionExpired(session)) {
          expiredRememberedTokens.add(session.token);
        }
        continue;
      }

      sessionsByToken.set(session.token, session);
      tokenByUsername.set(session.username, session.token);
    }

    persistRememberedSessions();
  }

  hydratePersistedRememberedSessions();

  return {
    issueSession,
    resumeSession,
    getSessionBySocket,
    getSessionByToken,
    getSessionByUsername,
    getSocketIdByUsername,
    disconnectSocket,
    destroySession,
    getAuthenticatedConnectedUsernameCount,
    toPublicSession
  };
}

export { DEFAULT_SESSION_GRACE_MS, DEFAULT_DURABLE_SESSION_MAX_AGE_MS };
