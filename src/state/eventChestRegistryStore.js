import fs from "node:fs/promises";
import path from "node:path";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "./eventChestDefinitions.js";
import { resolveDataDir } from "./paths.js";
import { JsonStore } from "./storage/jsonStore.js";

export const EVENT_CHEST_REGISTRY_DOCUMENT_VERSION = 1;
export const EVENT_CHEST_REGISTRY_FILENAME = "event-chest-registry.json";
export const EVENT_CHEST_REGISTRY_ID = "elemintz_event_chest_registry";

const STATIC_FALLBACK_REGISTRY = Object.freeze({
  schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
  registryId: EVENT_CHEST_REGISTRY_ID,
  registryRevisionId: "static_daily_elemintz_chest_default",
  publishedAt: null,
  publishedBy: null,
  definitions: Object.freeze([DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET])
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function normalizeTimestamp(value, fieldName) {
  const parsedMs = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsedMs)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }
  return new Date(parsedMs).toISOString();
}

function buildRevisionId(prefix, timestamp) {
  const safeTimestamp = String(timestamp ?? "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${safeTimestamp || Date.now()}`;
}

function sanitizeRegistryDefinitionForPublish(definition, { now, actor = null } = {}) {
  const publishedAt = normalizeTimestamp(now, "publishedAt");
  const safeActor = normalizeOptionalText(actor);
  const safeDefinition = clone(definition);
  const chestId = String(safeDefinition?.chestId ?? "").trim();
  const revisionId =
    normalizeOptionalText(safeDefinition?.definitionRevisionId) ??
    buildRevisionId(`definition_revision_${chestId || "event_chest"}`, publishedAt);

  return {
    ...safeDefinition,
    definitionRevisionId: revisionId,
    publishedAt,
    publishedBy: safeActor,
    updatedAt: publishedAt,
    updatedBy: safeActor
  };
}

function buildFallbackReadModel({ source = "fallback_static", readAt, warnings = [], errors = [] } = {}) {
  return {
    ok: errors.length === 0,
    source,
    readAt,
    registry: clone(STATIC_FALLBACK_REGISTRY),
    definitions: clone(STATIC_FALLBACK_REGISTRY.definitions),
    warnings: [...warnings],
    errors: [...errors]
  };
}

function validateEventChestRegistryDocument(document) {
  const errors = [];
  const warnings = [];

  if (!isObject(document)) {
    return {
      ok: false,
      errors: ["registry must be an object."],
      warnings,
      registry: null
    };
  }

  if (document.schemaVersion !== EVENT_CHEST_REGISTRY_DOCUMENT_VERSION) {
    errors.push(`schemaVersion must be ${EVENT_CHEST_REGISTRY_DOCUMENT_VERSION}.`);
  }

  const registryId = String(document.registryId ?? "").trim();
  if (!registryId) {
    errors.push("registryId is required.");
  }

  const registryRevisionId = String(document.registryRevisionId ?? "").trim();
  if (!registryRevisionId) {
    errors.push("registryRevisionId is required.");
  }

  const publishedAt = normalizeOptionalText(document.publishedAt);
  if (publishedAt && Number.isNaN(Date.parse(publishedAt))) {
    errors.push("publishedAt must be a valid timestamp when provided.");
  }

  if (!Array.isArray(document.definitions)) {
    errors.push("definitions must be an array.");
  } else if (document.definitions.length === 0) {
    errors.push("definitions must include at least one Event Chest definition.");
  }

  const definitions = [];
  const seenChestIds = new Set();
  for (const [index, definition] of (Array.isArray(document.definitions) ? document.definitions : []).entries()) {
    const chestId = String(definition?.chestId ?? "").trim() || `index:${index}`;
    if (seenChestIds.has(chestId)) {
      errors.push(`definitions contains duplicate chestId '${chestId}'.`);
      continue;
    }
    seenChestIds.add(chestId);

    const validation = validateEventChestDefinition(definition);
    if (!validation.ok) {
      errors.push(`definitions[${index}] '${chestId}' is invalid: ${validation.errors.join("; ")}`);
      continue;
    }

    definitions.push(clone(definition));
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      registry: null
    };
  }

  return {
    ok: true,
    errors,
    warnings,
    registry: {
      schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
      registryId,
      registryRevisionId,
      publishedAt,
      publishedBy: normalizeOptionalText(document.publishedBy),
      definitions
    }
  };
}

