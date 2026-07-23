import crypto from "node:crypto";

const HASH_PREFIX = "hmac-sha256$";
const MAX_USER_AGENT_LENGTH = 512;
const fallbackWarningLoggers = new WeakSet();

function warnAboutProcessLocalFallback(logger) {
  const safeLogger =
    logger && typeof logger === "object" && typeof logger.warn === "function"
      ? logger
      : console;
  if (fallbackWarningLoggers.has(safeLogger)) {
    return;
  }

  fallbackWarningLoggers.add(safeLogger);
  safeLogger.warn(
    "[Referral Abuse Signals] REFERRAL_ABUSE_SIGNAL_SALT is not set; using dev-only process-local fallback."
  );
}

function normalizeIpAddress(value) {
  let normalized = String(value ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice(7);
  }
  if (normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)) {
    return "loopback";
  }

  return normalized;
}

function normalizeUserAgent(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_USER_AGENT_LENGTH);
  return normalized || null;
}

export function createReferralAbuseSignalHasher({
  salt = process.env.REFERRAL_ABUSE_SIGNAL_SALT,
  fallbackSalt = crypto.randomBytes(32),
  logger = console
} = {}) {
  const configuredSalt = String(salt ?? "").trim();
  const secret = configuredSalt || Buffer.from(fallbackSalt).toString("hex");
  if (!configuredSalt) {
    warnAboutProcessLocalFallback(logger);
  }

  function hashValue(namespace, value) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }
    return `${HASH_PREFIX}${crypto
      .createHmac("sha256", secret)
      .update(`${namespace}:${normalized}`)
      .digest("hex")}`;
  }

  return {
    isPersistentlyConfigured: Boolean(configuredSalt),

    buildRequestSignals(socket, { targetIdentity = null } = {}) {
      const headers = socket?.handshake?.headers ?? {};
      const ipAddress = normalizeIpAddress(
        headers["x-forwarded-for"] ??
          socket?.handshake?.address ??
          socket?.request?.socket?.remoteAddress
      );
      const userAgent = normalizeUserAgent(headers["user-agent"]);

      return {
        ipHash: hashValue("ip", ipAddress),
        userAgentHash: hashValue("user-agent", userAgent),
        targetUsernameHashOrKey: hashValue(
          "referral-target",
          String(targetIdentity ?? "").trim().toLowerCase()
        )
      };
    }
  };
}

export const __private__ = {
  normalizeIpAddress,
  normalizeUserAgent
};
