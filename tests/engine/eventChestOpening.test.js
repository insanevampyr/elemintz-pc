import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { buildEventChestEntitlementId } from "../../src/state/eventChestEntitlementIds.js";
import { createEventChestEntitlement } from "../../src/state/eventChestEntitlements.js";
import {
  buildEventChestOpenResponse,
  createEventChestRewardSettlement
} from "../../src/state/eventChestOpening.js";
import { DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET } from "../../src/state/eventChestDefinitions.js";
import { EVENT_CHEST_REGISTRY_FILENAME } from "../../src/state/eventChestRegistryStore.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-opening-"));
}

function buildDefinition(overrides = {}) {
  return {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    chestId: "opening_event_chest",
    title: "Opening Event Chest",
    subtitle: "Opening test.",
    description: "Opening test chest.",
    modalTitle: "Opening Event Chest",
    definitionRevisionId: "definition_revision_opening_1",
    publishedAt: "2026-07-28T15:00:00.000Z",
    publishedBy: "VampyrLee",
    sourceDraftId: "draft_opening",
    sourceDraftRevisionId: "draft_revision_opening_1",
    odds: {
      common: 1,
      rare: 0,
      epic: 0,
      legendary: 0
    },
    pity: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity),
      epicPlusEnabled: false,
      legendaryEnabled: false
    },
    pool: {
      common: [{ type: "title", cosmeticId: "title_first_light" }],
      rare: [],
      epic: [],
      legendary: []
    },
    ...overrides
  };
}

async function writeRegistry(dataDir, definitions) {
  const filePath = path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        registryId: "elemintz_event_chest_registry",
        registryRevisionId: "registry_revision_opening",
        publishedAt: "2026-07-28T15:00:00.000Z",
        publishedBy: "VampyrLee",
        definitions
      },
      null,
      2
    ),
    "utf8"
  );
}

function buildEntitlement({ accountId, profileKey, chestId, definitionRevisionId, grantedAt } = {}) {
  const entitlementId = buildEventChestEntitlementId({
    accountId,
    profileKey,
    chestId,
    definitionRevisionId
  });
  return createEventChestEntitlement({
    entitlementId,
    chestId,
    definitionRevisionId,
    grantedAt
  });
}

async function createEntitledProfile(coordinator, username, { accountId = "account-opening", definition }) {
  const entitlement = buildEntitlement({
    accountId,
    profileKey: username,
    chestId: definition.chestId,
    definitionRevisionId: definition.definitionRevisionId,
    grantedAt: "2026-07-28T15:05:00.000Z"
  });
  await coordinator.profiles.ensureProfile(username, {
    linkedAccountId: accountId,
    eventChestEntitlements: {
      schemaVersion: 1,
      items: [entitlement]
    }
  });
  return entitlement;
}

function createRandom(values) {
  const rolls = [...values];
  return () => (rolls.length > 0 ? rolls.shift() : 0);
}

