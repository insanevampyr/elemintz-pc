import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { validateEventChestDefinition } from "./eventChestDefinitions.js";
import { normalizeEventChestActiveWindows } from "./eventChestSchedule.js";
import { resolveDataDir } from "./paths.js";
import { JsonStore } from "./storage/jsonStore.js";

export const EVENT_CHEST_DRAFT_STORE_VERSION = 1;
export const EVENT_CHEST_DRAFT_STORE_FILENAME = "event-chest-drafts.json";
export const EVENT_CHEST_DRAFT_REVISION_CONFLICT = "EVENT_CHEST_DRAFT_REVISION_CONFLICT";
export const EVENT_CHEST_DRAFT_EXPECTED_REVISION_REQUIRED =
  "EVENT_CHEST_DRAFT_EXPECTED_REVISION_REQUIRED";
export const EVENT_CHEST_DRAFT_NOT_FOUND = "EVENT_CHEST_DRAFT_NOT_FOUND";
export const EVENT_CHEST_DRAFT_SOURCE_REVISION_MISMATCH =
  "EVENT_CHEST_DRAFT_SOURCE_REVISION_MISMATCH";
export const EVENT_CHEST_DRAFT_STATUSES = Object.freeze([
  "draft",
  "validation_failed",
  "ready",
  "published",
  "archived"
]);

const EMPTY_DRAFT_DOCUMENT = Object.freeze({
  schemaVersion: EVENT_CHEST_DRAFT_STORE_VERSION,
  drafts: Object.freeze([])
});

