import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { resolveDataDir } from "./paths.js";
import { JsonStore } from "./storage/jsonStore.js";

export const EVENT_CHEST_ACTIVATION_SCHEMA_VERSION = 2;
export const EVENT_CHEST_ACTIVATION_FILENAME = "event-chest-activation.json";
export const EVENT_CHEST_ACTIVATION_STATUSES = Object.freeze(["active", "inactive"]);
export const EVENT_CHEST_REVISION_LIFECYCLE_STATES = Object.freeze(["inactive", "ended"]);

const LEGACY_EVENT_CHEST_ACTIVATION_SCHEMA_VERSION = 1;

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

export function buildEventChestRevisionLifecycleKey(chestId, definitionRevisionId) {
  const safeChestId = normalizeText(chestId);
  const safeDefinitionRevisionId = normalizeText(definitionRevisionId);
  return safeChestId && safeDefinitionRevisionId
    ? `${safeChestId}:${safeDefinitionRevisionId}`
    : null;
}

function buildEmptyLifecycle() {
  return {
    schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
    active: null,
    revisionStates: {}
  };
}

function normalizeActivePointer(value) {
  if (!isObject(value)) {
    return null;
  }
  const chestId = normalizeText(value.chestId);
  const definitionRevisionId = normalizeText(value.definitionRevisionId);
  const activationRevisionId = normalizeText(value.activationRevisionId);
  const activatedAt = normalizeTimestamp(value.activatedAt);
  if (!chestId || !definitionRevisionId || !activationRevisionId || !activatedAt) {
    return null;
  }
  return {
    activationRevisionId,
    chestId,
    definitionRevisionId,
    activatedAt,
    activatedBy: normalizeText(value.activatedBy),
    updatedAt: normalizeTimestamp(value.updatedAt) ?? activatedAt,
    updatedBy: normalizeText(value.updatedBy ?? value.activatedBy)
  };
}

function normalizeRevisionState(value) {
  if (!isObject(value)) {
    return null;
  }
  const chestId = normalizeText(value.chestId);
  const definitionRevisionId = normalizeText(value.definitionRevisionId);
  const state = EVENT_CHEST_REVISION_LIFECYCLE_STATES.includes(value.state)
    ? value.state
    : null;
  if (!chestId || !definitionRevisionId || !state) {
    return null;
  }
  const deactivatedAt = normalizeTimestamp(value.deactivatedAt);
  const endedAt = normalizeTimestamp(value.endedAt);
  if (state === "inactive" && !deactivatedAt) {
    return null;
  }
  if (state === "ended" && !endedAt) {
    return null;
  }
  return {
    chestId,
    definitionRevisionId,
    state,
    deactivatedAt: state === "inactive" ? deactivatedAt : null,
    deactivatedBy: state === "inactive" ? normalizeText(value.deactivatedBy) : null,
    endedAt: state === "ended" ? endedAt : null,
    endedBy: state === "ended" ? normalizeText(value.endedBy) : null,
    updatedAt: normalizeTimestamp(value.updatedAt) ?? deactivatedAt ?? endedAt,
    updatedBy: normalizeText(value.updatedBy ?? value.deactivatedBy ?? value.endedBy)
  };
}

function normalizeSchemaTwoLifecycle(value) {
  const lifecycle = buildEmptyLifecycle();
  lifecycle.active = value.active == null ? null : normalizeActivePointer(value.active);

  if (isObject(value.revisionStates)) {
    for (const revisionState of Object.values(value.revisionStates)) {
      const normalized = normalizeRevisionState(revisionState);
      const key = normalized
        ? buildEventChestRevisionLifecycleKey(normalized.chestId, normalized.definitionRevisionId)
        : null;
      if (key) {
        lifecycle.revisionStates[key] = normalized;
      }
    }
  }

  if (lifecycle.active) {
    delete lifecycle.revisionStates[
      buildEventChestRevisionLifecycleKey(
        lifecycle.active.chestId,
        lifecycle.active.definitionRevisionId
      )
    ];
  }
  return lifecycle;
}

