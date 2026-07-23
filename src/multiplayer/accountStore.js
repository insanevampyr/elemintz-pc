import crypto from "node:crypto";

import { JsonStore } from "../state/storage/jsonStore.js";
import {
  appendReferralRiskRecord,
  classifyReferralActivationRisk,
  classifyReferralQualificationRisk,
  classifyReferralRewardClaimRisk,
  createReferralRiskRecord,
  normalizeReferralRisk
} from "./referralRiskClassifier.js";

const ACCOUNTS_SCHEMA_VERSION = 6;
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
const REFERRAL_SETTLEMENT_ID_MAX_LENGTH = 200;
const REFERRAL_REWARD_TOKENS = 100;
const REFERRER_DAILY_CLAIM_LIMIT = 3;
const REFERRAL_FAILED_ACTIVATION_SIGNAL_LIMIT = 25;
const REFERRAL_REWARD_CLAIM_SIGNAL_LIMIT = 50;
const REFERRAL_ABUSE_SIGNAL_SCHEMA_VERSION = 1;
const REFERRAL_REWARD_REVIEW_SCHEMA_VERSION = 1;
const REFERRAL_HELD_REWARD_LIMIT = 100;
const REFERRAL_BLOCKED_REWARD_LIMIT = 100;
const REFERRAL_LATEST_REFERRER_REVIEW_LIMIT = 50;
const REFERRAL_ADMIN_RESTRICTION_SCHEMA_VERSION = 1;
const REFERRAL_QUALIFYING_MODES = new Set([
  "pve",
  "gauntlet",
  "featured_rival",
  "online_pvp",
  "blood_match"
]);
const REFERRAL_QUALIFYING_BLOOD_MATCH_END_REASONS = new Set([
  "all_ai_required_play_unavailable",
  "both_rivals_eliminated",
  "player_required_play_unavailable",
  "timeout_lead",
  "timeout_tie_or_deficit"
]);
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

function normalizeSubmittedReferralCode(value) {
  return typeof value === "string" ? normalizeReferralCode(value) : null;
}

function normalizeReferralTargetUsername(value) {
  if (typeof value !== "string" || value.length > MAX_USERNAME_LENGTH) {
    return null;
  }
  return normalizeUsername(value);
}

function normalizeReferralSettlementId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= REFERRAL_SETTLEMENT_ID_MAX_LENGTH
    ? normalized
    : null;
}

function normalizeReferralClaim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { claimedAt: null, amount: null, claimId: null };
  }

  const claimedAt = normalizeIsoTimestamp(value.claimedAt);
  const claimId = String(value.claimId ?? "").trim() || null;
  return {
    claimedAt,
    amount:
      claimedAt && claimId
        ? Math.max(0, Math.floor(Number(value.amount ?? REFERRAL_REWARD_TOKENS) || 0))
        : null,
    claimId
  };
}

function normalizePrivateSignalHash(value) {
  const normalized = String(value ?? "").trim();
  return /^hmac-sha256\$[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeReferralRequestSignals(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ipHash: normalizePrivateSignalHash(source.ipHash),
    userAgentHash: normalizePrivateSignalHash(source.userAgentHash),
    targetUsernameHashOrKey: normalizePrivateSignalHash(source.targetUsernameHashOrKey)
  };
}

function normalizeFailedReferralActivationSignals(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const attemptedAt = normalizeIsoTimestamp(entry.attemptedAt);
      const reason = String(entry.reason ?? "").trim().toUpperCase();
      if (!attemptedAt || !/^[A-Z0-9_]{1,64}$/.test(reason)) {
        return null;
      }
      return {
        attemptedAt,
        reason,
        ipHash: normalizePrivateSignalHash(entry.ipHash),
        userAgentHash: normalizePrivateSignalHash(entry.userAgentHash)
      };
    })
    .filter(Boolean)
    .slice(-REFERRAL_FAILED_ACTIVATION_SIGNAL_LIMIT);
}

function normalizeReferralRewardClaimSignals(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const claimType = String(entry.claimType ?? "").trim().toLowerCase();
      const claimedAt = normalizeIsoTimestamp(entry.claimedAt);
      const outcome = String(entry.outcome ?? "").trim().toLowerCase();
      if (
        !["own", "referrer"].includes(claimType) ||
        !claimedAt ||
        !["granted", "duplicate", "held_for_review", "blocked"].includes(outcome)
      ) {
        return null;
      }
      return {
        claimType,
        targetUsernameHashOrKey: normalizePrivateSignalHash(entry.targetUsernameHashOrKey),
        claimedAt,
        outcome,
        ipHash: normalizePrivateSignalHash(entry.ipHash),
        userAgentHash: normalizePrivateSignalHash(entry.userAgentHash)
      };
    })
    .filter(Boolean)
    .slice(-REFERRAL_REWARD_CLAIM_SIGNAL_LIMIT);
}

function normalizeReferralRewardReviewRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const claimType = String(value.claimType ?? "").trim().toLowerCase();
  const status = String(value.status ?? "").trim().toLowerCase();
  const reviewId = String(value.reviewId ?? "").trim();
  const deterministicGrantId = String(value.deterministicGrantId ?? "").trim();
  const createdAt = normalizeIsoTimestamp(value.createdAt);
  const updatedAt = normalizeIsoTimestamp(value.updatedAt) ?? createdAt;
  const riskDecision = String(value.riskDecision ?? "").trim().toLowerCase();
  if (
    !["own", "referrer"].includes(claimType) ||
    !["held_for_review", "blocked", "approved", "denied"].includes(status) ||
    !reviewId ||
    !deterministicGrantId ||
    !createdAt ||
    !["held_for_review", "blocked"].includes(riskDecision)
  ) {
    return null;
  }
  const riskReasons = [...new Set(
    (Array.isArray(value.riskReasons) ? value.riskReasons : [])
      .map((reason) => String(reason ?? "").trim())
      .filter((reason) => /^[a-z0-9_]{1,80}$/.test(reason))
  )];
  const stage = claimType === "referrer" ? "referrer_claim" : "own_claim";
  const signalPresence = {};
  for (const [key, present] of Object.entries(value.claimContext?.signalPresence ?? {})) {
    if (/^[a-zA-Z][a-zA-Z0-9]{0,48}$/.test(key)) {
      signalPresence[key] = Boolean(present);
    }
  }
  return {
    schemaVersion: REFERRAL_REWARD_REVIEW_SCHEMA_VERSION,
    reviewId,
    claimType,
    status,
    createdAt,
    updatedAt,
    targetAccountId: String(value.targetAccountId ?? "").trim() || null,
    targetUsernameHashOrKey: normalizePrivateSignalHash(value.targetUsernameHashOrKey),
    riskDecision,
    riskReasons,
    riskRecordId: String(value.riskRecordId ?? "").trim() || null,
    deterministicGrantId,
    rewardAmount: REFERRAL_REWARD_TOKENS,
    approvedAt: status === "approved" ? normalizeIsoTimestamp(value.approvedAt) : null,
    approvedBy:
      status === "approved" ? normalizeUsername(value.approvedBy) : null,
    deniedAt: status === "denied" ? normalizeIsoTimestamp(value.deniedAt) : null,
    deniedBy: status === "denied" ? normalizeUsername(value.deniedBy) : null,
    resolutionReasonCode:
      ["approved", "denied"].includes(status)
        ? normalizeReferralAdminReasonCode(value.resolutionReasonCode)
        : null,
    claimContext: {
      stage,
      signalPresence
    }
  };
}

function normalizeReferralAdminReasonCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized) ? normalized : null;
}

function normalizeReferralAdminRestrictions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const suspended = source.referralRewardsSuspended === true;
  const createdAt = suspended ? normalizeIsoTimestamp(source.createdAt) : null;
  return {
    schemaVersion: REFERRAL_ADMIN_RESTRICTION_SCHEMA_VERSION,
    referralRewardsSuspended: suspended,
    reasonCode: suspended
      ? normalizeReferralAdminReasonCode(source.reasonCode) ?? "ADMIN_REFERRAL_REVIEW"
      : null,
    createdAt,
    updatedAt: suspended
      ? normalizeIsoTimestamp(source.updatedAt) ?? createdAt
      : null,
    createdBy: suspended ? normalizeUsername(source.createdBy) : null
  };
}

function normalizeReferralRewardReview(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizeRecords = (records, limit) =>
    (Array.isArray(records) ? records : [])
      .map((record) => normalizeReferralRewardReviewRecord(record))
      .filter(Boolean)
      .slice(-limit);
  return {
    schemaVersion: REFERRAL_REWARD_REVIEW_SCHEMA_VERSION,
    heldRewards: normalizeRecords(source.heldRewards, REFERRAL_HELD_REWARD_LIMIT),
    blockedRewards: normalizeRecords(source.blockedRewards, REFERRAL_BLOCKED_REWARD_LIMIT),
    latestOwnRewardReview: normalizeReferralRewardReviewRecord(
      source.latestOwnRewardReview
    ),
    latestReferrerRewardReviews: normalizeRecords(
      source.latestReferrerRewardReviews,
      REFERRAL_LATEST_REFERRER_REVIEW_LIMIT
    )
  };
}

function buildReferralRewardReviewId(claimId) {
  return `referral-review-${crypto
    .createHash("sha256")
    .update(`reward-review:${String(claimId ?? "")}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function findReferralRewardReview(reviewValue, claimId) {
  const review = normalizeReferralRewardReview(reviewValue);
  return [...review.heldRewards, ...review.blockedRewards].find(
    (record) => record.deterministicGrantId === claimId
  ) ?? null;
}

function updateReferralRewardReviewRecord(reviewValue, nextRecordValue) {
  const review = normalizeReferralRewardReview(reviewValue);
  const nextRecord = normalizeReferralRewardReviewRecord(nextRecordValue);
  if (!nextRecord) {
    return review;
  }
  const replace = (record) =>
    record.reviewId === nextRecord.reviewId ? nextRecord : record;
  return normalizeReferralRewardReview({
    ...review,
    heldRewards: review.heldRewards.map(replace),
    blockedRewards: review.blockedRewards.map(replace),
    latestOwnRewardReview:
      review.latestOwnRewardReview?.reviewId === nextRecord.reviewId
        ? nextRecord
        : review.latestOwnRewardReview,
    latestReferrerRewardReviews: review.latestReferrerRewardReviews.map(replace)
  });
}

function appendReferralRewardReview(referralValue, {
  claimId,
  claimType,
  classification,
  createdAt,
  requestSignals,
  targetAccountId
} = {}) {
  const referral = normalizeReferral(referralValue);
  const status = String(classification?.decision ?? "").trim().toLowerCase();
  if (!["held_for_review", "blocked"].includes(status)) {
    return referral;
  }
  const existing = findReferralRewardReview(referral.rewardReview, claimId);
  if (existing) {
    return referral;
  }
  const signals = normalizeReferralRequestSignals(requestSignals);
  const stage = claimType === "referrer" ? "referrer_claim" : "own_claim";
  const riskRecordId = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        claimId,
        stage,
        decision: status,
        reasons: classification?.reasons ?? [],
        evaluatedAt: createdAt
      })
    )
    .digest("hex")
    .slice(0, 24);
  const record = normalizeReferralRewardReviewRecord({
    reviewId: buildReferralRewardReviewId(claimId),
    claimType,
    status,
    createdAt,
    updatedAt: createdAt,
    targetAccountId,
    targetUsernameHashOrKey: signals.targetUsernameHashOrKey,
    riskDecision: status,
    riskReasons: classification?.reasons,
    riskRecordId,
    deterministicGrantId: claimId,
    rewardAmount: REFERRAL_REWARD_TOKENS,
    claimContext: {
      stage,
      signalPresence: classification?.signalPresence
    }
  });
  const review = normalizeReferralRewardReview(referral.rewardReview);
  const nextReview = {
    ...review,
    [status === "held_for_review" ? "heldRewards" : "blockedRewards"]: [
      ...review[status === "held_for_review" ? "heldRewards" : "blockedRewards"],
      record
    ],
    latestOwnRewardReview:
      claimType === "own" ? record : review.latestOwnRewardReview,
    latestReferrerRewardReviews:
      claimType === "referrer"
        ? [...review.latestReferrerRewardReviews, record]
        : review.latestReferrerRewardReviews
  };
  return {
    ...referral,
    rewardReview: normalizeReferralRewardReview(nextReview)
  };
}

