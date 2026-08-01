export const EVENT_CHEST_ELIGIBILITY_MODES = Object.freeze(["all_players", "rules"]);
export const EVENT_CHEST_ELIGIBILITY_REASON_CODES = Object.freeze({
  ELIGIBLE: "eligible",
  LEVEL_TOO_LOW: "level_too_low",
  LEVEL_TOO_HIGH: "level_too_high",
  ACCOUNT_TOO_NEW: "account_too_new",
  ACCOUNT_CREATED_TOO_LATE: "account_created_too_late",
  EMAIL_NOT_VERIFIED: "email_not_verified",
  INVALID_DEFINITION: "invalid_eligibility_definition",
  MISSING_ACCOUNT_DATA: "missing_authoritative_account_data"
});

const MAX_LEVEL = 10000;
const MAX_ACCOUNT_AGE_DAYS = 36500;
const ISO_WITH_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedInteger(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function normalizeIsoWithZone(value) {
  const text = String(value ?? "").trim();
  if (!ISO_WITH_ZONE_PATTERN.test(text)) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeEventChestEligibility(eligibility) {
  if (eligibility == null) {
    return { mode: "all_players" };
  }
  if (!isObject(eligibility)) {
    return { mode: "invalid" };
  }
  const mode = String(eligibility.mode ?? "").trim() || "all_players";
  if (mode === "all_players") {
    return { mode: "all_players" };
  }
  if (mode !== "rules") {
    return { mode: "invalid" };
  }
  const normalized = { mode: "rules" };
  if (eligibility.minimumLevel !== undefined) {
    normalized.minimumLevel = Number(eligibility.minimumLevel);
  }
  if (eligibility.maximumLevel !== undefined) {
    normalized.maximumLevel = Number(eligibility.maximumLevel);
  }
  if (eligibility.minimumAccountAgeDays !== undefined) {
    normalized.minimumAccountAgeDays = Number(eligibility.minimumAccountAgeDays);
  }
  if (eligibility.accountCreatedBefore !== undefined) {
    normalized.accountCreatedBefore = String(eligibility.accountCreatedBefore ?? "").trim();
  }
  if (eligibility.verifiedEmailRequired !== undefined) {
    normalized.verifiedEmailRequired = Boolean(eligibility.verifiedEmailRequired);
  }
  return normalized;
}

export function validateEventChestEligibility(eligibility, errors, { fieldName = "eligibility" } = {}) {
  if (eligibility == null) {
    return;
  }
  if (!isObject(eligibility)) {
    errors.push(`${fieldName} must be an object.`);
    return;
  }
  const supportedFields = new Set([
    "mode",
    "minimumLevel",
    "maximumLevel",
    "minimumAccountAgeDays",
    "accountCreatedBefore",
    "verifiedEmailRequired"
  ]);
  for (const key of Object.keys(eligibility)) {
    if (!supportedFields.has(key)) {
      errors.push(`${fieldName}.${key} is unsupported.`);
    }
  }
  const mode = String(eligibility.mode ?? "").trim();
  if (!EVENT_CHEST_ELIGIBILITY_MODES.includes(mode)) {
    errors.push(`${fieldName}.mode is unsupported.`);
    return;
  }
  const restrictiveFields = [
    "minimumLevel",
    "maximumLevel",
    "minimumAccountAgeDays",
    "accountCreatedBefore",
    "verifiedEmailRequired"
  ].filter((field) => eligibility[field] !== undefined);
  if (mode === "all_players") {
    if (restrictiveFields.length > 0) {
      errors.push(`${fieldName}.mode all_players cannot include restrictive fields.`);
    }
    return;
  }
  if (eligibility.minimumLevel !== undefined && !isBoundedInteger(eligibility.minimumLevel, MAX_LEVEL)) {
    errors.push(`${fieldName}.minimumLevel must be an integer from 0 to ${MAX_LEVEL}.`);
  }
  if (eligibility.maximumLevel !== undefined && !isBoundedInteger(eligibility.maximumLevel, MAX_LEVEL)) {
    errors.push(`${fieldName}.maximumLevel must be an integer from 0 to ${MAX_LEVEL}.`);
  }
  if (
    isBoundedInteger(eligibility.minimumLevel, MAX_LEVEL) &&
    isBoundedInteger(eligibility.maximumLevel, MAX_LEVEL) &&
    eligibility.minimumLevel > eligibility.maximumLevel
  ) {
    errors.push(`${fieldName}.minimumLevel must not exceed ${fieldName}.maximumLevel.`);
  }
  if (
    eligibility.minimumAccountAgeDays !== undefined &&
    !isBoundedInteger(eligibility.minimumAccountAgeDays, MAX_ACCOUNT_AGE_DAYS)
  ) {
    errors.push(`${fieldName}.minimumAccountAgeDays must be an integer from 0 to ${MAX_ACCOUNT_AGE_DAYS}.`);
  }
  if (
    eligibility.accountCreatedBefore !== undefined &&
    !normalizeIsoWithZone(eligibility.accountCreatedBefore)
  ) {
    errors.push(`${fieldName}.accountCreatedBefore must be an ISO timestamp with Z or an explicit offset.`);
  }
  if (
    eligibility.verifiedEmailRequired !== undefined &&
    typeof eligibility.verifiedEmailRequired !== "boolean"
  ) {
    errors.push(`${fieldName}.verifiedEmailRequired must be a boolean.`);
  }
}

export function evaluateEventChestEligibility(definition, { profile = null, account = null, nowMs = Date.now() } = {}) {
  const eligibility = normalizeEventChestEligibility(definition?.eligibility);
  if (eligibility.mode === "all_players") {
    return { eligible: true, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.ELIGIBLE };
  }
  const errors = [];
  validateEventChestEligibility(definition?.eligibility, errors);
  if (eligibility.mode !== "rules" || errors.length > 0) {
    return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.INVALID_DEFINITION };
  }

  const playerLevel = Math.max(0, Math.floor(Number(profile?.playerLevel ?? 0) || 0));
  if (Number.isInteger(eligibility.minimumLevel) && playerLevel < eligibility.minimumLevel) {
    return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.LEVEL_TOO_LOW };
  }
  if (Number.isInteger(eligibility.maximumLevel) && playerLevel > eligibility.maximumLevel) {
    return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.LEVEL_TOO_HIGH };
  }

  const needsAccountData =
    Number.isInteger(eligibility.minimumAccountAgeDays) ||
    Boolean(eligibility.accountCreatedBefore) ||
    eligibility.verifiedEmailRequired === true;
  if (needsAccountData && !isObject(account)) {
    return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.MISSING_ACCOUNT_DATA };
  }

  const createdAtMs = Date.parse(String(account?.createdAt ?? account?.accountCreatedAt ?? ""));
  if (Number.isInteger(eligibility.minimumAccountAgeDays)) {
    if (!Number.isFinite(createdAtMs)) {
      return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.MISSING_ACCOUNT_DATA };
    }
    const ageMs = Number(nowMs) - createdAtMs;
    if (!Number.isFinite(ageMs) || ageMs < eligibility.minimumAccountAgeDays * 24 * 60 * 60 * 1000) {
      return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.ACCOUNT_TOO_NEW };
    }
  }
  if (eligibility.accountCreatedBefore) {
    const cutoffMs = Date.parse(eligibility.accountCreatedBefore);
    if (!Number.isFinite(createdAtMs)) {
      return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.MISSING_ACCOUNT_DATA };
    }
    if (!(createdAtMs <= cutoffMs)) {
      return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.ACCOUNT_CREATED_TOO_LATE };
    }
  }
  if (eligibility.verifiedEmailRequired === true && account?.emailVerified !== true) {
    return { eligible: false, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.EMAIL_NOT_VERIFIED };
  }

  return { eligible: true, reasonCode: EVENT_CHEST_ELIGIBILITY_REASON_CODES.ELIGIBLE };
}
