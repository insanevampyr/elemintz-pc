export const REFERRAL_RISK_SCHEMA_VERSION = 1;

export const REFERRAL_RISK_DECISIONS = Object.freeze({
  ELIGIBLE: "eligible",
  HELD_FOR_REVIEW: "held_for_review",
  BLOCKED: "blocked"
});

export const REFERRAL_RISK_REASONS = Object.freeze({
  SAME_SIGNUP_IP_HASH: "same_signup_ip_hash",
  SAME_ACTIVATION_IP_HASH: "same_activation_ip_hash",
  SAME_CLAIM_IP_HASH: "same_claim_ip_hash",
  SAME_USER_AGENT_HASH: "same_user_agent_hash",
  RAPID_ACTIVATION_AFTER_SIGNUP: "rapid_activation_after_signup",
  RAPID_QUALIFICATION_AFTER_ACTIVATION: "rapid_qualification_after_activation",
  RAPID_CLAIM_AFTER_QUALIFICATION: "rapid_claim_after_qualification",
  EXCESSIVE_FAILED_ACTIVATION_ATTEMPTS: "excessive_failed_activation_attempts",
  EXCESSIVE_REFERRALS_FROM_IP_HASH: "excessive_referrals_from_ip_hash",
  EXCESSIVE_REFERRALS_FROM_USER_AGENT_HASH: "excessive_referrals_from_user_agent_hash",
  REFERRER_DAILY_CLAIM_PRESSURE: "referrer_daily_claim_pressure",
  DUPLICATE_CLAIM_OBSERVED: "duplicate_claim_observed",
  MISSING_SIGNAL_CONTEXT: "missing_signal_context",
  EXISTING_HARD_BLOCK_SELF_REFERRAL: "existing_hard_block_self_referral",
  EXISTING_HARD_BLOCK_RECIPROCAL_REFERRAL: "existing_hard_block_reciprocal_referral",
  EXISTING_HARD_BLOCK_MALFORMED_CODE: "existing_hard_block_malformed_code",
  EXISTING_HARD_BLOCK_UNKNOWN_CODE: "existing_hard_block_unknown_code",
  EXISTING_HARD_BLOCK_DUPLICATE_ACTIVATION: "existing_hard_block_duplicate_activation",
  EXISTING_HARD_BLOCK_LOCKED_STATE: "existing_hard_block_locked_state",
  EXISTING_HARD_BLOCK_EMAIL_VERIFICATION: "existing_hard_block_email_verification"
});

const RISK_HISTORY_LIMIT = 50;
const REFERRER_CLAIM_RISK_LIMIT = 50;
const RAPID_ACTIVATION_MS = 2 * 60 * 1000;
const RAPID_QUALIFICATION_MS = 10 * 60 * 1000;
const RAPID_CLAIM_MS = 60 * 1000;
const EXCESSIVE_FAILED_ACTIVATIONS = 5;
const EXCESSIVE_SHARED_REFERRALS = 3;
const REFERRER_DAILY_CLAIM_PRESSURE_COUNT = 2;
const PRIVATE_HASH_PATTERN = /^hmac-sha256\$[a-f0-9]{64}$/;

const DECISION_VALUES = new Set(Object.values(REFERRAL_RISK_DECISIONS));
const REASON_VALUES = new Set(Object.values(REFERRAL_RISK_REASONS));
const STAGE_VALUES = new Set(["activation", "qualification", "own_claim", "referrer_claim"]);
const SIGNAL_PRESENCE_KEYS = Object.freeze([
  "requestIp",
  "requestUserAgent",
  "actorSignupIp",
  "actorSignupUserAgent",
  "relatedSignupIp",
  "relatedSignupUserAgent",
  "activationTimestamp",
  "qualificationTimestamp"
]);

const HARD_BLOCK_REASON_MAP = Object.freeze({
  EMAIL_VERIFICATION_REQUIRED:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_EMAIL_VERIFICATION,
  REFERRAL_ALREADY_LINKED:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_DUPLICATE_ACTIVATION,
  REFERRAL_DUPLICATE_ACTIVATION:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_DUPLICATE_ACTIVATION,
  REFERRAL_CODE_INVALID:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_MALFORMED_CODE,
  REFERRAL_CODE_UNKNOWN:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_UNKNOWN_CODE,
  REFERRAL_RECIPROCAL_LINK:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_RECIPROCAL_REFERRAL,
  REFERRAL_SELF_LINK:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_SELF_REFERRAL,
  REFERRAL_STATE_LOCKED:
    REFERRAL_RISK_REASONS.EXISTING_HARD_BLOCK_LOCKED_STATE
});

