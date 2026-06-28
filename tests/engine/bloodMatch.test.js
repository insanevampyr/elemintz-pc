import test from "node:test";
import assert from "node:assert/strict";

import { ELEMENTS } from "../../src/engine/rules.js";
import {
  BLOOD_MATCH_COMBATANT_IDS,
  BLOOD_MATCH_REQUIRED_PLAY_RESULTS,
  BLOOD_MATCH_REVEAL_TYPES,
  BLOOD_MATCH_TIMEOUT_REASONS,
  appendBloodMatchPotEntries,
  classifyBloodMatchReveal,
  evaluateBloodMatchRequiredPlayAvailability,
  resolveBloodMatchTimeout
} from "../../src/engine/bloodMatch.js";

function sortedEntryKeys(entries) {
  return entries.map((entry) => `${entry.ownerId}:${entry.element}`).sort();
}

function assertNoLostOrDuplicatedRevealedCards(result, expectedReveal) {
  const expectedEntries = BLOOD_MATCH_COMBATANT_IDS.map((ownerId) => ({
    ownerId,
    element: expectedReveal[ownerId]
  }));
  const resolvedEntries = [...result.potCardEntries, ...result.returnedCardEntries];

  assert.deepEqual(sortedEntryKeys(resolvedEntries), sortedEntryKeys(expectedEntries));
  assert.deepEqual(sortedEntryKeys(result.revealedCardEntries), sortedEntryKeys(expectedEntries));
}

test("bloodMatch: every ordered three-card combination classifies without losing cards", () => {
  for (const player of ELEMENTS) {
    for (const vampire of ELEMENTS) {
      for (const lycan of ELEMENTS) {
        const reveal = { player, vampire, lycan };
        const result = classifyBloodMatchReveal(reveal);

        assert.ok(
          Object.values(BLOOD_MATCH_REVEAL_TYPES).includes(result.type),
          `unexpected type for ${JSON.stringify(reveal)}`
        );
        assertNoLostOrDuplicatedRevealedCards(result, reveal);
      }
    }
  }
});

test("bloodMatch: clear undefeated winner receives all three revealed cards", () => {
  const result = classifyBloodMatchReveal({
    player: "fire",
    vampire: "earth",
    lycan: "wind"
  });

  assert.equal(result.type, BLOOD_MATCH_REVEAL_TYPES.CLEAR_WINNER);
  assert.equal(result.winnerId, "player");
  assert.deepEqual(result.activeCombatantIds, []);
  assert.deepEqual(result.excludedCombatantIds, []);
  assert.deepEqual(sortedEntryKeys(result.potCardEntries), [
    "lycan:wind",
    "player:fire",
    "vampire:earth"
  ]);
  assert.deepEqual(result.returnedCardEntries, []);
});

test("bloodMatch: three distinct elements produce one undefeated winner", () => {
  const result = classifyBloodMatchReveal({
    player: "water",
    vampire: "fire",
    lycan: "earth"
  });

  assert.equal(result.type, BLOOD_MATCH_REVEAL_TYPES.CLEAR_WINNER);
  assert.equal(result.winnerId, "player");
});

test("bloodMatch: all-three-same creates three-way WAR with all cards in pot", () => {
  const result = classifyBloodMatchReveal({
    player: "water",
    vampire: "water",
    lycan: "water"
  });

  assert.equal(result.type, BLOOD_MATCH_REVEAL_TYPES.THREE_WAY_WAR);
  assert.deepEqual(result.activeCombatantIds, ["player", "vampire", "lycan"]);
  assert.deepEqual(result.excludedCombatantIds, []);
  assert.deepEqual(sortedEntryKeys(result.potCardEntries), [
    "lycan:water",
    "player:water",
    "vampire:water"
  ]);
  assert.deepEqual(result.returnedCardEntries, []);
});

test("bloodMatch: tied pair that both defeat third enters two-way WAR with all original cards in pot", () => {
  const result = classifyBloodMatchReveal({
    player: "fire",
    vampire: "fire",
    lycan: "earth"
  });

  assert.equal(result.type, BLOOD_MATCH_REVEAL_TYPES.TWO_WAY_WAR_DEFEATED_THIRD);
  assert.deepEqual(result.activeCombatantIds, ["player", "vampire"]);
  assert.deepEqual(result.excludedCombatantIds, ["lycan"]);
  assert.deepEqual(sortedEntryKeys(result.potCardEntries), [
    "lycan:earth",
    "player:fire",
    "vampire:fire"
  ]);
  assert.deepEqual(result.returnedCardEntries, []);
});

test("bloodMatch: tied pair with neutral third returns neutral card and pots only tied cards", () => {
  const result = classifyBloodMatchReveal({
    player: "fire",
    vampire: "fire",
    lycan: "wind"
  });

  assert.equal(result.type, BLOOD_MATCH_REVEAL_TYPES.TWO_WAY_WAR_NEUTRAL_THIRD);
  assert.deepEqual(result.activeCombatantIds, ["player", "vampire"]);
  assert.deepEqual(result.excludedCombatantIds, ["lycan"]);
  assert.deepEqual(sortedEntryKeys(result.potCardEntries), ["player:fire", "vampire:fire"]);
  assert.deepEqual(result.returnedCardEntries, [{ ownerId: "lycan", element: "wind" }]);
});