function normalizeLegacyLifecycle(value) {
  const lifecycle = buildEmptyLifecycle();
  if (value.status !== "active") {
    return lifecycle;
  }
  lifecycle.active = normalizeActivePointer(value);
  return lifecycle;
}

function normalizeLifecycleDocument(value) {
  if (!isObject(value)) {
    return buildEmptyLifecycle();
  }
  if (value.schemaVersion === EVENT_CHEST_ACTIVATION_SCHEMA_VERSION) {
    return normalizeSchemaTwoLifecycle(value);
  }
  if (value.schemaVersion === LEGACY_EVENT_CHEST_ACTIVATION_SCHEMA_VERSION) {
    return normalizeLegacyLifecycle(value);
  }
  return buildEmptyLifecycle();
}

function buildActivationProjection(lifecycle) {
  const active = lifecycle?.active ?? null;
  return {
    schemaVersion: EVENT_CHEST_ACTIVATION_SCHEMA_VERSION,
    activationRevisionId: active?.activationRevisionId ?? null,
    status: active ? "active" : "inactive",
    chestId: active?.chestId ?? null,
    definitionRevisionId: active?.definitionRevisionId ?? null,
    activatedAt: active?.activatedAt ?? null,
    activatedBy: active?.activatedBy ?? null,
    endedAt: null,
    endedBy: null,
    updatedAt: active?.updatedAt ?? null,
    updatedBy: active?.updatedBy ?? null,
    lifecycle: clone(lifecycle)
  };
}

function lifecycleError(message, code) {
  return Object.assign(new Error(message), { code });
}

function requireExactRevision(chestId, definitionRevisionId) {
  const safeChestId = normalizeText(chestId);
  const safeDefinitionRevisionId = normalizeText(definitionRevisionId);
  if (!safeChestId) {
    throw lifecycleError("chestId is required.", "EVENT_CHEST_ACTIVATION_INVALID_REQUEST");
  }
  if (!safeDefinitionRevisionId) {
    throw lifecycleError(
      "definitionRevisionId is required.",
      "EVENT_CHEST_ACTIVATION_INVALID_REQUEST"
    );
  }
  return {
    chestId: safeChestId,
    definitionRevisionId: safeDefinitionRevisionId,
    key: buildEventChestRevisionLifecycleKey(safeChestId, safeDefinitionRevisionId)
  };
}

