import test from "node:test";
import assert from "node:assert/strict";
import { AI_DIFFICULTY, chooseAiCardIndex } from "../../src/engine/ai.js";

test("ai: easy returns valid random index", () => {
  const hand = ["earth", "water", "fire"];
  const index = chooseAiCardIndex(hand, {
    difficulty: AI_DIFFICULTY.EASY,
    rng: () => 0.8
  });

  assert.equal(index, 2);
});

test("ai: normal picks a valid card using only fair public state", () => {
  const hand = ["earth", "water", "fire"];
  const index = chooseAiCardIndex(hand, {
    difficulty: AI_DIFFICULTY.NORMAL,
    publicState: {
      aiCardsRemaining: 3,
      playerCardsRemaining: 4,
      aiCaptured: 0,
      playerCaptured: 2,
      warActive: false,
      pileCount: 0
    },
    rng: () => 0.1
  });

  assert.ok(index >= 0 && index < hand.length);
});

test("ai: hard does not depend on the player's hidden current-round choice", () => {
  const hand = ["fire", "fire", "wind"];
  const baseContext = {
    difficulty: AI_DIFFICULTY.HARD,
    publicState: {
      aiCardsRemaining: 3,
      playerCardsRemaining: 3,
      aiCaptured: 1,
      playerCaptured: 3,
      warActive: true,
      pileCount: 4,
      totalWarClashes: 1
    },
    rng: () => 0.2
  };

  const withHiddenFire = chooseAiCardIndex(hand, {
    ...baseContext,
    opponentLikelyCard: "fire",
    playerSelectedCard: "fire"
  });
  const withHiddenWater = chooseAiCardIndex(hand, {
    ...baseContext,
    opponentLikelyCard: "water",
    playerSelectedCard: "water"
  });

  assert.equal(withHiddenFire, withHiddenWater);
});