test("event chest opening: available entitlement opens against exact retained revision after event changes", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const historical = buildDefinition({
      title: "Historical Opening Revision",
      definitionRevisionId: "definition_revision_opening_history_1",
      sourceDraftRevisionId: "draft_revision_opening_history_1"
    });
    const newer = buildDefinition({
      title: "Newer Opening Revision",
      definitionRevisionId: "definition_revision_opening_history_2",
      sourceDraftRevisionId: "draft_revision_opening_history_2",
      pool: {
        common: [{ type: "title", cosmeticId: "title_element_touched" }],
        rare: [],
        epic: [],
        legendary: []
      }
    });
    await writeRegistry(dataDir, [historical, newer]);
    await coordinator.eventChestActivationStore.activate({
      chestId: newer.chestId,
      definitionRevisionId: newer.definitionRevisionId
    });
    await coordinator.eventChestActivationStore.end();
    const entitlement = await createEntitledProfile(coordinator, "OpeningHistoryUser", {
      definition: historical
    });

    const result = await coordinator.openEventChestEntitlement({
      username: "OpeningHistoryUser",
      profileKey: "OpeningHistoryUser",
      accountId: "account-opening",
      entitlementId: entitlement.entitlementId,
      random: createRandom([0, 0])
    });

    assert.equal(result.entitlement.status, "opened");
    assert.equal(result.entitlement.definitionRevisionId, historical.definitionRevisionId);
    assert.equal(result.reward.type, "cosmetic");
    assert.equal(result.reward.cosmetic.cosmeticId, "title_first_light");
    const profile = await coordinator.profiles.getProfile("OpeningHistoryUser");
    assert.equal(profile.ownedCosmetics.title.includes("title_first_light"), true);
    assert.equal(profile.ownedCosmetics.title.includes("title_element_touched"), false);
    assert.deepEqual(profile.eventChests, {});
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest opening: duplicate conversion grants configured tokens once and replays", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const definition = buildDefinition({
      duplicateTokenRewards: {
        common: 77,
        rare: 0,
        epic: 0,
        legendary: 0
      }
    });
    await writeRegistry(dataDir, [definition]);
    const entitlement = await createEntitledProfile(coordinator, "OpeningDuplicateUser", {
      definition
    });
    await coordinator.profiles.updateProfile("OpeningDuplicateUser", (current) => ({
      ...current,
      tokens: 10,
      ownedCosmetics: {
        ...current.ownedCosmetics,
        title: [...new Set([...(current.ownedCosmetics?.title ?? []), "title_first_light"])]
      }
    }));

    const first = await coordinator.openEventChestEntitlement({
      username: "OpeningDuplicateUser",
      profileKey: "OpeningDuplicateUser",
      accountId: "account-opening",
      entitlementId: entitlement.entitlementId,
      random: createRandom([0, 0])
    });
    const replay = await coordinator.openEventChestEntitlement({
      username: "OpeningDuplicateUser",
      profileKey: "OpeningDuplicateUser",
      accountId: "account-opening",
      entitlementId: entitlement.entitlementId,
      random: createRandom([0, 0])
    });

    assert.equal(first.reward.type, "tokens");
    assert.equal(first.reward.tokenAmount, 77);
    assert.equal(first.reward.duplicateConverted, true);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.reward, first.reward);
    const profile = await coordinator.profiles.getProfile("OpeningDuplicateUser");
    assert.equal(profile.tokens, 87);
    assert.equal(profile.eventChestEntitlements.items.length, 1);
    assert.equal(profile.eventChestEntitlements.items[0].status, "opened");
    assert.equal(typeof profile.eventChestEntitlements.items[0].openTransactionId, "string");
    assert.equal(typeof profile.eventChestEntitlements.items[0].rewardSettlement, "object");
    assert.equal(JSON.stringify(first).includes("transactionId"), false);
    assert.equal(JSON.stringify(first).includes("rewardSettlement"), false);
    assert.equal(JSON.stringify(first).includes("eventChestEntitlements"), false);
    assert.equal(JSON.stringify(first).includes("account-opening"), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest opening: concurrent opens produce one grant and one stored settlement", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const definition = buildDefinition();
    await writeRegistry(dataDir, [definition]);
    const entitlement = await createEntitledProfile(coordinator, "OpeningConcurrentUser", {
      definition
    });

    const [left, right] = await Promise.all([
      coordinator.openEventChestEntitlement({
        username: "OpeningConcurrentUser",
        profileKey: "OpeningConcurrentUser",
        accountId: "account-opening",
        entitlementId: entitlement.entitlementId,
        random: createRandom([0, 0])
      }),
      coordinator.openEventChestEntitlement({
        username: "OpeningConcurrentUser",
        profileKey: "OpeningConcurrentUser",
        accountId: "account-opening",
        entitlementId: entitlement.entitlementId,
        random: createRandom([0, 0])
      })
    ]);

    assert.equal([left, right].filter((result) => result.replayed).length, 1);
    assert.deepEqual(left.reward, right.reward);
    const profile = await coordinator.profiles.getProfile("OpeningConcurrentUser");
    assert.equal(profile.ownedCosmetics.title.filter((id) => id === "title_first_light").length, 1);
    assert.equal(profile.eventChestEntitlements.items.length, 1);
    assert.equal(profile.eventChestEntitlements.items[0].status, "opened");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest opening: missing, expired, missing revision, and invalid registry reject without mutation", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const definition = buildDefinition();
    await writeRegistry(dataDir, [definition]);
    const entitlement = await createEntitledProfile(coordinator, "OpeningFailureUser", {
      definition
    });
    const beforeMissing = await coordinator.profiles.getProfile("OpeningFailureUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningFailureUser",
        profileKey: "OpeningFailureUser",
        accountId: "account-opening",
        entitlementId: "missing_entitlement"
      }),
      (error) => error?.code === "EVENT_CHEST_OPEN_ENTITLEMENT_NOT_FOUND"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningFailureUser"), beforeMissing);

    await coordinator.profiles.updateProfile("OpeningFailureUser", (current) => ({
      ...current,
      eventChestEntitlements: {
        schemaVersion: 1,
        items: current.eventChestEntitlements.items.map((item) =>
          item.entitlementId === entitlement.entitlementId ? { ...item, status: "expired" } : item
        )
      }
    }));
    const beforeExpired = await coordinator.profiles.getProfile("OpeningFailureUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningFailureUser",
        profileKey: "OpeningFailureUser",
        accountId: "account-opening",
        entitlementId: entitlement.entitlementId
      }),
      (error) => error?.code === "EVENT_CHEST_OPEN_ENTITLEMENT_EXPIRED"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningFailureUser"), beforeExpired);

    const missingRevision = await createEntitledProfile(coordinator, "OpeningMissingRevisionUser", {
      definition: {
        ...definition,
        definitionRevisionId: "definition_revision_missing"
      }
    });
    const beforeMissingRevision = await coordinator.profiles.getProfile("OpeningMissingRevisionUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningMissingRevisionUser",
        profileKey: "OpeningMissingRevisionUser",
        accountId: "account-opening",
        entitlementId: missingRevision.entitlementId
      }),
      (error) => error?.code === "EVENT_CHEST_DEFINITION_REVISION_NOT_FOUND"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningMissingRevisionUser"), beforeMissingRevision);

  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest opening: invalid registry, invalid reward, and disabled duplicate conversion fail closed", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const definition = buildDefinition();
    const registryPath = path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, "{ nope", "utf8");
    const entitlement = await createEntitledProfile(coordinator, "OpeningInvalidRegistryUser", {
      definition
    });
    const beforeInvalidRegistry = await coordinator.profiles.getProfile("OpeningInvalidRegistryUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningInvalidRegistryUser",
        profileKey: "OpeningInvalidRegistryUser",
        accountId: "account-opening",
        entitlementId: entitlement.entitlementId
      }),
      (error) => error?.code === "EVENT_CHEST_ACTIVATION_REGISTRY_UNAVAILABLE"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningInvalidRegistryUser"), beforeInvalidRegistry);

    const invalidRewardDefinition = buildDefinition({
      pool: {
        common: [{ type: "title", cosmeticId: "missing_event_chest_title" }],
        rare: [],
        epic: [],
        legendary: []
      }
    });
    await writeRegistry(dataDir, [invalidRewardDefinition]);
    const invalidReward = await createEntitledProfile(coordinator, "OpeningInvalidRewardUser", {
      definition: invalidRewardDefinition
    });
    const beforeInvalidReward = await coordinator.profiles.getProfile("OpeningInvalidRewardUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningInvalidRewardUser",
        profileKey: "OpeningInvalidRewardUser",
        accountId: "account-opening",
        entitlementId: invalidReward.entitlementId,
        random: createRandom([0, 0])
      }),
      (error) => error?.code === "EVENT_CHEST_ACTIVATION_REGISTRY_UNAVAILABLE"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningInvalidRewardUser"), beforeInvalidReward);

    const duplicateDisabledDefinition = buildDefinition({
      definitionRevisionId: "definition_revision_duplicate_disabled",
      sourceDraftRevisionId: "draft_revision_duplicate_disabled",
      allowOpensAfterCompleteAsDuplicateConversion: false
    });
    await writeRegistry(dataDir, [duplicateDisabledDefinition]);
    const duplicateDisabled = await createEntitledProfile(coordinator, "OpeningDuplicateDisabledUser", {
      definition: duplicateDisabledDefinition
    });
    await coordinator.profiles.updateProfile("OpeningDuplicateDisabledUser", (current) => ({
      ...current,
      ownedCosmetics: {
        ...current.ownedCosmetics,
        title: [...new Set([...(current.ownedCosmetics?.title ?? []), "title_first_light"])]
      }
    }));
    const beforeDuplicateDisabled = await coordinator.profiles.getProfile("OpeningDuplicateDisabledUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningDuplicateDisabledUser",
        profileKey: "OpeningDuplicateDisabledUser",
        accountId: "account-opening",
        entitlementId: duplicateDisabled.entitlementId,
        random: createRandom([0, 0])
      }),
      (error) => error?.code === "EVENT_CHEST_OPEN_DUPLICATE_CONVERSION_DISABLED"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningDuplicateDisabledUser"), beforeDuplicateDisabled);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest opening: malformed opened settlement fails closed without grant", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const definition = buildDefinition();
    await writeRegistry(dataDir, [definition]);
    const entitlement = await createEntitledProfile(coordinator, "OpeningMalformedSettlementUser", {
      definition
    });
    await coordinator.profiles.updateProfile("OpeningMalformedSettlementUser", (current) => ({
      ...current,
      tokens: 10,
      eventChestEntitlements: {
        schemaVersion: 1,
        items: current.eventChestEntitlements.items.map((item) =>
          item.entitlementId === entitlement.entitlementId
            ? {
                ...item,
                status: "opened",
                openedAt: "2026-07-28T15:10:00.000Z",
                openTransactionId: "event_chest_open_bad",
                rewardSettlement: { nope: true }
              }
            : item
        )
      }
    }));
    const before = await coordinator.profiles.getProfile("OpeningMalformedSettlementUser");
    await assert.rejects(
      coordinator.openEventChestEntitlement({
        username: "OpeningMalformedSettlementUser",
        profileKey: "OpeningMalformedSettlementUser",
        accountId: "account-opening",
        entitlementId: entitlement.entitlementId
      }),
      (error) => error?.code === "EVENT_CHEST_OPEN_SETTLEMENT_INVALID"
    );
    assert.deepEqual(await coordinator.profiles.getProfile("OpeningMalformedSettlementUser"), before);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest opening: replay with missing current cosmetic metadata does not grant again", () => {
  const settlement = createEventChestRewardSettlement({
    entitlementId: "event_chest_entitlement_replay_missing_metadata",
    chestId: "opening_event_chest",
    definitionRevisionId: "definition_revision_opening_1",
    transactionId: "event_chest_open_replay_missing_metadata",
    settledAt: "2026-07-28T15:15:00.000Z",
    reward: {
      type: "cosmetic",
      rarity: "common",
      cosmetic: {
        type: "title",
        cosmeticId: "missing_replay_cosmetic"
      },
      tokenAmount: 0,
      duplicateConverted: false
    }
  });
  const response = buildEventChestOpenResponse({
    entitlement: {
      entitlementId: settlement.entitlementId,
      chestId: settlement.chestId,
      definitionRevisionId: settlement.definitionRevisionId,
      status: "opened",
      openedAt: settlement.settledAt
    },
    settlement,
    replayed: true
  });

  assert.equal(response.replayed, true);
  assert.equal(response.reward.cosmetic.cosmeticId, "missing_replay_cosmetic");
  assert.equal(response.reward.cosmetic.name, "missing_replay_cosmetic");
});

