import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import {
  EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS,
  buildEventChestDraftDeletionReferenceProof
} from "../../src/state/eventChestDeletionReferenceProof.js";
import {
  EVENT_CHEST_DRAFT_STORE_FILENAME,
  EventChestDraftStore
} from "../../src/state/eventChestDraftStore.js";
import {
  EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
  EVENT_CHEST_REGISTRY_ID
} from "../../src/state/eventChestRegistryStore.js";
import { EVENT_CHEST_ACTIVATION_SCHEMA_VERSION } from "../../src/state/eventChestActivationStore.js";
import { DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET } from "../../src/state/eventChestDefinitions.js";
import { DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } from "../../src/state/dailyElementChestSystem.js";
import { createEventChestRewardSettlement } from "../../src/state/eventChestOpening.js";
import { createEventChestDirectOpeningSettlement } from "../../src/state/eventChestDirectOpeningSettlement.js";

const NOW = "2026-08-01T12:00:00.000Z";

async function createTempDataDir(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-proof-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function buildDefinition(chestId, overrides = {}) {
  return structuredClone({
    ...DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
    chestId,
    lifecycle: { status: "draft", defaultPreset: false },
    ...overrides
  });
}

function buildDraftDocument({
  draftId = "draft_candidate",
  draftRevisionId = "draft_revision_candidate_1",
  chestId = "event_chest_candidate",
  extraDrafts = [],
  overrides = {}
} = {}) {
  return {
    schemaVersion: 1,
    drafts: [
      {
        draftId,
        draftRevisionId,
        chestId,
        status: "ready",
        definition: buildDefinition(chestId),
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: "Admin",
        updatedBy: "Admin",
        copiedFromDraftId: null,
        copiedFromDraftRevisionId: null,
        copiedFromChestId: null,
        copiedFromDefinitionRevisionId: null,
        ...overrides
      },
      ...extraDrafts
    ]
  };
}

function buildRegistry(definitions) {
  return {
    schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
    registryId: EVENT_CHEST_REGISTRY_ID,
    registryRevisionId: "registry_revision_proof",
    publishedAt: NOW,
    publishedBy: "Admin",
    definitions
  };
}

function buildPublishedDefinition(chestId, overrides = {}) {
  return buildDefinition(chestId, {
    lifecycle: { status: "inactive", defaultPreset: false },
    definitionRevisionId: `definition_revision_${chestId}_1`,
    publishedAt: NOW,
    publishedBy: "Admin",
    updatedAt: NOW,
    updatedBy: "Admin",
    sourceDraftId: null,
    sourceDraftRevisionId: null,
    ...overrides
  });
}

function buildProof(overrides = {}) {
  return buildEventChestDraftDeletionReferenceProof({
    requestedDraftId: "draft_candidate",
    expectedDraftRevisionId: "draft_revision_candidate_1",
    draftDocument: buildDraftDocument(),
    registryDocument: null,
    lifecycleDocument: null,
    profilesDocument: null,
    ...overrides
  });
}

test("event chest deletion proof: strict reads are non-repairing and missing reference stores stay absent", async (t) => {
  const dataDir = await createTempDataDir(t);
  const coordinator = new StateCoordinator({ dataDir });
  const draft = await coordinator.eventChestDraftStore.createDraft({ actor: "Admin" });
  const draftPath = path.join(dataDir, "server-data", EVENT_CHEST_DRAFT_STORE_FILENAME);
  const beforeDraft = await fs.readFile(draftPath, "utf8");

  const proof = await coordinator.inspectEventChestDraftDeletionReferencesForAuthority({
    draftId: draft.draftId,
    expectedDraftRevisionId: draft.draftRevisionId
  });

  assert.equal(proof.status, "eligible");
  assert.equal(proof.eligible, true);
  assert.deepEqual(proof.reasonCodes, []);
  assert.equal(await fs.readFile(draftPath, "utf8"), beforeDraft);
  await assert.rejects(fs.access(path.join(dataDir, "profiles.json")), /ENOENT/);
  await assert.rejects(
    fs.access(path.join(dataDir, "server-data", "event-chest-registry.json")),
    /ENOENT/
  );
  await assert.rejects(
    fs.access(path.join(dataDir, "server-data", "event-chest-activation.json")),
    /ENOENT/
  );
});

test("event chest deletion proof: malformed primary data is unavailable without backup restoration", async (t) => {
  const dataDir = await createTempDataDir(t);
  const coordinator = new StateCoordinator({ dataDir });
  const draft = await coordinator.eventChestDraftStore.createDraft({ actor: "Admin" });
  const registryPath = path.join(dataDir, "server-data", "event-chest-registry.json");
  const backupPath = `${registryPath}.backup-20260801-120000.json`;
  const malformed = "{malformed-current-registry";
  await fs.writeFile(registryPath, malformed, "utf8");
  await fs.writeFile(backupPath, JSON.stringify(buildRegistry([])), "utf8");

  const proof = await coordinator.inspectEventChestDraftDeletionReferencesForAuthority({
    draftId: draft.draftId,
    expectedDraftRevisionId: draft.draftRevisionId
  });

  assert.equal(proof.status, "unavailable");
  assert.equal(proof.eligible, false);
  assert.deepEqual(proof.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_UNAVAILABLE
  ]);
  assert.equal(await fs.readFile(registryPath, "utf8"), malformed);
  assert.equal(await fs.readFile(backupPath, "utf8"), JSON.stringify(buildRegistry([])));
});

