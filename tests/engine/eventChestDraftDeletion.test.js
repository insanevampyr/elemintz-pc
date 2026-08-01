import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET } from "../../src/state/eventChestDefinitions.js";
import { DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } from "../../src/state/dailyElementChestSystem.js";
import {
  EVENT_CHEST_DRAFT_NOT_FOUND,
  EVENT_CHEST_DRAFT_STORE_FILENAME
} from "../../src/state/eventChestDraftStore.js";
import { EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS } from "../../src/state/eventChestDeletionReferenceProof.js";
import { getStaticEventChestRegistryFallback } from "../../src/state/eventChestRegistryStore.js";
import { createEventChestDirectOpeningSettlement } from "../../src/state/eventChestDirectOpeningSettlement.js";

const NOW = "2026-08-01T12:00:00.000Z";

async function createHarness(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-delete-"));
  let revisionIndex = 0;
  const coordinator = new StateCoordinator({
    dataDir,
    now: () => NOW,
    randomUUID: () => `delete-test-${++revisionIndex}`
  });
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return { coordinator, dataDir };
}

function buildDefinition(chestId) {
  return structuredClone({
    ...DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
    chestId,
    lifecycle: { status: "draft", defaultPreset: false }
  });
}

async function saveDraft(
  coordinator,
  { draftId = "draft_delete_candidate", chestId = "event_chest_delete_candidate" } = {}
) {
  return coordinator.eventChestDraftStore.saveDraft({
    draftId,
    chestId,
    status: "ready",
    definition: buildDefinition(chestId),
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "PrivateAdmin",
    updatedBy: "PrivateAdmin"
  });
}

function deleteDraft(coordinator, draft, overrides = {}) {
  return coordinator.deleteEventChestDraftForAdmin({
    draftId: draft.draftId,
    expectedDraftRevisionId: draft.draftRevisionId,
    ...overrides
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function assertDraftPresent(coordinator, draftId) {
  const draft = await coordinator.eventChestDraftStore.getDraft(draftId);
  assert.equal(draft?.draftId, draftId);
}

test("event chest draft deletion: eligible exact draft is durably removed without touching other stores", async (t) => {
  const { coordinator, dataDir } = await createHarness(t);
  const candidate = await saveDraft(coordinator);
  const other = await saveDraft(coordinator, {
    draftId: "draft_keep_exact",
    chestId: "event_chest_keep_exact"
  });

  await coordinator.eventChestRegistryStore.store.write(
    getStaticEventChestRegistryFallback()
  );
  await coordinator.eventChestActivationStore.activate({
    chestId: "event_chest_unrelated_lifecycle",
    definitionRevisionId: "definition_revision_unrelated_lifecycle",
    actor: "PrivateAdmin"
  });
  await writeJson(coordinator.profiles.store.filePath, [
    {
      username: "PrivatePlayer",
      dailyElementChest: { totalOpens: 3, lastFreeOpenDateKey: "2026-08-01" }
    }
  ]);

  const protectedPaths = [
    coordinator.eventChestRegistryStore.filePath,
    coordinator.eventChestActivationStore.filePath,
    coordinator.profiles.store.filePath
  ];
  const beforeProtected = await Promise.all(protectedPaths.map(readOptionalFile));
  const result = await deleteDraft(coordinator, candidate);

  assert.deepEqual(result, {
    schemaVersion: 1,
    status: "deleted",
    deleted: true,
    draft: {
      draftId: candidate.draftId,
      draftRevisionId: candidate.draftRevisionId,
      chestId: candidate.chestId
    },
    reasonCodes: []
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "deleted",
    "draft",
    "reasonCodes",
    "schemaVersion",
    "status"
  ]);
  assert.equal(JSON.stringify(result).includes("PrivateAdmin"), false);
  assert.equal(JSON.stringify(result).includes("PrivatePlayer"), false);

  const restarted = new StateCoordinator({ dataDir });
  const remaining = await restarted.eventChestDraftStore.listDrafts();
  assert.deepEqual(remaining.map((draft) => draft.draftId), [other.draftId]);
  assert.equal(remaining[0].draftRevisionId, other.draftRevisionId);

  const afterProtected = await Promise.all(protectedPaths.map(readOptionalFile));
  assert.deepEqual(afterProtected, beforeProtected);
});

test("event chest draft deletion: malformed request, missing draft, and stale revision are distinct and non-mutating", async (t) => {
  const { coordinator } = await createHarness(t);
  const candidate = await saveDraft(coordinator);

  const missingRevision = await coordinator.deleteEventChestDraftForAdmin({
    draftId: candidate.draftId
  });
  assert.equal(missingRevision.status, "blocked");
  assert.deepEqual(missingRevision.reasonCodes, ["expected_revision_required"]);

  const malformedDraftId = await coordinator.deleteEventChestDraftForAdmin({
    draftId: ` ${candidate.draftId}`,
    expectedDraftRevisionId: candidate.draftRevisionId
  });
  assert.equal(malformedDraftId.status, "blocked");
  assert.deepEqual(malformedDraftId.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.INVALID_REQUEST
  ]);

  const missing = await coordinator.deleteEventChestDraftForAdmin({
    draftId: "draft_does_not_exist",
    expectedDraftRevisionId: "draft_revision_does_not_exist"
  });
  assert.equal(missing.status, "not_found");
  assert.deepEqual(missing.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_NOT_FOUND
  ]);

  const stale = await deleteDraft(coordinator, candidate, {
    expectedDraftRevisionId: "draft_revision_stale"
  });
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.reasonCodes, [
    EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REVISION_MISMATCH
  ]);
  await assertDraftPresent(coordinator, candidate.draftId);
});

