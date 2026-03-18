const ELEMENTS = Object.freeze(["fire", "earth", "wind", "water"]);

export const AI_DIFFICULTY = Object.freeze({
  EASY: "easy",
  NORMAL: "normal",
  HARD: "hard"
});

function randomIndex(hand, rng) {
  return Math.floor(rng() * hand.length);
}

function normalizeElement(card) {
  if (typeof card === "string") {
    return card.toLowerCase();
  }

  if (card && typeof card === "object" && typeof card.element === "string") {
    return card.element.toLowerCase();
  }

  return null;
}

function countElements(hand) {
  const counts = Object.fromEntries(ELEMENTS.map((element) => [element, 0]));

  for (const card of hand) {
    const element = normalizeElement(card);
    if (element && Object.hasOwn(counts, element)) {
      counts[element] += 1;
    }
  }

  return counts;
}

function buildPublicState(publicState = {}) {
  return {
    aiCardsRemaining: Math.max(0, Number(publicState.aiCardsRemaining ?? 0)),
    playerCardsRemaining: Math.max(0, Number(publicState.playerCardsRemaining ?? 0)),
    aiCaptured: Math.max(0, Number(publicState.aiCaptured ?? 0)),
    playerCaptured: Math.max(0, Number(publicState.playerCaptured ?? 0)),
    warActive: Boolean(publicState.warActive),
    pileCount: Math.max(0, Number(publicState.pileCount ?? 0)),
    totalWarClashes: Math.max(0, Number(publicState.totalWarClashes ?? 0))
  };
}

function scoreNormalChoice(element, counts, publicState, rng) {
  const duplicates = counts[element] ?? 0;
  const lowHand = publicState.aiCardsRemaining <= 3;
  const pressure = publicState.warActive || publicState.pileCount >= 4;
  let score = duplicates * 1.2;

  if (lowHand && duplicates === 1) {
    score -= 0.45;
  }

  if (pressure && duplicates === 1) {
    score -= 0.25;
  }

  if (publicState.aiCaptured < publicState.playerCaptured && duplicates > 1) {
    score += 0.35;
  }

  return score + rng() * 0.8;
}

function scoreHardChoice(element, counts, publicState, rng) {
  const duplicates = counts[element] ?? 0;
  const scoreDelta = publicState.aiCaptured - publicState.playerCaptured;
  const handDelta = publicState.aiCardsRemaining - publicState.playerCardsRemaining;
  const pressure = publicState.warActive || publicState.pileCount >= 4 || publicState.totalWarClashes >= 1;
  let score = duplicates * 1.8;

  if (duplicates === 1) {
    score -= 0.4;
  }

  if (publicState.aiCardsRemaining <= 3 && duplicates === 1) {
    score -= 0.8;
  }

  if (scoreDelta < 0 && duplicates > 1) {
    score += 0.8;
  }

  if (scoreDelta > 0 && handDelta >= 0 && duplicates === 1) {
    score -= 0.35;
  }

  if (pressure) {
    score += duplicates > 1 ? 0.7 : -0.35;
  }

  return score + rng() * 0.35;
}

export function chooseAiCardIndex(hand, context = {}) {
  if (!Array.isArray(hand) || hand.length === 0) {
    throw new Error("AI cannot pick from an empty hand.");
  }

  const {
    difficulty = AI_DIFFICULTY.NORMAL,
    publicState = {},
    rng = Math.random
  } = context;

  if (difficulty === AI_DIFFICULTY.EASY) {
    return randomIndex(hand, rng);
  }

  const counts = countElements(hand);
  const safePublicState = buildPublicState({
    ...publicState,
    aiCardsRemaining: publicState.aiCardsRemaining ?? hand.length
  });

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < hand.length; i += 1) {
    const element = normalizeElement(hand[i]);
    const score =
      difficulty === AI_DIFFICULTY.HARD
        ? scoreHardChoice(element, counts, safePublicState, rng)
        : scoreNormalChoice(element, counts, safePublicState, rng);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}
