import test from "node:test";
import assert from "node:assert/strict";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET
} from "../../src/state/eventChestDefinitions.js";
import {
  buildEventChestDraftReview,
  compareEventChestDefinitions,
  evaluateEventChestReviewWarnings,
  getEventChestCanonicalRewardKey,
  projectEventChestOdds
} from "../../src/state/eventChestReview.js";

const NOW = "2026-08-01T12:00:00.000Z";

function definition(overrides = {}) {
  return {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    chestId: "event_chest_review_test",
    lifecycle: { status: "draft", defaultPreset: false },
    ...overrides
  };
}

function draft(definitionOverrides = {}, recordOverrides = {}) {
  const value = definition(definitionOverrides);
  return {
    draftId: "draft_review_test",
    draftRevisionId: "draft_revision_review_2",
    chestId: value.chestId,
    status: "ready",
    definition: value,
    validation: { ok: true, errors: [] },
    createdBy: "PrivateCreator",
    updatedBy: "PrivateUpdater",
    ...recordOverrides
  };
}

function published(definitionOverrides = {}) {
  return {
    ...definition(definitionOverrides),
    lifecycle: { status: "inactive", defaultPreset: false },
    definitionRevisionId: "published_revision_review_1",
    publishedAt: "2026-07-30T12:00:00.000Z",
    publishedBy: "PrivatePublisher",
    sourceDraftId: "older_private_draft",
    sourceDraftRevisionId: "older_private_revision"
  };
}

function percentageTotal(scenario) {
  return scenario.rewards.reduce((sum, reward) => sum + reward.finalPercentage, 0);
}

test("event chest review: bounded preview uses exact draft identity and recognized safe fields", () => {
  const sourceDraft = draft({
    activeWindows: [
      { startsAt: "2026-08-02T00:00:00.000Z", endsAt: "2026-08-03T00:00:00.000Z" }
    ]
  });
  sourceDraft.definition.adminNotes = "Never expose this";
  sourceDraft.definition.sessionToken = "Never expose this either";
  const before = structuredClone(sourceDraft);

  const review = buildEventChestDraftReview({ draft: sourceDraft, readAt: NOW });

  assert.deepEqual(review.target, {
    kind: "draft",
    draftId: "draft_review_test",
    draftRevisionId: "draft_revision_review_2",
    chestId: "event_chest_review_test"
  });
  assert.equal(review.readAt, NOW);
  assert.equal(review.preview.display.title, DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.title);
  assert.equal(review.preview.display.artwork.closed, "icons/daily_chest.png");
  assert.deepEqual(review.preview.opening.methods, ["free", "paid"]);
  assert.equal(review.preview.opening.paidTokenCost, 100);
  assert.equal(review.preview.schedule.state, "upcoming");
  assert.equal(review.preview.lifecycle.runtimeState, "unpublished");
  assert.equal(review.preview.validation.ok, false);
  assert.equal(review.preview.validation.issueCount > 0, true);
  assert.ok(review.preview.rewards.length > 0);
  assert.deepEqual(
    review.preview.rewards.map((entry) => entry.rewardKey),
    [...review.preview.rewards.map((entry) => entry.rewardKey)].sort()
  );
  assert.equal(
    review.preview.rewards[0].rewardKey,
    getEventChestCanonicalRewardKey(
      review.preview.rewards[0].type,
      review.preview.rewards[0].cosmeticId
    )
  );
  const serialized = JSON.stringify(review);
  for (const privateField of [
    "adminNotes",
    "sessionToken",
    "createdBy",
    "updatedBy",
    "publishedBy",
    "settlementId",
    "entitlementId",
    "transactionId",
    "profile",
    "ownedCosmetics",
    "filePath",
    "queue"
  ]) {
    assert.equal(serialized.includes(privateField), false, `${privateField} must remain redacted`);
  }
  assert.deepEqual(sourceDraft, before, "review construction must not mutate the draft");
});