test("event chest draft deletion: draft, registry, shared chest, and lifecycle references block", async (t) => {
  await t.test("child draft lineage", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    await coordinator.eventChestDraftStore.duplicateDraft({
      sourceDraftId: candidate.draftId,
      expectedSourceDraftRevisionId: candidate.draftRevisionId,
      actor: "PrivateAdmin"
    });
    const result = await deleteDraft(coordinator, candidate);
    assert.equal(result.status, "blocked");
    assert.ok(
      result.reasonCodes.includes(
        EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_REFERENCED_BY_DRAFT
      )
    );
    await assertDraftPresent(coordinator, candidate.draftId);
  });

  await t.test("registry source identity", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    await coordinator.eventChestRegistryStore.publishEventChestDraftDefinition({
      definition: buildDefinition("event_chest_published_other"),
      actor: "PrivateAdmin",
      sourceDraftId: candidate.draftId,
      sourceDraftRevisionId: candidate.draftRevisionId
    });
    const result = await deleteDraft(coordinator, candidate);
    assert.equal(result.status, "blocked");
    assert.ok(
      result.reasonCodes.includes(
        EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SOURCE_REFERENCE
      )
    );
    await assertDraftPresent(coordinator, candidate.draftId);
  });

  await t.test("shared published chest", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    await coordinator.eventChestRegistryStore.publishEventChestDraftDefinition({
      definition: candidate.definition,
      actor: "PrivateAdmin",
      sourceDraftId: "draft_other_source",
      sourceDraftRevisionId: "draft_revision_other_source"
    });
    const result = await deleteDraft(coordinator, candidate);
    assert.equal(result.status, "blocked");
    assert.ok(
      result.reasonCodes.includes(
        EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_SHARED_CHEST
      )
    );
    await assertDraftPresent(coordinator, candidate.draftId);
  });

  await t.test("lifecycle state and history", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    const definitionRevisionId = "definition_revision_lifecycle_candidate";
    await coordinator.eventChestActivationStore.activate({
      chestId: candidate.chestId,
      definitionRevisionId,
      actor: "PrivateAdmin"
    });
    await coordinator.eventChestActivationStore.deactivate({
      chestId: candidate.chestId,
      definitionRevisionId,
      actor: "PrivateAdmin"
    });
    const result = await deleteDraft(coordinator, candidate);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.reasonCodes, [
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.LIFECYCLE_REFERENCE
    ]);
    await assertDraftPresent(coordinator, candidate.draftId);
  });
});