function normalizeReferralAbuseSignals(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: REFERRAL_ABUSE_SIGNAL_SCHEMA_VERSION,
    accountCreatedAt: normalizeIsoTimestamp(source.accountCreatedAt),
    signupIpHash: normalizePrivateSignalHash(source.signupIpHash),
    signupUserAgentHash: normalizePrivateSignalHash(source.signupUserAgentHash),
    emailVerifiedAt: normalizeIsoTimestamp(source.emailVerifiedAt),
    referralActivatedAt: normalizeIsoTimestamp(source.referralActivatedAt),
    referralActivationIpHash: normalizePrivateSignalHash(source.referralActivationIpHash),
    referralActivationUserAgentHash: normalizePrivateSignalHash(
      source.referralActivationUserAgentHash
    ),
    referralQualifiedAt: normalizeIsoTimestamp(source.referralQualifiedAt),
    rewardClaimSignals: normalizeReferralRewardClaimSignals(source.rewardClaimSignals),
    failedReferralActivationAttempts: normalizeFailedReferralActivationSignals(
      source.failedReferralActivationAttempts
    )
  };
}

function appendFailedReferralActivationSignal(referralValue, {
  attemptedAt,
  reason,
  requestSignals
} = {}) {
  const referral = normalizeReferral(referralValue);
  const signals = normalizeReferralRequestSignals(requestSignals);
  return {
    ...referral,
    abuseSignals: {
      ...referral.abuseSignals,
      failedReferralActivationAttempts: normalizeFailedReferralActivationSignals([
        ...referral.abuseSignals.failedReferralActivationAttempts,
        {
          attemptedAt,
          reason,
          ipHash: signals.ipHash,
          userAgentHash: signals.userAgentHash
        }
      ])
    }
  };
}

function appendReferralRewardClaimSignal(referralValue, {
  claimType,
  claimedAt,
  outcome,
  requestSignals
} = {}) {
  const referral = normalizeReferral(referralValue);
  const signals = normalizeReferralRequestSignals(requestSignals);
  return {
    ...referral,
    abuseSignals: {
      ...referral.abuseSignals,
      rewardClaimSignals: normalizeReferralRewardClaimSignals([
        ...referral.abuseSignals.rewardClaimSignals,
        {
          claimType,
          targetUsernameHashOrKey: signals.targetUsernameHashOrKey,
          claimedAt,
          outcome,
          ipHash: signals.ipHash,
          userAgentHash: signals.userAgentHash
        }
      ])
    }
  };
}

function appendClassifiedReferralRisk(referralValue, {
  classification,
  evaluatedAt,
  stage,
  requestSignals
} = {}) {
  const referral = normalizeReferral(referralValue);
  const signals = normalizeReferralRequestSignals(requestSignals);
  const record = createReferralRiskRecord({
    decision: classification?.decision,
    reasons: classification?.reasons,
    evaluatedAt,
    stage,
    targetUsernameHashOrKey: signals.targetUsernameHashOrKey,
    signalPresence: classification?.signalPresence
  });
  return {
    ...referral,
    risk: appendReferralRiskRecord(referral.risk, record)
  };
}

function countReferredAccountsBySignal(accounts, referralCode, field, signalHash) {
  const safeSignalHash = normalizePrivateSignalHash(signalHash);
  if (!referralCode || !safeSignalHash) {
    return 0;
  }
  return (Array.isArray(accounts) ? accounts : []).filter((entry) => {
    const referral = normalizeReferral(entry?.referral);
    const abuseSignals = referral.abuseSignals;
    return referral.referredBy === referralCode && abuseSignals?.[field] === safeSignalHash;
  }).length;
}

function buildReferralRewardClaimId(type, accountId, refereeAccountId = "") {
  const digest = crypto
    .createHash("sha256")
    .update(`${type}:${String(accountId ?? "")}:${String(refereeAccountId ?? "")}`)
    .digest("hex")
    .slice(0, 24);
  return `referral-${type}-${digest}`;
}

function getUtcDateKey(value) {
  const timestamp = normalizeIsoTimestamp(value);
  return timestamp ? timestamp.slice(0, 10) : null;
}

