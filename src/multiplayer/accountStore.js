import crypto from "node:crypto";

import { JsonStore } from "../state/storage/jsonStore.js";

const ACCOUNTS_SCHEMA_VERSION = 2;
const MAX_EMAIL_LENGTH = 160;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const EMAIL_VERIFICATION_TOKEN_BYTES = 24;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 1000 * 60;

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

function normalizeIsoTimestamp(value) {
  const normalized = String(value ?? "").trim();
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function hashEmailVerificationToken(token) {
  return `sha256$${crypto.createHash("sha256").update(String(token ?? "")).digest("hex")}`;
}

function createEmailVerificationToken() {
  return crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString("hex");
}

function normalizeEmailVerification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const tokenHash = String(value.tokenHash ?? "").trim();
  const requestedAt = normalizeIsoTimestamp(value.requestedAt);
  const expiresAt = normalizeIsoTimestamp(value.expiresAt);
  const lastSentAt = normalizeIsoTimestamp(value.lastSentAt);
  const resendCount = Math.max(0, Math.floor(Number(value.resendCount ?? 0) || 0));
  if (!tokenHash || !requestedAt || !expiresAt) {
    return null;
  }

  return {
    tokenHash,
    requestedAt,
    expiresAt,
    lastSentAt: lastSentAt ?? requestedAt,
    resendCount
  };
}

