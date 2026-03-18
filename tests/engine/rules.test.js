import test from "node:test";
import assert from "node:assert/strict";
import { compareElements, elementThatBeats, ELEMENTS } from "../../src/engine/rules.js";

test("rules: all elements are supported", () => {
  assert.deepEqual(ELEMENTS, ["fire", "water", "earth", "wind"]);
});

test("rules: compareElements resolves winners, ties, and no-effect pairs", () => {
  assert.equal(compareElements("fire", "earth"), "p1");
  assert.equal(compareElements("earth", "fire"), "p2");
  assert.equal(compareElements("wind", "wind"), "tie");

  assert.equal(compareElements("water", "earth"), "none");
  assert.equal(compareElements("earth", "water"), "none");
  assert.equal(compareElements("fire", "wind"), "none");
  assert.equal(compareElements("wind", "fire"), "none");
  assert.equal(compareElements("water", "wind"), "p2");
  assert.equal(compareElements("earth", "water"), "none");
});

test("rules: elementThatBeats returns counter", () => {
  assert.equal(elementThatBeats("fire"), "water");
  assert.equal(elementThatBeats("water"), "wind");
});