const PRIVATE_DRAFT_FIELD_KEYS = Object.freeze([
  "account",
  "accounts",
  "accountId",
  "adminSessionToken",
  "dailyElementChest",
  "eventChests",
  "ownedCosmetics",
  "playerLevel",
  "playerProfile",
  "playerXP",
  "profile",
  "profiles",
  "profileKey",
  "sessionId",
  "sessionToken",
  "settlementKey",
  "socketId",
  "tokens",
  "uniqueCosmeticAcquisitions"
]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRequiredText(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function buildDraftRevisionId(timestamp, randomUUID) {
  const safeTimestamp = String(timestamp ?? "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `draft_revision_${safeTimestamp || Date.now()}_${randomUUID()}`;
}

function buildGeneratedId(prefix, timestamp, randomUUID) {
  const safeTimestamp = String(timestamp ?? "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeUuid = String(randomUUID())
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${safeTimestamp || Date.now()}_${safeUuid}`;
}

function normalizeTimestamp(value, fieldName, fallback = null) {
  if (value == null || value === "") {
    if (fallback) {
      return fallback;
    }
    throw new Error(`${fieldName} is required.`);
  }

  const parsedMs = Date.parse(String(value));
  if (!Number.isFinite(parsedMs)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }
  return new Date(parsedMs).toISOString();
}

function normalizeStatus(value) {
  const normalized = String(value ?? "draft").trim().toLowerCase();
  if (!EVENT_CHEST_DRAFT_STATUSES.includes(normalized)) {
    throw new Error(`status must be one of: ${EVENT_CHEST_DRAFT_STATUSES.join(", ")}.`);
  }
  return normalized;
}

function stripBom(value) {
  const source = String(value ?? "");
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function findPrivateFields(value, prefix = "") {
  const findings = [];
  if (!value || typeof value !== "object") {
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...findPrivateFields(entry, `${prefix}[${index}]`));
    });
    return findings;
  }

  for (const [key, child] of Object.entries(value)) {
    const pathName = prefix ? `${prefix}.${key}` : key;
    if (PRIVATE_DRAFT_FIELD_KEYS.includes(key)) {
      findings.push(pathName);
    }
    findings.push(...findPrivateFields(child, pathName));
  }
  return findings;
}

function assertNoPrivateDraftFields(value) {
  const privateFields = findPrivateFields(value);
  if (privateFields.length > 0) {
    throw new Error(`Draft payload contains private player/profile fields: ${privateFields.join(", ")}.`);
  }
}

export function validateEventChestDraftDefinition(definition) {
  try {
    assertNoPrivateDraftFields(definition);
  } catch (error) {
    return {
      ok: false,
      errors: [String(error?.message ?? "Draft payload contains private player/profile fields.")]
    };
  }

  const validation = validateEventChestDefinition(definition);
  return {
    ok: validation.ok,
    errors: [...(validation.errors ?? [])]
  };
}

function validateEventChestDraftDefinitionForRecord(definition, { allowInvalidDefinition = false } = {}) {
  const validation = validateEventChestDraftDefinition(definition);
  if (!validation.ok && !allowInvalidDefinition) {
    throw new Error(`definition is invalid: ${validation.errors.join("; ")}`);
  }
  return validation;
}

export function normalizeEventChestDraftMetadata(input = {}, { now = new Date().toISOString() } = {}) {
  if (!isObject(input)) {
    throw new Error("draft must be an object.");
  }

  const draftId = normalizeRequiredText(input.draftId, "draftId");
  const draftRevisionId = normalizeRequiredText(input.draftRevisionId, "draftRevisionId");
  const createdAt = normalizeTimestamp(input.createdAt ?? now, "createdAt");
  const updatedAt = normalizeTimestamp(input.updatedAt ?? now, "updatedAt", createdAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error("updatedAt must be greater than or equal to createdAt.");
  }

  return {
    draftId,
    chestId: normalizeOptionalText(input.chestId),
    draftRevisionId,
    status: normalizeStatus(input.status),
    createdAt,
    updatedAt,
    createdBy: normalizeOptionalText(input.createdBy),
    updatedBy: normalizeOptionalText(input.updatedBy),
    copiedFromChestId: normalizeOptionalText(input.copiedFromChestId),
    copiedFromDefinitionRevisionId: normalizeOptionalText(input.copiedFromDefinitionRevisionId),
    copiedFromDraftId: normalizeOptionalText(input.copiedFromDraftId),
    copiedFromDraftRevisionId: normalizeOptionalText(input.copiedFromDraftRevisionId)
  };
}

function deriveEventChestDraftStatus(status, validation) {
  if (status === "published" || status === "archived") {
    return status;
  }
  return validation?.ok ? "ready" : "validation_failed";
}

export function createEventChestDraftRecord(input = {}, options = {}) {
  assertNoPrivateDraftFields(input);
  if (!Object.prototype.hasOwnProperty.call(input, "definition")) {
    throw new Error("definition is required.");
  }

  const now = typeof options.now === "function" ? options.now() : options.now ?? new Date().toISOString();
  const metadata = normalizeEventChestDraftMetadata(input, { now });
  const definition = clone(input.definition);
  const normalizedSchedule = normalizeEventChestActiveWindows(definition?.activeWindows);
  if (normalizedSchedule.ok) {
    definition.activeWindows = normalizedSchedule.windows;
  }
  const definitionValidation = validateEventChestDraftDefinitionForRecord(definition, {
    allowInvalidDefinition: Boolean(options.allowInvalidDefinition)
  });

  const chestId = metadata.chestId ?? (String(definition?.chestId ?? "").trim() || null);
  const validation = {
    ok: definitionValidation.ok,
    errors: [...(definitionValidation.errors ?? [])]
  };

  return {
    ...metadata,
    status: deriveEventChestDraftStatus(metadata.status, validation),
    chestId,
    definition,
    validation
  };
}

function normalizeDraftDocument(value) {
  if (!isObject(value) || value.schemaVersion !== EVENT_CHEST_DRAFT_STORE_VERSION || !Array.isArray(value.drafts)) {
    return clone(EMPTY_DRAFT_DOCUMENT);
  }

  const drafts = [];
  const seen = new Set();
  for (const draft of value.drafts) {
    try {
      const normalized = createEventChestDraftRecord(draft, {
        allowInvalidDefinition: true
      });
      if (seen.has(normalized.draftId)) {
        continue;
      }
      seen.add(normalized.draftId);
      drafts.push(normalized);
    } catch {
      // Invalid stored drafts are ignored until a future repair/import pass can
      // preserve detailed diagnostics without making them authoritative.
    }
  }

  return {
    schemaVersion: EVENT_CHEST_DRAFT_STORE_VERSION,
    drafts: drafts.sort((left, right) => left.draftId.localeCompare(right.draftId))
  };
}

function buildDraftSummary(draft) {
  return {
    draftId: draft.draftId,
    chestId: draft.chestId,
    draftRevisionId: draft.draftRevisionId,
    status: draft.status,
    title: draft.definition?.title ?? null,
    validation: clone(draft.validation),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    createdBy: draft.createdBy,
    updatedBy: draft.updatedBy,
    copiedFromChestId: draft.copiedFromChestId,
    copiedFromDefinitionRevisionId: draft.copiedFromDefinitionRevisionId,
    copiedFromDraftId: draft.copiedFromDraftId,
    copiedFromDraftRevisionId: draft.copiedFromDraftRevisionId
  };
}

function buildNewDraftDefinition({ chestId, title = "Untitled Event Chest" } = {}) {
  return {
    schemaVersion: 1,
    chestId,
    presetId: "event_chest_draft",
    title,
    subtitle: "Draft Event Chest",
    description: "Configure rewards before publishing this Event Chest.",
    modalTitle: title,
    chestType: "daily_event_chest",
    lifecycle: {
      status: "draft",
      defaultPreset: false
    },
    source: "event_chest_draft",
    dropKey: "event_chest_draft",
    collection: "Event Chests",
    releaseTag: "event_chest_draft",
    icons: {
      closed: "icons/loot_chest.png",
      open: "icons/loot_chest_open.png",
      fallbackClosed: "icons/loot_chest.png",
      fallbackOpen: "icons/loot_chest_open.png"
    },
    openTypes: ["free"],
    freeOpenPolicy: {
      cadence: "daily",
      resetTimeZone: "America/Chicago",
      resetHour: 18
    },
    paidTokenCost: 0,
    odds: {
      common: 0.7,
      rare: 0.22,
      epic: 0.07,
      legendary: 0.01
    },
    pity: {
      epicPlusThreshold: 10,
      legendaryThreshold: 30,
      epicPlusTable: [
        { rarity: "epic", weight: 0.875 },
        { rarity: "legendary", weight: 0.125 }
      ]
    },
    duplicateTokenRewards: {
      common: 25,
      rare: 60,
      epic: 150,
      legendary: 400
    },
    pool: {
      common: [],
      rare: [],
      epic: [],
      legendary: []
    },
    preferUnownedWithinRolledRarity: true,
    hideTileWhenPoolComplete: true,
    allowOpensAfterCompleteAsDuplicateConversion: true,
    activeWindows: [],
    definitionHistory: [],
    preserveHistoryOnReactivation: true
  };
}

function appendCopySuffix(value, maxLength = 120) {
  const base = String(value ?? "Untitled Event Chest").trim() || "Untitled Event Chest";
  const suffix = " Copy";
  const copyTitle = base.endsWith(suffix) ? base : `${base}${suffix}`;
  return copyTitle.length <= maxLength
    ? copyTitle
    : `${copyTitle.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function buildDuplicatedDefinition(sourceDefinition, { chestId } = {}) {
  const definition = clone(sourceDefinition);
  if (!isObject(definition)) {
    throw new Error("Source Event Chest definition is malformed.");
  }
  const title = appendCopySuffix(definition.title);
  const modalTitle = appendCopySuffix(definition.modalTitle ?? definition.title);
  delete definition.definitionRevisionId;
  delete definition.registryRevisionId;
  delete definition.publishedAt;
  delete definition.publishedBy;
  delete definition.sourceDraftId;
  delete definition.sourceDraftRevisionId;
  delete definition.activationRevisionId;
  delete definition.activatedAt;
  delete definition.activatedBy;
  delete definition.updatedAt;
  delete definition.updatedBy;

  return {
    ...definition,
    chestId,
    title,
    modalTitle,
    lifecycle: {
      ...(isObject(definition.lifecycle) ? definition.lifecycle : {}),
      status: "draft",
      defaultPreset: false
    },
    activeWindows: [],
    definitionHistory: []
  };
}

export class EventChestDraftStore {
  constructor({
    dataDir,
    now = () => new Date().toISOString(),
    randomUUID = () => crypto.randomUUID()
  } = {}) {
    this.dataDir = resolveDataDir(dataDir);
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
    this.randomUUID =
      typeof randomUUID === "function" ? randomUUID : () => crypto.randomUUID();
    this.filePath = path.join(this.dataDir, "server-data", EVENT_CHEST_DRAFT_STORE_FILENAME);
    this.store = new JsonStore(path.join("server-data", EVENT_CHEST_DRAFT_STORE_FILENAME), {
      dataDir: this.dataDir
    });
    this.mutationQueue = Promise.resolve();
  }

  runMutation(task) {
    const run = this.mutationQueue.then(task, task);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async readDocument() {
    try {
      const source = await fs.readFile(this.filePath, "utf8");
      return normalizeDraftDocument(JSON.parse(stripBom(source)));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return clone(EMPTY_DRAFT_DOCUMENT);
      }
      throw error;
    }
  }

  async listDrafts() {
    return clone((await this.readDocument()).drafts);
  }

  async listDraftSummaries() {
    return clone((await this.listDrafts()).map(buildDraftSummary));
  }

  async getDraft(draftId) {
    const safeDraftId = normalizeRequiredText(draftId, "draftId");
    return clone((await this.listDrafts()).find((draft) => draft.draftId === safeDraftId) ?? null);
  }

  async saveDraft(input = {}) {
    return this.runMutation(async () => {
      assertNoPrivateDraftFields(input);
      const now = this.now();
      const document = await this.readDocument();
      const draftId = normalizeRequiredText(input?.draftId, "draftId");
      const existingIndex = document.drafts.findIndex((draft) => draft.draftId === draftId);
      const existing = existingIndex >= 0 ? document.drafts[existingIndex] : null;
      const expectedDraftRevisionId = normalizeOptionalText(input?.expectedDraftRevisionId);
      if (existing && !expectedDraftRevisionId) {
        throw Object.assign(
          new Error("The current draft revision is required before saving."),
          {
            code: EVENT_CHEST_DRAFT_EXPECTED_REVISION_REQUIRED,
            details: {
              draftId,
              currentDraftRevisionId: existing.draftRevisionId
            }
          }
        );
      }
      if (existing && expectedDraftRevisionId !== existing.draftRevisionId) {
        throw Object.assign(
          new Error("This draft changed after you opened it. Reload the latest version before saving."),
          {
            code: EVENT_CHEST_DRAFT_REVISION_CONFLICT,
            details: {
              draftId,
              currentDraftRevisionId: existing.draftRevisionId
            }
          }
        );
      }

      const candidate = createEventChestDraftRecord(
        {
          ...(existing ?? {}),
          ...(input ?? {}),
          draftId,
          draftRevisionId: existing?.draftRevisionId ?? "pending_server_revision",
          createdAt: existing?.createdAt ?? input?.createdAt ?? now,
          updatedAt: now
        },
        { now, allowInvalidDefinition: true }
      );
      const record = {
        ...candidate,
        draftRevisionId: buildDraftRevisionId(now, this.randomUUID)
      };

      if (existingIndex >= 0) {
        document.drafts[existingIndex] = record;
      } else {
        document.drafts.push(record);
      }
      document.drafts.sort((left, right) => left.draftId.localeCompare(right.draftId));
      await this.store.write(document);
      return clone(record);
    });
  }

  async createDraft({ displaySeed = null, actor = null } = {}) {
    return this.runMutation(async () => {
      const now = this.now();
      const document = await this.readDocument();
      let draftId = "";
      let chestId = "";
      do {
        draftId = buildGeneratedId("event_chest_draft", now, this.randomUUID);
      } while (document.drafts.some((draft) => draft.draftId === draftId));
      do {
        chestId = buildGeneratedId("event_chest", now, this.randomUUID);
      } while (document.drafts.some((draft) => draft.chestId === chestId));

      const titleSeed =
        typeof displaySeed === "string"
          ? displaySeed
          : typeof displaySeed?.title === "string"
            ? displaySeed.title
            : "";
      const definition = buildNewDraftDefinition({
        chestId,
        title: String(titleSeed ?? "").trim() || "Untitled Event Chest"
      });
      const record = createEventChestDraftRecord(
        {
          draftId,
          chestId,
          draftRevisionId: buildDraftRevisionId(now, this.randomUUID),
          status: "validation_failed",
          definition,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor
        },
        { now, allowInvalidDefinition: true }
      );

      document.drafts.push(record);
      document.drafts.sort((left, right) => left.draftId.localeCompare(right.draftId));
      await this.store.write(document);
      return clone(record);
    });
  }

  async duplicateDraft({ sourceDraftId, expectedSourceDraftRevisionId, actor = null } = {}) {
    return this.runMutation(async () => {
      const now = this.now();
      const document = await this.readDocument();
      const safeSourceDraftId = normalizeRequiredText(sourceDraftId, "sourceDraftId");
      const safeExpectedRevisionId = normalizeRequiredText(
        expectedSourceDraftRevisionId,
        "expectedSourceDraftRevisionId"
      );
      const source = document.drafts.find((draft) => draft.draftId === safeSourceDraftId) ?? null;
      if (!source) {
        throw Object.assign(new Error("Event Chest draft was not found."), {
          code: EVENT_CHEST_DRAFT_NOT_FOUND
        });
      }
      if (source.draftRevisionId !== safeExpectedRevisionId) {
        throw Object.assign(
          new Error("This draft changed after you opened it. Reload the latest version before duplicating."),
          {
            code: EVENT_CHEST_DRAFT_SOURCE_REVISION_MISMATCH,
            details: {
              draftId: safeSourceDraftId,
              currentDraftRevisionId: source.draftRevisionId
            }
          }
        );
      }

      let draftId = "";
      let chestId = "";
      do {
        draftId = buildGeneratedId("event_chest_draft", now, this.randomUUID);
      } while (document.drafts.some((draft) => draft.draftId === draftId));
      do {
        chestId = buildGeneratedId("event_chest", now, this.randomUUID);
      } while (document.drafts.some((draft) => draft.chestId === chestId));

      const record = createEventChestDraftRecord(
        {
          draftId,
          chestId,
          draftRevisionId: buildDraftRevisionId(now, this.randomUUID),
          status: "validation_failed",
          definition: buildDuplicatedDefinition(source.definition, { chestId }),
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          copiedFromDraftId: source.draftId,
          copiedFromDraftRevisionId: source.draftRevisionId
        },
        { now, allowInvalidDefinition: true }
      );

      document.drafts.push(record);
      document.drafts.sort((left, right) => left.draftId.localeCompare(right.draftId));
      await this.store.write(document);
      return clone(record);
    });
  }

  async duplicatePublishedDefinition({ definition, actor = null } = {}) {
    return this.runMutation(async () => {
      const now = this.now();
      const document = await this.readDocument();
      const sourceDefinition = clone(definition);
      const sourceChestId = normalizeRequiredText(sourceDefinition?.chestId, "chestId");
      const sourceDefinitionRevisionId = normalizeRequiredText(
        sourceDefinition?.definitionRevisionId,
        "definitionRevisionId"
      );
      let draftId = "";
      let chestId = "";
      do {
        draftId = buildGeneratedId("event_chest_draft", now, this.randomUUID);
      } while (document.drafts.some((draft) => draft.draftId === draftId));
      do {
        chestId = buildGeneratedId("event_chest", now, this.randomUUID);
      } while (document.drafts.some((draft) => draft.chestId === chestId));

      const record = createEventChestDraftRecord(
        {
          draftId,
          chestId,
          draftRevisionId: buildDraftRevisionId(now, this.randomUUID),
          status: "validation_failed",
          definition: buildDuplicatedDefinition(sourceDefinition, { chestId }),
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          copiedFromChestId: sourceChestId,
          copiedFromDefinitionRevisionId: sourceDefinitionRevisionId
        },
        { now, allowInvalidDefinition: true }
      );

      document.drafts.push(record);
      document.drafts.sort((left, right) => left.draftId.localeCompare(right.draftId));
      await this.store.write(document);
      return clone(record);
    });
  }
}
