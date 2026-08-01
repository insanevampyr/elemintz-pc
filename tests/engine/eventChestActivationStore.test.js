import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EVENT_CHEST_ACTIVATION_FILENAME,
  EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
  EventChestActivationStore,
  buildEventChestRevisionLifecycleKey
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

async function withTempStore(callback, { now = "2026-08-01T12:00:00.000Z" } = {}) {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestActivationStore({ dataDir, now: () => now });
    await callback({ dataDir, store });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

test("event chest lifecycle store: missing file returns inactive canonical projection without writing", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    const activation = await store.readActivation();
    assert.equal(activation.schemaVersion, EVENT_CHEST_ACTIVATION_SCHEMA_VERSION);
    assert.equal(activation.status, "inactive");
    assert.equal(activation.chestId, null);
    assert.deepEqual(activation.lifecycle, {
      schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
      active: null,
      revisionStates: {},
      history: []
    });
    await assert.rejects(fs.access(activationPath(dataDir)), /ENOENT/);
  });
});

test("event chest lifecycle store: valid schema-v1 active pointer migrates without losing identity", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    await fs.mkdir(path.dirname(activationPath(dataDir)), { recursive: true });
    await fs.writeFile(
      activationPath(dataDir),
      JSON.stringify({
        schemaVersion: 1,
        activationRevisionId: "legacy_activation_revision",
        status: "active",
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1",
        activatedAt: "2026-07-31T12:00:00.000Z",
        activatedBy: "LegacyAdmin",
        endedAt: null,
        endedBy: null,
        updatedAt: "2026-07-31T12:00:00.000Z",
        updatedBy: "LegacyAdmin"
      }),
      "utf8"
    );

    const migrated = await store.readActivation();
    assert.equal(migrated.status, "active");
    assert.equal(migrated.chestId, "event_chest_alpha");
    assert.equal(migrated.definitionRevisionId, "definition_revision_alpha_1");
    assert.equal(migrated.activationRevisionId, "legacy_activation_revision");
    assert.equal((await readActivationFile(dataDir)).schemaVersion, 1);

    await store.deactivate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    const canonical = await readActivationFile(dataDir);
    assert.equal(canonical.schemaVersion, EVENT_CHEST_ACTIVATION_SCHEMA_VERSION);
    assert.equal(canonical.active, null);
    assert.equal(
      canonical.revisionStates[
        buildEventChestRevisionLifecycleKey("event_chest_alpha", "definition_revision_alpha_1")
      ].state,
      "inactive"
    );
  });
});

test("event chest lifecycle store: schema-v2 state migrates without fabricating archive or history", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    await fs.mkdir(path.dirname(activationPath(dataDir)), { recursive: true });
    await fs.writeFile(
      activationPath(dataDir),
      JSON.stringify({
        schemaVersion: 2,
        active: {
          activationRevisionId: "activation_alpha",
          chestId: "event_chest_alpha",
          definitionRevisionId: "definition_revision_alpha_1",
          activatedAt: "2026-07-31T10:00:00.000Z",
          activatedBy: "AdminA",
          updatedAt: "2026-07-31T10:00:00.000Z",
          updatedBy: "AdminA"
        },
        revisionStates: {
          "event_chest_beta:definition_revision_beta_1": {
            chestId: "event_chest_beta",
            definitionRevisionId: "definition_revision_beta_1",
            state: "inactive",
            deactivatedAt: "2026-07-30T10:00:00.000Z",
            deactivatedBy: "AdminB",
            endedAt: null,
            endedBy: null,
            updatedAt: "2026-07-30T10:00:00.000Z",
            updatedBy: "AdminB"
          },
          "event_chest_gamma:definition_revision_gamma_1": {
            chestId: "event_chest_gamma",
            definitionRevisionId: "definition_revision_gamma_1",
            state: "ended",
            deactivatedAt: null,
            deactivatedBy: null,
            endedAt: "2026-07-29T10:00:00.000Z",
            endedBy: "AdminC",
            updatedAt: "2026-07-29T10:00:00.000Z",
            updatedBy: "AdminC"
          }
        }
      }),
      "utf8"
    );

    const migrated = await store.readActivation();
    assert.equal(migrated.lifecycle.schemaVersion, EVENT_CHEST_ACTIVATION_SCHEMA_VERSION);
    assert.equal(migrated.lifecycle.active.chestId, "event_chest_alpha");
    assert.equal(
      migrated.lifecycle.revisionStates["event_chest_beta:definition_revision_beta_1"].state,
      "inactive"
    );
    assert.equal(
      migrated.lifecycle.revisionStates["event_chest_gamma:definition_revision_gamma_1"].state,
      "ended"
    );
    assert.equal(
      migrated.lifecycle.revisionStates["event_chest_beta:definition_revision_beta_1"].archived,
      false
    );
    assert.deepEqual(migrated.lifecycle.history, []);
    assert.equal((await readActivationFile(dataDir)).schemaVersion, 2);
  });
});

