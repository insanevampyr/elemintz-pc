import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "../../src/state/eventChestDefinitions.js";
import {
  evaluateEventChestEligibility,
  normalizeEventChestEligibility
} from "../../src/state/eventChestEligibility.js";
import { EventChestDraftStore } from "../../src/state/eventChestDraftStore.js";

const NOW = Date.parse("2026-07-30T12:00:00.000Z");

function definitionWithEligibility(eligibility) {
  return {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    chestId: "eligibility_test_chest",
    lifecycle: { status: "draft", defaultPreset: false },
    eligibility
  };
}

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-eligibility-"));
}

test("event chest eligibility: defaults and validation reject malformed contracts", async () => {
  assert.deepEqual(normalizeEventChestEligibility(undefined), { mode: "all_players" });
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.eligibility, { mode: "all_players" });

  const dataDir = await createTempDataDir();
  try {
    const draftStore = new EventChestDraftStore({ dataDir });
    const draft = await draftStore.createDraft({
      displaySeed: { title: "Eligibility Default Draft" }
    });
    assert.deepEqual(draft.definition.eligibility, { mode: "all_players" });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  assert.equal(validateEventChestDefinition(definitionWithEligibility({ mode: "all_players" })).ok, true);
  assert.equal(validateEventChestDefinition({ ...definitionWithEligibility(undefined), eligibility: undefined }).ok, true);

  assert.equal(
    validateEventChestDefinition(definitionWithEligibility({ mode: "all_players", minimumLevel: 10 })).ok,
    false
  );
  assert.equal(
    validateEventChestDefinition(definitionWithEligibility({ mode: "rules", minimumLevel: 20, maximumLevel: 10 })).ok,
    false
  );
  assert.equal(
    validateEventChestDefinition(definitionWithEligibility({ mode: "rules", unknownRule: true })).ok,
    false
  );
  assert.equal(
    validateEventChestDefinition(definitionWithEligibility({ mode: "rules", accountCreatedBefore: "2026-07-30" })).ok,
    false
  );
});

test("event chest eligibility: level account age created-before and email rules are deterministic", () => {
  const profile = { playerLevel: 10 };
  const account = {
    createdAt: "2026-07-20T12:00:00.000Z",
    emailVerified: true
  };

  assert.deepEqual(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", minimumLevel: 10 }), {
      profile,
      account,
      nowMs: NOW
    }),
    { eligible: true, reasonCode: "eligible" }
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", minimumLevel: 11 }), {
      profile,
      account,
      nowMs: NOW
    }).reasonCode,
    "level_too_low"
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", maximumLevel: 10 }), {
      profile,
      account,
      nowMs: NOW
    }).eligible,
    true
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", maximumLevel: 9 }), {
      profile,
      account,
      nowMs: NOW
    }).reasonCode,
    "level_too_high"
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", minimumAccountAgeDays: 10 }), {
      profile,
      account,
      nowMs: NOW
    }).eligible,
    true
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", minimumAccountAgeDays: 11 }), {
      profile,
      account,
      nowMs: NOW
    }).reasonCode,
    "account_too_new"
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", accountCreatedBefore: "2026-07-20T12:00:00.000Z" }), {
      profile,
      account,
      nowMs: NOW
    }).eligible,
    true
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", accountCreatedBefore: "2026-07-19T12:00:00.000Z" }), {
      profile,
      account,
      nowMs: NOW
    }).reasonCode,
    "account_created_too_late"
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", verifiedEmailRequired: true }), {
      profile,
      account: { ...account, emailVerified: false },
      nowMs: NOW
    }).reasonCode,
    "email_not_verified"
  );
});

test("event chest eligibility: level-only ranges need no account facts and honor inclusive boundaries", () => {
  const definition = definitionWithEligibility({
    mode: "rules",
    minimumLevel: 40,
    maximumLevel: 100
  });
  for (const [playerLevel, eligible, reasonCode] of [
    [27, false, "level_too_low"],
    [40, true, "eligible"],
    [67, true, "eligible"],
    [100, true, "eligible"],
    [101, false, "level_too_high"]
  ]) {
    assert.deepEqual(
      evaluateEventChestEligibility(definition, { profile: { playerLevel }, nowMs: NOW }),
      { eligible, reasonCode }
    );
  }
});

test("event chest eligibility: configured account rules fail closed when authoritative account facts are absent", () => {
  for (const eligibility of [
    { mode: "rules", minimumAccountAgeDays: 7 },
    { mode: "rules", accountCreatedBefore: "2026-07-25T12:00:00.000Z" },
    { mode: "rules", verifiedEmailRequired: true }
  ]) {
    assert.deepEqual(
      evaluateEventChestEligibility(definitionWithEligibility(eligibility), {
        profile: { playerLevel: 67 },
        nowMs: NOW
      }),
      { eligible: false, reasonCode: "missing_authoritative_account_data" }
    );
  }
});

test("event chest eligibility: combined rules use AND semantics and missing account data fails closed", () => {
  const definition = definitionWithEligibility({
    mode: "rules",
    minimumLevel: 5,
    maximumLevel: 15,
    minimumAccountAgeDays: 7,
    accountCreatedBefore: "2026-07-25T12:00:00.000Z",
    verifiedEmailRequired: true
  });
  assert.equal(
    evaluateEventChestEligibility(definition, {
      profile: { playerLevel: 10 },
      account: { createdAt: "2026-07-20T12:00:00.000Z", emailVerified: true },
      nowMs: NOW
    }).eligible,
    true
  );
  assert.equal(
    evaluateEventChestEligibility(definition, {
      profile: { playerLevel: 4 },
      account: { createdAt: "2026-07-20T12:00:00.000Z", emailVerified: true },
      nowMs: NOW
    }).reasonCode,
    "level_too_low"
  );
  assert.equal(
    evaluateEventChestEligibility(definition, {
      profile: { playerLevel: 10 },
      nowMs: NOW
    }).reasonCode,
    "missing_authoritative_account_data"
  );
  assert.equal(
    evaluateEventChestEligibility(definitionWithEligibility({ mode: "rules", verifiedEmailRequired: "yes" }), {
      profile: { playerLevel: 10 },
      account: { createdAt: "2026-07-20T12:00:00.000Z", emailVerified: true },
      nowMs: NOW
    }).reasonCode,
    "invalid_eligibility_definition"
  );
});
