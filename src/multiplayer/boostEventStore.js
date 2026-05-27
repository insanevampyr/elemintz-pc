import fs from "node:fs/promises";
import path from "node:path";
import {
  applyBoostEventToBaseMatchRewards,
  BOOST_EVENT_TARGET_KEYS,
  buildBoostEventTargetSummary,
  deriveBoostEventScopeLabel,
  doesBoostEventApplyToMatch,
  MATCH_REWARD_ROUNDING_MODE,
  resolveBoostEventTargets,
  roundBoostedRewardDelta
} from "../shared/boostEventRules.js";

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_SCOPE_LENGTH = 32;
const MAX_DIFFICULTY_LENGTH = 32;
const MAX_TARGET_SUMMARY_LENGTH = 240;
const MAX_MULTIPLIER = 10;
const MIN_MULTIPLIER = 1;
const ROUNDING_FACTOR = 1000;
const ALLOWED_SCOPES = new Set(["online", "all", "pve", "local_pvp", "custom"]);
const ALLOWED_DIFFICULTY_EXCLUSIONS = new Set(["easy"]);

class BoostEventValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BoostEventValidationError";
    this.code = code;
  }
}

function sanitizeText(value, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function stripUtf8Bom(value) {
  const source = String(value ?? "");
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function normalizeTimestamp(value) {
  if (value == null) {
    return null;
  }

  const normalized = sanitizeText(value, 64);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function normalizeMultiplier(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.round(numeric * ROUNDING_FACTOR) / ROUNDING_FACTOR;
  if (rounded < MIN_MULTIPLIER || rounded > MAX_MULTIPLIER) {
    return null;
  }

  return rounded;
}

function normalizeDifficultyExclusions(values) {
  const normalized = [];
  const seen = new Set();

  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = sanitizeText(rawValue, MAX_DIFFICULTY_LENGTH)?.toLowerCase() ?? null;
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    if (!ALLOWED_DIFFICULTY_EXCLUSIONS.has(value)) {
      return null;
    }

    normalized.push(value);
  }

  return normalized;
}

function normalizeBoostEvent(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  if (typeof entry.enabled !== "boolean") {
    return null;
  }

  if (
    typeof entry.title !== "string" ||
    typeof entry.message !== "string" ||
    (entry.scope != null && typeof entry.scope !== "string") ||
    (entry.startsAt != null && typeof entry.startsAt !== "string") ||
    (entry.endsAt != null && typeof entry.endsAt !== "string")
  ) {
    return null;
  }

  const title = sanitizeText(entry.title, MAX_TITLE_LENGTH);
  const message = sanitizeText(entry.message, MAX_MESSAGE_LENGTH);
  const rawScope =
    entry.scope == null ? null : sanitizeText(entry.scope, MAX_SCOPE_LENGTH)?.toLowerCase() ?? null;
  const startsAt = normalizeTimestamp(entry.startsAt);
  const endsAt = normalizeTimestamp(entry.endsAt);
  const excludeDifficulties = normalizeDifficultyExclusions(entry.excludeDifficulties);
  const xpMultiplier = normalizeMultiplier(entry.xpMultiplier);
  const tokenMultiplier = normalizeMultiplier(entry.tokenMultiplier);
  const explicitTargets =
    entry.targets == null
      ? null
      : entry.targets && typeof entry.targets === "object" && !Array.isArray(entry.targets)
        ? entry.targets
        : false;
  if (explicitTargets === false) {
    return null;
  }
  if (explicitTargets) {
    for (const [key, value] of Object.entries(explicitTargets)) {
      if (!BOOST_EVENT_TARGET_KEYS.includes(key) || typeof value !== "boolean") {
        return null;
      }
    }
  }
  if (entry.scope != null && (!rawScope || !ALLOWED_SCOPES.has(rawScope))) {
    return null;
  }
  const targets = resolveBoostEventTargets({
    scope: rawScope,
    excludeDifficulties,
    targets: explicitTargets
  });
  const scope = deriveBoostEventScopeLabel({
    scope: rawScope,
    excludeDifficulties,
    targets
  });
  const targetSummary = sanitizeText(
    buildBoostEventTargetSummary({
      scope: rawScope,
      excludeDifficulties,
      targets
    }),
    MAX_TARGET_SUMMARY_LENGTH
  );

  if (
    !title ||
    !message ||
    !scope ||
    !ALLOWED_SCOPES.has(scope) ||
    excludeDifficulties == null ||
    xpMultiplier == null ||
    tokenMultiplier == null ||
    !targets
  ) {
    return null;
  }

  if ((entry.startsAt != null && !startsAt) || (entry.endsAt != null && !endsAt)) {
    return null;
  }

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return null;
  }

  return {
    enabled: entry.enabled,
    title,
    message,
    startsAt,
    endsAt,
    scope,
    excludeDifficulties,
    targets,
    targetSummary,
    xpMultiplier,
    tokenMultiplier
  };
}

function assertBoostEventConfig(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_CONFIG_INVALID",
      "Boost event config must be an object."
    );
  }

  if (typeof entry.enabled !== "boolean") {
    throw new BoostEventValidationError(
      "BOOST_EVENT_ENABLED_INVALID",
      "enabled must be a boolean."
    );
  }

  if (typeof entry.title !== "string") {
    throw new BoostEventValidationError(
      "BOOST_EVENT_TITLE_INVALID",
      "title must be a string."
    );
  }

  const title = sanitizeText(entry.title, MAX_TITLE_LENGTH);
  if (!title) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_TITLE_INVALID",
      "title is required."
    );
  }

  if (typeof entry.message !== "string") {
    throw new BoostEventValidationError(
      "BOOST_EVENT_MESSAGE_INVALID",
      "message must be a string."
    );
  }

  const message = sanitizeText(entry.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_MESSAGE_INVALID",
      "message is required."
    );
  }

  const rawScope =
    entry.scope == null ? null : sanitizeText(entry.scope, MAX_SCOPE_LENGTH)?.toLowerCase() ?? null;
  if (entry.scope != null && (!rawScope || !ALLOWED_SCOPES.has(rawScope))) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_SCOPE_INVALID",
      "scope must be one of: online, all, pve, local_pvp, custom."
    );
  }

  if (entry.startsAt != null && typeof entry.startsAt !== "string") {
    throw new BoostEventValidationError(
      "BOOST_EVENT_START_INVALID",
      "startsAt must be a valid ISO datetime string or null."
    );
  }

  const startsAt = normalizeTimestamp(entry.startsAt);
  if (entry.startsAt != null && !startsAt) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_START_INVALID",
      "startsAt must be a valid ISO datetime string or null."
    );
  }

  if (entry.endsAt != null && typeof entry.endsAt !== "string") {
    throw new BoostEventValidationError(
      "BOOST_EVENT_END_INVALID",
      "endsAt must be a valid ISO datetime string or null."
    );
  }

  const endsAt = normalizeTimestamp(entry.endsAt);
  if (entry.endsAt != null && !endsAt) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_END_INVALID",
      "endsAt must be a valid ISO datetime string or null."
    );
  }

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_RANGE_INVALID",
      "endsAt must be after startsAt."
    );
  }

  const explicitTargets =
    entry.targets && typeof entry.targets === "object" && !Array.isArray(entry.targets)
      ? entry.targets
      : null;
  if (entry.targets != null && !explicitTargets) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_TARGETS_INVALID",
      "targets must be an object when provided."
    );
  }

  const excludeDifficultiesInput =
    entry.excludeDifficulties == null && explicitTargets
      ? []
      : entry.excludeDifficulties;

  if (!Array.isArray(excludeDifficultiesInput)) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_EXCLUDE_DIFFICULTIES_INVALID",
      "excludeDifficulties must be an array."
    );
  }

  const excludeDifficulties = normalizeDifficultyExclusions(excludeDifficultiesInput);
  if (excludeDifficulties == null) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_EXCLUDE_DIFFICULTIES_INVALID",
      "excludeDifficulties may only contain supported values such as easy."
    );
  }

  const xpMultiplier = normalizeMultiplier(entry.xpMultiplier);
  if (xpMultiplier == null) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_XP_MULTIPLIER_INVALID",
      "xpMultiplier must be a finite number between 1 and 10."
    );
  }

  const tokenMultiplier = normalizeMultiplier(entry.tokenMultiplier);
  if (tokenMultiplier == null) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_TOKEN_MULTIPLIER_INVALID",
      "tokenMultiplier must be a finite number between 1 and 10."
    );
  }

  if (explicitTargets) {
    const keys = Object.keys(explicitTargets);
    for (const key of keys) {
      if (!BOOST_EVENT_TARGET_KEYS.includes(key) || typeof explicitTargets[key] !== "boolean") {
        throw new BoostEventValidationError(
          "BOOST_EVENT_TARGETS_INVALID",
          "targets must only contain supported boolean mode target flags."
        );
      }
    }
  }

  const targets = resolveBoostEventTargets({
    scope: rawScope,
    excludeDifficulties,
    targets: explicitTargets
  });
  if (!targets) {
    throw new BoostEventValidationError(
      "BOOST_EVENT_TARGETS_INVALID",
      "targets could not be resolved from the provided scope/target configuration."
    );
  }

  const scope = deriveBoostEventScopeLabel({
    scope: rawScope,
    excludeDifficulties,
    targets
  });
  const targetSummary = sanitizeText(
    buildBoostEventTargetSummary({
      scope: rawScope,
      excludeDifficulties,
      targets
    }),
    MAX_TARGET_SUMMARY_LENGTH
  );

  return {
    enabled: entry.enabled,
    title,
    message,
    startsAt,
    endsAt,
    scope,
    excludeDifficulties,
    targets,
    targetSummary,
    xpMultiplier,
    tokenMultiplier
  };
}