function normalizeIsoTimestamp(value) {
  const normalized = String(value ?? "").trim();
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function normalizePrivateHash(value) {
  const normalized = String(value ?? "").trim();
  return PRIVATE_HASH_PATTERN.test(normalized) ? normalized : null;
}

function elapsedMs(earlierValue, laterValue) {
  const earlier = Date.parse(String(earlierValue ?? ""));
  const later = Date.parse(String(laterValue ?? ""));
  if (!Number.isFinite(earlier) || !Number.isFinite(later) || later < earlier) {
    return null;
  }
  return later - earlier;
}

function addUniqueReason(reasons, reason) {
  if (REASON_VALUES.has(reason) && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function buildSignalPresence({ actorSignals, relatedSignals, requestSignals } = {}) {
  return {
    requestIp: Boolean(normalizePrivateHash(requestSignals?.ipHash)),
    requestUserAgent: Boolean(normalizePrivateHash(requestSignals?.userAgentHash)),
    actorSignupIp: Boolean(normalizePrivateHash(actorSignals?.signupIpHash)),
    actorSignupUserAgent: Boolean(normalizePrivateHash(actorSignals?.signupUserAgentHash)),
    relatedSignupIp: Boolean(normalizePrivateHash(relatedSignals?.signupIpHash)),
    relatedSignupUserAgent: Boolean(normalizePrivateHash(relatedSignals?.signupUserAgentHash)),
    activationTimestamp: Boolean(normalizeIsoTimestamp(actorSignals?.referralActivatedAt)),
    qualificationTimestamp: Boolean(normalizeIsoTimestamp(actorSignals?.referralQualifiedAt))
  };
}

function hasMatchingHash(left, right) {
  const safeLeft = normalizePrivateHash(left);
  const safeRight = normalizePrivateHash(right);
  return Boolean(safeLeft && safeRight && safeLeft === safeRight);
}

function hasRelatedUserAgentMatch(actorSignals, relatedSignals, requestSignals) {
  return (
    hasMatchingHash(actorSignals?.signupUserAgentHash, relatedSignals?.signupUserAgentHash) ||
    hasMatchingHash(requestSignals?.userAgentHash, relatedSignals?.signupUserAgentHash) ||
    hasMatchingHash(requestSignals?.userAgentHash, relatedSignals?.referralActivationUserAgentHash)
  );
}

function finalizeClassification({
  reasons,
  hardBlockReason,
  signalPresence
}) {
  const safeReasons = [];
  const mappedHardBlock = HARD_BLOCK_REASON_MAP[String(hardBlockReason ?? "").trim()];
  if (mappedHardBlock) {
    addUniqueReason(safeReasons, mappedHardBlock);
  }
  for (const reason of reasons) {
    addUniqueReason(safeReasons, reason);
  }

  const substantiveReasons = safeReasons.filter(
    (reason) => reason !== REFERRAL_RISK_REASONS.MISSING_SIGNAL_CONTEXT
  );
  return {
    decision: mappedHardBlock
      ? REFERRAL_RISK_DECISIONS.BLOCKED
      : substantiveReasons.length > 0
        ? REFERRAL_RISK_DECISIONS.HELD_FOR_REVIEW
        : REFERRAL_RISK_DECISIONS.ELIGIBLE,
    reasons: safeReasons,
    signalPresence
  };
}

export function classifyReferralActivationRisk({
  actorSignals = null,
  relatedSignals = null,
  requestSignals = null,
  evaluatedAt,
  failedActivationAttemptCount = 0,
  hardBlockReason = null
} = {}) {
  const reasons = [];
  const signupElapsed = elapsedMs(actorSignals?.accountCreatedAt, evaluatedAt);
  if (signupElapsed !== null && signupElapsed < RAPID_ACTIVATION_MS) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.RAPID_ACTIVATION_AFTER_SIGNUP);
  }
  if (hasMatchingHash(actorSignals?.signupIpHash, relatedSignals?.signupIpHash)) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_SIGNUP_IP_HASH);
  }
  if (
    hasMatchingHash(requestSignals?.ipHash, relatedSignals?.signupIpHash) ||
    hasMatchingHash(requestSignals?.ipHash, relatedSignals?.referralActivationIpHash)
  ) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_ACTIVATION_IP_HASH);
  }
  if (Number(failedActivationAttemptCount) >= EXCESSIVE_FAILED_ACTIVATIONS) {
    addUniqueReason(
      reasons,
      REFERRAL_RISK_REASONS.EXCESSIVE_FAILED_ACTIVATION_ATTEMPTS
    );
  }
  if (reasons.length > 0 && hasRelatedUserAgentMatch(actorSignals, relatedSignals, requestSignals)) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_USER_AGENT_HASH);
  }

  const signalPresence = buildSignalPresence({
    actorSignals,
    relatedSignals,
    requestSignals
  });
  if (
    !signalPresence.requestIp ||
    !signalPresence.requestUserAgent ||
    !signalPresence.actorSignupIp ||
    !signalPresence.relatedSignupIp
  ) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.MISSING_SIGNAL_CONTEXT);
  }

  return finalizeClassification({ reasons, hardBlockReason, signalPresence });
}