test("event chest draft deletion: every persisted profile reference category blocks with redacted output", async (t) => {
  const profileCases = [
    {
      name: "progress",
      build: (draft) => ({
        eventChests: {
          [draft.chestId]: {
            schemaVersion: 1,
            chestId: draft.chestId,
            totalOpens: 1,
            participation: {
              firstDefinitionSeenAt: NOW,
              lastDefinitionSeenAt: NOW,
              definitionRevisionIdsSeen: ["definition_revision_private"]
            }
          }
        }
      })
    },
    {
      name: "pity",
      build: (draft) => ({
        eventChestPity: {
          schemaVersion: 1,
          byChestId: {
            [draft.chestId]: {
              epicPlusMisses: 1,
              legendaryMisses: 2,
              updatedAt: NOW
            }
          }
        }
      })
    },
    {
      name: "entitlement",
      build: (draft) => ({
        eventChestEntitlements: {
          schemaVersion: 1,
          items: [
            {
              schemaVersion: 1,
              entitlementId: "private_entitlement_id",
              chestId: draft.chestId,
              definitionRevisionId: "definition_revision_private",
              grantedAt: NOW,
              grantSource: "active_event",
              status: "available",
              openedAt: null,
              openTransactionId: null,
              rewardSettlement: null
            }
          ]
        }
      })
    },
    {
      name: "direct settlement and replay",
      build: (draft) => ({
        eventChestDirectOpenings: {
          schemaVersion: 1,
          settlements: [
            createEventChestDirectOpeningSettlement({
              requestId: "private_request_id",
              chestId: draft.chestId,
              definitionRevisionId: "definition_revision_private",
              method: "paid",
              settledAt: NOW,
              costCharged: 50,
              tokenBalance: 100,
              reward: {
                type: "tokens",
                rarity: "common",
                cosmetic: null,
                tokenAmount: 5,
                duplicateConverted: false
              }
            })
          ],
          invalidRequestIds: ["invalid_private_request_id"]
        }
      })
    }
  ];

  for (const profileCase of profileCases) {
    await t.test(profileCase.name, async (t) => {
      const { coordinator } = await createHarness(t);
      const candidate = await saveDraft(coordinator);
      await writeJson(coordinator.profiles.store.filePath, [
        {
          username: "PrivatePlayer",
          ...profileCase.build(candidate)
        }
      ]);
      const result = await deleteDraft(coordinator, candidate);
      assert.equal(result.status, "blocked");
      assert.deepEqual(result.reasonCodes, [
        EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILE_REFERENCE
      ]);
      const serialized = JSON.stringify(result);
      for (const privateValue of [
        "PrivatePlayer",
        "private_entitlement_id",
        "private_request_id",
        "invalid_private_request_id"
      ]) {
        assert.equal(serialized.includes(privateValue), false);
      }
      await assertDraftPresent(coordinator, candidate.draftId);
    });
  }
});

test("event chest draft deletion: malformed strict stores fail unavailable without repair", async (t) => {
  const cases = [
    {
      name: "draft",
      path: (coordinator) => coordinator.eventChestDraftStore.filePath,
      reason: EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_STORE_UNAVAILABLE
    },
    {
      name: "registry",
      path: (coordinator) => coordinator.eventChestRegistryStore.filePath,
      reason: EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.REGISTRY_UNAVAILABLE
    },
    {
      name: "lifecycle",
      path: (coordinator) => coordinator.eventChestActivationStore.filePath,
      reason: EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.LIFECYCLE_UNAVAILABLE
    },
    {
      name: "profiles",
      path: (coordinator) => coordinator.profiles.store.filePath,
      reason: EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.PROFILES_UNAVAILABLE
    }
  ];

  for (const malformedCase of cases) {
    await t.test(malformedCase.name, async (t) => {
      const { coordinator } = await createHarness(t);
      const candidate = await saveDraft(coordinator);
      const filePath = malformedCase.path(coordinator);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const malformed = `{malformed-${malformedCase.name}`;
      await fs.writeFile(filePath, malformed, "utf8");

      const result = await deleteDraft(coordinator, candidate);
      assert.equal(result.status, "unavailable");
      assert.ok(result.reasonCodes.includes(malformedCase.reason));
      assert.equal(await fs.readFile(filePath, "utf8"), malformed);
      if (malformedCase.name !== "draft") {
        await assertDraftPresent(coordinator, candidate.draftId);
      }
    });
  }
});

test("event chest draft deletion: reserved Daily identity and duplicate raw identity remain undeletable", async (t) => {
  await t.test("reserved Daily identity", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator, {
      draftId: "draft_reserved_daily",
      chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID
    });
    const result = await deleteDraft(coordinator, candidate);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.reasonCodes, [
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DAILY_CHEST_RESERVED
    ]);
    await assertDraftPresent(coordinator, candidate.draftId);
  });

  for (const status of ["published", "archived"]) {
    await t.test(`${status} draft status`, async (t) => {
      const { coordinator } = await createHarness(t);
      const candidate = await coordinator.eventChestDraftStore.saveDraft({
        draftId: `draft_${status}_orphan`,
        chestId: `event_chest_${status}_orphan`,
        status,
        definition: buildDefinition(`event_chest_${status}_orphan`),
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: "PrivateAdmin",
        updatedBy: "PrivateAdmin"
      });
      const result = await deleteDraft(coordinator, candidate);
      assert.equal(result.status, "blocked");
      assert.deepEqual(result.reasonCodes, [
        EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_NOT_UNPUBLISHED
      ]);
      await assertDraftPresent(coordinator, candidate.draftId);
    });
  }

  await t.test("duplicate ambiguous identity", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    const document = JSON.parse(
      await fs.readFile(coordinator.eventChestDraftStore.filePath, "utf8")
    );
    document.drafts.push(structuredClone(document.drafts[0]));
    await writeJson(coordinator.eventChestDraftStore.filePath, document);
    const before = await fs.readFile(coordinator.eventChestDraftStore.filePath);

    const result = await deleteDraft(coordinator, candidate);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.reasonCodes, [
      EVENT_CHEST_DRAFT_REFERENCE_PROOF_REASONS.DRAFT_STORE_MALFORMED
    ]);
    assert.deepEqual(await fs.readFile(coordinator.eventChestDraftStore.filePath), before);
  });
});