test("bloodMatch: pot helpers preserve original owner ids and elements without mutating inputs", () => {
  const existingPot = [{ ownerId: "player", element: "fire" }];
  const additions = [{ ownerId: "vampire", element: "water" }];

  const nextPot = appendBloodMatchPotEntries(existingPot, additions);

  assert.deepEqual(nextPot, [
    { ownerId: "player", element: "fire" },
    { ownerId: "vampire", element: "water" }
  ]);
  assert.notEqual(nextPot[0], existingPot[0]);
  assert.notEqual(nextPot[1], additions[0]);
  assert.deepEqual(existingPot, [{ ownerId: "player", element: "fire" }]);
  assert.deepEqual(additions, [{ ownerId: "vampire", element: "water" }]);
});

test("bloodMatch: player unable to satisfy required play is immediate terminal player loss", () => {
  const result = evaluateBloodMatchRequiredPlayAvailability({
    legalPlayableCardCounts: { player: 0, vampire: 0, lycan: 0 }
  });

  assert.equal(result.type, BLOOD_MATCH_REQUIRED_PLAY_RESULTS.PLAYER_LOSS);
  assert.equal(result.terminal, true);
  assert.equal(result.loserId, "player");
  assert.deepEqual(result.eliminatedCombatantIds, ["player"]);
});

test("bloodMatch: vampire unable to satisfy required play is eliminated while lycan remains", () => {
  const result = evaluateBloodMatchRequiredPlayAvailability({
    legalPlayableCardCounts: { player: 1, vampire: 0, lycan: 1 }
  });

  assert.equal(result.type, BLOOD_MATCH_REQUIRED_PLAY_RESULTS.AI_ELIMINATED_CONTINUE);
  assert.equal(result.terminal, false);
  assert.deepEqual(result.eliminatedCombatantIds, ["vampire"]);
  assert.deepEqual(result.remainingCombatantIds, ["player", "lycan"]);
});

test("bloodMatch: lycan unable to satisfy required play is eliminated while vampire remains", () => {
  const result = evaluateBloodMatchRequiredPlayAvailability({
    legalPlayableCardCounts: { player: 1, vampire: 1, lycan: 0 }
  });

  assert.equal(result.type, BLOOD_MATCH_REQUIRED_PLAY_RESULTS.AI_ELIMINATED_CONTINUE);
  assert.equal(result.terminal, false);
  assert.deepEqual(result.eliminatedCombatantIds, ["lycan"]);
  assert.deepEqual(result.remainingCombatantIds, ["player", "vampire"]);
});

test("bloodMatch: both AIs eliminated produces immediate player win", () => {
  const result = evaluateBloodMatchRequiredPlayAvailability({
    legalPlayableCardCounts: { player: 1, vampire: 0, lycan: 0 }
  });

  assert.equal(result.type, BLOOD_MATCH_REQUIRED_PLAY_RESULTS.PLAYER_WIN);
  assert.equal(result.terminal, true);
  assert.equal(result.winnerId, "player");
  assert.deepEqual(result.eliminatedCombatantIds, ["vampire", "lycan"]);
});

test("bloodMatch: player elimination takes precedence over AI elimination", () => {
  const result = evaluateBloodMatchRequiredPlayAvailability({
    legalPlayableCardCounts: { player: 0, vampire: 0, lycan: 1 }
  });

  assert.equal(result.type, BLOOD_MATCH_REQUIRED_PLAY_RESULTS.PLAYER_LOSS);
  assert.equal(result.terminal, true);
  assert.equal(result.loserId, "player");
});

test("bloodMatch: timeout player lead over surviving AIs produces player win", () => {
  const result = resolveBloodMatchTimeout({
    playerHandCount: 9,
    vampireHandCount: 8,
    lycanHandCount: 7
  });

  assert.equal(result.result, "player_win");
  assert.equal(result.winnerId, "player");
  assert.equal(result.endReason, BLOOD_MATCH_TIMEOUT_REASONS.TIMEOUT_LEAD);
});

test("bloodMatch: timeout tie with either surviving AI produces player loss", () => {
  const result = resolveBloodMatchTimeout({
    playerHandCount: 9,
    vampireHandCount: 9,
    lycanHandCount: 1
  });

  assert.equal(result.result, "player_loss");
  assert.equal(result.loserId, "player");
  assert.equal(result.endReason, BLOOD_MATCH_TIMEOUT_REASONS.TIMEOUT_TIE_OR_DEFICIT);
});

test("bloodMatch: timeout deficit against either surviving AI produces player loss", () => {
  const result = resolveBloodMatchTimeout({
    playerHandCount: 9,
    vampireHandCount: 1,
    lycanHandCount: 10
  });

  assert.equal(result.result, "player_loss");
  assert.equal(result.loserId, "player");
  assert.equal(result.endReason, BLOOD_MATCH_TIMEOUT_REASONS.TIMEOUT_TIE_OR_DEFICIT);
});

test("bloodMatch: timeout ignores eliminated AI in comparison", () => {
  const result = resolveBloodMatchTimeout({
    playerHandCount: 5,
    vampireHandCount: 99,
    lycanHandCount: 4,
    vampireEliminated: true,
    lycanEliminated: false
  });

  assert.equal(result.result, "player_win");
  assert.equal(result.winnerId, "player");
  assert.equal(result.endReason, BLOOD_MATCH_TIMEOUT_REASONS.TIMEOUT_LEAD);
  assert.deepEqual(result.comparedHandCounts, {
    player: 5,
    vampire: null,
    lycan: 4
  });
});
