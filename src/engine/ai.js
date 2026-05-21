import { compareElements, ELEMENTS } from "./rules.js";
import { resolveGauntletRivalById } from "./gauntletRivals.js";

export const AI_DIFFICULTY = Object.freeze({
  EASY: "easy",
  NORMAL: "normal",
  HARD: "hard"
});

function randomIndex(hand, rng) {
  return Math.floor(rng() * hand.length);
}

function buildAvailableElementEntries(hand) {
  return hand
    .map((card, index) => ({
      index,
      element: normalizeElement(card)
    }))
    .filter((entry) => entry.element && ELEMENTS.includes(entry.element));
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

function normalizeElementCounts(countsInput = {}) {
  const counts = Object.fromEntries(ELEMENTS.map((element) => [element, 0]));

  for (const element of ELEMENTS) {
    counts[element] = Math.max(0, Number(countsInput?.[element] ?? 0));
  }

  return counts;
}

function normalizeRecentPlayerMoves(movesInput = []) {
  if (!Array.isArray(movesInput)) {
    return [];
  }

  return movesInput
    .map((move) => normalizeElement(move))
    .filter((move) => move !== null)
    .slice(-6);
}

function buildPublicState(publicState = {}) {
  return {
    aiCardsRemaining: Math.max(0, Number(publicState.aiCardsRemaining ?? 0)),
    playerCardsRemaining: Math.max(0, Number(publicState.playerCardsRemaining ?? 0)),
    aiCaptured: Math.max(0, Number(publicState.aiCaptured ?? 0)),
    playerCaptured: Math.max(0, Number(publicState.playerCaptured ?? 0)),
    warActive: Boolean(publicState.warActive),
    pileCount: Math.max(0, Number(publicState.pileCount ?? 0)),
    totalWarClashes: Math.max(0, Number(publicState.totalWarClashes ?? 0)),
    playerElementCounts: normalizeElementCounts(publicState.playerElementCounts),
    recentPlayerMoves: normalizeRecentPlayerMoves(publicState.recentPlayerMoves)
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

function scoreHardBaseChoice(element, counts, publicState) {
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

  return score;
}

function estimateLikelyPlayerElements(publicState) {
  const weights = normalizeElementCounts(publicState.playerElementCounts);
  const recentMoves = normalizeRecentPlayerMoves(publicState.recentPlayerMoves);
  const recentBonuses = [0.9, 0.65, 0.45, 0.3];

  for (let index = 0; index < recentBonuses.length; index += 1) {
    const move = recentMoves.at(-(index + 1));
    if (!move) {
      break;
    }

    weights[move] += recentBonuses[index];
  }

  return ELEMENTS
    .map((element) => ({
      element,
      weight: weights[element] ?? 0
    }))
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => right.weight - left.weight);
}

function scoreHardAiCard(element, counts, publicState) {
  const pressure = publicState.warActive || publicState.pileCount >= 4 || publicState.totalWarClashes >= 1;
  const likelyPlayerElements = estimateLikelyPlayerElements(publicState);
  let score = scoreHardBaseChoice(element, counts, publicState);
  let hasProjectedWin = false;

  for (const candidate of likelyPlayerElements) {
    const outcome = compareElements(element, candidate.element);

    if (outcome === "p1") {
      hasProjectedWin = true;
      score += (pressure ? 3.6 : 2.35) * candidate.weight;
      continue;
    }

    if (outcome === "p2") {
      score -= (pressure ? 4.1 : 2.5) * candidate.weight;
      continue;
    }

    if (outcome === "tie") {
      score -= (pressure ? 0.95 : 0.25) * candidate.weight;
      continue;
    }

    score -= (pressure ? 0.45 : 0.12) * candidate.weight;
  }

  if (pressure && hasProjectedWin && (counts[element] ?? 0) === 1) {
    score += 0.4;
  }

  return score;
}

function chooseWeightedHardCard(scoreEntries, rng) {
  const sortedEntries = [...scoreEntries].sort((left, right) => right.score - left.score);
  const bestScore = sortedEntries[0]?.score ?? Number.NEGATIVE_INFINITY;
  const viableEntries = sortedEntries.filter((entry) => entry.score >= bestScore - 1.25);
  const weights = viableEntries.map((entry) => ({
    index: entry.index,
    weight: Math.max(0.05, entry.score - (bestScore - 1.25) + 0.15)
  }));
  const totalWeight = weights.reduce((total, entry) => total + entry.weight, 0);
  let remaining = rng() * totalWeight;

  for (const entry of weights) {
    remaining -= entry.weight;
    if (remaining <= 0) {
      return entry.index;
    }
  }

  return weights.at(-1)?.index ?? sortedEntries[0]?.index ?? 0;
}

function chooseWeightedElementIndex(availableEntries, weightsConfig = {}, rng = Math.random) {
  if (!Array.isArray(availableEntries) || availableEntries.length === 0) {
    return null;
  }

  const entriesByElement = new Map();
  for (const entry of availableEntries) {
    if (!entriesByElement.has(entry.element)) {
      entriesByElement.set(entry.element, []);
    }
    entriesByElement.get(entry.element).push(entry.index);
  }

  const weightedElements = [];
  for (const [element, indexes] of entriesByElement.entries()) {
    const configuredWeight = Math.max(0, Number(weightsConfig?.[element] ?? 0));
    weightedElements.push({
      element,
      indexes,
      weight: configuredWeight
    });
  }

  const totalWeight = weightedElements.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return availableEntries[0]?.index ?? null;
  }

  let remaining = rng() * totalWeight;
  for (const entry of weightedElements) {
    remaining -= entry.weight;
    if (remaining <= 0) {
      return entry.indexes[0] ?? availableEntries[0]?.index ?? null;
    }
  }

  return weightedElements.at(-1)?.indexes?.[0] ?? availableEntries[0]?.index ?? null;
}

function chooseLoopElementIndex(availableEntries, loop = [], turnIndex = 0) {
  if (!Array.isArray(availableEntries) || availableEntries.length === 0) {
    return null;
  }

  if (!Array.isArray(loop) || loop.length === 0) {
    return availableEntries[0]?.index ?? null;
  }

  const normalizedTurnIndex = Number.isFinite(Number(turnIndex))
    ? Math.max(0, Math.floor(Number(turnIndex)))
    : 0;
  const startIndex = normalizedTurnIndex % loop.length;

  for (let offset = 0; offset < loop.length; offset += 1) {
    const loopElement = normalizeElement(loop[(startIndex + offset) % loop.length]);
    const matchingEntry = availableEntries.find((entry) => entry.element === loopElement);
    if (matchingEntry) {
      return matchingEntry.index;
    }
  }

  return availableEntries[0]?.index ?? null;
}

export function chooseGauntletRivalCardIndex(hand, context = {}) {
  if (!Array.isArray(hand) || hand.length === 0) {
    return null;
  }

  const {
    rivalId = null,
    rival = null,
    turnIndex = 0,
    rng = Math.random
  } = context;
  const availableEntries = buildAvailableElementEntries(hand);
  if (availableEntries.length === 0) {
    return 0;
  }

  const resolvedRival = rival ?? resolveGauntletRivalById(rivalId);
  if (!resolvedRival) {
    return availableEntries[0]?.index ?? 0;
  }

  if (resolvedRival.behaviorType === "weighted") {
    return chooseWeightedElementIndex(availableEntries, resolvedRival.weights, rng);
  }

  if (resolvedRival.behaviorType === "loop") {
    return chooseLoopElementIndex(availableEntries, resolvedRival.loop, turnIndex);
  }

  return availableEntries[0]?.index ?? 0;
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

  if (difficulty === AI_DIFFICULTY.HARD) {
    const hardCounts = countElements(hand);
    const scoreEntries = hand.map((card, index) => ({
      index,
      score: scoreHardAiCard(normalizeElement(card), hardCounts, safePublicState)
    }));

    return chooseWeightedHardCard(scoreEntries, rng);
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < hand.length; i += 1) {
    const element = normalizeElement(hand[i]);
    const score =
      scoreNormalChoice(element, counts, safePublicState, rng);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}