function buildMutationResult(lifecycle, fields = {}) {
  return {
    activation: buildActivationProjection(lifecycle),
    lifecycle: clone(lifecycle),
    ...fields
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

  async readLifecycle() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return clone(normalizeLifecycleDocument(JSON.parse(stripBom(raw))));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return buildEmptyLifecycle();
      }
      throw error;
    }
  }

  async readActivation() {
    return buildActivationProjection(await this.readLifecycle());
  }

  async activate({ chestId, definitionRevisionId, actor = null } = {}) {
    return this.runMutation(async () => {
      const exact = requireExactRevision(chestId, definitionRevisionId);
      const lifecycle = await this.readLifecycle();
      const targetState = lifecycle.revisionStates[exact.key] ?? null;
      if (targetState?.state === "ended") {
        throw lifecycleError(
          "This Event Chest revision has ended and cannot be activated again.",
          "EVENT_CHEST_REVISION_ENDED"
        );
      }
      if (
        lifecycle.active?.chestId === exact.chestId &&
        lifecycle.active?.definitionRevisionId === exact.definitionRevisionId
      ) {
        return buildMutationResult(lifecycle, {
          activationStatus: "already_active",
          idempotent: true,
          alreadyActive: true
        });
      }

      const now = normalizeTimestamp(this.now()) ?? new Date().toISOString();
      const safeActor = normalizeText(actor);
      if (lifecycle.active) {
        const previousKey = buildEventChestRevisionLifecycleKey(
          lifecycle.active.chestId,
          lifecycle.active.definitionRevisionId
        );
        lifecycle.revisionStates[previousKey] = {
          chestId: lifecycle.active.chestId,
          definitionRevisionId: lifecycle.active.definitionRevisionId,
          state: "inactive",
          deactivatedAt: now,
          deactivatedBy: safeActor,
          endedAt: null,
          endedBy: null,
          updatedAt: now,
          updatedBy: safeActor
        };
      }
      delete lifecycle.revisionStates[exact.key];
      lifecycle.active = {
        activationRevisionId: buildRevisionId(now),
        chestId: exact.chestId,
        definitionRevisionId: exact.definitionRevisionId,
        activatedAt: now,
        activatedBy: safeActor,
        updatedAt: now,
        updatedBy: safeActor
      };

      await this.store.write(lifecycle);
      return buildMutationResult(lifecycle, {
        activationStatus: "activated",
        idempotent: false,
        alreadyActive: false
      });
    });
  }

  async deactivate({ chestId, definitionRevisionId, actor = null } = {}) {
    return this.runMutation(async () => {
      const exact = requireExactRevision(chestId, definitionRevisionId);
      const lifecycle = await this.readLifecycle();
      if (!lifecycle.active) {
        if (lifecycle.revisionStates[exact.key]?.state === "inactive") {
          return buildMutationResult(lifecycle, {
            activationStatus: "already_inactive",
            idempotent: true,
            alreadyInactive: true
          });
        }
        throw lifecycleError(
          "The selected Event Chest revision is not active.",
          "EVENT_CHEST_NOT_ACTIVE"
        );
      }
      if (
        lifecycle.active.chestId !== exact.chestId ||
        lifecycle.active.definitionRevisionId !== exact.definitionRevisionId
      ) {
        throw lifecycleError(
          "The active Event Chest revision no longer matches the selected revision.",
          "EVENT_CHEST_ACTIVE_REVISION_MISMATCH"
        );
      }

      const now = normalizeTimestamp(this.now()) ?? new Date().toISOString();
      const safeActor = normalizeText(actor);
      lifecycle.active = null;
      lifecycle.revisionStates[exact.key] = {
        chestId: exact.chestId,
        definitionRevisionId: exact.definitionRevisionId,
        state: "inactive",
        deactivatedAt: now,
        deactivatedBy: safeActor,
        endedAt: null,
        endedBy: null,
        updatedAt: now,
        updatedBy: safeActor
      };
      await this.store.write(lifecycle);
      return buildMutationResult(lifecycle, {
        activationStatus: "deactivated",
        idempotent: false,
        alreadyInactive: false
      });
    });
  }

  async end({ chestId, definitionRevisionId, actor = null } = {}) {
    return this.runMutation(async () => {
      const exact = requireExactRevision(chestId, definitionRevisionId);
      const lifecycle = await this.readLifecycle();
      if (!lifecycle.active) {
        if (lifecycle.revisionStates[exact.key]?.state === "ended") {
          return buildMutationResult(lifecycle, {
            activationStatus: "already_ended",
            idempotent: true,
            alreadyEnded: true
          });
        }
        throw lifecycleError(
          "The selected Event Chest revision is not active.",
          "EVENT_CHEST_NOT_ACTIVE"
        );
      }
      if (
        lifecycle.active.chestId !== exact.chestId ||
        lifecycle.active.definitionRevisionId !== exact.definitionRevisionId
      ) {
        throw lifecycleError(
          "The active Event Chest revision no longer matches the selected revision.",
          "EVENT_CHEST_ACTIVE_REVISION_MISMATCH"
        );
      }

      const now = normalizeTimestamp(this.now()) ?? new Date().toISOString();
      const safeActor = normalizeText(actor);
      lifecycle.active = null;
      lifecycle.revisionStates[exact.key] = {
        chestId: exact.chestId,
        definitionRevisionId: exact.definitionRevisionId,
        state: "ended",
        deactivatedAt: null,
        deactivatedBy: null,
        endedAt: now,
        endedBy: safeActor,
        updatedAt: now,
        updatedBy: safeActor
      };
      await this.store.write(lifecycle);
      return buildMutationResult(lifecycle, {
        activationStatus: "ended",
        idempotent: false,
        alreadyEnded: false
      });
    });
  }
}

export function normalizeEventChestActivationDocument(value) {
  return buildActivationProjection(normalizeLifecycleDocument(value));
}

export function normalizeEventChestLifecycleDocument(value) {
  return normalizeLifecycleDocument(value);
}