test("event chest opening: entitlement pity is shared by chest across revisions and replay-safe", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  try {
    const pity = {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity),
      epicPlusEnabled: true,
      legendaryEnabled: true,
      epicPlusThreshold: 2,
      legendaryThreshold: 3
    };
    const firstDefinition = buildDefinition({
      definitionRevisionId: "definition_revision_entitlement_pity_1",
      sourceDraftRevisionId: "draft_revision_entitlement_pity_1",
      pool: structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      pity
    });
    const secondDefinition = buildDefinition({
      definitionRevisionId: "definition_revision_entitlement_pity_2",
      sourceDraftRevisionId: "draft_revision_entitlement_pity_2",
      publishedAt: "2026-07-28T16:00:00.000Z",
      pool: structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      pity
    });
    await writeRegistry(dataDir, [firstDefinition, secondDefinition]);

    const firstEntitlement = buildEntitlement({
      accountId: "account-opening",
      profileKey: "OpeningPityUser",
      chestId: firstDefinition.chestId,
      definitionRevisionId: firstDefinition.definitionRevisionId,
      grantedAt: "2026-07-28T16:05:00.000Z"
    });
    const secondEntitlement = buildEntitlement({
      accountId: "account-opening",
      profileKey: "OpeningPityUser",
      chestId: secondDefinition.chestId,
      definitionRevisionId: secondDefinition.definitionRevisionId,
      grantedAt: "2026-07-28T16:10:00.000Z"
    });
    await coordinator.profiles.ensureProfile("OpeningPityUser", {
      linkedAccountId: "account-opening",
      eventChestEntitlements: {
        schemaVersion: 1,
        items: [firstEntitlement, secondEntitlement]
      }
    });

    const first = await coordinator.openEventChestEntitlement({
      username: "OpeningPityUser",
      profileKey: "OpeningPityUser",
      accountId: "account-opening",
      entitlementId: firstEntitlement.entitlementId,
      random: createRandom([0, 0])
    });
    assert.equal(first.reward.rarity, "common");
    assert.equal(first.pityGuarantee, null);

    const replay = await coordinator.openEventChestEntitlement({
      username: "OpeningPityUser",
      profileKey: "OpeningPityUser",
      accountId: "account-opening",
      entitlementId: firstEntitlement.entitlementId,
      random: () => {
        throw new Error("replay must not reroll");
      }
    });
    assert.equal(replay.replayed, true);

    const second = await coordinator.openEventChestEntitlement({
      username: "OpeningPityUser",
      profileKey: "OpeningPityUser",
      accountId: "account-opening",
      entitlementId: secondEntitlement.entitlementId,
      random: createRandom([0, 0])
    });
    assert.equal(second.reward.rarity, "epic");
    assert.equal(second.pityGuarantee, "epic_plus");
    const profile = await coordinator.profiles.getProfile("OpeningPityUser");
    assert.equal(profile.eventChestPity.byChestId[firstDefinition.chestId].epicPlusMisses, 0);
    assert.equal(profile.eventChestPity.byChestId[firstDefinition.chestId].legendaryMisses, 2);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
