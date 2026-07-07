import { ELEMENTS, elementThatBeats } from "./rules.js";
import { WAR_REQUIRED_CARDS } from "./war.js";

export const TRAINING_OPPONENT_PERSONALITIES = Object.freeze({
  REPEATER: "repeater",
  COUNTERER: "counterer",
  SURVIVOR: "survivor"
});

function normalizeElementMove(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ELEMENTS.includes(normalized) ? normalized : null;
}

export function normalizeTrainingOpponentPersonality(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return Object.values(TRAINING_OPPONENT_PERSONALITIES).includes(normalized)
    ? normalized
    : TRAINING_OPPONENT_PERSONALITIES.REPEATER;
}

export function buildLegalTrainingOpponentOptions(hand = [], blockedElement = null) {
  const normalizedBlockedElement = normalizeElementMove(blockedElement);
  return (Array.isArray(hand) ? hand : [])
    .map((card, index) => ({ card: normalizeElementMove(card), index }))
    .filter(({ card }) => card && card !== normalizedBlockedElement);
}

function chooseFirstLegalOptionByElement(legalOptions = [], element) {
  const normalizedElement = normalizeElementMove(element);
  if (!normalizedElement) {
    return null;
  }

  return legalOptions.find((option) => option.card === normalizedElement) ?? null;
}

export function chooseTrainingOpponentCardIndex({
  personality = TRAINING_OPPONENT_PERSONALITIES.REPEATER,
  legalOptions = [],
  recentPlayerMoves = [],
  recentOpponentMoves = [],
  publicState = {}
} = {}) {
  if (!Array.isArray(legalOptions) || legalOptions.length === 0) {
    return null;
  }

  const normalizedPersonality = normalizeTrainingOpponentPersonality(personality);
  const lastOpponentMove = normalizeElementMove(recentOpponentMoves.at(-1));
  const lastPlayerMove = normalizeElementMove(recentPlayerMoves.at(-1));

  if (normalizedPersonality === TRAINING_OPPONENT_PERSONALITIES.REPEATER) {
    const repeatedOption = chooseFirstLegalOptionByElement(legalOptions, lastOpponentMove);
    if (repeatedOption) {
      return repeatedOption.index;
    }
  }

  if (normalizedPersonality === TRAINING_OPPONENT_PERSONALITIES.COUNTERER && lastPlayerMove) {
    const counterOption = chooseFirstLegalOptionByElement(legalOptions, elementThatBeats(lastPlayerMove));
    if (counterOption) {
      return counterOption.index;
    }
  }

  if (normalizedPersonality === TRAINING_OPPONENT_PERSONALITIES.SURVIVOR) {
    const warPressure =
      Boolean(publicState?.warActive) ||
      Number(publicState?.aiCardsRemaining ?? legalOptions.length) <= WAR_REQUIRED_CARDS ||
      Number(publicState?.playerCardsRemaining ?? 0) <= WAR_REQUIRED_CARDS;
    if (warPressure && lastPlayerMove) {
      const lowerTieRiskOption = legalOptions.find((option) => option.card !== lastPlayerMove);
      if (lowerTieRiskOption) {
        return lowerTieRiskOption.index;
      }
    }
  }

  return legalOptions[0]?.index ?? null;
}
