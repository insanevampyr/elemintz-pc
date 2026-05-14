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

test("ai: normal remains stable when hard-only predictive context is present", () => {
  const hand = ["earth", "earth", "fire"];
  const baseContext = {
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
  };

  const withoutPredictiveState = chooseAiCardIndex(hand, baseContext);
  const withPredictiveState = chooseAiCardIndex(hand, {
    ...baseContext,
    publicState: {
      ...baseContext.publicState,
      playerElementCounts: {
        fire: 3,
        water: 0,
        earth: 1,
        wind: 0
      },
      recentPlayerMoves: ["fire", "fire", "earth"]
    }
  });

  assert.equal(withPredictiveState, withoutPredictiveState);
});

test("ai: hard favors the counter to the player's most common visible remaining element", () => {
  const hand = ["earth", "water", "wind"];
  const index = chooseAiCardIndex(hand, {
    difficulty: AI_DIFFICULTY.HARD,
    publicState: {
      aiCardsRemaining: 3,
      playerCardsRemaining: 4,
      playerElementCounts: {
        fire: 3,
        water: 0,
        earth: 1,
        wind: 0
      },
      recentPlayerMoves: ["fire", "earth"],
      aiCaptured: 0,
      playerCaptured: 1,
      warActive: false,
      pileCount: 0,
      totalWarClashes: 0
    },
    rng: () => 0
  });

  assert.equal(index, 1);
});

test("ai: hard avoids a likely losing card when a better legal option exists", () => {
  const hand = ["earth", "water"];
  const index = chooseAiCardIndex(hand, {
    difficulty: AI_DIFFICULTY.HARD,
    publicState: {
      aiCardsRemaining: 2,
      playerCardsRemaining: 4,
      playerElementCounts: {
        fire: 4,
        water: 0,
        earth: 0,
        wind: 0
      },
      recentPlayerMoves: ["fire", "fire"],
      aiCaptured: 1,
      playerCaptured: 2,
      warActive: false,
      pileCount: 0,
      totalWarClashes: 0
    },
    rng: () => 0
  });

  assert.equal(index, 1);
});

test("ai: hard uses WAR pressure to prefer the safer non-losing card", () => {
  const hand = ["water", "water", "wind"];
  const index = chooseAiCardIndex(hand, {
    difficulty: AI_DIFFICULTY.HARD,
    publicState: {
      aiCardsRemaining: 3,
      playerCardsRemaining: 4,
      playerElementCounts: {
        fire: 0,
        water: 4,
        earth: 0,
        wind: 0
      },
      recentPlayerMoves: ["water", "water", "water"],
      aiCaptured: 1,
      playerCaptured: 3,
      warActive: true,
      pileCount: 6,
      totalWarClashes: 2
    },
    rng: () => 0
  });

  assert.equal(index, 2);
});

test("ai: hard only returns a legal index and does not mutate public state or hand", () => {
  const hand = ["fire", "water", "earth"];
  const publicState = {
    aiCardsRemaining: 3,
    playerCardsRemaining: 4,
    playerElementCounts: {
      fire: 1,
      water: 2,
      earth: 1,
      wind: 0
    },
    recentPlayerMoves: ["water", "earth"],
    aiCaptured: 0,
    playerCaptured: 0,
    warActive: false,
    pileCount: 0,
    totalWarClashes: 0
  };
  const handBefore = [...hand];
  const publicStateBefore = structuredClone(publicState);

  const index = chooseAiCardIndex(hand, {
    difficulty: AI_DIFFICULTY.HARD,
    publicState,
    rng: () => 0.25
  });

  assert.ok(index >= 0 && index < hand.length);
  assert.deepEqual(hand, handBefore);
  assert.deepEqual(publicState, publicStateBefore);
});

test("ai: hard does not depend on the player's hidden current-round choice", () => {
  const hand = ["fire", "fire", "wind"];
  const baseContext = {
    difficulty: AI_DIFFICULTY.HARD,
    publicState: {
      aiCardsRemaining: 3,
      playerCardsRemaining: 3,
      playerElementCounts: {
        fire: 1,
        water: 1,
        earth: 0,
        wind: 1
      },
      recentPlayerMoves: ["fire", "water"],
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
