import fs from "node:fs/promises";
import path from "node:path";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  normalizeEventChestOpeningRules,
  validateEventChestDefinition
} from "./eventChestDefinitions.js";
import { normalizeEventChestActiveWindows } from "./eventChestSchedule.js";
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

function sanitizeRegistryDefinitionForPublish(
  definition,
  { now, actor = null, sourceDraftId = null, sourceDraftRevisionId = null } = {}
) {
  const publishedAt = normalizeTimestamp(now, "publishedAt");
  const safeActor = normalizeOptionalText(actor);
  const safeDefinition = normalizeEventChestOpeningRules(clone(definition));
  const schedule = normalizeEventChestActiveWindows(safeDefinition?.activeWindows);
  if (!schedule.ok) {
    throw new Error(`Event Chest schedule is invalid: ${schedule.errors.join("; ")}`);
  }
  safeDefinition.activeWindows = schedule.windows;
  const chestId = String(safeDefinition?.chestId ?? "").trim();
  const revisionId =
    normalizeOptionalText(safeDefinition?.definitionRevisionId) ??
    buildRevisionId(`definition_revision_${chestId || "event_chest"}`, publishedAt);

  return {
    ...safeDefinition,
    definitionRevisionId: revisionId,
    publishedAt,
    publishedBy: safeActor,
    sourceDraftId: normalizeOptionalText(sourceDraftId),
    sourceDraftRevisionId: normalizeOptionalText(sourceDraftRevisionId),
    updatedAt: publishedAt,
    updatedBy: safeActor
  };
}