test("event chest review odds: base, Epic+, and Legendary scenarios match configured runtime distributions", () => {
  const source = definition();
  const odds = projectEventChestOdds(source);
  const base = odds.scenarios.find((entry) => entry.scenario === "base");
  const epicPlus = odds.scenarios.find((entry) => entry.scenario === "epic_plus_due");
  const legendary = odds.scenarios.find((entry) => entry.scenario === "legendary_due");

  assert.equal(odds.valid, true);
  assert.deepEqual(base.rarityProbabilities, source.odds);
  assert.deepEqual(epicPlus.rarityProbabilities, {
    common: 0,
    rare: 0,
    epic: 0.875,
    legendary: 0.125
  });
  assert.deepEqual(legendary.rarityProbabilities, {
    common: 0,
    rare: 0,
    epic: 0,
    legendary: 1
  });
  for (const scenario of [base, epicPlus, legendary]) {
    assert.equal(scenario.valid, true);
    assert.ok(Math.abs(scenario.totalEffectiveWeight - 1) <= 0.000001);
    assert.ok(Math.abs(percentageTotal(scenario) - 100) <= 0.000001);
    assert.ok(scenario.rewards.every((reward) => reward.baseWeight === 1));
  }

  const commonRewards = base.rewards.filter((reward) => reward.rarity === "common");
  assert.ok(commonRewards.length > 1);
  assert.ok(
    commonRewards.every(
      (reward) => Math.abs(reward.finalPercentage - (source.odds.common / commonRewards.length) * 100) <= 0.000001
    )
  );
  assert.match(odds.note, /ownership preference.*unowned/i);
});

test("event chest review odds: disabled and unselectable scenarios fail safely without randomness", () => {
  const disabled = definition({
    pity: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity),
      epicPlusEnabled: false,
      legendaryEnabled: false
    }
  });
  const disabledOdds = projectEventChestOdds(disabled);
  assert.equal(disabledOdds.scenarios[0].valid, true);
  assert.equal(disabledOdds.scenarios[1].invalidReason, "scenario_disabled");
  assert.equal(disabledOdds.scenarios[2].invalidReason, "scenario_disabled");

  const unselectable = definition({
    odds: { common: 1, rare: 0, epic: 0, legendary: 0 },
    pool: { common: [], rare: [], epic: [], legendary: [] }
  });
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("review odds must not invoke randomness");
  };
  try {
    const odds = projectEventChestOdds(unselectable);
    assert.ok(odds.scenarios.every((scenario) => scenario.valid === false));
    assert.ok(odds.scenarios.every((scenario) => scenario.invalidReason === "no_selectable_reward"));
  } finally {
    Math.random = originalRandom;
  }
});

test("event chest review comparison: exact identities, fixed metadata order, reward identity, and archived state are deterministic", () => {
  const before = published();
  const afterDraft = draft({
    title: "Reviewed Event Chest",
    paidTokenCost: 125,
    pool: structuredClone(before.pool)
  });
  afterDraft.definition.pool.common = [
    ...afterDraft.definition.pool.common.slice(1),
    { type: "avatar", cosmeticId: "avatar_arcane_gambler" }
  ];
  const lifecycle = {
    active: null,
    revisionStates: {
      [`${before.chestId}:${before.definitionRevisionId}`]: {
        state: "inactive",
        archived: true
      }
    }
  };
  const comparison = compareEventChestDefinitions({
    draft: afterDraft,
    publishedDefinition: before,
    publishedDefinitions: [before],
    lifecycle,
    nowMs: Date.parse(NOW)
  });

  assert.equal(comparison.draftIdentity.draftRevisionId, afterDraft.draftRevisionId);
  assert.equal(comparison.publishedIdentity.definitionRevisionId, before.definitionRevisionId);
  assert.equal(comparison.publishedIdentity.archived, true);
  assert.deepEqual(
    comparison.fields.map((entry) => entry.field),
    [
      "title",
      "subtitle",
      "description",
      "modalTitle",
      "collection",
      "artwork",
      "schedule",
      "openingMethods",
      "paidTokenCost",
      "freeOpenPolicy",
      "pity",
      "eligibility",
      "completion",
      "duplicateBehavior"
    ]
  );
  assert.equal(comparison.fields.find((entry) => entry.field === "title").state, "changed");
  assert.equal(comparison.fields.find((entry) => entry.field === "paidTokenCost").state, "increased");
  assert.equal(
    comparison.rewards.find((entry) => entry.rewardKey === "title:title_first_light").state,
    "removed"
  );
  assert.equal(
    comparison.rewards.find((entry) => entry.rewardKey === "avatar:avatar_arcane_gambler").state,
    "added"
  );
  assert.deepEqual(
    comparison.rewards.map((entry) => entry.rewardKey),
    [...comparison.rewards.map((entry) => entry.rewardKey)].sort()
  );
});

