import fs from "node:fs/promises";
import path from "node:path";

import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "./eventChestDefinitions.js";
import { resolveDataDir } from "./paths.js";

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
  }

  async readRawFile() {
    const source = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(stripBom(source));
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
}

export function getStaticEventChestRegistryFallback() {
  return clone(STATIC_FALLBACK_REGISTRY);
}

export function validateEventChestRegistryDocumentForAdmin(document) {
  return validateEventChestRegistryDocument(document);
}
