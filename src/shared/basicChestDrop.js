const WIN_CHEST_DROP_CHANCE = 0.1;
const LOSS_CHEST_DROP_CHANCE = 0.02;
const DRAW_CHEST_DROP_CHANCE = 0.02;

function normalizeMode(mode) {
  return String(mode ?? "").trim().toLowerCase();
}

function normalizeOutcome(outcome) {
  return String(outcome ?? "").trim().toLowerCase();
}

export function getBasicChestDropChance(outcome, context = {}) {
  const mode = normalizeMode(context.mode);
  const difficulty = String(context.difficulty ?? "").trim().toLowerCase();
  const normalizedOutcome = normalizeOutcome(outcome);

  if (mode === "pve" && difficulty === "easy") {
    return 0;
  }

  if (normalizedOutcome === "win") {
    return WIN_CHEST_DROP_CHANCE;
  }

  if (normalizedOutcome === "loss" || normalizedOutcome === "draw") {
    return LOSS_CHEST_DROP_CHANCE;
  }

  return 0;
}

export function rollBasicChest(outcome, context = {}) {
  const chance = getBasicChestDropChance(outcome, context);
  if (chance <= 0) {
    return false;
  }

  const random = typeof context.random === "function" ? context.random : Math.random;
  return Number(random()) < chance;
}

export {
  WIN_CHEST_DROP_CHANCE,
  LOSS_CHEST_DROP_CHANCE,
  DRAW_CHEST_DROP_CHANCE
};