export class EventChestRegistryStore {
  constructor({ dataDir, logger = console, now = () => new Date().toISOString() } = {}) {
    this.dataDir = resolveDataDir(dataDir);
    this.logger = logger;
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
    this.filePath = path.join(this.dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
    this.store = new JsonStore(path.join("server-data", EVENT_CHEST_REGISTRY_FILENAME), {
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

  async readRawFile() {
    const source = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(stripBom(source));
  }

  async readPublishBaseRegistry() {
    try {
      const parsed = await this.readRawFile();
      const validation = validateEventChestRegistryDocument(parsed);
      if (!validation.ok) {
        throw new Error(`Existing Event Chest registry is invalid: ${validation.errors.join("; ")}`);
      }
      return validation.registry;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return clone(STATIC_FALLBACK_REGISTRY);
      }
      throw error;
    }
  }

  async getPublishedEventChestRegistry() {
    const readAt = this.now();
    try {
      const parsed = await this.readRawFile();
      const validation = validateEventChestRegistryDocument(parsed);
      if (!validation.ok) {
        return buildFallbackReadModel({
          source: "fallback_static",
          readAt,
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      return {
        ok: true,
        source: "file",
        readAt,
        registry: clone(validation.registry),
        definitions: clone(validation.registry.definitions),
        warnings: validation.warnings,
        errors: []
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return buildFallbackReadModel({ source: "fallback_static", readAt });
      }

      this.logger?.warn?.("[EventChestRegistryStore] registry read failed; using static fallback", {
        filePath: this.filePath,
        message: error?.message ?? String(error)
      });

      return buildFallbackReadModel({
        source: "fallback_static",
        readAt,
        errors: [`Unable to read event chest registry: ${error?.message ?? String(error)}`]
      });
    }
  }

  async getEventChestRegistryReadModel() {
    return this.getPublishedEventChestRegistry();
  }

  async getEventChestDefinitionById(chestId) {
    const safeChestId = String(chestId ?? "").trim();
    if (!safeChestId) {
      return null;
    }

    const registry = await this.getPublishedEventChestRegistry();
    return clone((registry.definitions ?? []).find((definition) => definition.chestId === safeChestId) ?? null);
  }

  async publishEventChestDraftDefinition({ definition, actor = null } = {}) {
    return this.runMutation(async () => {
      const draftValidation = validateEventChestDefinition(definition);
      if (!draftValidation.ok) {
        throw new Error(`Event Chest draft definition is invalid: ${draftValidation.errors.join("; ")}`);
      }

      const now = this.now();
      const publishedAt = normalizeTimestamp(now, "publishedAt");
      const baseRegistry = await this.readPublishBaseRegistry();
      const existingDefinitions = Array.isArray(baseRegistry.definitions) ? baseRegistry.definitions : [];
      const seenChestIds = new Set();
      for (const existingDefinition of existingDefinitions) {
        const chestId = String(existingDefinition?.chestId ?? "").trim();
        if (!chestId) {
          continue;
        }
        if (seenChestIds.has(chestId)) {
          throw new Error(`Existing Event Chest registry contains duplicate chestId '${chestId}'.`);
        }
        seenChestIds.add(chestId);
      }

      const publishedDefinition = sanitizeRegistryDefinitionForPublish(definition, {
        now: publishedAt,
        actor
      });
      const chestId = String(publishedDefinition.chestId ?? "").trim();
      const replaced = [];
      let didReplace = false;
      for (const existingDefinition of existingDefinitions) {
        if (existingDefinition.chestId === chestId) {
          replaced.push(publishedDefinition);
          didReplace = true;
        } else {
          replaced.push(clone(existingDefinition));
        }
      }
      if (!didReplace) {
        replaced.push(publishedDefinition);
      }

      const document = {
        schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
        registryId: normalizeOptionalText(baseRegistry.registryId) ?? EVENT_CHEST_REGISTRY_ID,
        registryRevisionId: buildRevisionId("registry_revision", publishedAt),
        publishedAt,
        publishedBy: normalizeOptionalText(actor),
        definitions: replaced
      };
      const registryValidation = validateEventChestRegistryDocument(document);
      if (!registryValidation.ok) {
        throw new Error(`Published Event Chest registry is invalid: ${registryValidation.errors.join("; ")}`);
      }

      await this.store.write(registryValidation.registry);

      const reread = await this.getPublishedEventChestRegistry();
      if (!reread.ok) {
        throw new Error(`Published Event Chest registry failed re-read validation: ${(reread.errors ?? []).join("; ")}`);
      }
      return reread;
    });
  }
}

export function getStaticEventChestRegistryFallback() {
  return clone(STATIC_FALLBACK_REGISTRY);
}

export function validateEventChestRegistryDocumentForAdmin(document) {
  return validateEventChestRegistryDocument(document);
}