function isReferralQualified(referral) {
  const normalized = normalizeReferral(referral);
  return (
    normalized.qualification.level2Reached &&
    normalized.qualification.qualifyingMatchCount >= REFERRAL_QUALIFYING_MATCH_TARGET
  );
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

  const referredAt = normalizeIsoTimestamp(source.referredAt);
  const qualifiedAt = normalizeIsoTimestamp(qualification.qualifiedAt);
  const abuseSignals = normalizeReferralAbuseSignals(source.abuseSignals);
  return {
    code: normalizeReferralCode(source.code),
    referredBy: normalizeReferralCode(source.referredBy),
    referredAt,
    qualification: {
      qualifyingMatchCount,
      level2Reached: Boolean(qualification.level2Reached),
      qualifiedAt,
      countedMatchIds
    },
    referredReward: normalizeReferralClaim(source.referredReward),
    referrerClaims,
    abuseSignals: {
      ...abuseSignals,
      referralActivatedAt: abuseSignals.referralActivatedAt ?? referredAt,
      referralQualifiedAt: abuseSignals.referralQualifiedAt ?? qualifiedAt
    },
    risk: normalizeReferralRisk(source.risk),
    rewardReview: normalizeReferralRewardReview(source.rewardReview),
    adminRestrictions: normalizeReferralAdminRestrictions(source.adminRestrictions)
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

function buildSafeReferralDashboard(account, accounts, playerLevel = 1, nowMs = Date.now()) {
  const referral = normalizeReferral(account?.referral);
  const referralRewardsSuspended =
    referral.adminRestrictions.referralRewardsSuspended;
  const ownProgress = buildSafeReferralStatus(account, playerLevel);
  const todayKey = new Date(nowMs).toISOString().slice(0, 10);
  const referrerClaimsPaidToday = Object.values(referral.referrerClaims).filter(
    (claim) => getUtcDateKey(claim?.claimedAt) === todayKey
  ).length;
  const referrerDailyCapReached = referrerClaimsPaidToday >= REFERRER_DAILY_CLAIM_LIMIT;
  const refereeProgress = (Array.isArray(accounts) ? accounts : [])
    .filter(
      (entry) =>
        entry?.accountId !== account?.accountId &&
        referral.code &&
        normalizeReferral(entry?.referral).referredBy === referral.code
    )
    .map((entry) => {
      const status = buildSafeReferralStatus(entry);
      const rewardClaimed = Boolean(referral.referrerClaims[entry.accountId]?.claimedAt);
      const rewardReview = findReferralRewardReview(
        referral.rewardReview,
        buildReferralRewardClaimId("referrer", account.accountId, entry.accountId)
      );
      return {
        username: normalizeUsername(entry?.username) ?? "Player",
        level2Reached: status.level2Reached,
        qualifyingMatchesCompleted: status.qualifyingMatchesCompleted,
        qualified: status.qualified,
        rewardStatus: rewardClaimed
          ? "claimed"
          : referralRewardsSuspended
            ? "could_not_claim"
          : rewardReview?.status === "held_for_review"
            ? "pending_review"
            : ["blocked", "denied"].includes(rewardReview?.status)
              ? "could_not_claim"
          : !status.qualified
            ? "locked"
            : referrerDailyCapReached
              ? "daily_cap_reached"
              : "claimable"
      };
    })
    .sort((left, right) => left.username.localeCompare(right.username));

  return {
    emailVerified: Boolean(account?.emailVerified),
    referralCode: account?.emailVerified ? referral.code : null,
    ownProgress: {
      referralLinked: ownProgress.referredByLinked,
      level2Reached: ownProgress.level2Reached,
      qualifyingMatchesCompleted: ownProgress.qualifyingMatchesCompleted,
      qualified: ownProgress.qualified,
      qualifiedAt: ownProgress.qualifiedAt,
      rewardStatus: referral.referredReward.claimedAt
        ? "claimed"
        : referralRewardsSuspended
          ? "could_not_claim"
        : findReferralRewardReview(
              referral.rewardReview,
              buildReferralRewardClaimId("own", account.accountId)
            )?.status === "held_for_review"
          ? "pending_review"
          : ["blocked", "denied"].includes(
                findReferralRewardReview(
                  referral.rewardReview,
                  buildReferralRewardClaimId("own", account.accountId)
                )?.status
              )
            ? "could_not_claim"
        : !ownProgress.referredByLinked
          ? "unavailable"
          : !ownProgress.qualified
            ? "locked"
            : "claimable"
    },
    referrerDailyCapReached,
    referrerClaimsPaidToday,
    referees: refereeProgress
  };
}

function findReferralRewardReviewLocation(accounts, reviewId) {
  const safeReviewId = String(reviewId ?? "").trim();
  if (!safeReviewId) {
    return null;
  }
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const referral = normalizeReferral(account?.referral);
    const record = [...referral.rewardReview.heldRewards, ...referral.rewardReview.blockedRewards]
      .find((entry) => entry.reviewId === safeReviewId);
    if (record) {
      return { account, referral, record };
    }
  }
  return null;
}

function buildSafeAdminReferralReview(record, account, accounts) {
  const targetAccount =
    (Array.isArray(accounts) ? accounts : []).find(
      (entry) => entry?.accountId === record?.targetAccountId
    ) ?? null;
  const referral = normalizeReferral(account?.referral);
  return {
    reviewId: record.reviewId,
    status: record.status,
    claimType: record.claimType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    account: {
      accountId: account?.accountId ?? null,
      username: normalizeUsername(account?.username) ?? "Player"
    },
    target: targetAccount
      ? {
          accountId: targetAccount.accountId,
          username: normalizeUsername(targetAccount.username) ?? "Player"
        }
      : null,
    riskDecision: record.riskDecision,
    riskReasons: [...record.riskReasons],
    riskStage: record.claimContext.stage,
    claimStatus: record.status,
    rewardAmount: record.rewardAmount,
    approvalPossible:
      record.status === "held_for_review" &&
      !referral.adminRestrictions.referralRewardsSuspended,
    referralRewardsSuspended:
      referral.adminRestrictions.referralRewardsSuspended,
    approvedAt: record.approvedAt,
    approvedBy: record.approvedBy,
    deniedAt: record.deniedAt,
    deniedBy: record.deniedBy
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
    (safeMode !== "blood_match" ||
      REFERRAL_QUALIFYING_BLOOD_MATCH_END_REASONS.has(safeEndReason)) &&
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
  const createdAt = normalizeIsoTimestamp(account.createdAt);
  const referral = normalizeReferral(account.referral);
  return {
    ...account,
    email: normalizeEmail(account.email) ?? account.email,
    username: normalizeUsername(account.username) ?? account.username,
    profileKey: normalizeUsername(account.profileKey) ?? normalizeUsername(account.username) ?? account.profileKey,
    emailVerified,
    emailVerifiedAt,
    emailVerification: emailVerified ? null : normalizeEmailVerification(account.emailVerification),
    referral: {
      ...referral,
      abuseSignals: {
        ...referral.abuseSignals,
        accountCreatedAt: referral.abuseSignals.accountCreatedAt ?? createdAt,
        emailVerifiedAt: referral.abuseSignals.emailVerifiedAt ?? emailVerifiedAt
      }
    }
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
    referralCodeGenerator = createReferralCodeCandidate,
    referralRewardRiskClassifier = classifyReferralRewardClaimRisk
  } = {}) {
    this.logger = logger;
    this.now = now;
    this.referralCodeGenerator = referralCodeGenerator;
    this.referralRewardRiskClassifier = referralRewardRiskClassifier;
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

  async register({
    email,
    password,
    username,
    profileKey = username,
    requestSignals = null
  } = {}) {
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
    const normalizedRequestSignals = normalizeReferralRequestSignals(requestSignals);
    const referral = normalizeReferral(null);
    const account = {
      accountId: crypto.randomUUID(),
      email: safeEmail,
      passwordHash: await createScryptHash(safePassword),
      username: safeUsername,
      profileKey: safeProfileKey,
      emailVerified: false,
      emailVerifiedAt: null,
      emailVerification: pendingVerification.emailVerification,
      referral: {
        ...referral,
        abuseSignals: {
          ...referral.abuseSignals,
          accountCreatedAt: now,
          signupIpHash: normalizedRequestSignals.ipHash,
          signupUserAgentHash: normalizedRequestSignals.userAgentHash
        }
      },
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

  async requestEmailVerification({ email, accountId, username, deliverVerification = null } = {}) {
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
    const hasExplicitVerificationRequest =
      Math.max(0, Number(account.emailVerification?.resendCount ?? 0) || 0) > 0;
    if (
      hasExplicitVerificationRequest &&
      Number.isFinite(lastSentAtMs) &&
      nowMs - lastSentAtMs >= 0 &&
      nowMs - lastSentAtMs < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      throw buildAccountError("EMAIL_VERIFICATION_COOLDOWN", "Please wait before requesting another verification email.");
    }

    const pendingVerification = this.buildPendingEmailVerification(nowMs);
    if (typeof deliverVerification === "function") {
      await deliverVerification({
        email: account.email,
        token: pendingVerification.token
      });
    }
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
    const referral = normalizeReferral(account.referral);
    account.referral = {
      ...referral,
      abuseSignals: {
        ...referral.abuseSignals,
        emailVerifiedAt: verifiedAt
      }
    };
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

  async getReferralDashboard({ accountId, username, playerLevel = 1 } = {}) {
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

    return buildSafeReferralDashboard(account, state.accounts, playerLevel, this.now());
  }

  async claimReferralReward({
    accountId,
    username,
    claimType,
    refereeUsername,
    playerLevel = 1,
    grantTokens,
    requestSignals = null
  } = {}) {
    const operation = async () => {
      const safeAccountId = String(accountId ?? "").trim();
      const safeUsername = normalizeUsername(username);
      const safeClaimType = String(claimType ?? "").trim().toLowerCase();
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
          "Verify your email before claiming referral rewards."
        );
      }
      if (typeof grantTokens !== "function") {
        throw buildAccountError(
          "REFERRAL_REWARD_AUTHORITY_UNAVAILABLE",
          "Referral rewards are unavailable right now."
        );
      }

      const referral = syncReferralQualificationLevel(account.referral, playerLevel, this.now());
      account.referral = referral;
      let claimId = null;
      let claimTarget = null;
      let ledgerClaimed = false;
      let relatedReferral = null;
      let referrerClaimsPaidToday = 0;
      let dailyCapReached = false;
      let reviewTargetAccountId = account.accountId;

      if (safeClaimType === "own") {
        if (!referral.referredBy) {
          throw buildAccountError("REFERRAL_NOT_LINKED", "No referral is linked to this account.");
        }
        if (!isReferralQualified(referral)) {
          throw buildAccountError(
            "REFERRAL_NOT_QUALIFIED",
            "Complete referral qualification before claiming this reward."
          );
        }
        const referrerAccount =
          state.accounts.find(
            (entry) => normalizeReferralCode(entry?.referral?.code) === referral.referredBy
          ) ?? null;
        relatedReferral = normalizeReferral(referrerAccount?.referral);
        claimId = buildReferralRewardClaimId("own", account.accountId);
        ledgerClaimed = Boolean(referral.referredReward.claimedAt);
        claimTarget = {
          account,
          applyClaim: (claimedAt) => {
            const currentReferral = normalizeReferral(account.referral);
            account.referral = {
              ...currentReferral,
              referredReward: {
                claimedAt,
                amount: REFERRAL_REWARD_TOKENS,
                claimId
              }
            };
          }
        };
      } else if (safeClaimType === "referrer") {
        const safeRefereeUsername = normalizeReferralTargetUsername(refereeUsername);
        if (!safeRefereeUsername) {
          throw buildAccountError(
            "REFERRAL_REFEREE_INVALID",
            "Choose a valid referred player reward."
          );
        }
        const referee =
          state.accounts.find(
            (entry) =>
              normalizeUsername(entry?.username)?.toLowerCase() ===
              safeRefereeUsername.toLowerCase()
          ) ?? null;
        if (!referee) {
          throw buildAccountError(
            "REFERRAL_REFEREE_UNKNOWN",
            "The referred player could not be found."
          );
        }
        const refereeReferral = normalizeReferral(referee.referral);
        reviewTargetAccountId = referee.accountId;
        relatedReferral = refereeReferral;
        if (!referral.code || refereeReferral.referredBy !== referral.code) {
          throw buildAccountError(
            "REFERRAL_REFEREE_UNRELATED",
            "That player is not linked to your referral code."
          );
        }
        if (!referee.emailVerified || !isReferralQualified(refereeReferral)) {
          throw buildAccountError(
            "REFERRAL_REFEREE_NOT_QUALIFIED",
            "That referred player has not completed qualification yet."
          );
        }
        claimId = buildReferralRewardClaimId("referrer", account.accountId, referee.accountId);
        ledgerClaimed = Boolean(referral.referrerClaims[referee.accountId]?.claimedAt);
        const todayKey = new Date(this.now()).toISOString().slice(0, 10);
        referrerClaimsPaidToday = Object.values(referral.referrerClaims).filter(
          (claim) => getUtcDateKey(claim?.claimedAt) === todayKey
        ).length;
        dailyCapReached =
          !ledgerClaimed && referrerClaimsPaidToday >= REFERRER_DAILY_CLAIM_LIMIT;
        claimTarget = {
          account,
          refereeUsername: normalizeUsername(referee.username),
          applyClaim: (claimedAt) => {
            const currentReferral = normalizeReferral(account.referral);
            account.referral = {
              ...currentReferral,
              referrerClaims: {
                ...currentReferral.referrerClaims,
                [referee.accountId]: {
                  claimedAt,
                  amount: REFERRAL_REWARD_TOKENS,
                  claimId
                }
              }
            };
          }
        };
      } else {
        throw buildAccountError(
          "REFERRAL_CLAIM_TYPE_INVALID",
          "Choose a valid referral reward."
        );
      }

      const claimSignalAt = new Date(this.now()).toISOString();
      if (
        !ledgerClaimed &&
        referral.adminRestrictions.referralRewardsSuspended
      ) {
        return {
          claimType: safeClaimType,
          refereeUsername: claimTarget.refereeUsername ?? null,
          status: "could_not_claim",
          message: "Referral reward could not be claimed.",
          amount: 0,
          duplicate: false,
          grantResult: null,
          dashboard: buildSafeReferralDashboard(
            account,
            state.accounts,
            playerLevel,
            this.now()
          )
        };
      }
      const normalizedSignals = normalizeReferralRequestSignals(requestSignals);
      const stage = safeClaimType === "referrer" ? "referrer_claim" : "own_claim";
      const existingReview = findReferralRewardReview(referral.rewardReview, claimId);
      const classification = this.referralRewardRiskClassifier({
        stage,
        actorSignals: account.referral.abuseSignals,
        relatedSignals: relatedReferral?.abuseSignals,
        requestSignals,
        evaluatedAt: claimSignalAt,
        duplicate: ledgerClaimed || Boolean(existingReview),
        referralsFromIpHash:
          safeClaimType === "referrer"
            ? countReferredAccountsBySignal(
                state.accounts,
                referral.code,
                "signupIpHash",
                normalizedSignals.ipHash
              )
            : 0,
        referralsFromUserAgentHash:
          safeClaimType === "referrer"
            ? countReferredAccountsBySignal(
                state.accounts,
                referral.code,
                "signupUserAgentHash",
                normalizedSignals.userAgentHash
              )
            : 0,
        referrerClaimsPaidToday
      });
      const enforcementDecision = existingReview?.status ?? classification?.decision;
      account.referral = appendClassifiedReferralRisk(account.referral, {
        classification,
        evaluatedAt: claimSignalAt,
        stage,
        requestSignals
      });

      if (
        !ledgerClaimed &&
        ["held_for_review", "blocked"].includes(enforcementDecision)
      ) {
        const enforcementClassification = {
          ...classification,
          decision: enforcementDecision,
          reasons: existingReview?.riskReasons ?? classification?.reasons
        };
        account.referral = appendReferralRewardReview(account.referral, {
          claimId,
          claimType: safeClaimType,
          classification: enforcementClassification,
          createdAt: claimSignalAt,
          requestSignals,
          targetAccountId: reviewTargetAccountId
        });
        account.referral = appendReferralRewardClaimSignal(account.referral, {
          claimType: safeClaimType,
          claimedAt: claimSignalAt,
          outcome: enforcementDecision,
          requestSignals
        });
        account.updatedAt = claimSignalAt;
        await this.writeState(state);
        const held = enforcementDecision === "held_for_review";
        return {
          claimType: safeClaimType,
          refereeUsername: claimTarget.refereeUsername ?? null,
          status: held ? "pending_review" : "could_not_claim",
          message: held
            ? "Referral reward pending review."
            : "Referral reward could not be claimed.",
          amount: 0,
          duplicate: Boolean(existingReview),
          grantResult: null,
          dashboard: buildSafeReferralDashboard(
            account,
            state.accounts,
            playerLevel,
            this.now()
          )
        };
      }

      if (dailyCapReached) {
        throw buildAccountError(
          "REFERRAL_DAILY_CAP_REACHED",
          "Daily referral claim limit reached. Come back tomorrow."
        );
      }

      const grantResult = await grantTokens({
        username: account.profileKey ?? account.username,
        claimId,
        amount: REFERRAL_REWARD_TOKENS
      });
      if (!ledgerClaimed) {
        const claimedAt = new Date(this.now()).toISOString();
        claimTarget.applyClaim(claimedAt);
        account.updatedAt = claimedAt;
      }
      const reportedTokensAdded = Number(grantResult?.tokensAdded);
      const amount = Number.isFinite(reportedTokensAdded)
        ? Math.min(REFERRAL_REWARD_TOKENS, Math.max(0, Math.floor(reportedTokensAdded)))
        : grantResult?.duplicate || ledgerClaimed
          ? 0
          : REFERRAL_REWARD_TOKENS;
      account.referral = appendReferralRewardClaimSignal(account.referral, {
        claimType: safeClaimType,
        claimedAt: claimSignalAt,
        outcome: amount === 0 ? "duplicate" : "granted",
        requestSignals
      });
      if (amount === 0 && !ledgerClaimed) {
        const duplicateClassification = this.referralRewardRiskClassifier({
          stage,
          actorSignals: account.referral.abuseSignals,
          relatedSignals: relatedReferral?.abuseSignals,
          requestSignals,
          evaluatedAt: claimSignalAt,
          duplicate: true,
          referralsFromIpHash: 0,
          referralsFromUserAgentHash: 0,
          referrerClaimsPaidToday
        });
        account.referral = appendClassifiedReferralRisk(account.referral, {
          classification: duplicateClassification,
          evaluatedAt: claimSignalAt,
          stage,
          requestSignals
        });
      }
      account.updatedAt = claimSignalAt;
      await this.writeState(state);

      return {
        claimType: safeClaimType,
        refereeUsername: claimTarget.refereeUsername ?? null,
        status: "claimed",
        message: "Reward claimed.",
        amount,
        duplicate: amount === 0,
        grantResult,
        dashboard: buildSafeReferralDashboard(account, state.accounts, playerLevel, this.now())
      };
    };

    const pending = this.referralMutationQueue.then(operation, operation);
    this.referralMutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async listReferralRewardReviews({ status = "all" } = {}) {
    const safeStatus = String(status ?? "all").trim().toLowerCase();
    const statusMap = {
      all: null,
      held: "held_for_review",
      held_for_review: "held_for_review",
      blocked: "blocked",
      approved: "approved",
      denied: "denied"
    };
    if (!(safeStatus in statusMap)) {
      throw buildAccountError(
        "ADMIN_REFERRAL_REVIEW_FILTER_INVALID",
        "Choose a valid referral review filter."
      );
    }
    const state = await this.readState();
    const reviews = [];
    for (const account of state.accounts) {
      const referral = normalizeReferral(account.referral);
      for (const record of [
        ...referral.rewardReview.heldRewards,
        ...referral.rewardReview.blockedRewards
      ]) {
        if (statusMap[safeStatus] && record.status !== statusMap[safeStatus]) {
          continue;
        }
        reviews.push(buildSafeAdminReferralReview(record, account, state.accounts));
      }
    }
    reviews.sort(
      (left, right) =>
        Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "")
    );
    return {
      filter: safeStatus,
      reviews
    };
  }

  async resolveReferralRewardReview({
    reviewId,
    action,
    adminIdentifier,
    reasonCode = null,
    grantTokens
  } = {}) {
    const operation = async () => {
      const safeReviewId = String(reviewId ?? "").trim();
      const safeAction = String(action ?? "").trim().toLowerCase();
      const safeAdminIdentifier = normalizeUsername(adminIdentifier);
      if (!safeReviewId) {
        throw buildAccountError(
          "ADMIN_REFERRAL_REVIEW_ID_REQUIRED",
          "reviewId is required."
        );
      }
      if (!["approve", "deny"].includes(safeAction)) {
        throw buildAccountError(
          "ADMIN_REFERRAL_REVIEW_ACTION_INVALID",
          "Choose approve or deny."
        );
      }
      if (!safeAdminIdentifier) {
        throw buildAccountError(
          "ADMIN_AUTH_REQUIRED",
          "An authenticated admin identity is required."
        );
      }

      const state = await this.readState();
      const location = findReferralRewardReviewLocation(state.accounts, safeReviewId);
      if (!location) {
        throw buildAccountError(
          "ADMIN_REFERRAL_REVIEW_NOT_FOUND",
          "Referral reward review was not found."
        );
      }
      const { account, record } = location;
      let referral = normalizeReferral(account.referral);

      if (safeAction === "approve") {
        if (record.status === "approved") {
          return {
            action: "approve",
            duplicate: true,
            tokensAdded: 0,
            review: buildSafeAdminReferralReview(record, account, state.accounts)
          };
        }
        if (record.status !== "held_for_review") {
          throw buildAccountError(
            "ADMIN_REFERRAL_REVIEW_NOT_APPROVABLE",
            "Only a pending referral reward can be approved."
          );
        }
        if (referral.adminRestrictions.referralRewardsSuspended) {
          throw buildAccountError(
            "ADMIN_REFERRAL_REWARDS_SUSPENDED",
            "Referral rewards are suspended for this account."
          );
        }
        if (typeof grantTokens !== "function") {
          throw buildAccountError(
            "REFERRAL_REWARD_AUTHORITY_UNAVAILABLE",
            "Referral rewards are unavailable right now."
          );
        }
        if (
          record.claimType === "referrer" &&
          !state.accounts.some((entry) => entry.accountId === record.targetAccountId)
        ) {
          throw buildAccountError(
            "ADMIN_REFERRAL_REVIEW_TARGET_MISSING",
            "The referral reward target could not be found."
          );
        }

        const grantResult = await grantTokens({
          username: account.profileKey ?? account.username,
          claimId: record.deterministicGrantId,
          amount: record.rewardAmount
        });
        const approvedAt = new Date(this.now()).toISOString();
        const approvedRecord = {
          ...record,
          status: "approved",
          updatedAt: approvedAt,
          approvedAt,
          approvedBy: safeAdminIdentifier,
          resolutionReasonCode:
            normalizeReferralAdminReasonCode(reasonCode) ?? "ADMIN_APPROVED"
        };
        referral =
          record.claimType === "own"
            ? {
                ...referral,
                referredReward: {
                  claimedAt: approvedAt,
                  amount: record.rewardAmount,
                  claimId: record.deterministicGrantId
                }
              }
            : {
                ...referral,
                referrerClaims: {
                  ...referral.referrerClaims,
                  [record.targetAccountId]: {
                    claimedAt: approvedAt,
                    amount: record.rewardAmount,
                    claimId: record.deterministicGrantId
                  }
                }
              };
        account.referral = {
          ...referral,
          rewardReview: updateReferralRewardReviewRecord(
            referral.rewardReview,
            approvedRecord
          )
        };
        account.updatedAt = approvedAt;
        await this.writeState(state);
        const reportedTokensAdded = Number(grantResult?.tokensAdded);
        return {
          action: "approve",
          duplicate: Boolean(grantResult?.duplicate),
          tokensAdded: Number.isFinite(reportedTokensAdded)
            ? Math.min(
                record.rewardAmount,
                Math.max(0, Math.floor(reportedTokensAdded))
              )
            : grantResult?.duplicate
              ? 0
              : record.rewardAmount,
          review: buildSafeAdminReferralReview(
            normalizeReferralRewardReviewRecord(approvedRecord),
            account,
            state.accounts
          )
        };
      }

      if (record.status === "denied" || record.status === "blocked") {
        return {
          action: "deny",
          duplicate: true,
          tokensAdded: 0,
          review: buildSafeAdminReferralReview(record, account, state.accounts)
        };
      }
      if (record.status !== "held_for_review") {
        throw buildAccountError(
          "ADMIN_REFERRAL_REVIEW_NOT_DENIABLE",
          "Only a pending referral reward can be denied."
        );
      }
      const deniedAt = new Date(this.now()).toISOString();
      const deniedRecord = {
        ...record,
        status: "denied",
        updatedAt: deniedAt,
        deniedAt,
        deniedBy: safeAdminIdentifier,
        resolutionReasonCode:
          normalizeReferralAdminReasonCode(reasonCode) ?? "ADMIN_DENIED"
      };
      account.referral = {
        ...referral,
        rewardReview: updateReferralRewardReviewRecord(
          referral.rewardReview,
          deniedRecord
        )
      };
      account.updatedAt = deniedAt;
      await this.writeState(state);
      return {
        action: "deny",
        duplicate: false,
        tokensAdded: 0,
        review: buildSafeAdminReferralReview(
          normalizeReferralRewardReviewRecord(deniedRecord),
          account,
          state.accounts
        )
      };
    };

    const pending = this.referralMutationQueue.then(operation, operation);
    this.referralMutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async suspendReferralRewards({
    accountId,
    reasonCode,
    adminIdentifier
  } = {}) {
    const operation = async () => {
      const safeAccountId = String(accountId ?? "").trim();
      const safeReasonCode =
        normalizeReferralAdminReasonCode(reasonCode) ?? "ADMIN_REFERRAL_REVIEW";
      const safeAdminIdentifier = normalizeUsername(adminIdentifier);
      if (!safeAccountId) {
        throw buildAccountError(
          "ADMIN_TARGET_ACCOUNT_REQUIRED",
          "accountId is required."
        );
      }
      if (!safeAdminIdentifier) {
        throw buildAccountError(
          "ADMIN_AUTH_REQUIRED",
          "An authenticated admin identity is required."
        );
      }
      const state = await this.readState();
      const account =
        state.accounts.find((entry) => entry.accountId === safeAccountId) ?? null;
      if (!account) {
        throw buildAccountError(
          "ACCOUNT_NOT_FOUND",
          "Account was not found."
        );
      }
      const referral = normalizeReferral(account.referral);
      if (referral.adminRestrictions.referralRewardsSuspended) {
        return {
          duplicate: true,
          accountId: account.accountId,
          username: normalizeUsername(account.username) ?? "Player",
          referralRewardsSuspended: true
        };
      }
      const now = new Date(this.now()).toISOString();
      account.referral = {
        ...referral,
        adminRestrictions: {
          schemaVersion: REFERRAL_ADMIN_RESTRICTION_SCHEMA_VERSION,
          referralRewardsSuspended: true,
          reasonCode: safeReasonCode,
          createdAt: now,
          updatedAt: now,
          createdBy: safeAdminIdentifier
        }
      };
      account.updatedAt = now;
      await this.writeState(state);
      return {
        duplicate: false,
        accountId: account.accountId,
        username: normalizeUsername(account.username) ?? "Player",
        referralRewardsSuspended: true
      };
    };

    const pending = this.referralMutationQueue.then(operation, operation);
    this.referralMutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async activateReferralCode({
    accountId,
    username,
    referralCode,
    playerLevel = 1,
    requestSignals = null
  } = {}) {
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
      let relatedReferral = null;
      try {
        if (!account.emailVerified) {
          throw buildAccountError(
            "EMAIL_VERIFICATION_REQUIRED",
            "Verify your email before activating a referral code."
          );
        }
        const safeReferralCode = normalizeSubmittedReferralCode(referralCode);
        if (!safeReferralCode) {
          throw buildAccountError("REFERRAL_CODE_INVALID", "Enter a valid referral code.");
        }

        let referral = syncReferralQualificationLevel(account.referral, playerLevel, this.now());
        if (referral.referredBy === safeReferralCode) {
          const relatedAccount =
            state.accounts.find(
              (entry) => normalizeReferralCode(entry?.referral?.code) === safeReferralCode
            ) ?? null;
          relatedReferral = normalizeReferral(relatedAccount?.referral);
          const evaluatedAt = new Date(this.now()).toISOString();
          const classification = classifyReferralActivationRisk({
            actorSignals: referral.abuseSignals,
            relatedSignals: relatedReferral.abuseSignals,
            requestSignals,
            evaluatedAt,
            failedActivationAttemptCount:
              referral.abuseSignals.failedReferralActivationAttempts.length,
            hardBlockReason: "REFERRAL_DUPLICATE_ACTIVATION"
          });
          account.referral = appendClassifiedReferralRisk(referral, {
            classification,
            evaluatedAt,
            stage: "activation",
            requestSignals
          });
          account.updatedAt = evaluatedAt;
          await this.writeState(state);
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
        relatedReferral = normalizeReferral(referrerAccount.referral);
        if (referrerAccount.accountId === account.accountId) {
          throw buildAccountError("REFERRAL_SELF_LINK", "You cannot use your own referral code.");
        }
        const accountReferralCode = normalizeReferralCode(account.referral?.code);
        if (accountReferralCode && relatedReferral.referredBy === accountReferralCode) {
          throw buildAccountError(
            "REFERRAL_RECIPROCAL_LINK",
            "You cannot use a referral code from someone you already referred."
          );
        }

        const activatedAt = new Date(this.now()).toISOString();
        const normalizedSignals = normalizeReferralRequestSignals(requestSignals);
        account.referral = {
          ...referral,
          referredBy: safeReferralCode,
          referredAt: activatedAt,
          qualification: {
            ...referral.qualification,
            level2Reached: Number(playerLevel ?? 1) >= 2
          },
          abuseSignals: {
            ...referral.abuseSignals,
            referralActivatedAt: activatedAt,
            referralActivationIpHash: normalizedSignals.ipHash,
            referralActivationUserAgentHash: normalizedSignals.userAgentHash
          }
        };
        const classification = classifyReferralActivationRisk({
          actorSignals: account.referral.abuseSignals,
          relatedSignals: relatedReferral.abuseSignals,
          requestSignals,
          evaluatedAt: activatedAt,
          failedActivationAttemptCount:
            account.referral.abuseSignals.failedReferralActivationAttempts.length
        });
        account.referral = appendClassifiedReferralRisk(account.referral, {
          classification,
          evaluatedAt: activatedAt,
          stage: "activation",
          requestSignals
        });
        account.updatedAt = activatedAt;
        await this.writeState(state);
        return {
          referralLinked: true,
          alreadyLinked: false,
          ...buildSafeReferralStatus(account, playerLevel)
        };
      } catch (error) {
        if (error?.code) {
          const attemptedAt = new Date(this.now()).toISOString();
          account.referral = appendFailedReferralActivationSignal(account.referral, {
            attemptedAt,
            reason: error.code,
            requestSignals
          });
          const classification = classifyReferralActivationRisk({
            actorSignals: account.referral.abuseSignals,
            relatedSignals: relatedReferral?.abuseSignals,
            requestSignals,
            evaluatedAt: attemptedAt,
            failedActivationAttemptCount:
              account.referral.abuseSignals.failedReferralActivationAttempts.length,
            hardBlockReason: error.code
          });
          account.referral = appendClassifiedReferralRisk(account.referral, {
            classification,
            evaluatedAt: attemptedAt,
            stage: "activation",
            requestSignals
          });
          account.updatedAt = attemptedAt;
          await this.writeState(state);
        }
        throw error;
      }
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
      const safeSettlementId = normalizeReferralSettlementId(settlementId);
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
      const qualificationCompleted =
        !currentReferral.qualification.qualifiedAt &&
        Boolean(referral.qualification.qualifiedAt);
      if (qualificationCompleted) {
        referral = normalizeReferral(referral);
        const referrerAccount =
          state.accounts.find(
            (entry) =>
              normalizeReferralCode(entry?.referral?.code) === referral.referredBy
          ) ?? null;
        const classification = classifyReferralQualificationRisk({
          actorSignals: referral.abuseSignals,
          relatedSignals: normalizeReferral(referrerAccount?.referral).abuseSignals,
          evaluatedAt: referral.qualification.qualifiedAt
        });
        referral = appendClassifiedReferralRisk(referral, {
          classification,
          evaluatedAt: referral.qualification.qualifiedAt,
          stage: "qualification"
        });
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
