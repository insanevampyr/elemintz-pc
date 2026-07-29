import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "../../src/state/eventChestDefinitions.js";
import {
  evaluateEventChestSchedule,
  normalizeEventChestActiveWindows
} from "../../src/state/eventChestSchedule.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

const WINDOW_ONE = {
  startsAt: "2026-08-01T12:00:00-05:00",
  endsAt: "2026-08-01T14:00:00-05:00"
};
const WINDOW_TWO = {
  startsAt: "2026-08-02T18:00:00.000Z",
  endsAt: "2026-08-02T20:00:00.000Z"
};

function createDefinition(activeWindows = []) {
  return structuredClone({
    ...DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
    chestId: "scheduled_event_chest",
    presetId: "scheduled_event_chest",
    lifecycle: {
      status: "draft",
      defaultPreset: false
    },
    activeWindows,
    definitionRevisionId: "definition_revision_schedule_1"
  });
}

test("event chest schedule normalization validates, canonicalizes, sorts, and rejects unsafe windows", () => {
  const normalized = normalizeEventChestActiveWindows([WINDOW_TWO, WINDOW_ONE]);
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.windows, [
    {
      startsAt: "2026-08-01T17:00:00.000Z",
      endsAt: "2026-08-01T19:00:00.000Z"
    },
    WINDOW_TWO
  ]);

  for (const [activeWindows, expected] of [
    [[{ startsAt: "not-a-date", endsAt: WINDOW_ONE.endsAt }], /startsAt/],
    [[{ startsAt: WINDOW_ONE.startsAt, endsAt: "not-a-date" }], /endsAt/],
    [[{ startsAt: WINDOW_ONE.startsAt, endsAt: WINDOW_ONE.startsAt }], /later than/],
    [[{ startsAt: WINDOW_ONE.endsAt, endsAt: WINDOW_ONE.startsAt }], /later than/],
    [[WINDOW_ONE, WINDOW_ONE], /duplicate window/],
    [[WINDOW_ONE, { startsAt: "2026-08-01T18:00:00.000Z", endsAt: "2026-08-01T20:00:00.000Z" }], /overlapping/],
    [[{ ...WINDOW_ONE, timezone: "America/Chicago" }], /unsupported/],
    [[{ startsAt: "2026-08-01T12:00", endsAt: "2026-08-01T14:00" }], /absolute ISO 8601/]
  ]) {
    const result = normalizeEventChestActiveWindows(activeWindows);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), expected);
  }

  const touching = normalizeEventChestActiveWindows([
    WINDOW_ONE,
    {
      startsAt: "2026-08-01T19:00:00.000Z",
      endsAt: "2026-08-01T20:00:00.000Z"
    }
  ]);
  assert.equal(touching.ok, true);
});

test("event chest definition validation enforces the schedule contract", () => {
  assert.equal(validateEventChestDefinition(createDefinition([WINDOW_ONE])).ok, true);
  assert.equal(validateEventChestDefinition(createDefinition([WINDOW_TWO, WINDOW_ONE])).ok, true);
  assert.equal(
    validateEventChestDefinition(
      createDefinition([
        WINDOW_ONE,
        { startsAt: "2026-08-01T18:00:00.000Z", endsAt: "2026-08-01T20:00:00.000Z" }
      ])
    ).ok,
    false
  );
});

test("event chest schedule evaluator uses inclusive starts, exclusive ends, and all derived states", () => {
  assert.equal(evaluateEventChestSchedule([], { nowMs: "2026-08-01T00:00:00.000Z" }).state, "unscheduled");
  assert.equal(
    evaluateEventChestSchedule([WINDOW_ONE, WINDOW_TWO], { nowMs: "2026-08-01T16:59:59.999Z" }).state,
    "upcoming"
  );
  assert.equal(
    evaluateEventChestSchedule([WINDOW_ONE, WINDOW_TWO], { nowMs: "2026-08-01T17:00:00.000Z" }).state,
    "active"
  );
  assert.equal(
    evaluateEventChestSchedule([WINDOW_ONE, WINDOW_TWO], { nowMs: "2026-08-01T19:00:00.000Z" }).state,
    "between_windows"
  );
  assert.equal(
    evaluateEventChestSchedule([WINDOW_ONE, WINDOW_TWO], { nowMs: "2026-08-02T20:00:00.000Z" }).state,
    "ended"
  );
  const invalid = evaluateEventChestSchedule(
    [{ startsAt: "bad", endsAt: WINDOW_ONE.endsAt }],
    { nowMs: "2026-08-01T18:00:00.000Z" }
  );
  assert.equal(invalid.state, "invalid");
  assert.equal(invalid.isWithinSchedule, false);
});