export function classifyReferralQualificationRisk({
  actorSignals = null,
  relatedSignals = null,
  evaluatedAt
} = {}) {
  const reasons = [];
  const qualificationElapsed = elapsedMs(actorSignals?.referralActivatedAt, evaluatedAt);
  if (qualificationElapsed !== null && qualificationElapsed < RAPID_QUALIFICATION_MS) {
    addUniqueReason(
      reasons,
      REFERRAL_RISK_REASONS.RAPID_QUALIFICATION_AFTER_ACTIVATION
    );
  }
  if (hasMatchingHash(actorSignals?.signupIpHash, relatedSignals?.signupIpHash)) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_SIGNUP_IP_HASH);
  }
  if (reasons.length > 0 && hasRelatedUserAgentMatch(actorSignals, relatedSignals, null)) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_USER_AGENT_HASH);
  }

  const signalPresence = buildSignalPresence({
    actorSignals,
    relatedSignals,
    requestSignals: null
  });
  if (
    !signalPresence.actorSignupIp ||
    !signalPresence.relatedSignupIp ||
    !signalPresence.activationTimestamp
  ) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.MISSING_SIGNAL_CONTEXT);
  }

  return finalizeClassification({
    reasons,
    hardBlockReason: null,
    signalPresence
  });
}

export function classifyReferralRewardClaimRisk({
  stage = "own_claim",
  actorSignals = null,
  relatedSignals = null,
  requestSignals = null,
  evaluatedAt,
  duplicate = false,
  referralsFromIpHash = 0,
  referralsFromUserAgentHash = 0,
  referrerClaimsPaidToday = 0
} = {}) {
  const reasons = [];
  const qualificationSignals =
    stage === "referrer_claim" ? relatedSignals : actorSignals;
  const claimElapsed = elapsedMs(
    qualificationSignals?.referralQualifiedAt,
    evaluatedAt
  );
  if (claimElapsed !== null && claimElapsed < RAPID_CLAIM_MS) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.RAPID_CLAIM_AFTER_QUALIFICATION);
  }
  if (hasMatchingHash(actorSignals?.signupIpHash, relatedSignals?.signupIpHash)) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_SIGNUP_IP_HASH);
  }
  if (
    hasMatchingHash(requestSignals?.ipHash, relatedSignals?.signupIpHash) ||
    hasMatchingHash(requestSignals?.ipHash, relatedSignals?.referralActivationIpHash)
  ) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_CLAIM_IP_HASH);
  }
  if (duplicate) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.DUPLICATE_CLAIM_OBSERVED);
  }
  if (Number(referralsFromIpHash) >= EXCESSIVE_SHARED_REFERRALS) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.EXCESSIVE_REFERRALS_FROM_IP_HASH);
  }
  if (Number(referralsFromUserAgentHash) >= EXCESSIVE_SHARED_REFERRALS) {
    addUniqueReason(
      reasons,
      REFERRAL_RISK_REASONS.EXCESSIVE_REFERRALS_FROM_USER_AGENT_HASH
    );
  }
  if (
    stage === "referrer_claim" &&
    Number(referrerClaimsPaidToday) >= REFERRER_DAILY_CLAIM_PRESSURE_COUNT
  ) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.REFERRER_DAILY_CLAIM_PRESSURE);
  }
  if (reasons.length > 0 && hasRelatedUserAgentMatch(actorSignals, relatedSignals, requestSignals)) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.SAME_USER_AGENT_HASH);
  }

  const signalPresence = buildSignalPresence({
    actorSignals,
    relatedSignals,
    requestSignals
  });
  signalPresence.qualificationTimestamp = Boolean(
    normalizeIsoTimestamp(qualificationSignals?.referralQualifiedAt)
  );
  if (
    !signalPresence.requestIp ||
    !signalPresence.requestUserAgent ||
    !signalPresence.actorSignupIp ||
    !signalPresence.qualificationTimestamp
  ) {
    addUniqueReason(reasons, REFERRAL_RISK_REASONS.MISSING_SIGNAL_CONTEXT);
  }

  return finalizeClassification({
    reasons,
    hardBlockReason: null,
    signalPresence
  });
}

