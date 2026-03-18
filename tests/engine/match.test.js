import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, playRound } from "../../src/engine/match.js";

function totalCards(state) {
  return (
    state.players.p1.hand.length +
    state.players.p2.hand.length +
    state.currentPile.length
  );
}

function countElements(hand) {
  const counts = { fire: 0, water: 0, earth: 0, wind: 0 };
  for (const card of hand) {
    counts[card] += 1;
  }
  return counts;
}

test("match: initializes with 8 cards per player", () => {
  const match = createMatch();
  assert.equal(match.players.p1.hand.length, 8);
  assert.equal(match.players.p2.hand.length, 8);
  assert.equal(totalCards(match), match.meta.totalCards);
  assert.equal(match.meta.totalCards, 16);
});

test("match: each player starts with exactly 2 of each element", () => {
  const match = createMatch();

  assert.deepEqual(countElements(match.players.p1.hand), {
    fire: 2,
    water: 2,
    earth: 2,
    wind: 2
  });

  assert.deepEqual(countElements(match.players.p2.hand), {
    fire: 2,
    water: 2,
    earth: 2,
    wind: 2
  });
});

test("match: NO EFFECT round returns each played card to its owner", () => {
  const match = {
    id: "no-effect",
    status: "active",
    round: 0,
    mode: "pve",
    difficulty: "balanced",
    winner: null,
    endReason: null,
    currentPile: [],
    players: {
      p1: { hand: ["water"], wonRounds: 0 },
      p2: { hand: ["earth"], wonRounds: 0 }
    },
    war: {
      active: false,
      clashes: 0
    },
    history: [],
    meta: {
      totalCards: 2
    }
  };

  const result = playRound(match, { p1CardIndex: 0, p2CardIndex: 0 });

  assert.equal(result.round.result, "none");
  assert.equal(result.round.capturedCards, 0);
  assert.deepEqual(match.players.p1.hand, ["water"]);
  assert.deepEqual(match.players.p2.hand, ["earth"]);
  assert.equal(match.currentPile.length, 0);
});

test("match: rounds preserve total card count", () => {
  let i = 0;
  const rng = () => ((i = (i + 13) % 100) / 100);
  const match = createMatch({ rng });

  for (let round = 0; round < 40 && match.status === "active"; round += 1) {
    const result = playRound(match, { rng, p1CardIndex: 0, p2CardIndex: 0 });
    assert.equal(totalCards(match), match.meta.totalCards);

    if (result.round) {
      assert.ok(result.round.capturedCards >= 0);
    }
  }

  assert.ok(match.history.length > 0);
});

test("match: p1 loses WAR immediately when unable to continue and p2 can continue", () => {
  const match = {
    id: "war-p1-insufficient",
    status: "active",
    round: 0,
    mode: "pve",
    difficulty: "balanced",
    winner: null,
    endReason: null,
    currentPile: [],
    players: {
      p1: { hand: ["fire"], wonRounds: 0 },
      p2: { hand: ["fire", "earth"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 3 }
  };

  const result = playRound(match, { p1CardIndex: 0, p2CardIndex: 0 });

  assert.equal(result.round.result, "p2");
  assert.equal(result.round.capturedCards, 2);
  assert.equal(match.status, "completed");
  assert.equal(match.winner, "p2");
  assert.equal(match.players.p1.hand.length, 0);
  assert.equal(match.players.p2.hand.length, 3);
});

test("match: p2 loses WAR immediately when unable to continue and p1 can continue", () => {
  const match = {
    id: "war-p2-insufficient",
    status: "active",
    round: 0,
    mode: "pve",
    difficulty: "balanced",
    winner: null,
    endReason: null,
    currentPile: [],
    players: {
      p1: { hand: ["wind", "earth"], wonRounds: 0 },
      p2: { hand: ["wind"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 3 }
  };

  const result = playRound(match, { p1CardIndex: 0, p2CardIndex: 0 });

  assert.equal(result.round.result, "p1");
  assert.equal(result.round.capturedCards, 2);
  assert.equal(match.status, "completed");
  assert.equal(match.winner, "p1");
  assert.equal(match.players.p1.hand.length, 3);
  assert.equal(match.players.p2.hand.length, 0);
});

test("match: both players unable to continue WAR ends match in draw and returns cards", () => {
  const match = {
    id: "war-both-insufficient",
    status: "active",
    round: 0,
    mode: "pve",
    difficulty: "balanced",
    winner: null,
    endReason: null,
    currentPile: [],
    players: {
      p1: { hand: ["fire"], wonRounds: 0 },
      p2: { hand: ["fire"], wonRounds: 0 }
    },
    war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
    history: [],
    meta: { totalCards: 2 }
  };

  const result = playRound(match, { p1CardIndex: 0, p2CardIndex: 0 });

  assert.equal(result.round.result, "draw");
  assert.equal(result.round.capturedCards, 0);
  assert.equal(match.status, "completed");
  assert.equal(match.winner, "draw");
  assert.equal(match.endReason, "war-insufficient-both");
  assert.equal(match.players.p1.hand.length, 1);
  assert.equal(match.players.p2.hand.length, 1);
  assert.equal(match.currentPile.length, 0);
  assert.equal(totalCards(match), match.meta.totalCards);
});
