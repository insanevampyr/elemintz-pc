const PENDING_REFERRAL_STORAGE_KEY = "elemintz.pendingReferralCode.v1";
const REFERRAL_CODE_PATTERN = /^ELM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const MAX_REFERRAL_INPUT_LENGTH = 2048;
const MAX_REFERRAL_VALUE_LENGTH = 32;

function resolveStorage(storage) {
  if (storage) {
    return storage;
  }

  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizePendingReferralCode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > MAX_REFERRAL_VALUE_LENGTH) {
    return null;
  }
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function extractPendingReferralCode(codeOrUrl) {
  if (typeof codeOrUrl !== "string") {
    return null;
  }

  const input = codeOrUrl.trim();
  if (!input || input.length > MAX_REFERRAL_INPUT_LENGTH) {
    return null;
  }

  const directCode = normalizePendingReferralCode(input);
  if (directCode) {
    return directCode;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(input, "https://vampyrlee.itch.io/elemintz");
  } catch {
    return null;
  }

  const referralValues = parsedUrl.searchParams.getAll("ref");
  if (referralValues.length !== 1) {
    return null;
  }
  return normalizePendingReferralCode(referralValues[0]);
}

export function getPendingReferralCode({ storage } = {}) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage || typeof targetStorage.getItem !== "function") {
    return null;
  }

  try {
    const rawValue = targetStorage.getItem(PENDING_REFERRAL_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsedValue = JSON.parse(rawValue);
    const code = normalizePendingReferralCode(parsedValue?.code);
    const capturedAt = String(parsedValue?.capturedAt ?? "").trim();
    const capturedAtMs = Date.parse(capturedAt);
    if (!code || !Number.isFinite(capturedAtMs) || parsedValue?.source !== "invite_link") {
      targetStorage.removeItem?.(PENDING_REFERRAL_STORAGE_KEY);
      return null;
    }
    return {
      code,
      capturedAt: new Date(capturedAtMs).toISOString(),
      source: "invite_link"
    };
  } catch {
    return null;
  }
}

export function capturePendingReferralCode(codeOrUrl, { storage, now = Date.now } = {}) {
  const code = extractPendingReferralCode(codeOrUrl);
  const targetStorage = resolveStorage(storage);
  if (!code || !targetStorage || typeof targetStorage.setItem !== "function") {
    return null;
  }

  let capturedAt;
  try {
    capturedAt = new Date(now()).toISOString();
  } catch {
    return null;
  }

  const pendingReferral = {
    code,
    capturedAt,
    source: "invite_link"
  };
  try {
    targetStorage.setItem(PENDING_REFERRAL_STORAGE_KEY, JSON.stringify(pendingReferral));
    return pendingReferral;
  } catch {
    return null;
  }
}

export function clearPendingReferralCode({ storage } = {}) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage || typeof targetStorage.removeItem !== "function") {
    return false;
  }

  try {
    targetStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

