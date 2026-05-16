import fs from "node:fs/promises";
import path from "node:path";

import { COSMETIC_CATALOG } from "../state/cosmeticSystem.js";

const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_COSMETIC_IDS = 64;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

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
        storeHidden: Boolean(item?.storeHidden)
      });
    }
  }

  return index;
}

const CATALOG_ID_MAP = buildCatalogIdMap();

function normalizeFeaturedCosmeticIds(ids, logger) {
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
      logger?.warn?.("[ShopRotation] skipping unknown cosmetic id", { id });
      continue;
    }

    if (catalogEntry.storeHidden) {
      logger?.warn?.("[ShopRotation] skipping storeHidden cosmetic id", { id });
      continue;
    }

    normalized.push(id);
    if (normalized.length >= MAX_COSMETIC_IDS) {
      break;
    }
  }

  return normalized;
}

function normalizeRotation(entry, logger) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const activeRotationId = sanitizeText(entry.activeRotationId, MAX_ID_LENGTH);
  const title = sanitizeText(entry.title, MAX_TITLE_LENGTH);
  const featuredCosmeticIds = normalizeFeaturedCosmeticIds(entry.featuredCosmeticIds, logger);

  if (!activeRotationId || !SAFE_ID_PATTERN.test(activeRotationId) || !title || featuredCosmeticIds.length === 0) {
    return null;
  }

  return {
    activeRotationId,
    title,
    message: sanitizeText(entry.message, MAX_MESSAGE_LENGTH),
    startsAt: normalizeTimestamp(entry.startsAt),
    endsAt: normalizeTimestamp(entry.endsAt),
    featuredCosmeticIds
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
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, "{}\n", "utf8");
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

  async getActiveRotation({ now = new Date() } = {}) {
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
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
      featuredCosmeticIds: [...rotation.featuredCosmeticIds]
    };
  }
}
