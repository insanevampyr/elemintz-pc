import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET } from "../../src/state/eventChestDefinitions.js";
import {
  EVENT_CHEST_DRAFT_STORE_FILENAME,
  EventChestDraftStore,
  createEventChestDraftRecord,
  normalizeEventChestDraftMetadata,
  validateEventChestDraftDefinition
} from "../../src/state/eventChestDraftStore.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-drafts-"));
}

function buildDefinition(overrides = {}) {
  return structuredClone({
    ...DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
    ...overrides
  });
}

function buildDraft(overrides = {}) {
  return {
    draftId: "daily-draft-1",
    chestId: "daily_elemintz_chest_current",
    draftRevisionId: "draft-revision-1",
    status: "ready",
    definition: buildDefinition(),
    createdAt: "2026-07-26T12:00:00.000Z",
    updatedAt: "2026-07-26T12:00:00.000Z",
    createdBy: "VampyrLee",
    updatedBy: "VampyrLee",
    copiedFromChestId: null,
    copiedFromDefinitionRevisionId: null,
    ...overrides
  };
}

function createRevisionSequence() {
  let index = 0;
  return () => `test-uuid-${++index}`;
}

test("event chest draft store: missing drafts file loads empty without writing", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({ dataDir });
    const drafts = await store.listDrafts();
    assert.deepEqual(drafts, []);

    await assert.rejects(
      fs.access(path.join(dataDir, "server-data", EVENT_CHEST_DRAFT_STORE_FILENAME)),
      /ENOENT/
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: valid draft saves, loads, and summarizes safe metadata", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({
      dataDir,
      now: () => "2026-07-26T12:05:00.000Z",
      randomUUID: createRevisionSequence()
    });
    const saved = await store.saveDraft(buildDraft());

    assert.equal(saved.draftId, "daily-draft-1");
    assert.equal(saved.chestId, "daily_elemintz_chest_current");
    assert.equal(saved.updatedAt, "2026-07-26T12:05:00.000Z");
    assert.equal(saved.validation.ok, true);
    assert.equal(
      saved.draftRevisionId,
      "draft_revision_2026_07_26T12_05_00_000Z_test-uuid-1"
    );
    assert.notEqual(saved.draftRevisionId, buildDraft().draftRevisionId);

    const loaded = await store.getDraft("daily-draft-1");
    assert.equal(loaded.definition.title, DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.title);

    const summaries = await store.listDraftSummaries();
    assert.deepEqual(Object.keys(summaries[0]).sort(), [
      "chestId",
      "copiedFromChestId",
      "copiedFromDefinitionRevisionId",
      "createdAt",
      "createdBy",
      "draftId",
      "draftRevisionId",
      "status",
      "title",
      "updatedAt",
      "updatedBy",
      "validation"
    ]);
    assert.equal("definition" in summaries[0], false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: returned drafts are defensive copies", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({ dataDir });
    await store.saveDraft(buildDraft());

    const first = await store.getDraft("daily-draft-1");
    first.definition.title = "Mutated Title";
    first.validation.errors.push("mutated");

    const second = await store.getDraft("daily-draft-1");
    assert.equal(second.definition.title, DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.title);
    assert.deepEqual(second.validation.errors, []);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: invalid definitions and missing metadata are rejected", () => {
  assert.deepEqual(validateEventChestDraftDefinition(buildDefinition()).ok, true);
  assert.equal(validateEventChestDraftDefinition(buildDefinition({ chestType: "bad_type" })).ok, false);

  assert.throws(
    () => createEventChestDraftRecord(buildDraft({ definition: buildDefinition({ chestType: "bad_type" }) })),
    /definition is invalid/
  );
  assert.throws(() => createEventChestDraftRecord(buildDraft({ draftId: "" })), /draftId is required/);
  assert.throws(
    () => createEventChestDraftRecord(buildDraft({ draftRevisionId: "" })),
    /draftRevisionId is required/
  );
  assert.throws(() => createEventChestDraftRecord(buildDraft({ createdAt: "not a date" })), /createdAt/);
  assert.throws(() => normalizeEventChestDraftMetadata({ draftId: "x", draftRevisionId: "y", status: "bad" }), /status/);
});