test("explicit activation and schedule jointly control new entitlement delivery", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-schedule-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  let now = "2026-08-01T16:00:00.000Z";
  let activation = {
    status: "active",
    chestId: "scheduled_event_chest",
    definitionRevisionId: "definition_revision_schedule_1"
  };
  let definition = createDefinition([WINDOW_ONE]);
  const coordinator = new StateCoordinator({
    dataDir,
    random: () => 0,
    eventChestActivationStore: {
      now: () => now,
      readActivation: async () => structuredClone(activation)
    },
    eventChestRegistryStore: {
      getPublishedEventChestDefinitionRevision: async () => structuredClone(definition)
    }
  });

  await coordinator.profiles.ensureProfile("SchedulePlayer");
  await coordinator.profiles.updateProfile("SchedulePlayer", (profile) => ({
    ...profile,
    linkedAccountId: "account_schedule_player"
  }));

  const before = await coordinator.syncEventChestEntitlementForProfile({
    username: "SchedulePlayer",
    accountId: "account_schedule_player"
  });
  assert.equal(before.active, false);
  assert.equal(before.deliveryStatus, "schedule_upcoming");

  now = "2026-08-01T17:00:00.000Z";
  const during = await coordinator.syncEventChestEntitlementForProfile({
    username: "SchedulePlayer",
    accountId: "account_schedule_player"
  });
  assert.equal(during.deliveryStatus, "delivered");
  assert.equal(during.entitlement.status, "available");

  now = "2026-08-01T19:00:00.000Z";
  const after = await coordinator.syncEventChestEntitlementForProfile({
    username: "SchedulePlayer",
    accountId: "account_schedule_player"
  });
  assert.equal(after.active, true);
  assert.equal(after.deliveryStatus, "existing_entitlement_available");
  assert.equal(after.entitlement.entitlementId, during.entitlement.entitlementId);
  assert.equal(
    (await coordinator.profiles.getProfile("SchedulePlayer")).eventChestEntitlements.items.length,
    1
  );
  await coordinator.profiles.ensureProfile("ScheduleLatePlayer");
  await coordinator.profiles.updateProfile("ScheduleLatePlayer", (profile) => ({
    ...profile,
    linkedAccountId: "account_schedule_late"
  }));
  const late = await coordinator.syncEventChestEntitlementForProfile({
    username: "ScheduleLatePlayer",
    accountId: "account_schedule_late"
  });
  assert.equal(late.active, false);
  assert.equal(late.deliveryStatus, "schedule_ended");

  const opened = await coordinator.openEventChestEntitlement({
    username: "SchedulePlayer",
    accountId: "account_schedule_player",
    entitlementId: during.entitlement.entitlementId,
    random: () => 0
  });
  assert.equal(opened.entitlement.status, "opened");
  const replay = await coordinator.openEventChestEntitlement({
    username: "SchedulePlayer",
    accountId: "account_schedule_player",
    entitlementId: during.entitlement.entitlementId,
    random: () => 0.99
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.reward, opened.reward);

  definition = createDefinition([]);
  const unscheduled = await coordinator.getActiveEventChestDefinitionForEntitlementDelivery({
    nowMs: now
  });
  assert.equal(unscheduled.active, true);
  assert.equal(unscheduled.schedule.state, "unscheduled");

  activation = { status: "inactive" };
  const inactive = await coordinator.getActiveEventChestDefinitionForEntitlementDelivery({
    nowMs: now
  });
  assert.equal(inactive.active, false);
  assert.equal(inactive.deliveryStatus, "no_active_event_chest");
});

test("switching active revisions evaluates the selected revision schedule", async () => {
  const definitions = {
    future: createDefinition([
      { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-02T00:00:00.000Z" }
    ]),
    current: createDefinition([
      { startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-08-02T00:00:00.000Z" }
    ])
  };
  let revision = "future";
  const coordinator = new StateCoordinator({
    eventChestActivationStore: {
      now: () => "2026-08-01T12:00:00.000Z",
      readActivation: async () => ({
        status: "active",
        chestId: "scheduled_event_chest",
        definitionRevisionId: revision
      })
    },
    eventChestRegistryStore: {
      getPublishedEventChestDefinitionRevision: async () => ({
        ...structuredClone(definitions[revision]),
        definitionRevisionId: revision
      })
    }
  });
  assert.equal(
    (await coordinator.getActiveEventChestDefinitionForEntitlementDelivery()).deliveryStatus,
    "schedule_upcoming"
  );
  revision = "current";
  assert.equal(
    (await coordinator.getActiveEventChestDefinitionForEntitlementDelivery()).active,
    true
  );
});
