import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeck,
  DEFAULT_CARDS_PER_ELEMENT,
  shuffleDeck,
  splitDeck
} from "../../src/engine/deck.js";

test("deck: default deck has 52 cards", () => {
  const deck = createDeck();
  assert.equal(deck.length, DEFAULT_CARDS_PER_ELEMENT * 4);
});

test("deck: splitDeck creates equal hands", () => {
  const deck = createDeck();
  const hands = splitDeck(deck);
  assert.equal(hands.p1.length, 26);
  assert.equal(hands.p2.length, 26);
});

test("deck: shuffleDeck preserves card count", () => {
  let i = 0;
  const rng = () => ((i = (i + 17) % 100) / 100);
  const deck = createDeck();
  const shuffled = shuffleDeck(deck, rng);
  assert.equal(shuffled.length, deck.length);
});
