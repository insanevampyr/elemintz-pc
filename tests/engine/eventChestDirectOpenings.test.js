import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET } from "../../src/state/eventChestDefinitions.js";
import {
  getEventChestFreeResetWindow,
  normalizeEventChestDirectOpenings
} from "../../src/state/eventChestDirectOpenings.js";
import { EVENT_CHEST_REGISTRY_FILENAME } from "../../src/state/eventChestRegistryStore.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

const NOW = "2026-07-29T19:00:00.000Z";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-direct-"));
}

function buildDefinition(overrides = {}) {
  return {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    chestId: "direct_open_test_chest",
    title: "Direct Open Test Chest",
    subtitle: "Direct opening test.",
    description: "Direct opening authority test chest.",
    modalTitle: "Direct Open Test Chest",
    definitionRevisionId: "definition_revision_direct_open_1",
    publishedAt: NOW,
    publishedBy: "test-admin",
    sourceDraftId: "draft_direct_open",
    sourceDraftRevisionId: "draft_revision_direct_open_1",
    openTypes: ["free", "paid"],
    paidTokenCost: 100,
    freeOpenPolicy: {
      cadence: "daily",
      resetTimeZone: "America/Chicago",
      resetHour: 18
    },
    activeWindows: [],
    ...overrides
  };
}

async function writeRegistry(dataDir, definitions) {
  const filePath = path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({
      schemaVersion: 1,
      registryId: "elemintz_event_chest_registry",
      registryRevisionId: "registry_revision_direct_open",
      publishedAt: NOW,
      publishedBy: "test-admin",
      definitions
    }),
    "utf8"
  );
}

async function createActiveCoordinator(dataDir, definition = buildDefinition()) {
  const coordinator = new StateCoordinator({
    dataDir,
    eventChestActivationStore: undefined
  });
  coordinator.eventChestActivationStore.now = () => NOW;
  await writeRegistry(dataDir, [definition]);
  await coordinator.eventChestActivationStore.activate({
    chestId: definition.chestId,
    definitionRevisionId: definition.definitionRevisionId
  });
  return coordinator;
}

async function createClaimedProfile(coordinator, username, tokens = 500) {
  await coordinator.profiles.ensureProfile(username, {
    linkedAccountId: `account-${username}`
  });
  await coordinator.profiles.updateProfile(username, (profile) => ({
    ...profile,
    tokens
  }));
}

function buildCompletionDefinition(overrides = {}) {
  const sourceEntries = structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool.common.slice(0, 2));
  return buildDefinition({
    pool: {
      common: sourceEntries,
      rare: [],
      epic: [],
      legendary: []
    },
    odds: { common: 1, rare: 0, epic: 0, legendary: 0 },
    pity: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity),
      epicPlusEnabled: false,
      legendaryEnabled: false
    },
    ...overrides
  });
}

async function grantOwnedPoolEntries(coordinator, username, entries) {
  await coordinator.profiles.updateProfile(username, (profile) => {
    const ownedCosmetics = structuredClone(profile.ownedCosmetics ?? {});
    for (const entry of entries) {
      const owned = Array.isArray(ownedCosmetics[entry.type]) ? ownedCosmetics[entry.type] : [];
      ownedCosmetics[entry.type] = [...new Set([...owned, entry.cosmeticId])];
    }
    return { ...profile, ownedCosmetics };
  });
}

function openDirect(coordinator, username, method, requestId, options = {}) {
  return coordinator.openEventChestDirect({
    username,
    profileKey: username,
    accountId: `account-${username}`,
    method,
    requestId,
    account: options.account ?? null,
    nowMs: options.nowMs ?? NOW,
    random: options.random ?? (() => 0)
  });
}

test("event chest direct opening: daily reset windows accept ISO time and honor DST", () => {
  const policy = {
    cadence: "daily",
    resetTimeZone: "America/Chicago",
    resetHour: 18
  };
  const winter = getEventChestFreeResetWindow(policy, "2026-01-15T01:00:00.000Z");
  const summer = getEventChestFreeResetWindow(policy, "2026-07-15T00:00:00.000Z");
  const springDst = getEventChestFreeResetWindow(policy, "2026-03-08T20:00:00.000Z");

  assert.equal(winter.startsAt, "2026-01-15T00:00:00.000Z");
  assert.equal(summer.startsAt, "2026-07-14T23:00:00.000Z");
  assert.equal(springDst.endMs - springDst.startMs, 23 * 60 * 60 * 1000);
  assert.equal(getEventChestFreeResetWindow(policy, "not-a-time"), null);
});