function normalizeAccount(account) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return null;
  }

  const emailVerified = Boolean(account.emailVerified);
  const emailVerifiedAt = emailVerified ? normalizeIsoTimestamp(account.emailVerifiedAt) : null;
  return {
    ...account,
    email: normalizeEmail(account.email) ?? account.email,
    username: normalizeUsername(account.username) ?? account.username,
    profileKey: normalizeUsername(account.profileKey) ?? normalizeUsername(account.username) ?? account.profileKey,
    emailVerified,
    emailVerifiedAt,
    emailVerification: emailVerified ? null : normalizeEmailVerification(account.emailVerification)
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
    emailVerified: Boolean(account.emailVerified),
    emailVerifiedAt: account.emailVerifiedAt ?? null,
    emailVerificationPending: Boolean(!account.emailVerified && account.emailVerification?.tokenHash),
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
  constructor({ dataDir, logger = console, now = () => Date.now() } = {}) {
    this.logger = logger;
    this.now = now;
    this.store = new JsonStore("accounts.json", { dataDir });
  }

  async readState() {
    const state = await this.store.read(buildEmptyState());
    if (!state || typeof state !== "object") {
      return buildEmptyState();
    }

    const accounts = Array.isArray(state.accounts)
      ? state.accounts.map((account) => normalizeAccount(account)).filter(Boolean)
      : [];

    return {
      schemaVersion: Number(state.schemaVersion ?? ACCOUNTS_SCHEMA_VERSION),
      accounts
    };
  }

  async writeState(state) {
    const safeState = {
      schemaVersion: ACCOUNTS_SCHEMA_VERSION,
      accounts: Array.isArray(state?.accounts)
        ? state.accounts.map((account) => normalizeAccount(account)).filter(Boolean)
        : []
    };
    await this.store.write(safeState);
    return safeState;
  }

  buildPendingEmailVerification(nowMs = this.now()) {
    const token = createEmailVerificationToken();
    const requestedAt = new Date(nowMs).toISOString();
    return {
      token,
      emailVerification: {
        tokenHash: hashEmailVerificationToken(token),
        requestedAt,
        expiresAt: new Date(nowMs + EMAIL_VERIFICATION_TOKEN_TTL_MS).toISOString(),
        lastSentAt: requestedAt,
        resendCount: 0
      }
    };
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

    const nowMs = this.now();
    const now = new Date(nowMs).toISOString();
    const pendingVerification = this.buildPendingEmailVerification(nowMs);
    const account = {
      accountId: crypto.randomUUID(),
      email: safeEmail,
      passwordHash: await createScryptHash(safePassword),
      username: safeUsername,
      profileKey: safeProfileKey,
      emailVerified: false,
      emailVerifiedAt: null,
      emailVerification: pendingVerification.emailVerification,
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
    return {
      ...sanitizeAccount(account),
      devVerificationToken: pendingVerification.token
    };
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

  async requestEmailVerification({ email, accountId, username } = {}) {
    const safeEmail = normalizeEmail(email);
    const safeAccountId = String(accountId ?? "").trim();
    const safeUsername = normalizeUsername(username);
    const state = await this.readState();
    const account =
      state.accounts.find(
        (entry) =>
          (safeAccountId && entry?.accountId === safeAccountId) ||
          (safeEmail && normalizeEmail(entry?.email) === safeEmail) ||
          (safeUsername && normalizeUsername(entry?.username) === safeUsername)
      ) ?? null;
    if (!account) {
      throw buildAccountError("ACCOUNT_NOT_FOUND", "Account was not found.");
    }

    if (account.emailVerified) {
      return {
        account: sanitizeAccount(account),
        alreadyVerified: true,
        emailVerificationPending: false
      };
    }

    const nowMs = this.now();
    const lastSentAtMs = Date.parse(account.emailVerification?.lastSentAt ?? "");
    if (
      Number.isFinite(lastSentAtMs) &&
      nowMs - lastSentAtMs >= 0 &&
      nowMs - lastSentAtMs < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      throw buildAccountError("EMAIL_VERIFICATION_COOLDOWN", "Please wait before requesting another verification email.");
    }

    const pendingVerification = this.buildPendingEmailVerification(nowMs);
    account.emailVerification = {
      ...pendingVerification.emailVerification,
      resendCount: Math.max(0, Number(account.emailVerification?.resendCount ?? 0) || 0) + 1
    };
    account.updatedAt = new Date(nowMs).toISOString();
    await this.writeState(state);

    return {
      account: sanitizeAccount(account),
      alreadyVerified: false,
      emailVerificationPending: true,
      devVerificationToken: pendingVerification.token
    };
  }

  async verifyEmail({ email, accountId, username, token } = {}) {
    const safeEmail = normalizeEmail(email);
    const safeAccountId = String(accountId ?? "").trim();
    const safeUsername = normalizeUsername(username);
    const safeToken = String(token ?? "").trim();
    const state = await this.readState();
    const account =
      state.accounts.find(
        (entry) =>
          (safeAccountId && entry?.accountId === safeAccountId) ||
          (safeEmail && normalizeEmail(entry?.email) === safeEmail) ||
          (safeUsername && normalizeUsername(entry?.username) === safeUsername)
      ) ?? null;
    if (!account) {
      throw buildAccountError("ACCOUNT_NOT_FOUND", "Account was not found.");
    }

    if (account.emailVerified) {
      return {
        account: sanitizeAccount(account),
        alreadyVerified: true,
        emailVerified: true
      };
    }

    if (!safeToken) {
      throw buildAccountError("EMAIL_VERIFICATION_TOKEN_REQUIRED", "Verification token is required.");
    }

    const verification = normalizeEmailVerification(account.emailVerification);
    if (!verification) {
      throw buildAccountError("EMAIL_VERIFICATION_NOT_REQUESTED", "Email verification has not been requested.");
    }

    if (this.now() > Date.parse(verification.expiresAt)) {
      throw buildAccountError("EMAIL_VERIFICATION_EXPIRED", "Email verification token has expired.");
    }

    if (hashEmailVerificationToken(safeToken) !== verification.tokenHash) {
      throw buildAccountError("EMAIL_VERIFICATION_INVALID", "Email verification token is invalid.");
    }

    const verifiedAt = new Date(this.now()).toISOString();
    account.emailVerified = true;
    account.emailVerifiedAt = verifiedAt;
    account.emailVerification = null;
    account.updatedAt = verifiedAt;
    await this.writeState(state);

    return {
      account: sanitizeAccount(account),
      alreadyVerified: false,
      emailVerified: true
    };
  }

  async getEmailVerificationStatus({ email, accountId, username } = {}) {
    const safeEmail = normalizeEmail(email);
    const safeAccountId = String(accountId ?? "").trim();
    const safeUsername = normalizeUsername(username);
    const state = await this.readState();
    const account =
      state.accounts.find(
        (entry) =>
          (safeAccountId && entry?.accountId === safeAccountId) ||
          (safeEmail && normalizeEmail(entry?.email) === safeEmail) ||
          (safeUsername && normalizeUsername(entry?.username) === safeUsername)
      ) ?? null;
    if (!account) {
      throw buildAccountError("ACCOUNT_NOT_FOUND", "Account was not found.");
    }

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

  async getAccountByUsername(username) {
    const safeUsername = normalizeUsername(username);
    if (!safeUsername) {
      return null;
    }

    const state = await this.readState();
    const account = state.accounts.find((entry) => normalizeUsername(entry?.username) === safeUsername) ?? null;
    return sanitizeAccount(account);
  }
}

export {
  ACCOUNTS_SCHEMA_VERSION,
  MIN_PASSWORD_LENGTH
};
