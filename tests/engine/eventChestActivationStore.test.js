import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EVENT_CHEST_ACTIVATION_FILENAME,
  EventChestActivationStore
} from "../../src/state/eventChestActivationStore.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-activation-"));
}

function activationPath(dataDir) {
  return path.join(dataDir, "server-data", EVENT_CHEST_ACTIVATION_FILENAME);
}

async function readActivationFile(dataDir) {
  return JSON.parse(await fs.readFile(activationPath(dataDir), "utf8"));
}

test("event chest activation store: missing file returns normalized inactive state without writing", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({ dataDir });
    const activation = await store.readActivation();

    assert.equal(activation.status, "inactive");
    assert.equal(activation.chestId, null);
    assert.equal(activation.definitionRevisionId, null);
    assert.equal(activation.activationRevisionId, null);
    await assert.rejects(fs.access(activationPath(dataDir)), /ENOENT/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest activation store: first activation persists exact chest revision and actor metadata", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({
      dataDir,
      now: () => "2026-07-27T17:00:00.000Z"
    });

    const result = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });

    assert.equal(result.activationStatus, "activated");
    assert.equal(result.idempotent, false);
    assert.equal(result.activation.status, "active");
    assert.equal(result.activation.chestId, "event_chest_alpha");
    assert.equal(result.activation.definitionRevisionId, "definition_revision_alpha_1");
    assert.ok(result.activation.activationRevisionId);
    assert.equal(result.activation.activatedAt, "2026-07-27T17:00:00.000Z");
    assert.equal(result.activation.activatedBy, "VampyrLee");
    assert.deepEqual(await readActivationFile(dataDir), result.activation);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest activation store: exact replay is idempotent and does not rewrite", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({
      dataDir,
      now: () => "2026-07-27T17:05:00.000Z"
    });

    const first = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    const firstSerialized = await fs.readFile(activationPath(dataDir), "utf8");
    const replay = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "OtherAdmin"
    });

    assert.equal(replay.activationStatus, "already_active");
    assert.equal(replay.idempotent, true);
    assert.equal(replay.alreadyActive, true);
    assert.equal(replay.activation.activationRevisionId, first.activation.activationRevisionId);
    assert.equal(replay.activation.activatedBy, "VampyrLee");
    assert.equal(await fs.readFile(activationPath(dataDir), "utf8"), firstSerialized);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest activation store: concurrent exact replay produces one active revision", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({
      dataDir,
      now: () => "2026-07-27T17:10:00.000Z"
    });

    const [left, right] = await Promise.all([
      store.activate({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1",
        actor: "VampyrLee"
      }),
      store.activate({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1",
        actor: "VampyrLee"
      })
    ]);

    assert.equal([left, right].filter((result) => result.activationStatus === "activated").length, 1);
    assert.equal([left, right].filter((result) => result.activationStatus === "already_active").length, 1);
    assert.equal(left.activation.activationRevisionId, right.activation.activationRevisionId);
    assert.equal((await readActivationFile(dataDir)).status, "active");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest activation store: switching chest or revision creates one new active pointer", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({
      dataDir,
      now: () => "2026-07-27T17:15:00.000Z"
    });

    const first = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    const newerRevision = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_2",
      actor: "VampyrLee"
    });
    const differentChest = await store.activate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1",
      actor: "VampyrLee"
    });

    assert.notEqual(newerRevision.activation.activationRevisionId, first.activation.activationRevisionId);
    assert.equal(newerRevision.activation.chestId, "event_chest_alpha");
    assert.equal(newerRevision.activation.definitionRevisionId, "definition_revision_alpha_2");
    assert.notEqual(differentChest.activation.activationRevisionId, newerRevision.activation.activationRevisionId);
    assert.equal(differentChest.activation.chestId, "event_chest_beta");
    assert.equal(differentChest.activation.definitionRevisionId, "definition_revision_beta_1");
    assert.deepEqual(await readActivationFile(dataDir), differentChest.activation);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest activation store: concurrent different activations serialize to one active pointer", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({
      dataDir,
      now: () => "2026-07-27T17:17:00.000Z"
    });

    const [left, right] = await Promise.all([
      store.activate({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1",
        actor: "VampyrLee"
      }),
      store.activate({
        chestId: "event_chest_beta",
        definitionRevisionId: "definition_revision_beta_1",
        actor: "VampyrLee"
      })
    ]);
    const persisted = await readActivationFile(dataDir);

    assert.equal(left.activationStatus, "activated");
    assert.equal(right.activationStatus, "activated");
    assert.ok(["event_chest_alpha", "event_chest_beta"].includes(persisted.chestId));
    assert.equal(persisted.status, "active");
    assert.equal(
      persisted.activationRevisionId,
      persisted.chestId === left.activation.chestId
        ? left.activation.activationRevisionId
        : right.activation.activationRevisionId
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest activation store: ending active event and repeated end are idempotent", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({
      dataDir,
      now: () => "2026-07-27T17:20:00.000Z"
    });

    const activated = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    const ended = await store.end({ actor: "VampyrLee" });
    const endedSerialized = await fs.readFile(activationPath(dataDir), "utf8");
    const replay = await store.end({ actor: "OtherAdmin" });
    const [concurrentA, concurrentB] = await Promise.all([
      store.end({ actor: "VampyrLee" }),
      store.end({ actor: "VampyrLee" })
    ]);

    assert.equal(ended.activationStatus, "ended");
    assert.equal(ended.idempotent, false);
    assert.equal(ended.activation.status, "inactive");
    assert.notEqual(ended.activation.activationRevisionId, activated.activation.activationRevisionId);
    assert.equal(ended.activation.endedAt, "2026-07-27T17:20:00.000Z");
    assert.equal(ended.activation.endedBy, "VampyrLee");
    assert.equal(replay.activationStatus, "already_inactive");
    assert.equal(replay.idempotent, true);
    assert.equal(replay.activation.activationRevisionId, ended.activation.activationRevisionId);
    assert.equal(await fs.readFile(activationPath(dataDir), "utf8"), endedSerialized);
    assert.equal(concurrentA.activation.activationRevisionId, ended.activation.activationRevisionId);
    assert.equal(concurrentB.activation.activationRevisionId, ended.activation.activationRevisionId);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
