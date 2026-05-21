import test from "node:test";
import assert from "node:assert/strict";
import { AI_DIFFICULTY, chooseAiCardIndex, chooseGauntletRivalCardIndex } from "../../src/engine/ai.js";
import {
  DEFAULT_GAUNTLET_RIVAL_ID,
  getGauntletRivalById,
  listGauntletRivals,
  resolveGauntletRivalById
} from "../../src/engine/gauntletRivals.js";

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

test("ai: all 8 Gauntlet rival definitions exist with rival-only identity fields", () => {
  const rivals = listGauntletRivals();

  assert.equal(rivals.length, 8);
  assert.deepEqual(
    rivals.map((rival) => rival.id),
    [
      "pyro_maniac",
      "tide_witch",
      "stonewall",
      "storm_chaser",
      "inferno_drummer",
      "river_spiral",
      "stone_march",
      "fourfold_monk"
    ]
  );

  for (const rival of rivals) {
    assert.equal(typeof rival.id, "string");
    assert.equal(typeof rival.displayName, "string");
    assert.equal(typeof rival.title, "string");
    assert.equal(typeof rival.hint, "string");
    assert.ok(rival.behaviorType === "weighted" || rival.behaviorType === "loop");
    assert.match(rival.avatarPath, /^assets\/rivals\/Gauntlet\/avatar_gauntlet_/);
    assert.doesNotMatch(rival.avatarPath, /^assets\/avatars\//);
    assert.equal(Object.hasOwn(rival, "badge"), false);
    assert.equal(Object.hasOwn(rival, "background"), false);
    assert.equal(Object.hasOwn(rival, "backgroundOverride"), false);
    assert.equal(Object.hasOwn(rival, "cardBack"), false);
    assert.equal(Object.hasOwn(rival, "cardVariant"), false);
    assert.equal(Object.hasOwn(rival, "cardVariants"), false);
    assert.equal(Object.hasOwn(rival, "titleArt"), false);

    if (rival.behaviorType === "weighted") {
      assert.deepEqual(Object.keys(rival.weights).sort(), ["earth", "fire", "water", "wind"]);
    } else {
      assert.equal(rival.loop.length, 10);
    }
  }
});

test("ai: Gauntlet rival lookup resolves known ids and safely falls back for unknown ids", () => {
  assert.equal(getGauntletRivalById("pyro_maniac")?.displayName, "Pyro Maniac");
  assert.equal(getGauntletRivalById("unknown_rival"), null);
  assert.equal(resolveGauntletRivalById("unknown_rival")?.id, DEFAULT_GAUNTLET_RIVAL_ID);
});

test("ai: weighted Gauntlet rival chooser only selects available cards", () => {
  const hand = ["water", "earth"];
  const index = chooseGauntletRivalCardIndex(hand, {
    rivalId: "pyro_maniac",
    rng: () => 0
  });

  assert.ok(index >= 0 && index < hand.length);
  assert.ok(["water", "earth"].includes(hand[index]));
});

test("ai: weighted Gauntlet rival chooser respects higher configured weights", () => {
  const hand = ["fire", "water", "wind"];
  const fireIndex = chooseGauntletRivalCardIndex(hand, {
    rivalId: "pyro_maniac",
    rng: () => 0
  });
  const waterIndex = chooseGauntletRivalCardIndex(hand, {
    rivalId: "pyro_maniac",
    rng: () => 0.7
  });

  assert.equal(fireIndex, 0);
  assert.equal(waterIndex, 1);
});

test("ai: loop Gauntlet rival chooser follows the 10-card loop and repeats after 10 turns", () => {
  const hand = ["fire", "water", "earth", "wind"];
  const firstCycle = Array.from({ length: 10 }, (_, turnIndex) =>
    hand[chooseGauntletRivalCardIndex(hand, { rivalId: "fourfold_monk", turnIndex })]
  );
  const repeatedTurn = hand[
    chooseGauntletRivalCardIndex(hand, { rivalId: "fourfold_monk", turnIndex: 10 })
  ];

  assert.deepEqual(firstCycle, [
    "fire",
    "water",
    "earth",
    "wind",
    "earth",
    "water",
    "fire",
    "water",
    "earth",
    "wind"
  ]);
  assert.equal(repeatedTurn, "fire");
});

test("ai: loop Gauntlet rival chooser falls back safely when the loop element is unavailable", () => {
  const hand = ["wind", "earth"];
  const index = chooseGauntletRivalCardIndex(hand, {
    rivalId: "river_spiral",
    turnIndex: 0
  });

  assert.ok(index >= 0 && index < hand.length);
  assert.equal(hand[index], "earth");
});

test("ai: Gauntlet rival chooser handles empty or malformed hands safely", () => {
  assert.equal(chooseGauntletRivalCardIndex([], { rivalId: "pyro_maniac" }), null);
  assert.equal(chooseGauntletRivalCardIndex(null, { rivalId: "pyro_maniac" }), null);
});
