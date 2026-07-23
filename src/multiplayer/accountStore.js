import crypto from "node:crypto";

import { JsonStore } from "../state/storage/jsonStore.js";

const ACCOUNTS_SCHEMA_VERSION = 3;
const MAX_EMAIL_LENGTH = 160;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const EMAIL_VERIFICATION_TOKEN_BYTES = 24;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 1000 * 60;
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_PATTERN = /^ELM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const REFERRAL_CODE_GENERATION_ATTEMPTS = 64;
const REFERRAL_QUALIFYING_MATCH_TARGET = 3;
const REFERRAL_COUNTED_MATCH_ID_LIMIT = 3;
const REFERRAL_QUALIFYING_MODES = new Set(["pve", "gauntlet", "featured_rival", "online_pvp"]);
const REFERRAL_DISQUALIFYING_END_REASONS = new Set([
  "abandoned",
  "cancelled",
  "forfeit",
  "invalid",
  "no_contest",
  "quit_forfeit"
]);

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

function createReferralCodeCandidate() {
  const bytes = crypto.randomBytes(8);
  const characters = Array.from(bytes, (byte) => REFERRAL_CODE_ALPHABET[byte & 31]);
  return `ELM-${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

function normalizeReferralCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeReferralClaim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { claimedAt: null, claimId: null };
  }

  return {
    claimedAt: normalizeIsoTimestamp(value.claimedAt),
    claimId: String(value.claimId ?? "").trim() || null
  };
}

function normalizeCountedReferralMatchIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((entry) => String(entry ?? "").trim().slice(0, 200))
      .filter(Boolean)
  )].slice(-REFERRAL_COUNTED_MATCH_ID_LIMIT);
}

function normalizeReferral(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const qualification =
    source.qualification && typeof source.qualification === "object" && !Array.isArray(source.qualification)
      ? source.qualification
      : {};
  const rawReferrerClaims =
    source.referrerClaims && typeof source.referrerClaims === "object" && !Array.isArray(source.referrerClaims)
      ? source.referrerClaims
      : {};
  const referrerClaims = {};
  for (const [claimKey, claimValue] of Object.entries(rawReferrerClaims)) {
    const safeClaimKey = String(claimKey ?? "").trim();
    const normalizedClaim = normalizeReferralClaim(claimValue);
    if (safeClaimKey && normalizedClaim.claimedAt && normalizedClaim.claimId) {
      referrerClaims[safeClaimKey] = normalizedClaim;
    }
  }
  const countedMatchIds = normalizeCountedReferralMatchIds(qualification.countedMatchIds);
  const qualifyingMatchCount = Math.min(
    REFERRAL_QUALIFYING_MATCH_TARGET,
    Math.max(
      countedMatchIds.length,
      Math.max(0, Math.floor(Number(qualification.qualifyingMatchCount ?? 0) || 0))
    )
  );

  return {
    code: normalizeReferralCode(source.code),
    referredBy: normalizeReferralCode(source.referredBy),
    referredAt: normalizeIsoTimestamp(source.referredAt),
    qualification: {
      qualifyingMatchCount,
      level2Reached: Boolean(qualification.level2Reached),
      qualifiedAt: normalizeIsoTimestamp(qualification.qualifiedAt),
      countedMatchIds
    },
    referredReward: normalizeReferralClaim(source.referredReward),
    referrerClaims
  };
}

function buildSafeReferralStatus(account, playerLevel = 1) {
  const referral = normalizeReferral(account?.referral);
  const level2Reached = referral.qualification.level2Reached || Number(playerLevel ?? 1) >= 2;
  const qualifyingMatchesCompleted = Math.min(
    REFERRAL_QUALIFYING_MATCH_TARGET,
    referral.qualification.qualifyingMatchCount
  );
  const hasActivatedReferral = Boolean(referral.referredBy);

  return {
    emailVerified: Boolean(account?.emailVerified),
    hasActivatedReferral,
    referredByLinked: hasActivatedReferral,
    level2Reached: hasActivatedReferral && level2Reached,
    qualifyingMatchesCompleted: hasActivatedReferral ? qualifyingMatchesCompleted : 0,
    qualified: hasActivatedReferral && level2Reached && qualifyingMatchesCompleted >= REFERRAL_QUALIFYING_MATCH_TARGET,
    qualifiedAt: hasActivatedReferral ? referral.qualification.qualifiedAt : null
  };
}

function isQualifyingReferralMatch({ mode, difficulty, status, endReason, winner, trainingMode } = {}) {
  const safeMode = String(mode ?? "").trim().toLowerCase();
  const safeDifficulty = String(difficulty ?? "").trim().toLowerCase();
  const safeEndReason = String(endReason ?? "").trim().toLowerCase();
  const safeWinner = String(winner ?? "").trim().toLowerCase();

  return (
    String(status ?? "").trim().toLowerCase() === "completed" &&
    REFERRAL_QUALIFYING_MODES.has(safeMode) &&
    !REFERRAL_DISQUALIFYING_END_REASONS.has(safeEndReason) &&
    ["p1", "p2", "draw"].includes(safeWinner) &&
    trainingMode !== true &&
    !(safeMode === "pve" && safeDifficulty === "easy")
  );
}

function syncReferralQualificationLevel(referralValue, playerLevel, nowMs) {
  const referral = normalizeReferral(referralValue);
  if (!referral.referredBy) {
    return referral;
  }

  const level2Reached = referral.qualification.level2Reached || Number(playerLevel ?? 1) >= 2;
  const qualified =
    level2Reached && referral.qualification.qualifyingMatchCount >= REFERRAL_QUALIFYING_MATCH_TARGET;
  return {
    ...referral,
    qualification: {
      ...referral.qualification,
      level2Reached,
      qualifiedAt:
        referral.qualification.qualifiedAt ?? (qualified ? new Date(nowMs).toISOString() : null)
    }
  };
}

function hasLockedReferredReferralState(referral) {
  const normalized = normalizeReferral(referral);
  return Boolean(
    normalized.qualification.qualifyingMatchCount > 0 ||
    normalized.qualification.level2Reached ||
    normalized.qualification.qualifiedAt ||
    normalized.referredReward.claimedAt ||
    normalized.referredReward.claimId
  );
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
    emailVerification: emailVerified ? null : normalizeEmailVerification(account.emailVerification),
    referral: normalizeReferral(account.referral)
  };
}

function normalizeAccounts(accounts) {
  const seenReferralCodes = new Set();
  return (Array.isArray(accounts) ? accounts : [])
    .map((account) => normalizeAccount(account))
    .filter(Boolean)
    .map((account) => {
      const referralCode = account.referral.code;
      if (!referralCode || !seenReferralCodes.has(referralCode)) {
        if (referralCode) {
          seenReferralCodes.add(referralCode);
        }
        return account;
      }

      return {
        ...account,
        referral: {
          ...account.referral,
          code: null
        }
      };
    });
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
  constructor({
    dataDir,
    logger = console,
    now = () => Date.now(),
    referralCodeGenerator = createReferralCodeCandidate
  } = {}) {
    this.logger = logger;
    this.now = now;
    this.referralCodeGenerator = referralCodeGenerator;
    this.referralMutationQueue = Promise.resolve();
    this.store = new JsonStore("accounts.json", { dataDir });
  }

  async readState() {
    const state = await this.store.read(buildEmptyState());
    if (!state || typeof state !== "object") {
      return buildEmptyState();
    }

    const accounts = normalizeAccounts(state.accounts);

    return {
      schemaVersion: Number(state.schemaVersion ?? ACCOUNTS_SCHEMA_VERSION),
      accounts
    };
  }

  async writeState(state) {
    const safeState = {
      schemaVersion: ACCOUNTS_SCHEMA_VERSION,
      accounts: normalizeAccounts(state?.accounts)
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
      referral: normalizeReferral(null),
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

  async getOrCreateReferralCode({ accountId, username, playerLevel = 1 } = {}) {
    const operation = async () => {
      const safeAccountId = String(accountId ?? "").trim();
      const safeUsername = normalizeUsername(username);
      const state = await this.readState();
      const account =
        state.accounts.find(
          (entry) =>
            (safeAccountId && entry?.accountId === safeAccountId) ||
            (safeUsername && normalizeUsername(entry?.username) === safeUsername)
        ) ?? null;
      if (!account) {
        throw buildAccountError("ACCOUNT_NOT_FOUND", "Account was not found.");
      }

      const currentReferral = normalizeReferral(account.referral);
      const referral = syncReferralQualificationLevel(currentReferral, playerLevel, this.now());
      const referralChanged = JSON.stringify(referral) !== JSON.stringify(currentReferral);
      account.referral = referral;
      const existingCode = referral.code;
      if (existingCode) {
        if (referralChanged) {
          account.updatedAt = new Date(this.now()).toISOString();
          await this.writeState(state);
        }
        return {
          referralCode: existingCode,
          referralLinked: Boolean(referral.referredBy),
          ...buildSafeReferralStatus(account, playerLevel)
        };
      }

      const usedCodes = new Set(
        state.accounts.map((entry) => normalizeReferralCode(entry?.referral?.code)).filter(Boolean)
      );
      let referralCode = null;
      for (let attempt = 0; attempt < REFERRAL_CODE_GENERATION_ATTEMPTS; attempt += 1) {
        const candidate = normalizeReferralCode(this.referralCodeGenerator());
        if (candidate && !usedCodes.has(candidate)) {
          referralCode = candidate;
          break;
        }
      }
      if (!referralCode) {
        throw buildAccountError("REFERRAL_CODE_UNAVAILABLE", "Unable to create a unique referral code.");
      }

      account.referral = {
        ...referral,
        code: referralCode
      };
      account.updatedAt = new Date(this.now()).toISOString();
      await this.writeState(state);
      return {
        referralCode,
        referralLinked: Boolean(account.referral.referredBy),
        ...buildSafeReferralStatus(account, playerLevel)
      };
    };

    const pending = this.referralMutationQueue.then(operation, operation);
    this.referralMutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async activateReferralCode({ accountId, username, referralCode, playerLevel = 1 } = {}) {
    const operation = async () => {
      const safeAccountId = String(accountId ?? "").trim();
      const safeUsername = normalizeUsername(username);
      const state = await this.readState();
      const account =
        state.accounts.find(
          (entry) =>
            (safeAccountId && entry?.accountId === safeAccountId) ||
            (safeUsername && normalizeUsername(entry?.username) === safeUsername)
        ) ?? null;
      if (!account) {
        throw buildAccountError("ACCOUNT_NOT_FOUND", "Account was not found.");
      }
      if (!account.emailVerified) {
        throw buildAccountError(
          "EMAIL_VERIFICATION_REQUIRED",
          "Verify your email before activating a referral code."
        );
      }
      const safeReferralCode = normalizeReferralCode(referralCode);
      if (!safeReferralCode) {
        throw buildAccountError("REFERRAL_CODE_INVALID", "Enter a valid referral code.");
      }

      let referral = syncReferralQualificationLevel(account.referral, playerLevel, this.now());
      if (referral.referredBy === safeReferralCode) {
        if (JSON.stringify(referral) !== JSON.stringify(normalizeReferral(account.referral))) {
          account.referral = referral;
          account.updatedAt = new Date(this.now()).toISOString();
          await this.writeState(state);
        }
        return {
          referralLinked: true,
          alreadyLinked: true,
          ...buildSafeReferralStatus(account, playerLevel)
        };
      }
      if (referral.referredBy) {
        throw buildAccountError(
          "REFERRAL_ALREADY_LINKED",
          "A referral code is already linked to this account."
        );
      }
      if (hasLockedReferredReferralState(referral)) {
        throw buildAccountError(
          "REFERRAL_STATE_LOCKED",
          "This account's referral state cannot be changed."
        );
      }

      const referrerAccount =
        state.accounts.find(
          (entry) => normalizeReferralCode(entry?.referral?.code) === safeReferralCode
        ) ?? null;
      if (!referrerAccount) {
        throw buildAccountError("REFERRAL_CODE_UNKNOWN", "Referral code was not found.");
      }
      if (referrerAccount.accountId === account.accountId) {
        throw buildAccountError("REFERRAL_SELF_LINK", "You cannot use your own referral code.");
      }
      const accountReferralCode = normalizeReferralCode(account.referral?.code);
      const referrerReferral = normalizeReferral(referrerAccount.referral);
      if (accountReferralCode && referrerReferral.referredBy === accountReferralCode) {
        throw buildAccountError(
          "REFERRAL_RECIPROCAL_LINK",
          "You cannot use a referral code from someone you already referred."
        );
      }

      account.referral = {
        ...referral,
        referredBy: safeReferralCode,
        referredAt: new Date(this.now()).toISOString(),
        qualification: {
          ...referral.qualification,
          level2Reached: Number(playerLevel ?? 1) >= 2
        }
      };
      account.updatedAt = new Date(this.now()).toISOString();
      await this.writeState(state);
      return {
        referralLinked: true,
        alreadyLinked: false,
        ...buildSafeReferralStatus(account, playerLevel)
      };
    };

    const pending = this.referralMutationQueue.then(operation, operation);
    this.referralMutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async recordReferralQualificationMatch({
    accountId,
    username,
    profileKey,
    settlementId,
    mode,
    difficulty,
    status,
    endReason,
    winner,
    trainingMode = false,
    playerLevel = 1
  } = {}) {
    const operation = async () => {
      const safeAccountId = String(accountId ?? "").trim();
      const safeUsername = normalizeUsername(username);
      const safeProfileKey = normalizeUsername(profileKey);
      const safeSettlementId = String(settlementId ?? "").trim().slice(0, 200);
      const state = await this.readState();
      const account =
        state.accounts.find(
          (entry) =>
            (safeAccountId && entry?.accountId === safeAccountId) ||
            (safeProfileKey && normalizeUsername(entry?.profileKey) === safeProfileKey) ||
            (safeUsername && normalizeUsername(entry?.username) === safeUsername)
        ) ?? null;
      if (!account) {
        return null;
      }

      const currentReferral = normalizeReferral(account.referral);
      if (!currentReferral.referredBy) {
        return buildSafeReferralStatus(account, playerLevel);
      }

      let referral = syncReferralQualificationLevel(currentReferral, playerLevel, this.now());
      const qualification = referral.qualification;
      const eligible =
        safeSettlementId &&
        isQualifyingReferralMatch({
          mode,
          difficulty,
          status,
          endReason,
          winner,
          trainingMode
        });
      const alreadyCounted = qualification.countedMatchIds.includes(safeSettlementId);
      if (
        eligible &&
        !alreadyCounted &&
        qualification.qualifyingMatchCount < REFERRAL_QUALIFYING_MATCH_TARGET
      ) {
        const qualifyingMatchCount = qualification.qualifyingMatchCount + 1;
        const qualified = qualification.level2Reached && qualifyingMatchCount >= REFERRAL_QUALIFYING_MATCH_TARGET;
        referral = {
          ...referral,
          qualification: {
            ...qualification,
            qualifyingMatchCount,
            qualifiedAt:
              qualification.qualifiedAt ?? (qualified ? new Date(this.now()).toISOString() : null),
            countedMatchIds: normalizeCountedReferralMatchIds([
              ...qualification.countedMatchIds,
              safeSettlementId
            ])
          }
        };
      }

      if (JSON.stringify(referral) !== JSON.stringify(currentReferral)) {
        account.referral = referral;
        account.updatedAt = new Date(this.now()).toISOString();
        await this.writeState(state);
      }

      return buildSafeReferralStatus({ ...account, referral }, playerLevel);
    };

    const pending = this.referralMutationQueue.then(operation, operation);
    this.referralMutationQueue = pending.catch(() => undefined);
    return pending;
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
