import test from "node:test";
import assert from "node:assert/strict";
import { playRoundManualWarStep } from "../../src/engine/match.js";
import { resolveWar } from "../../src/engine/war.js";

test("war: resolves after at least one clash", () => {
  const state = {
    players: {
      p1: { hand: ["earth", "water"] },
      p2: { hand: ["wind", "wind"] }
    }
  };

  const result = resolveWar(state, ["fire", "fire"]);

  assert.equal(result.winner, "p1");
  assert.equal(result.clashes, 1);
  assert.equal(result.pile.length, 4);
});

test("war: pile progression increments by 2 cards per clash", () => {
  const state = {
    players: {
      p1: { hand: ["fire", "fire", "earth"] },
      p2: { hand: ["wind", "wind", "wind"] }
    }
  };

  const result = resolveWar(state, ["water", "water"]);

  assert.deepEqual(result.pileSizes, [2, 4, 6, 8]);
});

test("war manual: tie start enters WAR with 2 pile cards", () => {
  const match = {
    status: "active",
    round: 0,
    currentPile: [],
    players: {
      p1: { hand: ["fire", "water"], wonRounds: 0 },
      p2: { hand: ["fire", "earth"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 4 }
  };

  const result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });

  assert.equal(result.status, "war_continues");
  assert.equal(match.war.active, true);
  assert.equal(match.currentPile.length, 2);
  assert.deepEqual(match.war.pendingPileSizes, [2]);
});

test("war manual: no-effect continuation keeps piling and then winner captures full pile", () => {
  const match = {
    status: "active",
    round: 0,
    currentPile: [],
    players: {
      p1: { hand: ["fire", "water", "earth"], wonRounds: 0 },
      p2: { hand: ["fire", "earth", "wind"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 6 }
  };

  // Tie enters WAR
  let result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "war_continues");
  assert.equal(match.currentPile.length, 2);

  // No-effect inside WAR (water vs earth)
  result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "war_continues");
  assert.equal(match.currentPile.length, 4);
  assert.deepEqual(match.war.pendingPileSizes, [2, 4]);

  // Winner clash inside WAR (earth beats wind)
  result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "resolved");
  assert.equal(result.round.result, "p1");
  assert.equal(result.round.capturedCards, 6);
  assert.deepEqual(result.round.warPileSizes, [2, 4, 6]);
  assert.equal(match.currentPile.length, 0);
  assert.equal(match.war.active, false);
});

test("war manual: continuation resolves immediately on non-tie reveal", () => {
  const match = {
    status: "active",
    round: 0,
    currentPile: [],
    players: {
      p1: { hand: ["fire", "fire"], wonRounds: 0 },
      p2: { hand: ["fire", "water"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 4 }
  };

  let result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "war_continues");
  assert.equal(match.war.active, true);

  result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "resolved");
  assert.equal(result.round.result, "p2");
  assert.equal(match.war.active, false);
  assert.equal(match.currentPile.length, 0);
});

test("war manual: simultaneous exhaustion after continued WAR resolves immediately as draw", () => {
  const match = {
    status: "active",
    round: 0,
    currentPile: [],
    players: {
      p1: { hand: ["fire", "water"], wonRounds: 0 },
      p2: { hand: ["fire", "earth"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 4 }
  };

  let result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "war_continues");
  assert.equal(match.war.active, true);

  result = playRoundManualWarStep(match, { p1CardIndex: 0, p2CardIndex: 0 });
  assert.equal(result.status, "resolved");
  assert.equal(result.round.result, "draw");
  assert.equal(match.status, "completed");
  assert.equal(match.winner, "draw");
  assert.equal(match.war.active, false);
});

test("war: p1 loses immediately when unable to continue and p2 can continue", () => {
  const state = {
    players: {
      p1: { hand: [] },
      p2: { hand: ["fire"] }
    }
  };

  const result = resolveWar(state, ["water", "water"]);

  assert.equal(result.winner, "p2");
  assert.equal(result.reason, "war-insufficient-p1");
  assert.deepEqual(result.pile, ["water", "water"]);
});

test("war: p2 loses immediately when unable to continue and p1 can continue", () => {
  const state = {
    players: {
      p1: { hand: ["earth"] },
      p2: { hand: [] }
    }
  };

  const result = resolveWar(state, ["wind", "wind"]);

  assert.equal(result.winner, "p1");
  assert.equal(result.reason, "war-insufficient-p2");
  assert.deepEqual(result.pile, ["wind", "wind"]);
});

test("war: both players unable to continue returns draw and requests pile return", () => {
  const state = {
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    }
  };

  const result = resolveWar(state, ["fire", "fire"]);

  assert.equal(result.winner, "draw");
  assert.equal(result.reason, "war-insufficient-both");
  assert.equal(result.returnPileOnDraw, true);
  assert.deepEqual(result.pile, ["fire", "fire"]);
});

test("war tie when both players reveal final card", () => {
  const state = {
    players: {
      p1: { hand: ["water"] },
      p2: { hand: ["water"] }
    }
  };

  const result = resolveWar(state, ["fire", "fire"]);

  assert.equal(result.winner, "draw");
  assert.equal(result.reason, "war-insufficient-both");
  assert.equal(result.returnPileOnDraw, true);
  assert.equal(result.clashes, 1);
  assert.deepEqual(result.pile, ["fire", "fire", "water", "water"]);
  assert.deepEqual(result.pileSizes, [2, 4]);
});
