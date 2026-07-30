import test from "node:test";
import assert from "node:assert/strict";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "../../src/state/eventChestDefinitions.js";
import {
  applyEventChestReward,
  normalizeEventChestRewardSettlement,
  selectEventChestReward
} from "../../src/state/eventChestOpening.js";
import {
  applyEventChestPityState,
  createDefaultEventChestPity,
  normalizeEventChestPity
} from "../../src/state/eventChestPity.js";
import { createDefaultProfile } from "../../src/state/statsTracking.js";

function definition(overrides = {}) {
  return {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    chestId: "event_chest_reward_test",
    ...overrides
  };
}

function expectInvalid(candidate, pattern) {
  const validation = validateEventChestDefinition(candidate);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), pattern);
}

test("event chest reward rules: odds, pool, duplicate, and pity bounds validate", () => {
  assert.equal(validateEventChestDefinition(definition()).ok, true);

  expectInvalid(definition({ odds: { common: 0.69, rare: 0.22, epic: 0.07, legendary: 0.01 } }), /sum to 1/);
  expectInvalid(definition({ odds: { common: 0.71, rare: 0.22, epic: 0.07, legendary: 0.01 } }), /sum to 1/);
  expectInvalid(definition({ odds: { common: -0.1, rare: 0.22, epic: 0.07, legendary: 0.81 } }), /common.*0 to 1/);
  expectInvalid(
    definition({ odds: { common: 0.7, rare: 0.22, epic: 0.07, legendary: 0.01, unique: 0 } }),
    /unique is unsupported/
  );
  expectInvalid(definition({ odds: { common: 0.7, rare: 0.22, epic: 0.08 } }), /legendary.*0 to 1/);

  const emptyRare = definition();
  emptyRare.pool.rare = [];
  expectInvalid(emptyRare, /rare rewards are required/);
  emptyRare.odds = { common: 0.78, rare: 0, epic: 0.2, legendary: 0.02 };
  assert.equal(validateEventChestDefinition(emptyRare).ok, true);

  expectInvalid(
    definition({ duplicateTokenRewards: { common: -1, rare: 60, epic: 150, legendary: 400 } }),
    /duplicateTokenRewards.common/
  );
  expectInvalid(
    definition({ duplicateTokenRewards: { common: 1.5, rare: 60, epic: 150, legendary: 400 } }),
    /duplicateTokenRewards.common/
  );
  expectInvalid(
    definition({ duplicateTokenRewards: { common: 1_000_001, rare: 60, epic: 150, legendary: 400 } }),
    /duplicateTokenRewards.common/
  );

  const zeroPity = definition();
  zeroPity.pity.epicPlusThreshold = 0;
  expectInvalid(zeroPity, /epicPlusThreshold/);
  const excessivePity = definition();
  excessivePity.pity.legendaryThreshold = 10_001;
  expectInvalid(excessivePity, /legendaryThreshold/);
  const reversedPity = definition();
  reversedPity.pity.epicPlusThreshold = 20;
  reversedPity.pity.legendaryThreshold = 10;
  expectInvalid(reversedPity, /greater than or equal/);
});

