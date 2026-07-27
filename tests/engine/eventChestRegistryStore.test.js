import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "../../src/state/eventChestDefinitions.js";
import {
  EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
  EVENT_CHEST_REGISTRY_FILENAME,
  EVENT_CHEST_REGISTRY_ID,
  EventChestRegistryStore,
  validateEventChestRegistryDocumentForAdmin
} from "../../src/state/eventChestRegistryStore.js";
import { DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } from "../../src/state/dailyElementChestSystem.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-event-chest-registry-"));
}

function cloneDailyDefinition(overrides = {}) {
  return structuredClone({
    ...DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
    ...overrides
  });
}

function buildRegistryDocument(definitions = [DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET], overrides = {}) {
  return {
    schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
    registryId: EVENT_CHEST_REGISTRY_ID,
    registryRevisionId: "registry_revision_existing",
    publishedAt: "2026-07-26T11:00:00.000Z",
    publishedBy: "PreviousAdmin",
    definitions: structuredClone(definitions),
    ...overrides
  };
}

async function writeRegistryFixture(dataDir, payload) {
  const filePath = path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function readRegistryFile(dataDir) {
  const filePath = path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("event chest registry writer: missing registry can publish a valid draft", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => "2026-07-26T12:00:00.000Z",
      logger: { warn: () => {} }
    });

    const result = await store.publishEventChestDraftDefinition({
      definition: DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
      actor: "VampyrLee"
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "file");
    assert.equal(result.registry.registryId, EVENT_CHEST_REGISTRY_ID);
    assert.equal(result.registry.publishedAt, "2026-07-26T12:00:00.000Z");
    assert.equal(result.registry.publishedBy, "VampyrLee");
    assert.equal(result.definitions.length, 1);
    assert.equal(result.definitions[0].chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
    assert.equal(result.definitions[0].publishedAt, "2026-07-26T12:00:00.000Z");
    assert.equal(result.definitions[0].publishedBy, "VampyrLee");
    assert.ok(result.definitions[0].definitionRevisionId);

    const written = await readRegistryFile(dataDir);
    assert.equal(validateEventChestRegistryDocumentForAdmin(written).ok, true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: valid existing registry replaces matching chestId and creates backup", async () => {
  const dataDir = await createTempDataDir();
  try {
    await writeRegistryFixture(dataDir, buildRegistryDocument());
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => "2026-07-26T12:05:00.000Z",
      logger: { warn: () => {} }
    });

    const result = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "Edited Daily EleMintz Chest" }),
      actor: "VampyrLee"
    });

    assert.equal(result.ok, true);
    assert.equal(result.definitions.length, 1);
    assert.equal(result.definitions[0].title, "Edited Daily EleMintz Chest");

    const written = await readRegistryFile(dataDir);
    assert.equal(written.definitions.length, 1);
    assert.equal(written.definitions[0].title, "Edited Daily EleMintz Chest");
    const serverDataEntries = await fs.readdir(path.join(dataDir, "server-data"));
    assert.equal(
      serverDataEntries.some(
        (entry) => entry.startsWith(`${EVENT_CHEST_REGISTRY_FILENAME}.backup-`) && entry.endsWith(".json")
      ),
      true
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: exact draft revision replay is idempotent without rewriting", async () => {
  const dataDir = await createTempDataDir();
  try {
    let tick = 0;
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => `2026-07-26T12:30:0${tick++}.000Z`,
      logger: { warn: () => {} }
    });

    const first = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "Replay Safe Daily Chest" }),
      actor: "VampyrLee",
      sourceDraftId: "draft_daily",
      sourceDraftRevisionId: "draft_revision_1"
    });
    const writtenAfterFirst = await fs.readFile(
      path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME),
      "utf8"
    );
    const firstRegistryRevisionId = first.registry.registryRevisionId;
    const firstDefinitionRevisionId = first.definitions[0].definitionRevisionId;

    const replay = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "Replay Safe Daily Chest" }),
      actor: "VampyrLee",
      sourceDraftId: "draft_daily",
      sourceDraftRevisionId: "draft_revision_1"
    });
    const writtenAfterReplay = await fs.readFile(
      path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME),
      "utf8"
    );

    assert.equal(first.publicationStatus, "published");
    assert.equal(first.idempotent, false);
    assert.equal(replay.publicationStatus, "already_published");
    assert.equal(replay.idempotent, true);
    assert.equal(replay.alreadyPublished, true);
    assert.equal(replay.registry.registryRevisionId, firstRegistryRevisionId);
    assert.equal(replay.definitions[0].definitionRevisionId, firstDefinitionRevisionId);
    assert.equal(writtenAfterReplay, writtenAfterFirst);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: concurrent exact draft revision replay publishes once", async () => {
  const dataDir = await createTempDataDir();
  try {
    let tick = 0;
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => `2026-07-26T12:31:0${tick++}.000Z`,
      logger: { warn: () => {} }
    });

    const [left, right] = await Promise.all([
      store.publishEventChestDraftDefinition({
        definition: cloneDailyDefinition({ title: "Concurrent Replay Daily Chest" }),
        actor: "VampyrLee",
        sourceDraftId: "draft_daily",
        sourceDraftRevisionId: "draft_revision_1"
      }),
      store.publishEventChestDraftDefinition({
        definition: cloneDailyDefinition({ title: "Concurrent Replay Daily Chest" }),
        actor: "VampyrLee",
        sourceDraftId: "draft_daily",
        sourceDraftRevisionId: "draft_revision_1"
      })
    ]);

    const published = [left, right].filter((result) => result.publicationStatus === "published");
    const idempotent = [left, right].filter((result) => result.publicationStatus === "already_published");
    assert.equal(published.length, 1);
    assert.equal(idempotent.length, 1);
    assert.equal(left.registry.registryRevisionId, right.registry.registryRevisionId);
    assert.equal(left.definitions[0].definitionRevisionId, right.definitions[0].definitionRevisionId);

    const written = await readRegistryFile(dataDir);
    assert.equal(written.definitions.length, 1);
    assert.equal(written.definitions[0].sourceDraftId, "draft_daily");
    assert.equal(written.definitions[0].sourceDraftRevisionId, "draft_revision_1");
    const serverDataEntries = await fs.readdir(path.join(dataDir, "server-data"));
    const backups = serverDataEntries.filter(
      (entry) => entry.startsWith(`${EVENT_CHEST_REGISTRY_FILENAME}.backup-`) && entry.endsWith(".json")
    );
    assert.equal(backups.length, 0);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: newer draft revision publishes normally after prior revision", async () => {
  const dataDir = await createTempDataDir();
  try {
    let tick = 0;
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => `2026-07-26T12:32:0${tick++}.000Z`,
      logger: { warn: () => {} }
    });

    const first = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "Original Draft Revision" }),
      actor: "VampyrLee",
      sourceDraftId: "draft_daily",
      sourceDraftRevisionId: "draft_revision_1"
    });
    const second = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "New Draft Revision" }),
      actor: "VampyrLee",
      sourceDraftId: "draft_daily",
      sourceDraftRevisionId: "draft_revision_2"
    });

    assert.equal(second.publicationStatus, "published");
    assert.notEqual(second.registry.registryRevisionId, first.registry.registryRevisionId);
    assert.notEqual(second.definitions[0].definitionRevisionId, first.definitions[0].definitionRevisionId);
    assert.equal(second.definitions[0].title, "New Draft Revision");
    assert.equal(second.definitions[0].sourceDraftRevisionId, "draft_revision_2");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: different draft and chest identities are independent", async () => {
  const dataDir = await createTempDataDir();
  try {
    let tick = 0;
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => `2026-07-26T12:33:0${tick++}.000Z`,
      logger: { warn: () => {} }
    });

    const first = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "Draft One" }),
      actor: "VampyrLee",
      sourceDraftId: "draft_one",
      sourceDraftRevisionId: "draft_revision_1"
    });
    const differentDraft = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({ title: "Draft Two Same Chest" }),
      actor: "VampyrLee",
      sourceDraftId: "draft_two",
      sourceDraftRevisionId: "draft_revision_1"
    });
    const differentChest = await store.publishEventChestDraftDefinition({
      definition: cloneDailyDefinition({
        chestId: "daily_elemintz_chest_bonus",
        title: "Draft Three Different Chest"
      }),
      actor: "VampyrLee",
      sourceDraftId: "draft_three",
      sourceDraftRevisionId: "draft_revision_1"
    });

    assert.equal(first.publicationStatus, "published");
    assert.equal(differentDraft.publicationStatus, "published");
    assert.equal(differentChest.publicationStatus, "published");
    assert.notEqual(differentDraft.registry.registryRevisionId, first.registry.registryRevisionId);
    assert.notEqual(differentChest.registry.registryRevisionId, differentDraft.registry.registryRevisionId);
    assert.equal(differentChest.definitions.length, 2);
    assert.equal(
      differentChest.definitions.filter((definition) => definition.chestId === DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID).length,
      1
    );
    assert.equal(
      differentChest.definitions.filter((definition) => definition.chestId === "daily_elemintz_chest_bonus").length,
      1
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: invalid draft does not write registry", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => "2026-07-26T12:10:00.000Z",
      logger: { warn: () => {} }
    });

    await assert.rejects(
      store.publishEventChestDraftDefinition({
        definition: cloneDailyDefinition({ chestId: "" }),
        actor: "VampyrLee"
      }),
      /draft definition is invalid/i
    );
    await assert.rejects(
      fs.access(path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME)),
      /ENOENT/
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: duplicate chestId target registry blocks publish", async () => {
  const dataDir = await createTempDataDir();
  try {
    await writeRegistryFixture(
      dataDir,
      buildRegistryDocument([
        DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
        cloneDailyDefinition({ title: "Duplicate Daily Chest" })
      ])
    );
    const before = await fs.readFile(path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME), "utf8");
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => "2026-07-26T12:15:00.000Z",
      logger: { warn: () => {} }
    });

    await assert.rejects(
      store.publishEventChestDraftDefinition({
        definition: cloneDailyDefinition({ title: "Should Not Publish" }),
        actor: "VampyrLee"
      }),
      /duplicate chestId/i
    );
    const after = await fs.readFile(path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME), "utf8");
    assert.equal(after, before);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: malformed existing registry is not overwritten", async () => {
  const dataDir = await createTempDataDir();
  try {
    const filePath = await writeRegistryFixture(dataDir, "{ nope");
    const before = await fs.readFile(filePath, "utf8");
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => "2026-07-26T12:20:00.000Z",
      logger: { warn: () => {} }
    });

    await assert.rejects(
      store.publishEventChestDraftDefinition({
        definition: DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
        actor: "VampyrLee"
      }),
      /Unexpected token|Expected property name|JSON/i
    );
    const after = await fs.readFile(filePath, "utf8");
    assert.equal(after, before);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: private player fields are rejected and never persisted", async () => {
  const dataDir = await createTempDataDir();
  try {
    const store = new EventChestRegistryStore({
      dataDir,
      now: () => "2026-07-26T12:25:00.000Z",
      logger: { warn: () => {} }
    });

    await assert.rejects(
      store.publishEventChestDraftDefinition({
        definition: {
          ...DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
          ownedCosmetics: { avatar: ["default_avatar"] },
          eventChests: {}
        },
        actor: "VampyrLee"
      }),
      /private player\/profile field/i
    );
    await store.publishEventChestDraftDefinition({
      definition: DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
      actor: "VampyrLee"
    });
    const serialized = JSON.stringify(await readRegistryFile(dataDir));
    assert.equal(serialized.includes("ownedCosmetics"), false);
    assert.equal(serialized.includes('"eventChests":'), false);
    assert.equal(serialized.includes("profileKey"), false);
    assert.equal(serialized.includes("sessionToken"), false);
    assert.equal(serialized.includes('"tokens":'), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry writer: Daily Elemintz Chest default still validates", () => {
  const validation = validateEventChestDefinition(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET);
  assert.equal(validation.ok, true);
});
