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
      now: () => "2026-07-26T12:05:00.000Z"
    });
    const saved = await store.saveDraft(buildDraft());

    assert.equal(saved.draftId, "daily-draft-1");
    assert.equal(saved.chestId, "daily_elemintz_chest_current");
    assert.equal(saved.updatedAt, "2026-07-26T12:05:00.000Z");
    assert.equal(saved.validation.ok, true);

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

test("event chest draft store: duplicate draftId upserts safely without duplicate records", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestDraftStore({
      dataDir,
      now: () => "2026-07-26T12:05:00.000Z"
    });
    const first = await store.saveDraft(buildDraft());
    const second = await store.saveDraft(
      buildDraft({
        draftRevisionId: "draft-revision-2",
        definition: buildDefinition({ title: "Edited Daily Chest Draft" })
      })
    );

    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.draftRevisionId, "draft-revision-2");
    const drafts = await store.listDrafts();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].definition.title, "Edited Daily Chest Draft");
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