test("event chest review comparison: reward array reordering alone produces no false change", () => {
  const before = published();
  const afterDraft = draft({ pool: structuredClone(before.pool) });
  for (const rarity of Object.keys(afterDraft.definition.pool)) {
    afterDraft.definition.pool[rarity].reverse();
  }
  const comparison = compareEventChestDefinitions({
    draft: afterDraft,
    publishedDefinition: before,
    publishedDefinitions: [before],
    nowMs: Date.parse(NOW)
  });
  assert.equal(comparison.status, "unchanged");
  assert.ok(comparison.rewards.every((entry) => entry.state === "unchanged"));
});

test("event chest review comparison: rarity and percentage direction changes are explicit", () => {
  const before = published();
  const oddsDraft = draft({
    odds: { common: 0.8, rare: 0.12, epic: 0.07, legendary: 0.01 }
  });
  const oddsComparison = compareEventChestDefinitions({
    draft: oddsDraft,
    publishedDefinition: before,
    publishedDefinitions: [before],
    nowMs: Date.parse(NOW)
  });
  assert.equal(
    oddsComparison.rewards.find((entry) => entry.rewardKey === "title:title_first_light").state,
    "increased"
  );
  assert.equal(
    oddsComparison.rewards.find(
      (entry) => entry.rewardKey === "avatar:avatar_chestbound_adept"
    ).state,
    "decreased"
  );

  const rarityDraft = draft({ pool: structuredClone(before.pool) });
  const movedReward = rarityDraft.definition.pool.common.shift();
  rarityDraft.definition.pool.rare.push(movedReward);
  const rarityComparison = compareEventChestDefinitions({
    draft: rarityDraft,
    publishedDefinition: before,
    publishedDefinitions: [before],
    nowMs: Date.parse(NOW)
  });
  assert.equal(
    rarityComparison.rewards.find(
      (entry) => entry.rewardKey === getEventChestCanonicalRewardKey(movedReward)
    ).state,
    "changed"
  );
});

test("event chest review warnings: controlled critical codes are objective and validation remains separate", () => {
  const emptyDraft = draft({
    title: "",
    openTypes: [],
    pity: { epicPlusEnabled: true, legendaryEnabled: true, epicPlusThreshold: 0 },
    pool: { common: [], rare: [], epic: [], legendary: [] }
  });
  emptyDraft.definition.definitionRevisionId = "conflicting_revision";
  const collision = {
    ...published(),
    definitionRevisionId: "conflicting_revision",
    sourceDraftId: "different_draft",
    sourceDraftRevisionId: "different_revision"
  };
  const review = buildEventChestDraftReview({
    draft: emptyDraft,
    publishedDefinitions: [collision],
    readAt: NOW
  });
  const codes = new Set(review.warnings.items.map((entry) => entry.code));
  for (const code of [
    "EVENT_CHEST_EMPTY_REWARD_POOL",
    "EVENT_CHEST_NO_SELECTABLE_REWARD",
    "EVENT_CHEST_IMPOSSIBLE_OPEN_CONFIGURATION",
    "EVENT_CHEST_INVALID_PITY_CONFIGURATION",
    "EVENT_CHEST_PUBLICATION_IDENTITY_CONFLICT",
    "EVENT_CHEST_REQUIRED_FIELD_MISSING"
  ]) {
    assert.equal(codes.has(code), true, `${code} should be present`);
  }
  assert.equal(review.warnings.highestSeverity, "critical");
  assert.deepEqual(Object.keys(review.preview.validation).sort(), ["issueCount", "ok"]);

  const duplicateDraft = draft();
  duplicateDraft.definition.pool.common.push(duplicateDraft.definition.pool.common[0]);
  const duplicateReview = buildEventChestDraftReview({ draft: duplicateDraft, readAt: NOW });
  assert.ok(
    duplicateReview.warnings.items.some(
      (entry) => entry.code === "EVENT_CHEST_AMBIGUOUS_REWARD_IDENTITY"
    )
  );

  const invalidReferenceDraft = draft();
  invalidReferenceDraft.definition.pool.common[0] = {
    type: "avatar",
    cosmeticId: "missing_review_cosmetic"
  };
  const invalidReview = buildEventChestDraftReview({ draft: invalidReferenceDraft, readAt: NOW });
  assert.ok(
    invalidReview.warnings.items.some(
      (entry) => entry.code === "EVENT_CHEST_INVALID_REWARD_REFERENCE"
    )
  );
});

