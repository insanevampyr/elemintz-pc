import fs from "node:fs/promises";
import path from "node:path";

import { COSMETIC_CATALOG } from "../state/cosmeticSystem.js";

const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_COSMETIC_IDS = 64;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const MS_PER_DAY = 86_400_000;
const DEFAULT_SCHEDULE_CONFIG = Object.freeze({
  enabled: false,
  mode: "weekly",
  rotationLengthDays: 7,
  anchorDate: null,
  rotationOrder: [],
  rotations: {}
});

function sanitizeText(value, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function stripUtf8Bom(value) {
  const source = String(value ?? "");
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function normalizeTimestamp(value) {
  if (value == null) {
    return null;
  }

  const safeValue = sanitizeText(value, 64);
  if (!safeValue) {
    return null;
  }

  const parsedMs = Date.parse(safeValue);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function buildCatalogIdMap() {
  const index = new Map();

  for (const [type, items] of Object.entries(COSMETIC_CATALOG ?? {})) {
    for (const item of items ?? []) {
      const id = String(item?.id ?? "").trim();
      if (!id || index.has(id)) {
        continue;
      }

      index.set(id, {
        type,
        id,
        storeHidden: Boolean(item?.storeHidden),
        rotationOnly: Boolean(item?.rotationOnly)
      });
    }
  }

  return index;
}

const CATALOG_ID_MAP = buildCatalogIdMap();

function normalizeCosmeticIds(ids, logger, { reasonLabel = "cosmetic id" } = {}) {
  const seen = new Set();
  const normalized = [];

  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = sanitizeText(rawId, MAX_ID_LENGTH);
    if (!id || !SAFE_ID_PATTERN.test(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    const catalogEntry = CATALOG_ID_MAP.get(id);
    if (!catalogEntry) {
      logger?.warn?.(`[ShopRotation] skipping unknown ${reasonLabel}`, { id });
      continue;
    }

    if (catalogEntry.storeHidden) {
      logger?.warn?.(`[ShopRotation] skipping storeHidden ${reasonLabel}`, { id });
      continue;
    }

    normalized.push(id);
    if (normalized.length >= MAX_COSMETIC_IDS) {
      break;
    }
  }

  return normalized;
}

function normalizeFeaturedCosmeticIds(ids, logger) {
  return normalizeCosmeticIds(ids, logger, { reasonLabel: "featured cosmetic id" });
}

function normalizeLimitedCosmeticIds(ids, logger) {
  return normalizeCosmeticIds(ids, logger, { reasonLabel: "limited cosmetic id" });
}

function normalizeRotation(entry, logger) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const activeRotationId = sanitizeText(entry.activeRotationId, MAX_ID_LENGTH);
  const title = sanitizeText(entry.title, MAX_TITLE_LENGTH);
  const featuredCosmeticIds = normalizeFeaturedCosmeticIds(entry.featuredCosmeticIds, logger);
  const allowLimitedCosmeticIds = normalizeLimitedCosmeticIds(entry.allowLimitedCosmeticIds, logger);

  if (!activeRotationId || !SAFE_ID_PATTERN.test(activeRotationId) || !title || featuredCosmeticIds.length === 0) {
    return null;
  }

  return {
    activeRotationId,
    title,
    message: sanitizeText(entry.message, MAX_MESSAGE_LENGTH),
    startsAt: normalizeTimestamp(entry.startsAt),
    endsAt: normalizeTimestamp(entry.endsAt),
    featuredCosmeticIds,
    allowLimitedCosmeticIds
  };
}

function normalizeRotationIdList(ids) {
  const seen = new Set();
  const normalized = [];

  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = sanitizeText(rawId, MAX_ID_LENGTH);
    if (!id || !SAFE_ID_PATTERN.test(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function normalizeScheduleConfig(entry, logger) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const enabled = Boolean(entry.enabled);
  const mode = sanitizeText(entry.mode, 32)?.toLowerCase() ?? null;
  const rotationLengthDays = normalizePositiveInteger(entry.rotationLengthDays);
  const anchorDate = normalizeTimestamp(entry.anchorDate);
  const rotationOrder = normalizeRotationIdList(entry.rotationOrder);
  const rawRotations =
    entry.rotations && typeof entry.rotations === "object" && !Array.isArray(entry.rotations)
      ? entry.rotations
      : null;

  if (!enabled) {
    return {
      ...DEFAULT_SCHEDULE_CONFIG
    };
  }

  if (mode !== "weekly" || !rotationLengthDays || !anchorDate || rotationOrder.length === 0 || !rawRotations) {
    logger?.warn?.("[ShopRotation] invalid shop-rotation-schedule.json; falling back to manual rotation", {
      reason: "invalid_schedule_config"
    });
    return null;
  }

  const rotations = {};
  for (const [rotationId, rotationEntry] of Object.entries(rawRotations)) {
    const normalizedId = sanitizeText(rotationId, MAX_ID_LENGTH);
    if (!normalizedId || !SAFE_ID_PATTERN.test(normalizedId)) {
      continue;
    }

    const normalizedRotation = normalizeRotation(
      {
        ...rotationEntry,
        activeRotationId: normalizedId
      },
      logger
    );
    if (!normalizedRotation) {
      continue;
    }

    rotations[normalizedId] = normalizedRotation;
  }

  if (Object.keys(rotations).length === 0) {
    logger?.warn?.("[ShopRotation] schedule contains no valid rotations; falling back to manual rotation", {
      reason: "empty_schedule_rotations"
    });
    return null;
  }

  for (const rotationId of rotationOrder) {
    if (!rotations[rotationId]) {
      logger?.warn?.("[ShopRotation] schedule references missing rotation key; falling back to manual rotation", {
        rotationId
      });
      return null;
    }
  }

  return {
    enabled,
    mode,
    rotationLengthDays,
    anchorDate,
    rotationOrder,
    rotations
  };
}

function isRotationActive(rotation, nowMs) {
  if (!rotation) {
    return false;
  }

  const startsAtMs = rotation.startsAt ? Date.parse(rotation.startsAt) : null;
  if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) {
    return false;
  }

  const endsAtMs = rotation.endsAt ? Date.parse(rotation.endsAt) : null;
  if (Number.isFinite(endsAtMs) && endsAtMs <= nowMs) {
    return false;
  }

  return true;
}

export class ShopRotationStore {
  constructor({ dataDir, logger = console } = {}) {
    if (!dataDir) {
      throw new Error("dataDir is required for ShopRotationStore.");
    }

    this.dataDir = dataDir;
    this.logger = logger;
    this.filePath = path.join(dataDir, "server-data", "shop-rotation.json");
    this.scheduleFilePath = path.join(dataDir, "server-data", "shop-rotation-schedule.json");
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, "{}\n", "utf8");
    }
  }

  async ensureScheduleFile() {
    await fs.mkdir(path.dirname(this.scheduleFilePath), { recursive: true });
    try {
      await fs.access(this.scheduleFilePath);
    } catch {
      await fs.writeFile(
        this.scheduleFilePath,
        `${JSON.stringify(DEFAULT_SCHEDULE_CONFIG, null, 2)}\n`,
        "utf8"
      );
    }
  }

  async readRotationConfig() {
    await this.ensureFile();

    let source = "{}";
    try {
      source = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      this.logger.warn?.("[ShopRotation] read failed; returning no active rotation", {
        message: error?.message ?? String(error)
      });
      return null;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(stripUtf8Bom(source));
    } catch (error) {
      this.logger.warn?.("[ShopRotation] invalid shop-rotation.json; returning no active rotation", {
        message: error?.message ?? String(error),
        filePath: this.filePath
      });
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.logger.warn?.("[ShopRotation] shop-rotation.json must contain an object; returning no active rotation", {
        filePath: this.filePath
      });
      return null;
    }

    return normalizeRotation(parsed, this.logger);
  }

  async readScheduleConfig() {
    await this.ensureScheduleFile();

    let source = "{}";
    try {
      source = await fs.readFile(this.scheduleFilePath, "utf8");
    } catch (error) {
      this.logger.warn?.("[ShopRotation] schedule read failed; falling back to manual rotation", {
        message: error?.message ?? String(error)
      });
      return null;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(stripUtf8Bom(source));
    } catch (error) {
      this.logger.warn?.("[ShopRotation] invalid shop-rotation-schedule.json; falling back to manual rotation", {
        message: error?.message ?? String(error),
        filePath: this.scheduleFilePath
      });
      return null;
    }

    return normalizeScheduleConfig(parsed, this.logger);
  }

  resolveScheduledRotation(schedule, nowMs) {
    if (!schedule?.enabled || schedule.mode !== "weekly") {
      return null;
    }

    const anchorMs = Date.parse(schedule.anchorDate);
    if (!Number.isFinite(anchorMs)) {
      return null;
    }

    const elapsedMs = nowMs - anchorMs;
    if (elapsedMs < 0) {
      return null;
    }

    const elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);
    const rotationIndex = Math.floor(elapsedDays / schedule.rotationLengthDays);
    const currentId = schedule.rotationOrder[rotationIndex % schedule.rotationOrder.length];
    const rotation = schedule.rotations[currentId];
    if (!rotation) {
      return null;
    }

    const startsAtMs = anchorMs + rotationIndex * schedule.rotationLengthDays * MS_PER_DAY;
    const endsAtMs = startsAtMs + schedule.rotationLengthDays * MS_PER_DAY;

    return {
      activeRotationId: rotation.activeRotationId,
      title: rotation.title,
      message: rotation.message,
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
      featuredCosmeticIds: [...rotation.featuredCosmeticIds],
      allowLimitedCosmeticIds: [...rotation.allowLimitedCosmeticIds]
    };
  }

  async getActiveRotation({ now = new Date() } = {}) {
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const schedule = await this.readScheduleConfig();
    const scheduledRotation = this.resolveScheduledRotation(schedule, safeNowMs);
    if (scheduledRotation) {
      return scheduledRotation;
    }

    const rotation = await this.readRotationConfig();
    if (!rotation || !isRotationActive(rotation, safeNowMs)) {
      return null;
    }

    return {
      activeRotationId: rotation.activeRotationId,
      title: rotation.title,
      message: rotation.message,
      startsAt: rotation.startsAt,
      endsAt: rotation.endsAt,
      featuredCosmeticIds: [...rotation.featuredCosmeticIds],
      allowLimitedCosmeticIds: [...rotation.allowLimitedCosmeticIds]
    };
  }
}