function buildRegistryReadModelFromDocument(registry, { source = "file", warnings = [], errors = [] } = {}) {
  const latestDefinitions = getLatestEventChestDefinitions(registry?.definitions ?? []);
  return {
    ok: errors.length === 0,
    source,
    readAt: new Date().toISOString(),
    registry: {
      ...clone(registry),
      definitions: clone(latestDefinitions)
    },
    definitions: clone(latestDefinitions),
    warnings: [...warnings],
    errors: [...errors]
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

function getRevisionSortTimestamp(definition) {
  const publishedMs = Date.parse(String(definition?.publishedAt ?? ""));
  if (Number.isFinite(publishedMs)) {
    return publishedMs;
  }
  const updatedMs = Date.parse(String(definition?.updatedAt ?? ""));
  return Number.isFinite(updatedMs) ? updatedMs : 0;
}

function compareLatestDefinitions(left, right) {
  const leftMs = getRevisionSortTimestamp(left);
  const rightMs = getRevisionSortTimestamp(right);
  if (leftMs !== rightMs) {
    return leftMs - rightMs;
  }

  return String(left?.definitionRevisionId ?? "").localeCompare(String(right?.definitionRevisionId ?? ""));
}

function getLatestEventChestDefinitions(definitions) {
  const latestByChestId = new Map();
  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const chestId = String(definition?.chestId ?? "").trim();
    if (!chestId) {
      continue;
    }

    const current = latestByChestId.get(chestId);
    if (!current || compareLatestDefinitions(current, definition) <= 0) {
      latestByChestId.set(chestId, definition);
    }
  }

  return [...latestByChestId.values()].sort((left, right) =>
    String(left?.chestId ?? "").localeCompare(String(right?.chestId ?? ""))
  );
}

function isCompletePublishedDefinition(definition) {
  return Boolean(
    normalizeOptionalText(definition?.definitionRevisionId) &&
      normalizeOptionalText(definition?.publishedAt)
  );
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
  const seenRevisionKeys = new Set();
  for (const [index, definition] of (Array.isArray(document.definitions) ? document.definitions : []).entries()) {
    const chestId = String(definition?.chestId ?? "").trim() || `index:${index}`;
    const definitionRevisionId = String(definition?.definitionRevisionId ?? "").trim();
    const revisionKey = `${chestId}\u0000${definitionRevisionId}`;
    if (seenRevisionKeys.has(revisionKey)) {
      errors.push(
        definitionRevisionId
          ? `definitions contains duplicate chestId and definitionRevisionId '${chestId}:${definitionRevisionId}'.`
          : `definitions contains duplicate chestId '${chestId}' without definitionRevisionId.`
      );
      continue;
    }
    seenRevisionKeys.add(revisionKey);

    const validation = validateEventChestDefinition(definition);
    const scheduleErrors = (validation.errors ?? []).filter((error) =>
      String(error).startsWith("activeWindows")
    );
    const blockingErrors = (validation.errors ?? []).filter(
      (error) => !String(error).startsWith("activeWindows")
    );
    if (blockingErrors.length > 0) {
      errors.push(`definitions[${index}] '${chestId}' is invalid: ${blockingErrors.join("; ")}`);
      continue;
    }
    if (scheduleErrors.length > 0) {
      warnings.push(
        `definitions[${index}] '${chestId}' has an invalid historical schedule and is unavailable for new delivery: ${scheduleErrors.join("; ")}`
      );
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
        registry: {
          ...clone(validation.registry),
          definitions: clone(getLatestEventChestDefinitions(validation.registry.definitions))
        },
        definitions: clone(getLatestEventChestDefinitions(validation.registry.definitions)),
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

  async getPublishedEventChestDefinitionRevision({ chestId, definitionRevisionId } = {}) {
    const safeChestId = String(chestId ?? "").trim();
    const safeDefinitionRevisionId = String(definitionRevisionId ?? "").trim();
    if (!safeChestId || !safeDefinitionRevisionId) {
      throw Object.assign(new Error("chestId and definitionRevisionId are required."), {
        code: "EVENT_CHEST_ACTIVATION_INVALID_REQUEST"
      });
    }

    let parsed = null;
    try {
      parsed = await this.readRawFile();
    } catch (error) {
      throw Object.assign(new Error("Published Event Chest registry is unavailable or invalid."), {
        code: "EVENT_CHEST_ACTIVATION_REGISTRY_UNAVAILABLE",
        cause: error
      });
    }

    const validation = validateEventChestRegistryDocument(parsed);
    if (!validation.ok) {
      throw Object.assign(new Error("Published Event Chest registry is unavailable or invalid."), {
        code: "EVENT_CHEST_ACTIVATION_REGISTRY_UNAVAILABLE"
      });
    }

    const definitions = Array.isArray(validation.registry.definitions) ? validation.registry.definitions : [];
    const sameChestDefinitions = definitions.filter((definition) => definition?.chestId === safeChestId);
    if (sameChestDefinitions.length === 0) {
      throw Object.assign(new Error(`Event Chest definition '${safeChestId}' was not found.`), {
        code: "EVENT_CHEST_DEFINITION_NOT_FOUND"
      });
    }

    const definition =
      sameChestDefinitions.find(
        (entry) => String(entry?.definitionRevisionId ?? "").trim() === safeDefinitionRevisionId
      ) ?? null;
    if (!definition) {
      throw Object.assign(
        new Error(`Event Chest definition revision '${safeDefinitionRevisionId}' was not found.`),
        { code: "EVENT_CHEST_DEFINITION_REVISION_NOT_FOUND" }
      );
    }

    if (!String(definition?.publishedAt ?? "").trim()) {
      throw Object.assign(new Error("Event Chest definition revision is not publish-complete."), {
        code: "EVENT_CHEST_DEFINITION_REVISION_NOT_FOUND"
      });
    }

    return clone(definition);
  }

  async publishEventChestDraftDefinition({
    definition,
    actor = null,
    sourceDraftId = null,
    sourceDraftRevisionId = null
  } = {}) {
    return this.runMutation(async () => {
      const draftValidation = validateEventChestDefinition(definition);
      if (!draftValidation.ok) {
        throw new Error(`Event Chest draft definition is invalid: ${draftValidation.errors.join("; ")}`);
      }

      const now = this.now();
      const publishedAt = normalizeTimestamp(now, "publishedAt");
      const baseRegistry = await this.readPublishBaseRegistry();
      const existingDefinitions = Array.isArray(baseRegistry.definitions) ? baseRegistry.definitions : [];
      const seenRevisionKeys = new Set();
      for (const existingDefinition of existingDefinitions) {
        const chestId = String(existingDefinition?.chestId ?? "").trim();
        if (!chestId) {
          continue;
        }
        const definitionRevisionId = String(existingDefinition?.definitionRevisionId ?? "").trim();
        const revisionKey = `${chestId}\u0000${definitionRevisionId}`;
        if (seenRevisionKeys.has(revisionKey)) {
          throw new Error(
            definitionRevisionId
              ? `Existing Event Chest registry contains duplicate chestId and definitionRevisionId '${chestId}:${definitionRevisionId}'.`
              : `Existing Event Chest registry contains duplicate chestId '${chestId}' without definitionRevisionId.`
          );
        }
        seenRevisionKeys.add(revisionKey);
      }

      const safeSourceDraftId = normalizeOptionalText(sourceDraftId);
      const safeSourceDraftRevisionId = normalizeOptionalText(sourceDraftRevisionId);
      const chestId = String(definition?.chestId ?? "").trim();
      const existingPublishedDefinition =
        existingDefinitions.find(
          (existingDefinition) =>
            existingDefinition.chestId === chestId &&
            safeSourceDraftId &&
            safeSourceDraftRevisionId &&
            existingDefinition.sourceDraftId === safeSourceDraftId &&
            existingDefinition.sourceDraftRevisionId === safeSourceDraftRevisionId
        ) ?? null;
      if (
        existingPublishedDefinition &&
        existingPublishedDefinition.sourceDraftId === safeSourceDraftId &&
        existingPublishedDefinition.sourceDraftRevisionId === safeSourceDraftRevisionId
      ) {
        return {
          ...buildRegistryReadModelFromDocument(baseRegistry),
          publishedDefinition: clone(existingPublishedDefinition),
          publicationStatus: "already_published",
          idempotent: true,
          alreadyPublished: true
        };
      }

      const publishedDefinition = sanitizeRegistryDefinitionForPublish(definition, {
        now: publishedAt,
        actor,
        sourceDraftId: safeSourceDraftId,
        sourceDraftRevisionId: safeSourceDraftRevisionId
      });
      const retainedDefinitions = [
        ...existingDefinitions
          .filter(
            (existingDefinition) =>
              existingDefinition.chestId !== chestId || isCompletePublishedDefinition(existingDefinition)
          )
          .map((existingDefinition) => clone(existingDefinition)),
        publishedDefinition
      ];

      const document = {
        schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
        registryId: normalizeOptionalText(baseRegistry.registryId) ?? EVENT_CHEST_REGISTRY_ID,
        registryRevisionId: buildRevisionId("registry_revision", publishedAt),
        publishedAt,
        publishedBy: normalizeOptionalText(actor),
        definitions: retainedDefinitions
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
      return {
        ...reread,
        publishedDefinition: clone(publishedDefinition),
        publicationStatus: "published",
        idempotent: false,
        alreadyPublished: false
      };
    });
  }
}

export function getStaticEventChestRegistryFallback() {
  return clone(STATIC_FALLBACK_REGISTRY);
}

export function validateEventChestRegistryDocumentForAdmin(document) {
  return validateEventChestRegistryDocument(document);
}