test("event chest lifecycle store: activation persists exact revision and reloads canonical state", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    const result = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    assert.equal(result.activationStatus, "activated");
    assert.equal(result.activation.status, "active");
    assert.equal(result.lifecycle.active.chestId, "event_chest_alpha");
    assert.equal(result.lifecycle.active.definitionRevisionId, "definition_revision_alpha_1");
    assert.equal(result.lifecycle.active.activatedAt, "2026-08-01T12:00:00.000Z");

    const recreated = new EventChestActivationStore({ dataDir });
    const reloaded = await recreated.readActivation();
    assert.equal(reloaded.status, "active");
    assert.equal(reloaded.chestId, "event_chest_alpha");
    assert.deepEqual(await readActivationFile(dataDir), result.lifecycle);
  });
});

test("event chest lifecycle store: exact activation replay is idempotent and does not rewrite", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    const first = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    const serialized = await fs.readFile(activationPath(dataDir), "utf8");
    const replay = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "OtherAdmin"
    });
    assert.equal(replay.activationStatus, "already_active");
    assert.equal(replay.idempotent, true);
    assert.equal(replay.activation.activationRevisionId, first.activation.activationRevisionId);
    assert.equal(await fs.readFile(activationPath(dataDir), "utf8"), serialized);
  });
});

test("event chest lifecycle store: replacement makes the prior revision inactive and reactivatable", async () => {
  await withTempStore(async ({ store }) => {
    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    const replacement = await store.activate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    const alphaKey = buildEventChestRevisionLifecycleKey(
      "event_chest_alpha",
      "definition_revision_alpha_1"
    );
    assert.equal(replacement.lifecycle.active.chestId, "event_chest_beta");
    assert.equal(replacement.lifecycle.revisionStates[alphaKey].state, "inactive");
    assert.equal(replacement.lifecycle.revisionStates[alphaKey].endedAt, null);

    const reactivated = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    const betaKey = buildEventChestRevisionLifecycleKey(
      "event_chest_beta",
      "definition_revision_beta_1"
    );
    assert.equal(reactivated.lifecycle.active.chestId, "event_chest_alpha");
    assert.equal(reactivated.lifecycle.revisionStates[alphaKey], undefined);
    assert.equal(reactivated.lifecycle.revisionStates[betaKey].state, "inactive");
  });
});

test("event chest lifecycle store: deactivate is exact, replay-safe, stale-safe, and reversible", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    await assert.rejects(
      store.deactivate({
        chestId: "event_chest_beta",
        definitionRevisionId: "definition_revision_beta_1"
      }),
      (error) => error?.code === "EVENT_CHEST_ACTIVE_REVISION_MISMATCH"
    );
    const deactivated = await store.deactivate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    const serialized = await fs.readFile(activationPath(dataDir), "utf8");
    assert.equal(deactivated.activationStatus, "deactivated");
    assert.equal(deactivated.activation.status, "inactive");

    const replay = await store.deactivate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    assert.equal(replay.activationStatus, "already_inactive");
    assert.equal(replay.idempotent, true);
    assert.equal(await fs.readFile(activationPath(dataDir), "utf8"), serialized);

    const reactivated = await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    assert.equal(reactivated.activation.status, "active");
  });
});