test("event chest review warnings: controlled high and info changes are deterministic and percentage drops stay informational", () => {
  const before = published();
  const afterDraft = draft({
    openTypes: ["paid"],
    paidTokenCost: 150,
    activeWindows: [
      { startsAt: "2026-07-01T00:00:00.000Z", endsAt: "2026-07-02T00:00:00.000Z" }
    ],
    pity: {
      ...structuredClone(before.pity),
      epicPlusEnabled: false,
      legendaryThreshold: before.pity.legendaryThreshold + 1
    },
    odds: { common: 0.8, rare: 0.15, epic: 0.04, legendary: 0.01 },
    pool: structuredClone(before.pool)
  });
  afterDraft.definition.pool.rare = afterDraft.definition.pool.rare.slice(1);
  const review = buildEventChestDraftReview({
    draft: afterDraft,
    publishedDefinition: before,
    publishedDefinitions: [before],
    readAt: NOW
  });
  const byCode = new Map(review.warnings.items.map((entry) => [entry.code, entry]));
  for (const code of [
    "EVENT_CHEST_SCHEDULE_EXPIRED",
    "EVENT_CHEST_REWARD_REMOVED",
    "EVENT_CHEST_FREE_OPEN_REMOVED",
    "EVENT_CHEST_TOKEN_COST_CHANGED",
    "EVENT_CHEST_PITY_DISABLED",
    "EVENT_CHEST_PITY_THRESHOLD_INCREASED",
    "EVENT_CHEST_METADATA_CHANGED"
  ]) {
    assert.equal(byCode.has(code), true, `${code} should be present`);
  }
  assert.equal(byCode.get("EVENT_CHEST_REWARD_PERCENTAGE_DECREASED")?.severity, "info");
  assert.ok(review.warnings.items.every((entry) => ["critical", "high", "info"].includes(entry.severity)));

  const invalidScheduleDraft = draft({
    activeWindows: [
      { startsAt: "2026-08-03T00:00:00.000Z", endsAt: "2026-08-02T00:00:00.000Z" }
    ]
  });
  const invalidSchedule = buildEventChestDraftReview({ draft: invalidScheduleDraft, readAt: NOW });
  assert.ok(
    invalidSchedule.warnings.items.some(
      (entry) => entry.code === "EVENT_CHEST_SCHEDULE_INVALID_RANGE"
    )
  );
});

test("event chest review warnings: objectively unreachable configured rewards are high severity", () => {
  const sourceDraft = draft({
    odds: { common: 0.78, rare: 0, epic: 0.21, legendary: 0.01 }
  });
  const review = buildEventChestDraftReview({ draft: sourceDraft, readAt: NOW });
  const rareWarnings = review.warnings.items.filter(
    (entry) => entry.code === "EVENT_CHEST_REWARD_UNOBTAINABLE"
  );
  assert.equal(rareWarnings.length, sourceDraft.definition.pool.rare.length);
  assert.ok(rareWarnings.every((entry) => entry.severity === "high"));
});

test("event chest review warnings: no comparison base is informational and bounded", () => {
  const review = buildEventChestDraftReview({ draft: draft(), readAt: NOW });
  assert.deepEqual(
    review.warnings.items.filter((entry) => entry.code === "EVENT_CHEST_NO_COMPARISON_BASE"),
    [
      {
        code: "EVENT_CHEST_NO_COMPARISON_BASE",
        severity: "info",
        message: "No exact published revision was selected for comparison.",
        affected: "comparison"
      }
    ]
  );
});

test("event chest review warning evaluator never mutates supplied preview or draft", () => {
  const sourceDraft = draft();
  const preview = buildEventChestDraftReview({ draft: sourceDraft, readAt: NOW }).preview;
  const beforeDraft = structuredClone(sourceDraft);
  const beforePreview = structuredClone(preview);
  const warnings = evaluateEventChestReviewWarnings({ draft: sourceDraft, preview });
  assert.ok(Array.isArray(warnings.items));
  assert.deepEqual(sourceDraft, beforeDraft);
  assert.deepEqual(preview, beforePreview);
});
