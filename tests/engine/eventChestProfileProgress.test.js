import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } from "../../src/state/dailyElementChestSystem.js";
import {
  EVENT_CHEST_PROGRESS_SCHEMA_VERSION,
  createDefaultEventChestProgress,
  dailyElementChestFromEventChestProgress,
  eventChestProgressFromDailyElementChest,
  getNormalizedDailyEventChestProgress,
  normalizeEventChestProgressEntry,
  normalizeProfileEventChests
} from "../../src/state/eventChestProfileProgress.js";

function buildLegacyDailyProgress(overrides = {}) {
  return {
    lastFreeOpenDateKey: "2026-06-06T23:00:00.000Z",
    totalOpens: 12,
    paidOpens: 8,
    freeOpens: 4,
    pity: {
      opensSinceEpicPlus: 6,
      opensSinceLegendary: 12
    },
    ...overrides
  };
}

test("event chest profile progress: default shape is correct", () => {
  assert.deepEqual(createDefaultEventChestProgress("daily_elemintz_chest_current"), {
    schemaVersion: EVENT_CHEST_PROGRESS_SCHEMA_VERSION,
    chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
    firstOpenedAt: null,
    lastOpenedAt: null,
    lastOpenType: null,
    lastFreeOpenDateKey: null,
    totalOpens: 0,
    paidOpens: 0,
    freeOpens: 0,
    pity: {
      opensSinceEpicPlus: 0,
      opensSinceLegendary: 0
    },
    participation: {
      firstDefinitionSeenAt: null,
      lastDefinitionSeenAt: null,
      definitionRevisionIdsSeen: []
    }
  });
  assert.equal(createDefaultEventChestProgress(""), null);
});

test("event chest profile progress: malformed eventChests normalizes to an empty object", () => {
  assert.deepEqual(normalizeProfileEventChests(null), {});
  assert.deepEqual(normalizeProfileEventChests([]), {});
  assert.deepEqual(normalizeProfileEventChests("bad"), {});
});

test("event chest profile progress: malformed keyed progress repairs safely", () => {
  const normalized = normalizeProfileEventChests({
    [DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]: {
      chestId: "wrong_internal_value",
      schemaVersion: "bad",
      firstOpenedAt: "not-a-date",
      lastOpenedAt: "2026-06-07T01:02:03.000Z",
      lastOpenType: "paid",
      lastFreeOpenDateKey: "bad-date",
      totalOpens: "7.9",
      paidOpens: -3,
      freeOpens: "x",
      pity: "bad",
      participation: "bad"
    }
  });

  assert.deepEqual(normalized[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID], {
    schemaVersion: 1,
    chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
    firstOpenedAt: null,
    lastOpenedAt: "2026-06-07T01:02:03.000Z",
    lastOpenType: "paid",
    lastFreeOpenDateKey: null,
    totalOpens: 7,
    paidOpens: 0,
    freeOpens: 0,
    pity: {
      opensSinceEpicPlus: 0,
      opensSinceLegendary: 0
    },
    participation: {
      firstDefinitionSeenAt: null,
      lastDefinitionSeenAt: null,
      definitionRevisionIdsSeen: []
    }
  });
});

test("event chest profile progress: counters clamp and repair like Daily Chest counters", () => {
  const normalized = normalizeEventChestProgressEntry({
    chestId: "counter_chest",
    totalOpens: "8.8",
    paidOpens: -2,
    freeOpens: Number.NaN,
    pity: {
      opensSinceEpicPlus: "3.5",
      opensSinceLegendary: -9
    }
  });

  assert.equal(normalized.totalOpens, 8);
  assert.equal(normalized.paidOpens, 0);
  assert.equal(normalized.freeOpens, 0);
  assert.deepEqual(normalized.pity, {
    opensSinceEpicPlus: 3,
    opensSinceLegendary: 0
  });
});

test("event chest profile progress: malformed pity repairs to zeroed pity", () => {
  assert.deepEqual(normalizeEventChestProgressEntry({ chestId: "pity_chest", pity: [] }).pity, {
    opensSinceEpicPlus: 0,
    opensSinceLegendary: 0
  });
});

test("event chest profile progress: invalid date and string fields repair to null", () => {
  const normalized = normalizeEventChestProgressEntry({
    chestId: "date_chest",
    firstOpenedAt: "bad",
    lastOpenedAt: "",
    lastOpenType: "bonus",
    lastFreeOpenDateKey: "nope"
  });

  assert.equal(normalized.firstOpenedAt, null);
  assert.equal(normalized.lastOpenedAt, null);
  assert.equal(normalized.lastOpenType, null);
  assert.equal(normalized.lastFreeOpenDateKey, null);
});

