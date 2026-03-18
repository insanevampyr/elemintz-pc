import { ELEMENTS } from "./rules.js";

export const DEFAULT_CARDS_PER_ELEMENT = 13;

export function createDeck(cardsPerElement = DEFAULT_CARDS_PER_ELEMENT) {
  if (!Number.isInteger(cardsPerElement) || cardsPerElement <= 0) {
    throw new Error("cardsPerElement must be a positive integer.");
  }

  const deck = [];
  for (const element of ELEMENTS) {
    for (let i = 0; i < cardsPerElement; i += 1) {
      deck.push(element);
    }
  }
  return deck;
}

export function shuffleDeck(cards, rng = Math.random) {
  const deck = [...cards];

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

export function splitDeck(deck) {
  if (deck.length % 2 !== 0) {
    throw new Error("Deck length must be even to split between two players.");
  }

  const half = deck.length / 2;
  return {
    p1: deck.slice(0, half),
    p2: deck.slice(half)
  };
}

export function drawCard(hand) {
  return hand.shift();
}

export function collectCards(hand, cards) {
  hand.push(...cards);
}
