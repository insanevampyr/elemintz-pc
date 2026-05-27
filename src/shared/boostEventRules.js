const MATCH_REWARD_ROUNDING_MODE = "floor_integer";

const BOOST_EVENT_TARGET_KEYS = Object.freeze([
  "pve_normal",
  "pve_hard",
  "pve_easy",
  "featured_rival_base",
  "gauntlet_base",
  "online_pvp",
  "local_pvp_casual"
]);

const EMPTY_BOOST_EVENT_TARGETS = Object.freeze(
  Object.fromEntries(BOOST_EVENT_TARGET_KEYS.map((key) => [key, false]))
);

function cloneEmptyBoostTargets() {
  return {
    ...EMPTY_BOOST_EVENT_TARGETS
  };
}

function normalizeMatchMode(mode) {
  const safeMode = String(mode ?? "").trim().toLowerCase();
  if (safeMode === "online_pvp" || safeMode === "online") {
    return "online_pvp";
  }

  if (
    safeMode === "pve" ||
    safeMode === "local_pvp" ||
    safeMode === "featured_rival" ||
    safeMode === "gauntlet"
  ) {
    return safeMode;
  }

  return null;
}

function normalizeDifficultyExclusions(values) {
  const excluded = new Set();
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = String(rawValue ?? "").trim().toLowerCase();
    if (value) {
      excluded.add(value);
    }
  }
  return excluded;
}

function normalizeBoostEventTargetsObject(targets) {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    return null;
  }

  const normalized = cloneEmptyBoostTargets();
  for (const [key, value] of Object.entries(targets)) {
    if (!BOOST_EVENT_TARGET_KEYS.includes(key) || typeof value !== "boolean") {
      return null;
    }
    normalized[key] = value;
  }

  return normalized;
}

function buildLegacyScopeTargets(boostEvent = {}) {
  const scope = String(boostEvent?.scope ?? "").trim().toLowerCase();
  const excludeDifficulties = normalizeDifficultyExclusions(boostEvent?.excludeDifficulties);
  const normalized = cloneEmptyBoostTargets();
  const easyIncluded = !excludeDifficulties.has("easy");

  switch (scope) {
    case "online":
      normalized.online_pvp = true;
      break;
    case "local_pvp":
      normalized.local_pvp_casual = true;
      break;
    case "pve":
      normalized.pve_normal = true;
      normalized.pve_hard = true;
      normalized.pve_easy = easyIncluded;
      normalized.featured_rival_base = true;
      normalized.gauntlet_base = true;
      break;
    case "all":
      normalized.pve_normal = true;
      normalized.pve_hard = true;
      normalized.pve_easy = easyIncluded;
      normalized.featured_rival_base = true;
      normalized.gauntlet_base = true;
      normalized.online_pvp = true;
      break;
    default:
      break;
  }

  return normalized;
}

export function resolveBoostEventTargets(boostEvent = {}) {
  const normalizedTargets = normalizeBoostEventTargetsObject(boostEvent?.targets);
  if (normalizedTargets) {
    return normalizedTargets;
  }

  return buildLegacyScopeTargets(boostEvent);
}

export function inferBoostEventRewardTarget(matchState = {}) {
  const mode = normalizeMatchMode(matchState?.mode);
  if (mode === "online_pvp") {
    return "online_pvp";
  }
  if (mode === "local_pvp") {
    return "local_pvp_casual";
  }
  if (mode === "featured_rival") {
    return "featured_rival_base";
  }
  if (mode === "gauntlet") {
    return "gauntlet_base";
  }
  if (mode !== "pve") {
    return null;
  }

  const featuredRivalId = String(matchState?.featuredRivalId ?? "").trim().toLowerCase();
  if (featuredRivalId) {
    return "featured_rival_base";
  }

  if (matchState?.gauntletMode === true) {
    return "gauntlet_base";
  }

  const difficulty = String(matchState?.difficulty ?? "").trim().toLowerCase();
  if (difficulty === "easy") {
    return "pve_easy";
  }
  if (difficulty === "hard") {
    return "pve_hard";
  }
  return "pve_normal";
}

