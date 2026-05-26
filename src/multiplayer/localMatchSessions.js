import { randomUUID } from "node:crypto";

function normalizeSessionString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function cloneMetadata(metadata) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {};
}

function toPublicSession(session) {
  if (!session) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    username: session.username,
    mode: session.mode,
    aiDifficulty: session.aiDifficulty ?? null,
    featuredRivalId: session.featuredRivalId ?? null,
    gauntletRivalId: session.gauntletRivalId ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    metadata: cloneMetadata(session.metadata)
  };
}

export function createLocalMatchSessionStore({ now = () => new Date() } = {}) {
  const sessions = new Map();

  function buildTimestamp() {
    const value = now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  function createSession({
    username,
    mode,
    aiDifficulty = null,
    featuredRivalId = null,
    gauntletRivalId = null,
    metadata = {}
  } = {}) {
    const safeUsername = normalizeSessionString(username);
    const safeMode = normalizeSessionString(mode);
    if (!safeUsername) {
      throw new Error("username is required for local match session creation.");
    }
    if (!safeMode) {
      throw new Error("mode is required for local match session creation.");
    }

    const timestamp = buildTimestamp();
    const session = {
      sessionId: `local-${randomUUID()}`,
      username: safeUsername,
      mode: safeMode,
      aiDifficulty: normalizeSessionString(aiDifficulty),
      featuredRivalId: normalizeSessionString(featuredRivalId),
      gauntletRivalId: normalizeSessionString(gauntletRivalId),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "active",
      metadata: cloneMetadata(metadata)
    };

    sessions.set(session.sessionId, session);
    return toPublicSession(session);
  }

  function getSession(sessionId) {
    const safeSessionId = normalizeSessionString(sessionId);
    return safeSessionId ? sessions.get(safeSessionId) ?? null : null;
  }

  function getSessionForUsername(sessionId, username) {
    const session = getSession(sessionId);
    const safeUsername = normalizeSessionString(username);
    if (!session || !safeUsername) {
      return null;
    }

    return session.username === safeUsername ? session : null;
  }

  function abandonSession({ sessionId, username } = {}) {
    const session = getSessionForUsername(sessionId, username);
    if (!session) {
      return null;
    }

    session.status = "abandoned";
    session.updatedAt = buildTimestamp();
    return toPublicSession(session);
  }

  function completeSession({ sessionId, username, metadata = {} } = {}) {
    const session = getSessionForUsername(sessionId, username);
    if (!session) {
      return null;
    }

    const timestamp = buildTimestamp();
    session.status = "completed";
    session.updatedAt = timestamp;
    session.metadata = {
      ...cloneMetadata(session.metadata),
      ...cloneMetadata(metadata),
      completedAt: timestamp
    };
    return toPublicSession(session);
  }

  return {
    createSession,
    getSession,
    getSessionForUsername,
    abandonSession,
    completeSession,
    toPublicSession
  };
}
