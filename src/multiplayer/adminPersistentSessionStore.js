import crypto from "node:crypto";

import { JsonStore } from "../state/storage/jsonStore.js";

const ADMIN_SESSION_SCHEMA_VERSION = 1;
const ADMIN_SESSION_FILENAME = "server-data/admin-persistent-sessions.json";
const ADMIN_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function buildEmptyState() {
  return {
    schemaVersion: ADMIN_SESSION_SCHEMA_VERSION,
    sessions: []
  };
}

function normalizeText(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function buildToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  const safeToken = String(token ?? "").trim();
  return safeToken
    ? crypto.createHash("sha256").update(safeToken, "utf8").digest("hex")
    : null;
}

function buildPublicAdminSession(record, token = null) {
  if (!record) {
    return null;
  }

  return {
    ...(token ? { token } : {}),
    adminSessionId: record.adminSessionId,
    username: record.username,
    profileKey: record.profileKey ?? record.username,
    accountId: record.accountId ?? null,
    email: record.email ?? null,
    authenticated: true,
    admin: true,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt ?? null
  };
}

function sanitizeRecord(record) {
  const tokenHash = normalizeText(record?.tokenHash);
  const username = normalizeText(record?.username);
  const email = normalizeEmail(record?.email);
  const issuedAt = normalizeIsoTimestamp(record?.issuedAt);
  const expiresAt = normalizeIsoTimestamp(record?.expiresAt);
  if (!tokenHash || !username || !email || !issuedAt || !expiresAt) {
    return null;
  }

  return {
    tokenHash,
    adminSessionId: normalizeText(record?.adminSessionId) ?? crypto.randomUUID(),
    username,
    profileKey: normalizeText(record?.profileKey) ?? username,
    accountId: normalizeText(record?.accountId),
    email,
    issuedAt,
    expiresAt,
    revokedAt: normalizeIsoTimestamp(record?.revokedAt),
    lastUsedAt: normalizeIsoTimestamp(record?.lastUsedAt)
  };
}

export class AdminPersistentSessionStore {
  constructor({ dataDir, now = () => Date.now() } = {}) {
    this.store = new JsonStore(ADMIN_SESSION_FILENAME, { dataDir });
    this.now = now;
    this.mutationQueue = Promise.resolve();
  }

  async readState() {
    const state = await this.store.read(buildEmptyState());
    return {
      schemaVersion: ADMIN_SESSION_SCHEMA_VERSION,
      sessions: Array.isArray(state?.sessions)
        ? state.sessions.map((entry) => sanitizeRecord(entry)).filter(Boolean)
        : []
    };
  }

  async writeState(state) {
    return this.store.write({
      schemaVersion: ADMIN_SESSION_SCHEMA_VERSION,
      sessions: Array.isArray(state?.sessions)
        ? state.sessions.map((entry) => sanitizeRecord(entry)).filter(Boolean)
        : []
    });
  }

  async mutateState(mutator) {
    const runMutation = async () => {
      const state = await this.readState();
      const result = await mutator(state);
      if (result?.write !== false) {
        await this.writeState(state);
      }
      return result?.value;
    };

    const queuedMutation = this.mutationQueue.then(runMutation, runMutation);
    this.mutationQueue = queuedMutation.catch(() => undefined);
    return queuedMutation;
  }

  isExpired(record) {
    const expiresAtMs = Date.parse(record?.expiresAt ?? "");
    return Number.isFinite(expiresAtMs) && this.now() >= expiresAtMs;
  }

  async issueSession({ account } = {}) {
    const username = normalizeText(account?.username ?? account?.profileKey);
    const email = normalizeEmail(account?.email);
    if (!username || !email) {
      const error = new Error("A valid Admin account identity is required.");
      error.code = "ADMIN_SESSION_ACCOUNT_REQUIRED";
      throw error;
    }

    const token = buildToken();
    const issuedAt = new Date(this.now()).toISOString();
    const record = {
      tokenHash: hashToken(token),
      adminSessionId: crypto.randomUUID(),
      username,
      profileKey: normalizeText(account?.profileKey) ?? username,
      accountId: normalizeText(account?.accountId),
      email,
      issuedAt,
      expiresAt: new Date(this.now() + ADMIN_SESSION_MAX_AGE_MS).toISOString(),
      revokedAt: null,
      lastUsedAt: issuedAt
    };

    return this.mutateState((state) => {
      state.sessions.push(record);
      return {
        value: buildPublicAdminSession(record, token)
      };
    });
  }

  async resumeSession(token) {
    const tokenHash = hashToken(token);
    if (!tokenHash) {
      const error = new Error("A valid Admin session token is required.");
      error.code = "ADMIN_SESSION_TOKEN_REQUIRED";
      throw error;
    }

    return this.mutateState((state) => {
      const record = state.sessions.find((entry) => entry.tokenHash === tokenHash) ?? null;
      if (!record) {
        const error = new Error("This Admin session is no longer valid.");
        error.code = "ADMIN_SESSION_NOT_FOUND";
        throw error;
      }
      if (record.revokedAt) {
        const error = new Error("This Admin session has been revoked.");
        error.code = "ADMIN_SESSION_REVOKED";
        throw error;
      }
      if (this.isExpired(record)) {
        const error = new Error("This Admin session has expired.");
        error.code = "ADMIN_SESSION_EXPIRED";
        throw error;
      }

      record.lastUsedAt = new Date(this.now()).toISOString();
      return {
        value: buildPublicAdminSession(record, token)
      };
    });
  }

  async revokeSession(token) {
    const tokenHash = hashToken(token);
    if (!tokenHash) {
      return { revoked: false };
    }

    return this.mutateState((state) => {
      const record = state.sessions.find((entry) => entry.tokenHash === tokenHash) ?? null;
      if (!record) {
        return {
          write: false,
          value: { revoked: false }
        };
      }
      if (!record.revokedAt) {
        record.revokedAt = new Date(this.now()).toISOString();
        return {
          value: { revoked: true }
        };
      }

      return {
        write: false,
        value: { revoked: false }
      };
    });
  }
}

export {
  ADMIN_SESSION_MAX_AGE_MS,
  ADMIN_SESSION_SCHEMA_VERSION,
  hashToken as hashAdminPersistentSessionToken
};
