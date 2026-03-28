import crypto from "node:crypto";

import { JsonStore } from "../state/storage/jsonStore.js";

const ACCOUNTS_SCHEMA_VERSION = 1;
const MAX_EMAIL_LENGTH = 160;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;

function buildAccountError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function normalizeUsername(username) {
  const normalized = String(username ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_USERNAME_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function normalizePassword(password) {
  return String(password ?? "");
}

function buildEmptyState() {
  return {
    schemaVersion: ACCOUNTS_SCHEMA_VERSION,
    accounts: []
  };
}

function sanitizeAccount(account) {
  if (!account) {
    return null;
  }

  return {
    accountId: account.accountId,
    email: account.email,
    username: account.username,
    profileKey: account.profileKey,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function createScryptHash(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(`scrypt$${salt.toString("hex")}$${Buffer.from(derivedKey).toString("hex")}`);
    });
  });
}

function verifyScryptHash(password, storedHash) {
  return new Promise((resolve, reject) => {
    const [algorithm, saltHex, hashHex] = String(storedHash ?? "").split("$");
    if (algorithm !== "scrypt" || !saltHex || !hashHex) {
      reject(buildAccountError("ACCOUNT_HASH_INVALID", "Stored account password hash is invalid."));
      return;
    }

    const salt = Buffer.from(saltHex, "hex");
    const expectedHash = Buffer.from(hashHex, "hex");
    crypto.scrypt(password, salt, expectedHash.length, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(crypto.timingSafeEqual(Buffer.from(derivedKey), expectedHash));
    });
  });
}

export class MultiplayerAccountStore {
  constructor({ dataDir, logger = console } = {}) {
    this.logger = logger;
    this.store = new JsonStore("accounts.json", { dataDir });
  }

  async readState() {
    const state = await this.store.read(buildEmptyState());
    if (!state || typeof state !== "object") {
      return buildEmptyState();
    }

    return {
      schemaVersion: Number(state.schemaVersion ?? ACCOUNTS_SCHEMA_VERSION),
      accounts: Array.isArray(state.accounts) ? state.accounts : []
    };
  }

  async writeState(state) {
    const safeState = {
      schemaVersion: ACCOUNTS_SCHEMA_VERSION,
      accounts: Array.isArray(state?.accounts) ? state.accounts : []
    };
    await this.store.write(safeState);
    return safeState;
  }

  async register({ email, password, username, profileKey = username } = {}) {
    const safeEmail = normalizeEmail(email);
    const safeUsername = normalizeUsername(username);
    const safeProfileKey = normalizeUsername(profileKey) ?? safeUsername;
    const safePassword = normalizePassword(password);

    if (!safeEmail || !safeEmail.includes("@")) {
      throw buildAccountError("ACCOUNT_EMAIL_INVALID", "A valid email address is required.");
    }

    if (!safeUsername || safeUsername.length < 2) {
      throw buildAccountError("ACCOUNT_USERNAME_INVALID", "A valid username is required.");
    }

    if (safePassword.length < MIN_PASSWORD_LENGTH) {
      throw buildAccountError(
        "ACCOUNT_PASSWORD_INVALID",
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      );
    }

    const state = await this.readState();
    if (state.accounts.some((account) => normalizeEmail(account?.email) === safeEmail)) {
      throw buildAccountError("ACCOUNT_EMAIL_IN_USE", "This email is already registered.");
    }

    if (state.accounts.some((account) => normalizeUsername(account?.username) === safeUsername)) {
      throw buildAccountError("ACCOUNT_USERNAME_IN_USE", "This username is already linked to an account.");
    }

    const now = new Date().toISOString();
    const account = {
      accountId: crypto.randomUUID(),
      email: safeEmail,
      passwordHash: await createScryptHash(safePassword),
      username: safeUsername,
      profileKey: safeProfileKey,
      createdAt: now,
      updatedAt: now
    };

    state.accounts.push(account);
    await this.writeState(state);
    this.logger.info?.("[AccountStore] register success", {
      accountId: account.accountId,
      email: account.email,
      username: account.username
    });
    return sanitizeAccount(account);
  }

  async login({ email, password } = {}) {
    const safeEmail = normalizeEmail(email);
    const safePassword = normalizePassword(password);

    if (!safeEmail || !safePassword) {
      throw buildAccountError("ACCOUNT_LOGIN_INVALID", "Email and password are required.");
    }

    const state = await this.readState();
    const account = state.accounts.find((entry) => normalizeEmail(entry?.email) === safeEmail) ?? null;
    if (!account) {
      throw buildAccountError("ACCOUNT_LOGIN_FAILED", "Invalid email or password.");
    }

    const passwordMatches = await verifyScryptHash(safePassword, account.passwordHash);
    if (!passwordMatches) {
      throw buildAccountError("ACCOUNT_LOGIN_FAILED", "Invalid email or password.");
    }

    account.updatedAt = new Date().toISOString();
    await this.writeState(state);
    this.logger.info?.("[AccountStore] login success", {
      accountId: account.accountId,
      email: account.email,
      username: account.username
    });
    return sanitizeAccount(account);
  }

  async getAccountById(accountId) {
    const safeAccountId = String(accountId ?? "").trim();
    if (!safeAccountId) {
      return null;
    }

    const state = await this.readState();
    const account = state.accounts.find((entry) => entry?.accountId === safeAccountId) ?? null;
    return sanitizeAccount(account);
  }

  async getAccountByEmail(email) {
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) {
      return null;
    }

    const state = await this.readState();
    const account = state.accounts.find((entry) => normalizeEmail(entry?.email) === safeEmail) ?? null;
    return sanitizeAccount(account);
  }
}

export {
  ACCOUNTS_SCHEMA_VERSION,
  MIN_PASSWORD_LENGTH
};