test("event chest lifecycle store: end is exact, terminal, idempotent, and durable", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    await assert.rejects(
      store.end({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_2"
      }),
      (error) => error?.code === "EVENT_CHEST_ACTIVE_REVISION_MISMATCH"
    );
    const ended = await store.end({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "VampyrLee"
    });
    assert.equal(ended.activationStatus, "ended");
    assert.equal(ended.lifecycle.active, null);
    assert.equal(
      ended.lifecycle.revisionStates[
        buildEventChestRevisionLifecycleKey("event_chest_alpha", "definition_revision_alpha_1")
      ].state,
      "ended"
    );

    const recreated = new EventChestActivationStore({ dataDir });
    const replay = await recreated.end({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    assert.equal(replay.activationStatus, "already_ended");
    assert.equal(replay.idempotent, true);
    await assert.rejects(
      recreated.activate({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1"
      }),
      (error) => error?.code === "EVENT_CHEST_REVISION_ENDED"
    );

    const nextRevision = await recreated.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_2"
    });
    assert.equal(nextRevision.activation.definitionRevisionId, "definition_revision_alpha_2");
  });
});

test("event chest lifecycle store: queued replacement wins and stale deactivate cannot clear it", async () => {
  await withTempStore(async ({ store }) => {
    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    const replacementPromise = store.activate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    const staleDeactivatePromise = store.deactivate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    await replacementPromise;
    await assert.rejects(
      staleDeactivatePromise,
      (error) => error?.code === "EVENT_CHEST_ACTIVE_REVISION_MISMATCH"
    );
    const final = await store.readActivation();
    assert.equal(final.chestId, "event_chest_beta");
    assert.equal(final.definitionRevisionId, "definition_revision_beta_1");
  });
});

