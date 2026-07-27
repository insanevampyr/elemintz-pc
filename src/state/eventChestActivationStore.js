import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { resolveDataDir } from "./paths.js";
import { JsonStore } from "./storage/jsonStore.js";

export const EVENT_CHEST_ACTIVATION_SCHEMA_VERSION = 1;
export const EVENT_CHEST_ACTIVATION_FILENAME = "event-chest-activation.json";
export const EVENT_CHEST_ACTIVATION_STATUSES = Object.freeze(["active", "inactive"]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildRevisionId(timestamp) {
  const safeTimestamp = String(timestamp ?? "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `event_chest_activation_revision_${safeTimestamp || Date.now()}_${crypto.randomUUID()}`;
}

function buildInactiveActivation({
  activationRevisionId = null,
  updatedAt = null,
  updatedBy = null,
  endedAt = null,
  endedBy = null
} = {}) {
  return {
    schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
    activationRevisionId: normalizeText(activationRevisionId),
    status: "inactive",
    chestId: null,
    definitionRevisionId: null,
    activatedAt: null,
    activatedBy: null,
    endedAt: normalizeTimestamp(endedAt),
    endedBy: normalizeText(endedBy),
    updatedAt: normalizeTimestamp(updatedAt),
    updatedBy: normalizeText(updatedBy)
  };
}

function normalizeActivationDocument(value) {
  if (!isObject(value) || value.schemaVersion !== EVENT_CHEST_ACTIVATION_SCHEMA_VERSION) {
    return buildInactiveActivation();
  }

  const status = EVENT_CHEST_ACTIVATION_STATUSES.includes(value.status) ? value.status : "inactive";
  if (status !== "active") {
    return buildInactiveActivation({
      activationRevisionId: value.activationRevisionId,
      updatedAt: value.updatedAt,
      updatedBy: value.updatedBy,
      endedAt: value.endedAt,
      endedBy: value.endedBy
    });
  }

  const chestId = normalizeText(value.chestId);
  const definitionRevisionId = normalizeText(value.definitionRevisionId);
  const activationRevisionId = normalizeText(value.activationRevisionId);
  const activatedAt = normalizeTimestamp(value.activatedAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  if (!chestId || !definitionRevisionId || !activationRevisionId || !activatedAt || !updatedAt) {
    return buildInactiveActivation();
  }

  return {
    schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
    activationRevisionId,
    status: "active",
    chestId,
    definitionRevisionId,
    activatedAt,
    activatedBy: normalizeText(value.activatedBy),
    endedAt: null,
    endedBy: null,
    updatedAt,
    updatedBy: normalizeText(value.updatedBy)
  };
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export class EventChestActivationStore {
  constructor({ dataDir, now = () => new Date().toISOString() } = {}) {
    this.dataDir = resolveDataDir(dataDir);
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
    this.filePath = path.join(this.dataDir, "server-data", EVENT_CHEST_ACTIVATION_FILENAME);
    this.store = new JsonStore(path.join("server-data", EVENT_CHEST_ACTIVATION_FILENAME), {
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

  async readActivation() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return clone(normalizeActivationDocument(JSON.parse(stripBom(raw))));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return buildInactiveActivation();
      }
      throw error;
    }
  }

  async activate({ chestId, definitionRevisionId, actor = null } = {}) {
    return this.runMutation(async () => {
      const safeChestId = normalizeText(chestId);
      const safeDefinitionRevisionId = normalizeText(definitionRevisionId);
      if (!safeChestId) {
        throw Object.assign(new Error("chestId is required."), {
          code: "EVENT_CHEST_ACTIVATION_INVALID_REQUEST"
        });
      }
      if (!safeDefinitionRevisionId) {
        throw Object.assign(new Error("definitionRevisionId is required."), {
          code: "EVENT_CHEST_ACTIVATION_INVALID_REQUEST"
        });
      }

      const current = await this.readActivation();
      if (
        current.status === "active" &&
        current.chestId === safeChestId &&
        current.definitionRevisionId === safeDefinitionRevisionId
      ) {
        return {
          activation: current,
          activationStatus: "already_active",
          idempotent: true,
          alreadyActive: true
        };
      }

      const now = normalizeTimestamp(this.now()) ?? new Date().toISOString();
      const activation = {
        schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
        activationRevisionId: buildRevisionId(now),
        status: "active",
        chestId: safeChestId,
        definitionRevisionId: safeDefinitionRevisionId,
        activatedAt: now,
        activatedBy: normalizeText(actor),
        endedAt: null,
        endedBy: null,
        updatedAt: now,
        updatedBy: normalizeText(actor)
      };

      await this.store.write(activation);
      return {
        activation: clone(activation),
        activationStatus: "activated",
        idempotent: false,
        alreadyActive: false
      };
    });
  }

  async end({ actor = null } = {}) {
    return this.runMutation(async () => {
      const current = await this.readActivation();
      if (current.status !== "active") {
        return {
          activation: current,
          activationStatus: "already_inactive",
          idempotent: true,
          alreadyInactive: true
        };
      }

      const now = normalizeTimestamp(this.now()) ?? new Date().toISOString();
      const activation = {
        schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
        activationRevisionId: buildRevisionId(now),
        status: "inactive",
        chestId: null,
        definitionRevisionId: null,
        activatedAt: null,
        activatedBy: null,
        endedAt: now,
        endedBy: normalizeText(actor),
        updatedAt: now,
        updatedBy: normalizeText(actor)
      };

      await this.store.write(activation);
      return {
        activation: clone(activation),
        activationStatus: "ended",
        idempotent: false,
        alreadyInactive: false
      };
    });
  }
}

export function normalizeEventChestActivationDocument(value) {
  return normalizeActivationDocument(value);
}