test("event chest draft deletion: publish and delete cannot interleave in either ordering", async (t) => {
  await t.test("publish first", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    const order = [];
    let releasePublish;
    let notifyPublishStarted;
    const gate = new Promise((resolve) => {
      releasePublish = resolve;
    });
    const started = new Promise((resolve) => {
      notifyPublishStarted = resolve;
    });
    const originalPublish =
      coordinator.eventChestRegistryStore.publishEventChestDraftDefinition.bind(
        coordinator.eventChestRegistryStore
      );
    coordinator.eventChestRegistryStore.publishEventChestDraftDefinition = async (input) => {
      order.push("publish:start");
      notifyPublishStarted();
      await gate;
      const result = await originalPublish(input);
      order.push("publish:end");
      return result;
    };

    const publish = coordinator.publishEventChestDraftForAdmin({
      draftId: candidate.draftId,
      expectedDraftRevisionId: candidate.draftRevisionId,
      actor: "PrivateAdmin"
    });
    await started;
    const deletion = deleteDraft(coordinator, candidate).then((result) => {
      order.push("delete:end");
      return result;
    });
    await Promise.resolve();
    assert.deepEqual(order, ["publish:start"]);
    releasePublish();

    await publish;
    const deleteResult = await deletion;
    assert.equal(deleteResult.status, "blocked");
    assert.deepEqual(order, ["publish:start", "publish:end", "delete:end"]);
    await assertDraftPresent(coordinator, candidate.draftId);
  });

  await t.test("delete first", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    const order = [];
    let releaseDelete;
    let notifyDeleteStarted;
    const gate = new Promise((resolve) => {
      releaseDelete = resolve;
    });
    const started = new Promise((resolve) => {
      notifyDeleteStarted = resolve;
    });
    const originalDelete =
      coordinator.eventChestDraftStore.deleteDraftWithReferenceProof.bind(
        coordinator.eventChestDraftStore
      );
    coordinator.eventChestDraftStore.deleteDraftWithReferenceProof = (input) =>
      originalDelete({
        ...input,
        getReferenceProofSnapshot: async () => {
          order.push("delete:start");
          notifyDeleteStarted();
          await gate;
          return input.getReferenceProofSnapshot();
        }
      });
    const originalPublishWithin =
      coordinator.publishEventChestDraftWithinAuthoringLock.bind(coordinator);
    coordinator.publishEventChestDraftWithinAuthoringLock = async (input) => {
      order.push("publish:start");
      return originalPublishWithin(input);
    };

    const deletion = deleteDraft(coordinator, candidate);
    await started;
    const publish = coordinator.publishEventChestDraftForAdmin({
      draftId: candidate.draftId,
      expectedDraftRevisionId: candidate.draftRevisionId,
      actor: "PrivateAdmin"
    });
    await Promise.resolve();
    assert.deepEqual(order, ["delete:start"]);
    releaseDelete();

    const deleteResult = await deletion;
    const publishResult = await Promise.allSettled([publish]);
    assert.equal(deleteResult.status, "deleted");
    assert.equal(publishResult[0].status, "rejected");
    assert.deepEqual(order, ["delete:start", "publish:start"]);
  });
});