export function deriveBoostEventScopeLabel(boostEvent = {}) {
  const targets = resolveBoostEventTargets(boostEvent);
  const enabled = BOOST_EVENT_TARGET_KEYS.filter((key) => targets[key]);

  if (
    enabled.length === 1 &&
    enabled[0] === "online_pvp"
  ) {
    return "online";
  }

  if (
    enabled.length === 1 &&
    enabled[0] === "local_pvp_casual"
  ) {
    return "local_pvp";
  }

  const legacyPveOnly =
    targets.pve_normal === true &&
    targets.pve_hard === true &&
    targets.featured_rival_base === true &&
    targets.gauntlet_base === true &&
    targets.online_pvp === false &&
    targets.local_pvp_casual === false;
  if (legacyPveOnly) {
    return "pve";
  }

  const standardAll =
    targets.pve_normal === true &&
    targets.pve_hard === true &&
    targets.featured_rival_base === true &&
    targets.gauntlet_base === true &&
    targets.online_pvp === true &&
    targets.local_pvp_casual === false;
  if (standardAll) {
    return "all";
  }

  return "custom";
}

export function buildBoostEventTargetSummary(boostEvent = {}) {
  const targets = resolveBoostEventTargets(boostEvent);
  const labels = [];

  if (targets.pve_normal) {
    labels.push("Normal AI");
  }
  if (targets.pve_hard) {
    labels.push("Hard AI");
  }
  if (targets.pve_easy) {
    labels.push("Easy AI");
  }
  if (targets.featured_rival_base) {
    labels.push("Featured Rival");
  }
  if (targets.gauntlet_base) {
    labels.push("Gauntlet");
  }
  if (targets.online_pvp) {
    labels.push("Online PvP");
  }
  if (targets.local_pvp_casual) {
    labels.push("Local 2-Player");
  }

  return labels.join(", ");
}

export function roundBoostedRewardDelta(amount) {
  const safeAmount = Math.max(0, Number(amount ?? 0) || 0);
  return Math.max(0, Math.floor(safeAmount));
}

export function doesBoostEventApplyToMatch({ boostEvent, matchState } = {}) {
  if (!boostEvent?.enabled) {
    return false;
  }

  const rewardTarget = inferBoostEventRewardTarget(matchState);
  if (!rewardTarget) {
    return false;
  }

  const targets = resolveBoostEventTargets(boostEvent);
  if (!targets[rewardTarget]) {
    return false;
  }

  return true;
}

export function applyBoostEventToBaseMatchRewards({
  boostEvent,
  matchState,
  xp = 0,
  tokens = 0
} = {}) {
  const baseXp = Math.max(0, Number(xp ?? 0) || 0);
  const baseTokens = Math.max(0, Number(tokens ?? 0) || 0);

  if (!doesBoostEventApplyToMatch({ boostEvent, matchState })) {
    return {
      xp: roundBoostedRewardDelta(baseXp),
      tokens: roundBoostedRewardDelta(baseTokens),
      applied: false,
      xpBonus: 0,
      tokenBonus: 0,
      display: null
    };
  }

  const baseRoundedXp = roundBoostedRewardDelta(baseXp);
  const baseRoundedTokens = roundBoostedRewardDelta(baseTokens);
  const boostedXp = Math.max(
    baseRoundedXp,
    roundBoostedRewardDelta(baseXp * Number(boostEvent.xpMultiplier ?? 1))
  );
  const boostedTokens = Math.max(
    baseRoundedTokens,
    roundBoostedRewardDelta(baseTokens * Number(boostEvent.tokenMultiplier ?? 1))
  );

  const xpApplied = boostedXp !== baseRoundedXp;
  const tokenApplied = boostedTokens !== baseRoundedTokens;
  const applied = xpApplied || tokenApplied;

  return {
    xp: boostedXp,
    tokens: boostedTokens,
    applied,
    xpBonus: Math.max(0, boostedXp - baseRoundedXp),
    tokenBonus: Math.max(0, boostedTokens - baseRoundedTokens),
    display: applied
      ? {
          xpApplied,
          tokenApplied,
          xpMultiplier: Number(boostEvent?.xpMultiplier ?? 1),
          tokenMultiplier: Number(boostEvent?.tokenMultiplier ?? 1)
        }
      : null
  };
}

export { BOOST_EVENT_TARGET_KEYS, MATCH_REWARD_ROUNDING_MODE };