test("event chest reward selection: deterministic odds and pity transitions are chest-scoped", () => {
  const baseProfile = createDefaultProfile("EventChestRewardUser");
  const normalDefinition = definition({
    odds: { common: 1, rare: 0, epic: 0, legendary: 0 }
  });
  const normal = selectEventChestReward({
    definition: normalDefinition,
    profile: baseProfile,
    random: () => 0
  });
  assert.equal(normal.rarity, "common");
  assert.equal(normal.pity.appliedTarget, null);
  assert.deepEqual(normal.pity.before, { epicPlusMisses: 0, legendaryMisses: 0 });
  assert.deepEqual(
    {
      epicPlusMisses: normal.pity.after.epicPlusMisses,
      legendaryMisses: normal.pity.after.legendaryMisses
    },
    { epicPlusMisses: 1, legendaryMisses: 1 }
  );

  const epicProfile = {
    ...baseProfile,
    eventChestPity: applyEventChestPityState(
      createDefaultEventChestPity(),
      normalDefinition.chestId,
      { epicPlusMisses: 9, legendaryMisses: 9, updatedAt: "2026-07-29T00:00:00.000Z" }
    )
  };
  const epic = selectEventChestReward({
    definition: normalDefinition,
    profile: epicProfile,
    random: () => 0
  });
  assert.equal(epic.rarity, "epic");
  assert.equal(epic.pity.appliedTarget, "epic_plus");
  assert.equal(epic.pity.after.epicPlusMisses, 0);
  assert.equal(epic.pity.after.legendaryMisses, 10);

  const legendaryProfile = {
    ...baseProfile,
    eventChestPity: applyEventChestPityState(
      createDefaultEventChestPity(),
      normalDefinition.chestId,
      { epicPlusMisses: 9, legendaryMisses: 29, updatedAt: "2026-07-29T00:00:00.000Z" }
    )
  };
  const legendary = selectEventChestReward({
    definition: normalDefinition,
    profile: legendaryProfile,
    random: () => 0
  });
  assert.equal(legendary.rarity, "legendary");
  assert.equal(legendary.pity.appliedTarget, "legendary");
  assert.deepEqual(
    {
      epicPlusMisses: legendary.pity.after.epicPlusMisses,
      legendaryMisses: legendary.pity.after.legendaryMisses
    },
    { epicPlusMisses: 0, legendaryMisses: 0 }
  );
});

test("event chest duplicate conversion uses authoritative ownership and exact definition value", () => {
  const candidate = definition({
    odds: { common: 1, rare: 0, epic: 0, legendary: 0 }
  });
  candidate.pool.common = [candidate.pool.common[0]];
  const selected = selectEventChestReward({
    definition: candidate,
    profile: createDefaultProfile("NewRewardUser"),
    random: () => 0
  });
  const first = applyEventChestReward({
    profile: createDefaultProfile("NewRewardUser"),
    definition: candidate,
    selectedReward: selected
  });
  assert.equal(first.reward.type, "cosmetic");
  assert.equal(first.reward.duplicateConverted, false);

  candidate.duplicateTokenRewards.common = 37;
  const duplicate = applyEventChestReward({
    profile: first.profile,
    definition: candidate,
    selectedReward: selected
  });
  assert.equal(duplicate.reward.type, "tokens");
  assert.equal(duplicate.reward.tokenAmount, 37);
  assert.equal(duplicate.reward.duplicateConverted, true);
  assert.equal(duplicate.profile.tokens, first.profile.tokens + 37);

  candidate.duplicateTokenRewards.common = 0;
  const zeroConversion = applyEventChestReward({
    profile: first.profile,
    definition: candidate,
    selectedReward: selected
  });
  assert.equal(zeroConversion.reward.tokenAmount, 0);
  assert.equal(zeroConversion.profile.tokens, first.profile.tokens);
});

test("event chest settlement normalization rejects fractional token values", () => {
  const settlement = {
    schemaVersion: 1,
    entitlementId: "entitlement_fractional",
    chestId: "event_chest_reward_test",
    definitionRevisionId: "revision_1",
    transactionId: "transaction_1",
    settledAt: "2026-07-29T00:00:00.000Z",
    tokensCharged: 1.5,
    reward: {
      type: "cosmetic",
      rarity: "common",
      cosmetic: {
        type: "frames",
        cosmeticId: "daily_flame_frame"
      },
      tokenAmount: 0,
      duplicateConverted: false
    }
  };

  assert.equal(normalizeEventChestRewardSettlement(settlement), null);
});

test("event chest pity normalization is private, bounded, and idempotent", () => {
  const malformed = normalizeEventChestPity({
    schemaVersion: 1,
    byChestId: {
      valid: {
        epicPlusMisses: 99_999,
        legendaryMisses: -1,
        updatedAt: "invalid"
      },
      broken: null
    }
  });
  assert.deepEqual(malformed.byChestId.valid, {
    epicPlusMisses: 10_000,
    legendaryMisses: 0,
    updatedAt: null
  });
  assert.deepEqual(normalizeEventChestPity(malformed), malformed);
});
