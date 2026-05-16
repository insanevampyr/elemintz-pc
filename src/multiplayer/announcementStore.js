import fs from "node:fs/promises";
import path from "node:path";

const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_TYPE_LENGTH = 32;
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

function normalizeAnnouncement(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const id = sanitizeText(entry.id, MAX_ID_LENGTH);
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    return null;
  }

  const title = sanitizeText(entry.title, MAX_TITLE_LENGTH);
  const message = sanitizeText(entry.message, MAX_MESSAGE_LENGTH);
  if (!title || !message) {
    return null;
  }

  return {
    id,
    title,
    message,
    type: sanitizeText(entry.type, MAX_TYPE_LENGTH),
    priority: Number.isFinite(Number(entry.priority)) ? Math.trunc(Number(entry.priority)) : 0,
    active: entry.active === true,
    dismissible: entry.dismissible !== false,
    startsAt: normalizeTimestamp(entry.startsAt),
    endsAt: normalizeTimestamp(entry.endsAt),
    sortIndex: index
  };
}

function isAnnouncementActive(entry, nowMs) {
  if (!entry?.active) {
    return false;
  }

  const startsAtMs = entry.startsAt ? Date.parse(entry.startsAt) : null;
  if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) {
    return false;
  }

  const endsAtMs = entry.endsAt ? Date.parse(entry.endsAt) : null;
  if (Number.isFinite(endsAtMs) && endsAtMs <= nowMs) {
    return false;
  }

  return true;
}

function buildDismissKey(id) {
  return `announcement:${String(id ?? "").trim()}`;
}

function filterDismissed(entries, seenAnnouncements = {}) {
  return entries.filter((entry) => !seenAnnouncements?.[buildDismissKey(entry.id)]);
}

function sortAnnouncements(entries) {
  return [...entries].sort((left, right) => {
    const priorityDelta = Number(right?.priority ?? 0) - Number(left?.priority ?? 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0);
  });
}

function stripInternalFields(entry) {
  if (!entry) {
    return null;
  }

  return {
    id: entry.id,
    title: entry.title,
    message: entry.message,
    type: entry.type,
    priority: entry.priority,
    active: entry.active,
    dismissible: entry.dismissible,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt
  };
}

export { buildDismissKey };

export class AnnouncementStore {
  constructor({ dataDir, logger = console } = {}) {
    if (!dataDir) {
      throw new Error("dataDir is required for AnnouncementStore.");
    }

    this.dataDir = dataDir;
    this.logger = logger;
    this.filePath = path.join(dataDir, "server-data", "announcements.json");
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, "[]\n", "utf8");
    }
  }

  async readAnnouncements() {
    await this.ensureFile();

    let source = "[]";
    try {
      source = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      this.logger.warn?.("[Announcements] read failed; returning empty list", {
        message: error?.message ?? String(error)
      });
      return [];
    }

    let parsed = [];
    try {
      parsed = JSON.parse(stripUtf8Bom(source));
    } catch (error) {
      this.logger.warn?.("[Announcements] invalid announcements.json; returning empty list", {
        message: error?.message ?? String(error),
        filePath: this.filePath
      });
      return [];
    }

    if (!Array.isArray(parsed)) {
      this.logger.warn?.("[Announcements] announcements.json must contain an array; returning empty list", {
        filePath: this.filePath
      });
      return [];
    }

    return parsed
      .map((entry, index) => normalizeAnnouncement(entry, index))
      .filter(Boolean);
  }

  async listActiveAnnouncements({ seenAnnouncements = {}, now = new Date() } = {}) {
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const entries = await this.readAnnouncements();
    const filtered = filterDismissed(
      entries.filter((entry) => isAnnouncementActive(entry, safeNowMs)),
      seenAnnouncements
    );

    return sortAnnouncements(filtered).map((entry) => stripInternalFields(entry));
  }
}