test("event chest lifecycle store: stale end cannot affect a queued replacement", async () => {
  await withTempStore(async ({ store }) => {
    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    const replacementPromise = store.activate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    const staleEndPromise = store.end({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    await replacementPromise;
    await assert.rejects(
      staleEndPromise,
      (error) => error?.code === "EVENT_CHEST_ACTIVE_REVISION_MISMATCH"
    );
    const final = await store.readActivation();
    assert.equal(final.chestId, "event_chest_beta");
    assert.equal(final.definitionRevisionId, "definition_revision_beta_1");
    assert.equal(
      final.lifecycle.revisionStates[
        buildEventChestRevisionLifecycleKey("event_chest_alpha", "definition_revision_alpha_1")
      ].state,
      "inactive"
    );
  });
});

test("event chest lifecycle store: archive and unarchive are exact, durable, idempotent, and preserve ended authority", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    const inactiveKey = buildEventChestRevisionLifecycleKey(
      "event_chest_alpha",
      "definition_revision_alpha_1"
    );
    const endedKey = buildEventChestRevisionLifecycleKey(
      "event_chest_beta",
      "definition_revision_beta_1"
    );

    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "AdminA"
    });
    await assert.rejects(
      store.archive({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1"
      }),
      (error) => error?.code === "EVENT_CHEST_REVISION_ACTIVE"
    );
    await store.deactivate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "AdminA"
    });
    const archived = await store.archive({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "AdminA"
    });
    assert.equal(archived.lifecycle.revisionStates[inactiveKey].archived, true);
    await assert.rejects(
      store.activate({
        chestId: "event_chest_alpha",
        definitionRevisionId: "definition_revision_alpha_1"
      }),
      (error) => error?.code === "EVENT_CHEST_REVISION_ARCHIVED"
    );
    const archiveReplay = await store.archive({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "OtherAdmin"
    });
    assert.equal(archiveReplay.idempotent, true);
    assert.equal(
      archiveReplay.lifecycle.history.filter((event) => event.eventType === "archived").length,
      1
    );

    const unarchived = await store.unarchive({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "AdminA"
    });
    assert.equal(unarchived.lifecycle.active, null);
    assert.equal(unarchived.lifecycle.revisionStates[inactiveKey].archived, false);
    const unarchiveReplay = await store.unarchive({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    assert.equal(unarchiveReplay.idempotent, true);
    assert.equal(
      unarchiveReplay.lifecycle.history.filter((event) => event.eventType === "unarchived").length,
      1
    );
    await store.activate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    await store.end({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    await store.archive({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    await store.unarchive({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1"
    });
    const reloaded = await new EventChestActivationStore({ dataDir }).readActivation();
    assert.equal(reloaded.lifecycle.revisionStates[endedKey].state, "ended");
    assert.equal(reloaded.lifecycle.revisionStates[endedKey].archived, false);
    await assert.rejects(
      store.activate({
        chestId: "event_chest_beta",
        definitionRevisionId: "definition_revision_beta_1"
      }),
      (error) => error?.code === "EVENT_CHEST_REVISION_ENDED"
    );
  });
});

test("event chest lifecycle store: append-only history is ordered, private internally, and race-safe", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    await store.activate({
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1",
      actor: "AdminSecret"
    });
    await store.activate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1",
      actor: "AdminSecret"
    });
    await store.deactivate({
      chestId: "event_chest_beta",
      definitionRevisionId: "definition_revision_beta_1",
      actor: "AdminSecret"
    });
    const beforeRace = await store.readActivation();
    assert.deepEqual(
      beforeRace.lifecycle.history.map((event) => event.eventType),
      ["activated", "replaced", "deactivated"]
    );
    assert.deepEqual(beforeRace.lifecycle.history[1].priorActiveRevision, {
      chestId: "event_chest_alpha",
      definitionRevisionId: "definition_revision_alpha_1"
    });
    assert.equal(beforeRace.lifecycle.history[0].actor, "AdminSecret");

    const race = await Promise.allSettled([
      store.archive({
        chestId: "event_chest_gamma",
        definitionRevisionId: "definition_revision_gamma_1"
      }),
      store.activate({
        chestId: "event_chest_gamma",
        definitionRevisionId: "definition_revision_gamma_1"
      })
    ]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(race.filter((result) => result.status === "rejected").length, 1);
    const final = await new EventChestActivationStore({ dataDir }).readActivation();
    const gammaKey = buildEventChestRevisionLifecycleKey(
      "event_chest_gamma",
      "definition_revision_gamma_1"
    );
    const activeGamma =
      final.chestId === "event_chest_gamma" &&
      final.definitionRevisionId === "definition_revision_gamma_1";
    const archivedGamma = final.lifecycle.revisionStates[gammaKey]?.archived === true;
    assert.notEqual(activeGamma, archivedGamma);
    assert.equal(JSON.parse(await fs.readFile(activationPath(dataDir), "utf8")).schemaVersion, 3);
  });
});

test("event chest lifecycle store: malformed persistence fails closed", async () => {
  await withTempStore(async ({ dataDir, store }) => {
    await fs.mkdir(path.dirname(activationPath(dataDir)), { recursive: true });
    await fs.writeFile(activationPath(dataDir), JSON.stringify({ schemaVersion: 3, active: { nope: true } }), "utf8");
    assert.equal((await store.readActivation()).status, "inactive");

    await fs.writeFile(
      activationPath(dataDir),
      JSON.stringify({
        schemaVersion: 3,
        active: null,
        revisionStates: {
          "event_chest_archived:definition_revision_archived_1": {
            chestId: "event_chest_archived",
            definitionRevisionId: "definition_revision_archived_1",
            state: "inactive",
            archived: true
          }
        },
        history: []
      }),
      "utf8"
    );
    assert.equal(
      (await store.readActivation()).lifecycle.revisionStates[
        "event_chest_archived:definition_revision_archived_1"
      ].archived,
      true
    );
    await assert.rejects(
      store.activate({
        chestId: "event_chest_archived",
        definitionRevisionId: "definition_revision_archived_1"
      }),
      (error) => error?.code === "EVENT_CHEST_REVISION_ARCHIVED"
    );

    await fs.writeFile(activationPath(dataDir), "{ malformed", "utf8");
    await assert.rejects(store.readActivation(), SyntaxError);
  });
});
