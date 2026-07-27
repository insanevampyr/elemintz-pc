import fs from "node:fs/promises";
import path from "node:path";

import { validateEventChestDefinition } from "./eventChestDefinitions.js";
import { resolveDataDir } from "./paths.js";
import { JsonStore } from "./storage/jsonStore.js";

export const EVENT_CHEST_DRAFT_STORE_VERSION = 1;
export const EVENT_CHEST_DRAFT_STORE_FILENAME = "event-chest-drafts.json";
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
    copiedFromDefinitionRevisionId: normalizeOptionalText(input.copiedFromDefinitionRevisionId)
  };
}

export function createEventChestDraftRecord(input = {}, options = {}) {
  assertNoPrivateDraftFields(input);
  if (!Object.prototype.hasOwnProperty.call(input, "definition")) {
    throw new Error("definition is required.");
  }

  const now = typeof options.now === "function" ? options.now() : options.now ?? new Date().toISOString();
  const metadata = normalizeEventChestDraftMetadata(input, { now });
  const definition = clone(input.definition);
  const definitionValidation = validateEventChestDraftDefinition(definition);
  if (!definitionValidation.ok) {
    throw new Error(`definition is invalid: ${definitionValidation.errors.join("; ")}`);
  }

  const chestId = metadata.chestId ?? (String(definition?.chestId ?? "").trim() || null);
  const validation = {
    ok: true,
    errors: []
  };

  return {
    ...metadata,
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
      const normalized = createEventChestDraftRecord(draft);
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
    copiedFromDefinitionRevisionId: draft.copiedFromDefinitionRevisionId
  };
}

export class EventChestDraftStore {
  constructor({ dataDir, now = () => new Date().toISOString() } = {}) {
    this.dataDir = resolveDataDir(dataDir);
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
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
      const record = createEventChestDraftRecord(
        {
          ...(existing ?? {}),
          ...(input ?? {}),
          draftId,
          createdAt: existing?.createdAt ?? input?.createdAt ?? now,
          updatedAt: now
        },
        { now }
      );

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
}