export function createReferralRiskRecord({
  decision,
  reasons = [],
  evaluatedAt,
  stage,
  targetUsernameHashOrKey = null,
  signalPresence = null
} = {}) {
  const safeDecision = DECISION_VALUES.has(decision)
    ? decision
    : REFERRAL_RISK_DECISIONS.ELIGIBLE;
  const safeStage = STAGE_VALUES.has(stage) ? stage : null;
  const safeEvaluatedAt = normalizeIsoTimestamp(evaluatedAt);
  if (!safeStage || !safeEvaluatedAt) {
    return null;
  }

  const safeReasons = [];
  for (const reason of Array.isArray(reasons) ? reasons : []) {
    addUniqueReason(safeReasons, reason);
  }
  const safeSignalPresence = {};
  for (const key of SIGNAL_PRESENCE_KEYS) {
    safeSignalPresence[key] = Boolean(signalPresence?.[key]);
  }

  return {
    schemaVersion: REFERRAL_RISK_SCHEMA_VERSION,
    decision: safeDecision,
    reasons: safeReasons,
    evaluatedAt: safeEvaluatedAt,
    stage: safeStage,
    targetUsernameHashOrKey: normalizePrivateHash(targetUsernameHashOrKey),
    signalPresence: safeSignalPresence
  };
}

export function normalizeReferralRisk(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizeRecord = (record) => {
    if (!DECISION_VALUES.has(record?.decision)) {
      return null;
    }
    return createReferralRiskRecord({
      decision: record?.decision,
      reasons: record?.reasons,
      evaluatedAt: record?.evaluatedAt,
      stage: record?.stage,
      targetUsernameHashOrKey: record?.targetUsernameHashOrKey,
      signalPresence: record?.signalPresence
    });
  };
  const normalizeRecords = (records, limit) =>
    (Array.isArray(records) ? records : [])
      .map((record) => normalizeRecord(record))
      .filter(Boolean)
      .slice(-limit);

  return {
    schemaVersion: REFERRAL_RISK_SCHEMA_VERSION,
    latestActivationRisk: normalizeRecord(source.latestActivationRisk),
    latestQualificationRisk: normalizeRecord(source.latestQualificationRisk),
    latestOwnClaimRisk: normalizeRecord(source.latestOwnClaimRisk),
    referrerClaimRisks: normalizeRecords(
      source.referrerClaimRisks,
      REFERRER_CLAIM_RISK_LIMIT
    ),
    riskHistory: normalizeRecords(source.riskHistory, RISK_HISTORY_LIMIT)
  };
}

export function appendReferralRiskRecord(riskValue, recordValue) {
  const risk = normalizeReferralRisk(riskValue);
  const record = createReferralRiskRecord(recordValue);
  if (!record) {
    return risk;
  }

  const next = {
    ...risk,
    riskHistory: [...risk.riskHistory, record].slice(-RISK_HISTORY_LIMIT)
  };
  if (record.stage === "activation") {
    next.latestActivationRisk = record;
  } else if (record.stage === "qualification") {
    next.latestQualificationRisk = record;
  } else if (record.stage === "own_claim") {
    next.latestOwnClaimRisk = record;
  } else if (record.stage === "referrer_claim") {
    next.referrerClaimRisks = [...risk.referrerClaimRisks, record].slice(
      -REFERRER_CLAIM_RISK_LIMIT
    );
  }
  return next;
}

export const __private__ = {
  HARD_BLOCK_REASON_MAP,
  RISK_HISTORY_LIMIT,
  REFERRER_CLAIM_RISK_LIMIT
};