function isBoostEventActive(eventConfig, nowMs) {
  if (!eventConfig?.enabled) {
    return false;
  }

  const startsAtMs = eventConfig.startsAt ? Date.parse(eventConfig.startsAt) : null;
  if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) {
    return false;
  }

  const endsAtMs = eventConfig.endsAt ? Date.parse(eventConfig.endsAt) : null;
  if (Number.isFinite(endsAtMs) && endsAtMs <= nowMs) {
    return false;
  }

  return true;
}

export class BoostEventStore {
  constructor({ dataDir, logger = console } = {}) {
    if (!dataDir) {
      throw new Error("dataDir is required for BoostEventStore.");
    }

    this.dataDir = dataDir;
    this.logger = logger;
    this.filePath = path.join(dataDir, "server-data", "boost-event.json");
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, "{}\n", "utf8");
    }
  }

  async readConfig() {
    await this.ensureFile();

    let source = "{}";
    try {
      source = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      this.logger.warn?.("[BoostEvent] read failed; returning null config", {
        message: error?.message ?? String(error)
      });
      return null;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(stripUtf8Bom(source));
    } catch (error) {
      this.logger.warn?.("[BoostEvent] invalid boost-event.json; returning null config", {
        message: error?.message ?? String(error),
        filePath: this.filePath
      });
      return null;
    }

    const normalized = normalizeBoostEvent(parsed);
    if (!normalized) {
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
        return null;
      }

      this.logger.warn?.("[BoostEvent] boost-event.json failed validation; returning null config", {
        filePath: this.filePath
      });
      return null;
    }

    return normalized;
  }

  async getActiveEvent({ now = new Date() } = {}) {
    const config = await this.readConfig();
    if (!config) {
      return null;
    }

    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (!isBoostEventActive(config, safeNowMs)) {
      return null;
    }

    return {
      ...config,
      excludeDifficulties: [...config.excludeDifficulties],
      targets: { ...config.targets }
    };
  }

  async upsertConfig(input) {
    const config = assertBoostEventConfig(input);
    await this.ensureFile();
    await fs.writeFile(this.filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }

  async clearConfig() {
    await this.ensureFile();
    await fs.writeFile(this.filePath, "{}\n", "utf8");
    return null;
  }
}

export { MATCH_REWARD_ROUNDING_MODE };
