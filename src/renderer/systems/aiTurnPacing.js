export const AI_TURN_PACING_PROFILES = Object.freeze({
  FORCED: Object.freeze({
    key: "forced",
    minMs: 0,
    maxMs: 100,
    longThinkChance: 0,
    longThinkMaxMs: 100
  }),
  NORMAL: Object.freeze({
    key: "normal",
    minMs: 450,
    maxMs: 900,
    longThinkChance: 0.05,
    longThinkMaxMs: 1800
  }),
  HARD: Object.freeze({
    key: "hard",
    minMs: 700,
    maxMs: 1400,
    longThinkChance: 0.05,
    longThinkMaxMs: 1800
  })
});

function clampUnitRandom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(0.999999, Math.max(0, numeric));
}

function randomBetweenInclusive(minMs, maxMs, rng) {
  const min = Math.max(0, Math.floor(Number(minMs ?? 0) || 0));
  const max = Math.max(min, Math.floor(Number(maxMs ?? min) || min));
  const roll = clampUnitRandom(typeof rng === "function" ? rng() : Math.random());
  return min + Math.floor(roll * (max - min + 1));
}

export function resolveAiTurnPacingProfile({
  legalChoiceCount = 0,
  aiDifficulty = "normal",
  trainingMode = false,
  gauntletMode = false,
  featuredRivalId = null
} = {}) {
  const legalChoices = Math.max(0, Math.floor(Number(legalChoiceCount ?? 0) || 0));
  if (legalChoices <= 0) {
    return null;
  }

  if (legalChoices === 1) {
    return AI_TURN_PACING_PROFILES.FORCED;
  }

  if (trainingMode) {
    return AI_TURN_PACING_PROFILES.NORMAL;
  }

  if (gauntletMode || String(featuredRivalId ?? "").trim()) {
    return AI_TURN_PACING_PROFILES.HARD;
  }

  return String(aiDifficulty ?? "").trim().toLowerCase() === "hard"
    ? AI_TURN_PACING_PROFILES.HARD
    : AI_TURN_PACING_PROFILES.NORMAL;
}

export function calculateAiTurnPacingDelayMs(profile, { rng = Math.random } = {}) {
  if (!profile) {
    return 0;
  }

  const baseDelay = randomBetweenInclusive(profile.minMs, profile.maxMs, rng);
  const longThinkChance = Math.max(0, Number(profile.longThinkChance ?? 0) || 0);
  if (longThinkChance <= 0) {
    return baseDelay;
  }

  const longThinkRoll = clampUnitRandom(typeof rng === "function" ? rng() : Math.random());
  if (longThinkRoll >= longThinkChance) {
    return baseDelay;
  }

  return randomBetweenInclusive(baseDelay, profile.longThinkMaxMs ?? baseDelay, rng);
}
