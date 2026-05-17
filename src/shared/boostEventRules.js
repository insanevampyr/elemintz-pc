const MATCH_REWARD_ROUNDING_MODE = "floor_integer";

function normalizeMatchMode(mode) {
  const safeMode = String(mode ?? "").trim().toLowerCase();
  if (safeMode === "online_pvp") {
    return "online";
  }

  if (safeMode === "pve" || safeMode === "local_pvp") {
    return safeMode;
  }

  return null;
}

function isExcludedDifficulty(boostEvent, matchState) {
  const safeMode = normalizeMatchMode(matchState?.mode);
  if (safeMode !== "pve") {
    return false;
  }

  const difficulty = String(matchState?.difficulty ?? "").trim().toLowerCase();
  return boostEvent?.excludeDifficulties?.includes(difficulty) ?? false;
}

export function roundBoostedRewardDelta(amount) {
  const safeAmount = Math.max(0, Number(amount ?? 0) || 0);
  return Math.max(0, Math.floor(safeAmount));
}

export function doesBoostEventApplyToMatch({ boostEvent, matchState } = {}) {
  if (!boostEvent?.enabled) {
    return false;
  }

  const mode = normalizeMatchMode(matchState?.mode);
  if (!mode) {
    return false;
  }

  if (boostEvent.scope !== "all" && boostEvent.scope !== mode) {
    return false;
  }

  if (isExcludedDifficulty(boostEvent, matchState)) {
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

export { MATCH_REWARD_ROUNDING_MODE };