test("event chest deletion proof: malformed and ambiguous draft identities fail closed", () => {
  const mismatch = buildProof({
    draftDocument: buildDraftDocument({
      overrides: { definition: buildDefinition("different_chest") }
    })
  });
  assert.equal(mismatch.status, "unavailable");
  assert.deepEqual(mismatch.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_STORE_MALFORMED
  ]);

  const candidate = buildDraftDocument().drafts[0];
  const duplicate = buildProof({
    draftDocument: {
      schemaVersion: 1,
      drafts: [candidate, { ...structuredClone(candidate) }]
    }
  });
  assert.equal(duplicate.status, "unavailable");
  assert.deepEqual(duplicate.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_STORE_MALFORMED
  ]);

  const stale = buildProof({ expectedDraftRevisionId: "draft_revision_stale" });
  assert.equal(stale.status, "blocked");
  assert.deepEqual(stale.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REVISION_MISMATCH
  ]);
});

test("event chest deletion proof: structurally malformed registry, lifecycle, and profiles are unavailable", () => {
  const malformedRegistry = buildProof({
    registryDocument: {
      schemaVersion: 1,
      registryId: EVENT_CHEST_REGISTRY_ID,
      registryRevisionId: "registry_revision_malformed",
      publishedAt: NOW,
      definitions: "not-an-array"
    }
  });
  assert.equal(malformedRegistry.status, "unavailable");
  assert.deepEqual(malformedRegistry.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_MALFORMED
  ]);

  const malformedLifecycle = buildProof({
    lifecycleDocument: {
      schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
      active: { chestId: "event_chest_candidate" },
      revisionStates: {},
      history: []
    }
  });
  assert.equal(malformedLifecycle.status, "unavailable");
  assert.deepEqual(malformedLifecycle.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.LIFECYCLE_MALFORMED
  ]);

  const malformedProfiles = buildProof({ profilesDocument: { profiles: [] } });
  assert.equal(malformedProfiles.status, "unavailable");
  assert.deepEqual(malformedProfiles.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILES_MALFORMED
  ]);
});

test("event chest deletion proof: draft, registry, and lifecycle references are bounded blockers", () => {
  const source = buildDraftDocument().drafts[0];
  const child = {
    ...structuredClone(source),
    draftId: "draft_child",
    draftRevisionId: "draft_revision_child_1",
    chestId: "event_chest_child",
    definition: buildDefinition("event_chest_child"),
    copiedFromDraftId: source.draftId,
    copiedFromDraftRevisionId: source.draftRevisionId
  };
  const draftReference = buildProof({
    draftDocument: buildDraftDocument({ extraDrafts: [child] })
  });
  assert.equal(draftReference.eligible, false);
  assert.ok(
    draftReference.reasonCodes.includes(
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REFERENCED_BY_DRAFT
    )
  );

  const revisionOnlyChildReference = buildProof({
    draftDocument: buildDraftDocument({
      extraDrafts: [
        {
          ...child,
          copiedFromDraftId: "draft_different_source",
          copiedFromDraftRevisionId: source.draftRevisionId
        }
      ]
    })
  });
  assert.ok(
    revisionOnlyChildReference.reasonCodes.includes(
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REFERENCED_BY_DRAFT
    )
  );

  const registryReference = buildProof({
    registryDocument: buildRegistry([
      buildPublishedDefinition("event_chest_published_copy", {
        sourceDraftId: "draft_candidate",
        sourceDraftRevisionId: "draft_revision_candidate_1"
      }),
      buildPublishedDefinition("event_chest_candidate")
    ])
  });
  assert.equal(registryReference.eligible, false);
  assert.ok(
    registryReference.reasonCodes.includes(
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SOURCE_REFERENCE
    )
  );
  assert.ok(
    registryReference.reasonCodes.includes(
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SHARED_CHEST
    )
  );

  const registryRevisionReference = buildProof({
    registryDocument: buildRegistry([
      buildPublishedDefinition("event_chest_published_revision_copy", {
        sourceDraftId: "draft_different_source",
        sourceDraftRevisionId: "draft_revision_candidate_1"
      })
    ])
  });
  assert.deepEqual(registryRevisionReference.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SOURCE_REFERENCE
  ]);

  const lifecycleReference = buildProof({
    lifecycleDocument: {
      schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
      active: {
        activationRevisionId: "activation_candidate",
        chestId: "event_chest_candidate",
        definitionRevisionId: "definition_revision_candidate_1",
        activatedAt: NOW,
        activatedBy: "PrivateAdmin",
        updatedAt: NOW,
        updatedBy: "PrivateAdmin"
      },
      revisionStates: {},
      history: []
    }
  });
  assert.equal(lifecycleReference.eligible, false);
  assert.deepEqual(lifecycleReference.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.LIFECYCLE_REFERENCE
  ]);
  assert.equal(JSON.stringify(lifecycleReference).includes("PrivateAdmin"), false);
});