test("event chest draft deletion: save and delete serialize without removing or recreating the wrong revision", async (t) => {
  await t.test("save first makes delete stale", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    let releaseSave;
    let notifySaveStarted;
    const gate = new Promise((resolve) => {
      releaseSave = resolve;
    });
    const started = new Promise((resolve) => {
      notifySaveStarted = resolve;
    });
    const originalWrite = coordinator.eventChestDraftStore.store.write.bind(
      coordinator.eventChestDraftStore.store
    );
    coordinator.eventChestDraftStore.store.write = async (document) => {
      notifySaveStarted();
      await gate;
      return originalWrite(document);
    };
    const save = coordinator.eventChestDraftStore.saveDraft({
      ...candidate,
      expectedDraftRevisionId: candidate.draftRevisionId,
      definition: { ...candidate.definition, title: "Saved First" }
    });
    await started;
    const deletion = deleteDraft(coordinator, candidate);
    releaseSave();

    const saved = await save;
    const deleteResult = await deletion;
    assert.notEqual(saved.draftRevisionId, candidate.draftRevisionId);
    assert.equal(deleteResult.status, "stale");
    assert.equal(
      (await coordinator.eventChestDraftStore.getDraft(candidate.draftId)).draftRevisionId,
      saved.draftRevisionId
    );
  });

  await t.test("delete first prevents a queued stale save from recreating the draft", async (t) => {
    const { coordinator } = await createHarness(t);
    const candidate = await saveDraft(coordinator);
    let releaseDelete;
    let notifyDeleteStarted;
    const gate = new Promise((resolve) => {
      releaseDelete = resolve;
    });
    const started = new Promise((resolve) => {
      notifyDeleteStarted = resolve;
    });
    const originalDelete =
      coordinator.eventChestDraftStore.deleteDraftWithReferenceProof.bind(
        coordinator.eventChestDraftStore
      );
    coordinator.eventChestDraftStore.deleteDraftWithReferenceProof = (input) =>
      originalDelete({
        ...input,
        getReferenceProofSnapshot: async () => {
          notifyDeleteStarted();
          await gate;
          return input.getReferenceProofSnapshot();
        }
      });

    const deletion = deleteDraft(coordinator, candidate);
    await started;
    const save = coordinator.saveEventChestDraftForAdmin({
      draftId: candidate.draftId,
      expectedDraftRevisionId: candidate.draftRevisionId,
      definition: { ...candidate.definition, title: "Must Not Recreate" },
      actor: "PrivateAdmin"
    });
    await Promise.resolve();
    releaseDelete();

    const deleteResult = await deletion;
    await assert.rejects(save, (error) => error?.code === EVENT_CHEST_DRAFT_NOT_FOUND);
    assert.equal(deleteResult.status, "deleted");
    assert.equal(await coordinator.eventChestDraftStore.getDraft(candidate.draftId), null);
  });
});

test("event chest draft deletion: duplicate concurrent requests delete only the exact candidate once", async (t) => {
  const { coordinator } = await createHarness(t);
  const candidate = await saveDraft(coordinator);
  const other = await saveDraft(coordinator, {
    draftId: "draft_concurrent_keep",
    chestId: "event_chest_concurrent_keep"
  });

  const results = await Promise.all([
    deleteDraft(coordinator, candidate),
    deleteDraft(coordinator, candidate)
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["deleted", "not_found"]
  );
  const remaining = await coordinator.eventChestDraftStore.listDrafts();
  assert.deepEqual(remaining.map((draft) => draft.draftId), [other.draftId]);
});

test("event chest draft deletion: failed atomic persistence preserves the draft and retry succeeds", async (t) => {
  const { coordinator, dataDir } = await createHarness(t);
  const candidate = await saveDraft(coordinator);
  const draftPath = path.join(
    coordinator.eventChestDraftStore.dataDir,
    "server-data",
    EVENT_CHEST_DRAFT_STORE_FILENAME
  );
  const before = await fs.readFile(draftPath);
  const protectedPaths = [
    coordinator.eventChestRegistryStore.filePath,
    coordinator.eventChestActivationStore.filePath,
    coordinator.profiles.store.filePath
  ];
  const beforeProtected = await Promise.all(protectedPaths.map(readOptionalFile));
  const tempPath = `${draftPath}.tmp`;
  await fs.mkdir(tempPath);

  const failed = await deleteDraft(coordinator, candidate);
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(failed.reasonCodes, ["draft_persistence_failed"]);
  assert.equal(JSON.stringify(failed).includes(dataDir), false);
  assert.equal(JSON.stringify(failed).includes(draftPath), false);
  assert.deepEqual(await fs.readFile(draftPath), before);
  await assertDraftPresent(coordinator, candidate.draftId);
  assert.deepEqual(
    await Promise.all(protectedPaths.map(readOptionalFile)),
    beforeProtected
  );

  await fs.rm(tempPath, { recursive: true, force: true });
  const retry = await deleteDraft(coordinator, candidate);
  assert.equal(retry.status, "deleted");
  assert.equal(await coordinator.eventChestDraftStore.getDraft(candidate.draftId), null);
});