test("event chest draft store: successful sequential saves rotate server revisions", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({
      dataDir,
      now: () => "2026-07-26T12:05:00.000Z",
      randomUUID: createRevisionSequence()
    });
    const first = await store.saveDraft(buildDraft());
    const second = await store.saveDraft(
      buildDraft({
        expectedDraftRevisionId: first.draftRevisionId,
        draftRevisionId: "client-revision-must-be-ignored",
        definition: buildDefinition({ title: "Edited Daily Chest Draft" })
      })
    );
    const third = await store.saveDraft(
      buildDraft({
        expectedDraftRevisionId: second.draftRevisionId,
        definition: buildDefinition({ title: "Edited Daily Chest Draft Again" })
      })
    );

    assert.equal(second.createdAt, first.createdAt);
    assert.notEqual(second.draftRevisionId, first.draftRevisionId);
    assert.notEqual(second.draftRevisionId, "client-revision-must-be-ignored");
    assert.notEqual(third.draftRevisionId, second.draftRevisionId);
    const drafts = await store.listDrafts();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].definition.title, "Edited Daily Chest Draft Again");
    assert.equal(drafts[0].draftRevisionId, third.draftRevisionId);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: stale save rejects without mutation or revision generation", async () => {
  const dataDir = await createTempDataDir();
  try {
    let generatedRevisionCount = 0;
    const store = new EventChestDraftStore({
      dataDir,
      randomUUID: () => `test-uuid-${++generatedRevisionCount}`
    });
    const first = await store.saveDraft(buildDraft());

    await assert.rejects(
      store.saveDraft({
        ...buildDraft(),
        definition: buildDefinition({ title: "Missing Expected Revision" })
      }),
      (error) => error?.code === "EVENT_CHEST_DRAFT_EXPECTED_REVISION_REQUIRED"
    );
    assert.equal(generatedRevisionCount, 1);

    const second = await store.saveDraft({
      ...buildDraft(),
      expectedDraftRevisionId: first.draftRevisionId,
      definition: buildDefinition({ title: "Authoritative Edit" })
    });
    const beforeConflict = await store.getDraft(first.draftId);

    await assert.rejects(
      store.saveDraft({
        ...buildDraft(),
        expectedDraftRevisionId: first.draftRevisionId,
        definition: buildDefinition({ title: "Stale Edit" })
      }),
      (error) =>
        error?.code === "EVENT_CHEST_DRAFT_REVISION_CONFLICT" &&
        error?.details?.currentDraftRevisionId === second.draftRevisionId
    );

    assert.equal(generatedRevisionCount, 2);
    assert.deepEqual(await store.getDraft(first.draftId), beforeConflict);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: reads and failed validation do not rotate revision", async () => {
  const dataDir = await createTempDataDir();
  try {
    let generatedRevisionCount = 0;
    const store = new EventChestDraftStore({
      dataDir,
      randomUUID: () => `test-uuid-${++generatedRevisionCount}`
    });
    const saved = await store.saveDraft(buildDraft());

    await store.getDraft(saved.draftId);
    await store.listDrafts();
    await store.listDraftSummaries();
    assert.equal(generatedRevisionCount, 1);

    await assert.rejects(
      store.saveDraft({
        ...buildDraft(),
        expectedDraftRevisionId: saved.draftRevisionId,
        definition: buildDefinition({ chestId: "" })
      }),
      /definition is invalid/
    );
    assert.equal(generatedRevisionCount, 1);
    assert.equal((await store.getDraft(saved.draftId)).draftRevisionId, saved.draftRevisionId);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: concurrent saves from one revision produce one success and one conflict", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({
      dataDir,
      randomUUID: createRevisionSequence()
    });
    const first = await store.saveDraft(buildDraft());
    const results = await Promise.allSettled([
      store.saveDraft({
        ...buildDraft(),
        expectedDraftRevisionId: first.draftRevisionId,
        definition: buildDefinition({ title: "Concurrent Edit A" })
      }),
      store.saveDraft({
        ...buildDraft(),
        expectedDraftRevisionId: first.draftRevisionId,
        definition: buildDefinition({ title: "Concurrent Edit B" })
      })
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected?.reason?.code, "EVENT_CHEST_DRAFT_REVISION_CONFLICT");
    const persisted = await store.getDraft(first.draftId);
    assert.ok(["Concurrent Edit A", "Concurrent Edit B"].includes(persisted.definition.title));
    assert.notEqual(persisted.draftRevisionId, first.draftRevisionId);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: private player/profile fields are rejected", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({ dataDir });
    await assert.rejects(
      store.saveDraft(
        buildDraft({
          profile: { username: "DoNotStore" }
        })
      ),
      /private player\/profile fields/
    );
    await assert.rejects(
      store.saveDraft(
        buildDraft({
          definition: {
            ...buildDefinition(),
            eventChests: {}
          }
        })
      ),
      /private player\/profile fields/
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest draft store: draft save does not write registry or profiles", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({ dataDir });
    await store.saveDraft(buildDraft());

    await fs.access(path.join(dataDir, "server-data", EVENT_CHEST_DRAFT_STORE_FILENAME));
    await assert.rejects(
      fs.access(path.join(dataDir, "server-data", "event-chest-registry.json")),
      /ENOENT/
    );
    await assert.rejects(fs.access(path.join(dataDir, "profiles.json")), /ENOENT/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