test("event chest deletion proof: every persisted profile reference shape is detected without private output", () => {
  const chestId = "event_chest_candidate";
  const definitionRevisionId = "definition_revision_candidate_1";
  const entitlementSettlement = createEventChestRewardSettlement({
    entitlementId: "private_entitlement_id",
    chestId,
    definitionRevisionId,
    transactionId: "private_transaction_id",
    settledAt: NOW,
    reward: {
      type: "tokens",
      rarity: "common",
      cosmetic: null,
      tokenAmount: 25,
      duplicateConverted: false
    },
    tokenBalance: 500
  });
  const directSettlement = createEventChestDirectOpeningSettlement({
    requestId: "private_request_123",
    chestId,
    definitionRevisionId,
    method: "paid",
    settledAt: NOW,
    costCharged: 100,
    tokenBalance: 400,
    reward: {
      type: "tokens",
      rarity: "common",
      cosmetic: null,
      tokenAmount: 25,
      duplicateConverted: false
    }
  });
  const profilesDocument = [
    {
      username: "PrivatePlayer",
      eventChests: {
        [chestId]: {
          schemaVersion: 1,
          chestId,
          totalOpens: 1,
          paidOpens: 1,
          freeOpens: 0,
          participation: {
            firstDefinitionSeenAt: NOW,
            lastDefinitionSeenAt: NOW,
            definitionRevisionIdsSeen: [definitionRevisionId]
          }
        }
      },
      eventChestPity: {
        schemaVersion: 1,
        byChestId: {
          [chestId]: {
            epicPlusMisses: 1,
            legendaryMisses: 1,
            updatedAt: NOW
          }
        }
      },
      eventChestEntitlements: {
        schemaVersion: 1,
        items: [
          {
            schemaVersion: 1,
            entitlementId: "private_entitlement_id",
            chestId,
            definitionRevisionId,
            grantedAt: NOW,
            grantSource: "active_event",
            status: "opened",
            openedAt: NOW,
            openTransactionId: "private_transaction_id",
            rewardSettlement: entitlementSettlement
          }
        ]
      },
      eventChestDirectOpenings: {
        schemaVersion: 1,
        settlements: [directSettlement],
        invalidRequestIds: []
      }
    }
  ];

  const proof = buildProof({ profilesDocument });
  assert.equal(proof.status, "blocked");
  assert.deepEqual(proof.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILE_REFERENCE
  ]);
  assert.deepEqual(proof.referenceCategories, [
    "profile_direct_settlement",
    "profile_entitlement",
    "profile_entitlement_settlement",
    "profile_pity",
    "profile_progress"
  ]);
  const serialized = JSON.stringify(proof);
  for (const privateValue of [
    "PrivatePlayer",
    "private_entitlement_id",
    "private_transaction_id",
    "private_request_123"
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("event chest deletion proof: malformed profile sections block and Daily Chest data stays isolated", () => {
  const malformed = buildProof({
    profilesDocument: [
      {
        username: "Player",
        eventChestEntitlements: { schemaVersion: 1, items: "not-an-array" }
      }
    ]
  });
  assert.equal(malformed.status, "unavailable");
  assert.deepEqual(malformed.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILES_MALFORMED
  ]);

  const dailyOnly = buildProof({
    profilesDocument: [
      {
        username: "Player",
        dailyElementChest: {
          totalOpens: 20,
          lastFreeOpenDateKey: NOW
        }
      }
    ]
  });
  assert.equal(dailyOnly.status, "eligible");
  assert.deepEqual(dailyOnly.referenceCategories, []);

  const reservedDailyDefinition = buildProof({
    draftDocument: buildDraftDocument({
      chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID
    })
  });
  assert.equal(reservedDailyDefinition.status, "blocked");
  assert.deepEqual(reservedDailyDefinition.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DAILY_CHEST_RESERVED
  ]);
  assert.deepEqual(reservedDailyDefinition.referenceCategories, ["daily_chest"]);
});

test("event chest authoring queue: publication cannot interleave with a future delete critical section", async (t) => {
  const dataDir = await createTempDataDir(t);
  const definition = buildDefinition("event_chest_queue");
  const draft = {
    draftId: "draft_queue",
    draftRevisionId: "draft_revision_queue_1",
    definition
  };
  let releasePublish;
  let notifyPublishStarted;
  const publishGate = new Promise((resolve) => {
    releasePublish = resolve;
  });
  const publishStarted = new Promise((resolve) => {
    notifyPublishStarted = resolve;
  });
  const order = [];
  const coordinator = new StateCoordinator({
    dataDir,
    eventChestDraftStore: {
      getDraft: async () => structuredClone(draft)
    },
    eventChestRegistryStore: {
      publishEventChestDraftDefinition: async () => {
        order.push("publish:start");
        notifyPublishStarted();
        await publishGate;
        order.push("publish:end");
        const publishedDefinition = {
          ...definition,
          definitionRevisionId: "definition_revision_queue_1",
          publishedAt: NOW
        };
        return {
          publishedDefinition,
          definitions: [publishedDefinition],
          warnings: [],
          errors: [],
          source: "file",
          registry: {
            registryRevisionId: "registry_revision_queue",
            publishedAt: NOW
          }
        };
      }
    }
  });

  const publish = coordinator.publishEventChestDraftForAdmin({
    draftId: draft.draftId,
    expectedDraftRevisionId: draft.draftRevisionId,
    actor: "Admin"
  });
  await publishStarted;
  const futureDeleteCriticalSection = coordinator.runEventChestAuthoringMutation(async () => {
    order.push("future-delete:start");
    order.push("future-delete:end");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["publish:start"]);

  releasePublish();
  await Promise.all([publish, futureDeleteCriticalSection]);
  assert.deepEqual(order, [
    "publish:start",
    "publish:end",
    "future-delete:start",
    "future-delete:end"
  ]);

  let releaseFutureDelete;
  let notifyFutureDeleteStarted;
  const futureDeleteGate = new Promise((resolve) => {
    releaseFutureDelete = resolve;
  });
  const futureDeleteStarted = new Promise((resolve) => {
    notifyFutureDeleteStarted = resolve;
  });
  const reverseOrder = [];
  const reverseCoordinator = new StateCoordinator({
    dataDir,
    eventChestDraftStore: {
      getDraft: async () => {
        reverseOrder.push("publish:read-draft");
        return structuredClone(draft);
      }
    },
    eventChestRegistryStore: {
      publishEventChestDraftDefinition: async () => {
        reverseOrder.push("publish:write-registry");
        const publishedDefinition = {
          ...definition,
          definitionRevisionId: "definition_revision_queue_2",
          publishedAt: NOW
        };
        return {
          publishedDefinition,
          definitions: [publishedDefinition],
          warnings: [],
          errors: [],
          source: "file",
          registry: {
            registryRevisionId: "registry_revision_queue_2",
            publishedAt: NOW
          }
        };
      }
    }
  });
  const futureDeleteFirst = reverseCoordinator.runEventChestAuthoringMutation(async () => {
    reverseOrder.push("future-delete:start");
    notifyFutureDeleteStarted();
    await futureDeleteGate;
    reverseOrder.push("future-delete:end");
  });
  await futureDeleteStarted;
  const queuedPublish = reverseCoordinator.publishEventChestDraftForAdmin({
    draftId: draft.draftId,
    expectedDraftRevisionId: draft.draftRevisionId,
    actor: "Admin"
  });
  await Promise.resolve();
  assert.deepEqual(reverseOrder, ["future-delete:start"]);
  releaseFutureDelete();
  await Promise.all([futureDeleteFirst, queuedPublish]);
  assert.deepEqual(reverseOrder, [
    "future-delete:start",
    "future-delete:end",
    "publish:read-draft",
    "publish:write-registry"
  ]);
});