test("event chest profile progress: participation fields repair safely", () => {
  const normalized = normalizeEventChestProgressEntry({
    chestId: "participation_chest",
    participation: {
      firstDefinitionSeenAt: "2026-06-01T00:00:00.000Z",
      lastDefinitionSeenAt: "bad",
      definitionRevisionIdsSeen: [" rev-a ", "", "rev-a", "rev-b", null, "rev-b"]
    }
  });

  assert.deepEqual(normalized.participation, {
    firstDefinitionSeenAt: "2026-06-01T00:00:00.000Z",
    lastDefinitionSeenAt: null,
    definitionRevisionIdsSeen: ["rev-a", "rev-b"]
  });
});

test("event chest profile progress: existing dailyElementChest converts exactly to keyed Daily progress", () => {
  const daily = buildLegacyDailyProgress();
  const progress = eventChestProgressFromDailyElementChest(daily);

  assert.equal(progress.chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.equal(progress.lastFreeOpenDateKey, daily.lastFreeOpenDateKey);
  assert.equal(progress.totalOpens, daily.totalOpens);
  assert.equal(progress.paidOpens, daily.paidOpens);
  assert.equal(progress.freeOpens, daily.freeOpens);
  assert.deepEqual(progress.pity, daily.pity);
});

test("event chest profile progress: keyed Daily progress derives legacy dailyElementChest exactly", () => {
  const daily = buildLegacyDailyProgress();
  const progress = eventChestProgressFromDailyElementChest(daily);

  assert.deepEqual(dailyElementChestFromEventChestProgress(progress), daily);
});

test("event chest profile progress: old-only profile projects keyed progress without losing state", () => {
  const dailyElementChest = buildLegacyDailyProgress({
    totalOpens: 22,
    paidOpens: 13,
    freeOpens: 9,
    pity: {
      opensSinceEpicPlus: 9,
      opensSinceLegendary: 29
    }
  });
  const progress = getNormalizedDailyEventChestProgress({ dailyElementChest });

  assert.equal(progress.totalOpens, 22);
  assert.equal(progress.paidOpens, 13);
  assert.equal(progress.freeOpens, 9);
  assert.deepEqual(progress.pity, dailyElementChest.pity);
});

test("event chest profile progress: new-only keyed progress projects legacy alias without losing state", () => {
  const keyed = eventChestProgressFromDailyElementChest(buildLegacyDailyProgress({
    totalOpens: 5,
    paidOpens: 2,
    freeOpens: 3
  }));
  const legacy = dailyElementChestFromEventChestProgress(keyed);

  assert.deepEqual(legacy, {
    lastFreeOpenDateKey: "2026-06-06T23:00:00.000Z",
    totalOpens: 5,
    paidOpens: 2,
    freeOpens: 3,
    pity: {
      opensSinceEpicPlus: 6,
      opensSinceLegendary: 12
    }
  });
});

test("event chest profile progress: matching old and keyed shapes remain idempotent", () => {
  const dailyElementChest = buildLegacyDailyProgress();
  const keyed = eventChestProgressFromDailyElementChest(dailyElementChest);
  const profile = {
    dailyElementChest,
    eventChests: {
      [DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]: keyed
    }
  };

  assert.deepEqual(getNormalizedDailyEventChestProgress(profile), keyed);
  assert.deepEqual(
    normalizeProfileEventChests(normalizeProfileEventChests(profile.eventChests)),
    normalizeProfileEventChests(profile.eventChests)
  );
});

test("event chest profile progress: invalid chestId is ignored unless a known chestId is supplied", () => {
  assert.equal(normalizeEventChestProgressEntry({ chestId: "" }), null);
  assert.deepEqual(normalizeProfileEventChests({ "": { totalOpens: 9 } }), {});
  assert.equal(
    normalizeEventChestProgressEntry({ chestId: "" }, { chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID })?.chestId,
    DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID
  );
});

test("event chest profile progress: pure helpers do not mutate inputs", () => {
  const profile = {
    dailyElementChest: buildLegacyDailyProgress(),
    eventChests: {
      [DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]: eventChestProgressFromDailyElementChest(buildLegacyDailyProgress())
    }
  };
  const before = structuredClone(profile);

  normalizeProfileEventChests(profile.eventChests);
  eventChestProgressFromDailyElementChest(profile.dailyElementChest);
  getNormalizedDailyEventChestProgress(profile);
  dailyElementChestFromEventChestProgress(profile.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]);

  assert.deepEqual(profile, before);
});