test("event chest lifecycle: archive and end hide new opens while preserving entitlements and settlement replay", async () => {
  const dataDir = await createTempDataDir();
  try {
    const definition = buildDefinition({ openTypes: ["entitlement", "free", "paid"] });
    const coordinator = await createActiveCoordinator(dataDir, definition);
    await createClaimedProfile(coordinator, "LifecycleOpenUser", 500);

    const issued = await coordinator.syncEventChestEntitlementForProfile({
      username: "LifecycleOpenUser",
      profileKey: "LifecycleOpenUser",
      accountId: "account-LifecycleOpenUser"
    });
    assert.equal(issued.deliveryStatus, "delivered");
    await coordinator.deactivateEventChestActivationForAdmin({
      chestId: definition.chestId,
      definitionRevisionId: definition.definitionRevisionId,
      actor: "VampyrLee"
    });
    await coordinator.archiveEventChestRevisionForAdmin({
      chestId: definition.chestId,
      definitionRevisionId: definition.definitionRevisionId,
      actor: "VampyrLee"
    });
    await createClaimedProfile(coordinator, "ArchivedNewUser", 500);
    const blockedIssuance = await coordinator.syncEventChestEntitlementForProfile({
      username: "ArchivedNewUser",
      profileKey: "ArchivedNewUser",
      accountId: "account-ArchivedNewUser"
    });
    assert.equal(blockedIssuance.deliveryStatus, "no_active_event_chest");

    const retained = await coordinator.syncEventChestEntitlementForProfile({
      username: "LifecycleOpenUser",
      profileKey: "LifecycleOpenUser",
      accountId: "account-LifecycleOpenUser"
    });
    assert.equal(retained.deliveryStatus, "existing_entitlement_available");
    assert.equal(JSON.stringify(retained).includes("archived"), false);
    assert.equal(JSON.stringify(retained).includes("lifecycle"), false);
    const beforeRejectedOpen = await coordinator.profiles.getProfile("LifecycleOpenUser");
    await assert.rejects(
      openDirect(coordinator, "LifecycleOpenUser", "free", "deactivated_free_request"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    await assert.rejects(
      openDirect(coordinator, "LifecycleOpenUser", "paid", "deactivated_paid_request"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("LifecycleOpenUser"), beforeRejectedOpen);

    const entitlementOpen = await coordinator.openEventChestEntitlement({
      username: "LifecycleOpenUser",
      profileKey: "LifecycleOpenUser",
      accountId: "account-LifecycleOpenUser",
      entitlementId: issued.entitlement.entitlementId,
      random: () => 0
    });
    const entitlementReplay = await coordinator.openEventChestEntitlement({
      username: "LifecycleOpenUser",
      profileKey: "LifecycleOpenUser",
      accountId: "account-LifecycleOpenUser",
      entitlementId: issued.entitlement.entitlementId,
      random: () => 0.99
    });
    assert.equal(entitlementOpen.replayed, false);
    assert.equal(entitlementReplay.replayed, true);

    await coordinator.unarchiveEventChestRevisionForAdmin({
      chestId: definition.chestId,
      definitionRevisionId: definition.definitionRevisionId,
      actor: "VampyrLee"
    });
    await coordinator.activateEventChestDefinitionForAdmin({
      chestId: definition.chestId,
      definitionRevisionId: definition.definitionRevisionId,
      actor: "VampyrLee"
    });
    const paid = await openDirect(
      coordinator,
      "LifecycleOpenUser",
      "paid",
      "ended_replay_request",
      { random: () => 0.5 }
    );
    assert.equal(paid.replayed, false);
    await coordinator.endEventChestActivationForAdmin({
      chestId: definition.chestId,
      definitionRevisionId: definition.definitionRevisionId,
      actor: "VampyrLee"
    });
    const paidReplay = await openDirect(
      coordinator,
      "LifecycleOpenUser",
      "paid",
      "ended_replay_request",
      { random: () => 0.99 }
    );
    assert.equal(paidReplay.replayed, true);
    const beforeNewEndedOpen = await coordinator.profiles.getProfile("LifecycleOpenUser");
    await assert.rejects(
      openDirect(coordinator, "LifecycleOpenUser", "paid", "ended_new_request"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("LifecycleOpenUser"), beforeNewEndedOpen);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: paid charge, replay, concurrency, and distinct requests are authoritative", async () => {
  const dataDir = await createTempDataDir();
  try {
    const coordinator = await createActiveCoordinator(dataDir);
    await createClaimedProfile(coordinator, "PaidDirectUser", 500);
    let randomCalls = 0;
    const random = () => {
      randomCalls += 1;
      return 0;
    };

    const [first, concurrentReplay] = await Promise.all([
      openDirect(coordinator, "PaidDirectUser", "paid", "paid_request_0001", { random }),
      openDirect(coordinator, "PaidDirectUser", "paid", "paid_request_0001", { random })
    ]);
    assert.equal(first.costCharged, 100);
    assert.equal(concurrentReplay.costCharged, 100);
    assert.equal([first, concurrentReplay].filter((result) => result.replayed).length, 1);
    assert.equal(randomCalls, 2);

    let profile = await coordinator.profiles.getProfile("PaidDirectUser");
    assert.equal(profile.tokens, 400);
    assert.equal(profile.eventChestDirectOpenings.settlements.length, 1);

    const retry = await openDirect(
      coordinator,
      "PaidDirectUser",
      "paid",
      "paid_request_0001",
      { random }
    );
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.reward, first.reward);
    assert.equal(randomCalls, 2);

    await openDirect(coordinator, "PaidDirectUser", "paid", "paid_request_0002", {
      random
    });
    profile = await coordinator.profiles.getProfile("PaidDirectUser");
    assert.equal(profile.tokens, 300);
    assert.equal(profile.eventChestDirectOpenings.settlements.length, 2);

    await assert.rejects(
      openDirect(coordinator, "PaidDirectUser", "free", "paid_request_0001"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_INVALID_REQUEST"
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: eligibility rejects before mutation, charge, free state, pity, or settlement", async () => {
  const dataDir = await createTempDataDir();
  try {
    const coordinator = await createActiveCoordinator(
      dataDir,
      buildDefinition({
        eligibility: { mode: "rules", minimumLevel: 10 }
      })
    );
    await createClaimedProfile(coordinator, "IneligibleDirectUser", 500);
    const beforePaid = await coordinator.profiles.getProfile("IneligibleDirectUser");
    await assert.rejects(
      openDirect(coordinator, "IneligibleDirectUser", "paid", "ineligible_paid_request"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    const afterPaid = await coordinator.profiles.getProfile("IneligibleDirectUser");
    assert.equal(afterPaid.tokens, beforePaid.tokens);
    assert.deepEqual(afterPaid.eventChestDirectOpenings, beforePaid.eventChestDirectOpenings);
    assert.deepEqual(afterPaid.eventChestPity, beforePaid.eventChestPity);
    assert.deepEqual(afterPaid.ownedCosmetics, beforePaid.ownedCosmetics);

    await assert.rejects(
      openDirect(coordinator, "IneligibleDirectUser", "free", "ineligible_free_request"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("IneligibleDirectUser"), afterPaid);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: completed exact revision is hidden and rejects stale free and paid requests before mutation", async () => {
  const dataDir = await createTempDataDir();
  try {
    const definition = buildCompletionDefinition();
    const coordinator = await createActiveCoordinator(dataDir, definition);
    await createClaimedProfile(coordinator, "CompletedDirectUser", 500);

    await grantOwnedPoolEntries(coordinator, "CompletedDirectUser", [definition.pool.common[0]]);
    const incomplete = await coordinator.syncEventChestEntitlementForProfile({
      username: "CompletedDirectUser",
      profileKey: "CompletedDirectUser",
      accountId: "account-CompletedDirectUser"
    });
    assert.equal(incomplete.active, true);
    assert.equal(incomplete.directOpen.available, true);
    assert.equal(incomplete.directOpen.rewardPool.missingCount, 1);

    await grantOwnedPoolEntries(coordinator, "CompletedDirectUser", [definition.pool.common[1]]);
    const before = await coordinator.profiles.getProfile("CompletedDirectUser");
    const completed = await coordinator.syncEventChestEntitlementForProfile({
      username: "CompletedDirectUser",
      profileKey: "CompletedDirectUser",
      accountId: "account-CompletedDirectUser"
    });
    assert.equal(completed.active, false);
    assert.equal(completed.directOpen.available, false);
    assert.equal(JSON.stringify(completed).includes("rewardPool"), false);

    for (const [method, requestId] of [
      ["free", "completed_free_request"],
      ["paid", "completed_paid_request"]
    ]) {
      await assert.rejects(
        openDirect(coordinator, "CompletedDirectUser", method, requestId),
        (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
      );
    }
    assert.deepEqual(await coordinator.profiles.getProfile("CompletedDirectUser"), before);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: completion is deduplicated, fails closed for invalid pools, and reopens for a new revision", async () => {
  const dataDir = await createTempDataDir();
  try {
    const definition = buildCompletionDefinition();
    const coordinator = await createActiveCoordinator(dataDir, definition);
    await createClaimedProfile(coordinator, "RevisionDirectUser", 500);
    const firstEntry = definition.pool.common[0];

    const duplicated = {
      ...definition,
      pool: {
        common: [firstEntry, structuredClone(firstEntry)],
        rare: [],
        epic: [],
        legendary: []
      }
    };
    await grantOwnedPoolEntries(coordinator, "RevisionDirectUser", [firstEntry]);
    assert.deepEqual(coordinator.getEventChestCompletionState(duplicated, await coordinator.profiles.getProfile("RevisionDirectUser")), {
      poolValid: true,
      totalCount: 1,
      ownedCount: 1,
      isComplete: true
    });
    assert.equal(
      coordinator.buildEventChestDirectOpenStatus(
        { ...definition, pool: { common: [{ type: "avatar", cosmeticId: "missing_reward" }] } },
        await coordinator.profiles.getProfile("RevisionDirectUser")
      ).available,
      false
    );
    assert.equal(
      coordinator.buildEventChestDirectOpenStatus(
        { ...definition, pool: { common: [], rare: [], epic: [], legendary: [] } },
        await coordinator.profiles.getProfile("RevisionDirectUser")
      ).available,
      false
    );

    await grantOwnedPoolEntries(coordinator, "RevisionDirectUser", [definition.pool.common[1]]);
    const hidden = await coordinator.syncEventChestEntitlementForProfile({
      username: "RevisionDirectUser",
      profileKey: "RevisionDirectUser",
      accountId: "account-RevisionDirectUser"
    });
    assert.equal(hidden.active, false);

    const reopened = buildCompletionDefinition({
      definitionRevisionId: "definition_revision_direct_open_2",
      pool: {
        common: [definition.pool.common[0], definition.pool.common[1], DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool.common[2]],
        rare: [],
        epic: [],
        legendary: []
      }
    });
    await writeRegistry(dataDir, [definition, reopened]);
    await coordinator.eventChestActivationStore.activate({
      chestId: reopened.chestId,
      definitionRevisionId: reopened.definitionRevisionId
    });
    const visible = await coordinator.syncEventChestEntitlementForProfile({
      username: "RevisionDirectUser",
      profileKey: "RevisionDirectUser",
      accountId: "account-RevisionDirectUser"
    });
    assert.equal(visible.active, true);
    assert.equal(visible.directOpen.available, true);
    assert.equal(visible.directOpen.definitionRevisionId, reopened.definitionRevisionId);
    assert.equal(visible.directOpen.rewardPool.missingCount, 1);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: a completed settlement replays while new requests are rejected", async () => {
  const dataDir = await createTempDataDir();
  try {
    const reward = structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool.common[0]);
    const definition = buildCompletionDefinition({
      pool: { common: [reward], rare: [], epic: [], legendary: [] }
    });
    const coordinator = await createActiveCoordinator(dataDir, definition);
    await createClaimedProfile(coordinator, "ReplayCompleteDirectUser", 500);

    const opened = await openDirect(coordinator, "ReplayCompleteDirectUser", "paid", "completion_replay_request");
    assert.equal(opened.replayed, false);
    const replay = await openDirect(coordinator, "ReplayCompleteDirectUser", "paid", "completion_replay_request");
    assert.equal(replay.replayed, true);
    await assert.rejects(
      openDirect(coordinator, "ReplayCompleteDirectUser", "paid", "completion_new_request"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    const profile = await coordinator.profiles.getProfile("ReplayCompleteDirectUser");
    assert.equal(profile.eventChestDirectOpenings.settlements.length, 1);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: sync status includes safe presentation data", async () => {
  const dataDir = await createTempDataDir();
  try {
    const definition = buildDefinition({
      odds: { common: 0.7, rare: 0.22, epic: 0.07, legendary: 0.01 }
    });
    const coordinator = await createActiveCoordinator(dataDir, definition);
    await createClaimedProfile(coordinator, "PresentationDirectUser", 500);
    const rewardEntry = definition.pool.common[0];
    await coordinator.profiles.updateProfile("PresentationDirectUser", (profile) => ({
      ...profile,
      eventChestPity: {
        schemaVersion: 1,
        byChestId: {
          [definition.chestId]: {
            epicPlusMisses: 4,
            legendaryMisses: 18,
            updatedAt: NOW
          }
        }
      },
      ownedCosmetics: {
        ...profile.ownedCosmetics,
        [rewardEntry.type]: [
          ...(profile.ownedCosmetics?.[rewardEntry.type] ?? []),
          rewardEntry.cosmeticId
        ]
      }
    }));

    const status = await coordinator.syncEventChestEntitlementForProfile({
      username: "PresentationDirectUser",
      profileKey: "PresentationDirectUser",
      accountId: "account-PresentationDirectUser"
    });
    const directOpen = status.directOpen;
    assert.equal(directOpen.available, true);
    assert.equal(directOpen.chestId, definition.chestId);
    assert.equal(directOpen.definitionRevisionId, definition.definitionRevisionId);
    assert.deepEqual(directOpen.odds, definition.odds);
    assert.equal(directOpen.pity.epicPlus.displayLabel, "4 / 10");
    assert.equal(directOpen.pity.legendary.displayLabel, "18 / 30");
    assert.equal(directOpen.rewardPool.totalCount, 12);
    assert.equal(directOpen.rewardPool.ownedCount, 1);
    assert.equal(directOpen.rewardPool.items.common[0].owned, true);
    assert.equal(directOpen.rewardPool.items.common[0].name.length > 0, true);
    assert.equal(directOpen.methods.paid.costTokens, 100);
    assert.equal(directOpen.methods.paid.tokenBalance, 500);
    assert.equal(
      JSON.stringify(directOpen).includes("eventChestDirectOpenings"),
      false
    );
    assert.equal(JSON.stringify(directOpen).includes("settlements"), false);
    assert.equal(JSON.stringify(directOpen).includes("transactionId"), false);
    assert.equal(JSON.stringify(directOpen).includes("account-"), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: safe presentation normalizes retained legacy rarity casing", async () => {
  const dataDir = await createTempDataDir();
  try {
    const coordinator = new StateCoordinator({ dataDir });
    const canonical = buildDefinition();
    const definition = {
      ...canonical,
      odds: {
        Common: 0.7,
        Rare: 0.22,
        Epic: 0.07,
        Legendary: 0.01
      },
      pool: {
        Common: canonical.pool.common,
        Rare: canonical.pool.rare,
        Epic: canonical.pool.epic,
        Legendary: canonical.pool.legendary
      }
    };
    const firstCommon = canonical.pool.common[0];
    const status = coordinator.buildEventChestDirectOpenStatus(
      definition,
      {
        tokens: 500,
        ownedCosmetics: {
          [firstCommon.type]: [firstCommon.cosmeticId]
        }
      },
      { nowMs: NOW }
    );

    assert.equal(status.available, true);
    assert.deepEqual(status.odds, { common: 0.7, rare: 0.22, epic: 0.07, legendary: 0.01 });
    assert.equal(status.pity.epicPlus.displayLabel, "0 / 10");
    assert.equal(status.pity.legendary.displayLabel, "0 / 30");
    assert.equal(status.rewardPool.totalCount, 12);
    assert.equal(status.rewardPool.ownedCount, 1);
    assert.equal(status.rewardPool.byRarity.common.total, 3);
    assert.equal(status.rewardPool.byRarity.rare.total, 2);
    assert.equal(status.rewardPool.byRarity.epic.total, 5);
    assert.equal(status.rewardPool.byRarity.legendary.total, 2);
    assert.equal(status.rewardPool.items.common[0].owned, true);
    assert.equal(JSON.stringify(status).includes("eventChestDirectOpenings"), false);
    assert.equal(JSON.stringify(status).includes("transactionId"), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: insufficient paid and failed reward selection do not mutate", async () => {
  const dataDir = await createTempDataDir();
  try {
    const coordinator = await createActiveCoordinator(dataDir);
    await createClaimedProfile(coordinator, "FailedDirectUser", 50);
    const before = await coordinator.profiles.getProfile("FailedDirectUser");

    await assert.rejects(
      openDirect(coordinator, "FailedDirectUser", "paid", "paid_request_low"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_INSUFFICIENT_TOKENS"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("FailedDirectUser"), before);

    await coordinator.profiles.updateProfile("FailedDirectUser", (profile) => ({
      ...profile,
      tokens: 500
    }));
    const beforeSelectionFailure = await coordinator.profiles.getProfile("FailedDirectUser");
    await assert.rejects(
      openDirect(coordinator, "FailedDirectUser", "free", "free_request_fail", {
        random() {
          throw new Error("selection failed");
        }
      }),
      /selection failed/
    );
    assert.deepEqual(
      await coordinator.profiles.getProfile("FailedDirectUser"),
      beforeSelectionFailure
    );

    const retry = await openDirect(
      coordinator,
      "FailedDirectUser",
      "free",
      "free_request_fail"
    );
    assert.equal(retry.replayed, false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: free window grants once, survives restart, and resets", async () => {
  const dataDir = await createTempDataDir();
  try {
    let coordinator = await createActiveCoordinator(dataDir);
    await createClaimedProfile(coordinator, "FreeDirectUser", 500);

    const first = await openDirect(
      coordinator,
      "FreeDirectUser",
      "free",
      "free_request_0001"
    );
    assert.equal(first.costCharged, 0);
    assert.equal(first.tokenBalance, 500);

    const replay = await openDirect(
      coordinator,
      "FreeDirectUser",
      "free",
      "free_request_0001"
    );
    assert.equal(replay.replayed, true);
    await assert.rejects(
      openDirect(coordinator, "FreeDirectUser", "free", "free_request_0002"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_FREE_ALREADY_CLAIMED"
    );

    coordinator = new StateCoordinator({ dataDir });
    coordinator.eventChestActivationStore.now = () => NOW;
    await assert.rejects(
      openDirect(coordinator, "FreeDirectUser", "free", "free_request_0003"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_FREE_ALREADY_CLAIMED"
    );

    const nextWindow = "2026-07-30T00:30:00.000Z";
    const next = await openDirect(
      coordinator,
      "FreeDirectUser",
      "free",
      "free_request_0004",
      { nowMs: nextWindow }
    );
    assert.equal(next.replayed, false);
    const profile = await coordinator.profiles.getProfile("FreeDirectUser");
    assert.equal(profile.eventChestDirectOpenings.settlements.length, 2);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: method and schedule failures are mutation-free", async () => {
  const dataDir = await createTempDataDir();
  try {
    const definition = buildDefinition({
      openTypes: ["entitlement"],
      paidTokenCost: 100,
      freeOpenPolicy: null
    });
    const coordinator = await createActiveCoordinator(dataDir, definition);
    await createClaimedProfile(coordinator, "MethodDirectUser", 500);
    const before = await coordinator.profiles.getProfile("MethodDirectUser");
    await assert.rejects(
      openDirect(coordinator, "MethodDirectUser", "paid", "paid_request_off"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_METHOD_DISABLED"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("MethodDirectUser"), before);

    const futureDefinition = buildDefinition({
      definitionRevisionId: "definition_revision_direct_future",
      activeWindows: [
        {
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2026-08-02T00:00:00.000Z"
        }
      ]
    });
    await writeRegistry(dataDir, [futureDefinition]);
    await coordinator.eventChestActivationStore.activate({
      chestId: futureDefinition.chestId,
      definitionRevisionId: futureDefinition.definitionRevisionId
    });
    await assert.rejects(
      openDirect(coordinator, "MethodDirectUser", "paid", "paid_request_future"),
      (error) => error?.code === "EVENT_CHEST_DIRECT_OPEN_UNAVAILABLE"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("MethodDirectUser"), before);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: private ledger normalizes fail closed", () => {
  const normalized = normalizeEventChestDirectOpenings({
    schemaVersion: 1,
    settlements: [
      {
        schemaVersion: 1,
        requestId: "private_request_01",
        openingId: "opening-private",
        transactionId: "transaction-private",
        chestId: "private-chest",
        definitionRevisionId: "private-revision",
        method: "paid",
        settledAt: NOW,
        costCharged: 100,
        freeWindowKey: null,
        reward: {
          type: "tokens",
          rarity: "common",
          cosmetic: null,
          tokenAmount: 25,
          duplicateConverted: true
        }
      },
      {
        requestId: "private_request_bad",
        method: "paid"
      }
    ]
  });
  assert.equal(normalized.settlements.length, 1);
  assert.deepEqual(normalized.invalidRequestIds, ["private_request_bad"]);
  assert.equal(JSON.stringify(normalized).includes("accountId"), false);
  assert.equal(JSON.stringify(normalized).includes("profileKey"), false);
});

test("event chest direct opening: paid duplicate conversion and replay are atomic", async () => {
  const dataDir = await createTempDataDir();
  const base = buildDefinition({
    odds: { common: 1, rare: 0, epic: 0, legendary: 0 },
    pity: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity),
      epicPlusEnabled: false,
      legendaryEnabled: false
    }
  });
  base.pool.common = [base.pool.common[0]];
  const coordinator = await createActiveCoordinator(dataDir, base);
  try {
    await createClaimedProfile(coordinator, "DuplicateDirectUser", 500);
    const rewardEntry = base.pool.common[0];
    await coordinator.profiles.updateProfile("DuplicateDirectUser", (profile) => ({
      ...profile,
      ownedCosmetics: {
        ...profile.ownedCosmetics,
        [rewardEntry.type]: [
          ...(profile.ownedCosmetics?.[rewardEntry.type] ?? []),
          rewardEntry.cosmeticId
        ]
      }
    }));

    const opened = await openDirect(
      coordinator,
      "DuplicateDirectUser",
      "paid",
      "paid_duplicate_request_01"
    );
    assert.equal(opened.costCharged, 100);
    assert.equal(opened.duplicateTokensAwarded, 25);
    assert.equal(opened.reward.duplicateConverted, true);
    assert.equal(opened.reward.tokenAmount, 25);
    assert.equal(opened.tokenBalance, 425);

    const replay = await openDirect(
      coordinator,
      "DuplicateDirectUser",
      "paid",
      "paid_duplicate_request_01"
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.tokenBalance, 425);
    assert.equal(replay.duplicateTokensAwarded, 25);
    const profile = await coordinator.profiles.getProfile("DuplicateDirectUser");
    assert.equal(profile.tokens, 425);
    assert.deepEqual(profile.eventChestPity.byChestId[base.chestId], {
      epicPlusMisses: 0,
      legendaryMisses: 0,
      updatedAt: NOW
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest direct opening: pity advances once, triggers at threshold, and survives restart", async () => {
  const dataDir = await createTempDataDir();
  const base = buildDefinition({
    odds: { common: 1, rare: 0, epic: 0, legendary: 0 },
    pity: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity),
      epicPlusEnabled: true,
      legendaryEnabled: true,
      epicPlusThreshold: 2,
      legendaryThreshold: 3
    }
  });
  const coordinator = await createActiveCoordinator(dataDir, base);
  try {
    await createClaimedProfile(coordinator, "PityDirectUser", 500);
    const first = await openDirect(
      coordinator,
      "PityDirectUser",
      "paid",
      "paid_pity_request_01"
    );
    assert.equal(first.reward.rarity, "common");
    assert.equal(first.pityGuarantee, null);

    const replay = await openDirect(
      coordinator,
      "PityDirectUser",
      "paid",
      "paid_pity_request_01"
    );
    assert.equal(replay.replayed, true);
    let profile = await coordinator.profiles.getProfile("PityDirectUser");
    assert.equal(profile.eventChestPity.byChestId[base.chestId].epicPlusMisses, 1);

    const second = await openDirect(
      coordinator,
      "PityDirectUser",
      "paid",
      "paid_pity_request_02"
    );
    assert.equal(second.reward.rarity, "epic");
    assert.equal(second.pityGuarantee, "epic_plus");
    profile = await coordinator.profiles.getProfile("PityDirectUser");
    assert.equal(profile.eventChestPity.byChestId[base.chestId].epicPlusMisses, 0);
    assert.equal(profile.eventChestPity.byChestId[base.chestId].legendaryMisses, 2);

    const restarted = new StateCoordinator({ dataDir });
    const reloaded = await restarted.profiles.getProfile("PityDirectUser");
    assert.equal(reloaded.eventChestPity.byChestId[base.chestId].legendaryMisses, 2);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
