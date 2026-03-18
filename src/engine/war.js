import { compareElements } from "./rules.js";
import { drawCard } from "./deck.js";

export const WAR_FACE_DOWN = 0;
export const WAR_REQUIRED_CARDS = WAR_FACE_DOWN + 1;

function drawWarCards(hand, count) {
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    const card = drawCard(hand);
    if (!card) {
      return null;
    }
    cards.push(card);
  }
  return cards;
}

function appendWarCardsToPile(pile, p1Cards, p2Cards) {
  const maxLength = Math.max(p1Cards.length, p2Cards.length);
  for (let i = 0; i < maxLength; i += 1) {
    if (i < p1Cards.length) {
      pile.push(p1Cards[i]);
    }
    if (i < p2Cards.length) {
      pile.push(p2Cards[i]);
    }
  }
}

export function resolveWar(state, startingPile = []) {
  const pile = [...startingPile];
  const pileSizes = [pile.length];
  let clashes = 0;

  while (true) {
    const p1CanContinue = state.players.p1.hand.length >= WAR_REQUIRED_CARDS;
    const p2CanContinue = state.players.p2.hand.length >= WAR_REQUIRED_CARDS;

    if (!p1CanContinue && !p2CanContinue) {
      return {
        winner: "draw",
        pile,
        clashes,
        pileSizes,
        returnPileOnDraw: true,
        reason: "war-insufficient-both"
      };
    }

    if (!p1CanContinue) {
      return { winner: "p2", pile, clashes, pileSizes, reason: "war-insufficient-p1" };
    }

    if (!p2CanContinue) {
      return { winner: "p1", pile, clashes, pileSizes, reason: "war-insufficient-p2" };
    }

    const p1Cards = drawWarCards(state.players.p1.hand, WAR_REQUIRED_CARDS);
    const p2Cards = drawWarCards(state.players.p2.hand, WAR_REQUIRED_CARDS);
    if (!p1Cards || !p2Cards) {
      // Defensive fallback; pre-checks above should prevent this path.
      return { winner: "draw", pile, clashes, pileSizes, returnPileOnDraw: true };
    }

    appendWarCardsToPile(pile, p1Cards, p2Cards);
    clashes += 1;
    pileSizes.push(pile.length);

    const p1Card = p1Cards[p1Cards.length - 1];
    const p2Card = p2Cards[p2Cards.length - 1];
    const result = compareElements(p1Card, p2Card);
    if (result === "p1" || result === "p2") {
      return { winner: result, pile, clashes, pileSizes };
    }
  }
}
