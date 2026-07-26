import { DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } from "./dailyElementChestSystem.js";

export const EVENT_CHEST_PROGRESS_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeCounter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.floor(numeric));
}

function normalizeChestId(chestId) {
  return String(chestId ?? "").trim();
}

function normalizeNullableIso(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeOpenType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["free", "paid"].includes(normalized) ? normalized : null;
}

function normalizeNullableString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizePity(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    opensSinceEpicPlus: safeCounter(source.opensSinceEpicPlus),
    opensSinceLegendary: safeCounter(source.opensSinceLegendary)
  };
}

function normalizeParticipation(value) {
  const source = isPlainObject(value) ? value : {};
  const seen = new Set();
  const definitionRevisionIdsSeen = [];

  for (const entry of Array.isArray(source.definitionRevisionIdsSeen) ? source.definitionRevisionIdsSeen : []) {
    const safeEntry = String(entry ?? "").trim();
    if (!safeEntry || seen.has(safeEntry)) {
      continue;
    }
    seen.add(safeEntry);
    definitionRevisionIdsSeen.push(safeEntry);
  }

  return {
    firstDefinitionSeenAt: normalizeNullableIso(source.firstDefinitionSeenAt),
    lastDefinitionSeenAt: normalizeNullableIso(source.lastDefinitionSeenAt),
    definitionRevisionIdsSeen
  };
}

export function createDefaultEventChestProgress(chestId) {
  const safeChestId = normalizeChestId(chestId);
  if (!safeChestId) {
    return null;
  }

  return {
    schemaVersion: EVENT_CHEST_PROGRESS_SCHEMA_VERSION,
    chestId: safeChestId,
    source: null,
    sourceProfileField: null,
    firstOpenedAt: null,
    lastOpenedAt: null,
    lastUpdatedAt: null,
    lastOpenType: null,
    lastFreeOpenDateKey: null,
    totalOpens: 0,
    paidOpens: 0,
    freeOpens: 0,
    pity: {
      opensSinceEpicPlus: 0,
      opensSinceLegendary: 0
    },
    participation: {
      firstDefinitionSeenAt: null,
      lastDefinitionSeenAt: null,
      definitionRevisionIdsSeen: []
    }
  };
}

export function normalizeEventChestProgressEntry(value, { chestId = null } = {}) {
  const safeChestId = normalizeChestId(chestId ?? value?.chestId);
  if (!safeChestId) {
    return null;
  }

  const source = isPlainObject(value) ? value : {};
  return {
    schemaVersion: EVENT_CHEST_PROGRESS_SCHEMA_VERSION,
    chestId: safeChestId,
    source: normalizeNullableString(source.source),
    sourceProfileField: normalizeNullableString(source.sourceProfileField),
    firstOpenedAt: normalizeNullableIso(source.firstOpenedAt),
    lastOpenedAt: normalizeNullableIso(source.lastOpenedAt),
    lastUpdatedAt: normalizeNullableIso(source.lastUpdatedAt),
    lastOpenType: normalizeOpenType(source.lastOpenType),
    lastFreeOpenDateKey: normalizeNullableIso(source.lastFreeOpenDateKey),
    totalOpens: safeCounter(source.totalOpens),
    paidOpens: safeCounter(source.paidOpens),
    freeOpens: safeCounter(source.freeOpens),
    pity: normalizePity(source.pity),
    participation: normalizeParticipation(source.participation)
  };
}

export function normalizeProfileEventChests(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const normalizedEntries = [];
  for (const [chestId, progress] of Object.entries(value)) {
    const safeChestId = normalizeChestId(chestId);
    if (!safeChestId) {
      continue;
    }
    const normalized = normalizeEventChestProgressEntry(progress, { chestId: safeChestId });
    if (normalized) {
      normalizedEntries.push([safeChestId, normalized]);
    }
  }

  return Object.fromEntries(normalizedEntries);
}

export function eventChestProgressFromDailyElementChest(
  dailyElementChest,
  chestId = DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
  { openedAt = null, lastOpenType = null, lastUpdatedAt = openedAt } = {}
) {
  const safeChestId = normalizeChestId(chestId);
  if (!safeChestId) {
    return null;
  }

  const source = isPlainObject(dailyElementChest) ? dailyElementChest : {};
  return normalizeEventChestProgressEntry(
    {
      chestId: safeChestId,
      source: "legacy_daily_element_chest_mirror",
      sourceProfileField: "dailyElementChest",
      firstOpenedAt: source.totalOpens > 0 ? openedAt : null,
      lastOpenedAt: source.totalOpens > 0 ? openedAt : null,
      lastUpdatedAt,
      lastOpenType,
      lastFreeOpenDateKey: source.lastFreeOpenDateKey,
      totalOpens: source.totalOpens,
      paidOpens: source.paidOpens,
      freeOpens: source.freeOpens,
      pity: source.pity
    },
    { chestId: safeChestId }
  );
}

export function mirrorDailyElementChestProgressToEventChests(
  profile,
  {
    chestId = DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
    openedAt = null,
    lastOpenType = null,
    lastUpdatedAt = openedAt
  } = {}
) {
  const safeChestId = normalizeChestId(chestId);
  if (!safeChestId) {
    return profile;
  }

  const eventChests = normalizeProfileEventChests(profile?.eventChests);
  const previous = eventChests[safeChestId] ?? null;
  const mirrored = eventChestProgressFromDailyElementChest(profile?.dailyElementChest, safeChestId, {
    openedAt,
    lastOpenType,
    lastUpdatedAt
  });

  if (!mirrored) {
    return {
      ...profile,
      eventChests
    };
  }

  return {
    ...profile,
    eventChests: normalizeProfileEventChests({
      ...eventChests,
      [safeChestId]: {
        ...mirrored,
        firstOpenedAt: previous?.firstOpenedAt ?? mirrored.firstOpenedAt,
        participation: previous?.participation ?? mirrored.participation
      }
    })
  };
}

export function dailyElementChestFromEventChestProgress(progress) {
  const normalized = normalizeEventChestProgressEntry(progress, {
    chestId: progress?.chestId ?? DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID
  });

  return {
    lastFreeOpenDateKey: normalized?.lastFreeOpenDateKey ?? null,
    totalOpens: safeCounter(normalized?.totalOpens),
    paidOpens: safeCounter(normalized?.paidOpens),
    freeOpens: safeCounter(normalized?.freeOpens),
    pity: {
      opensSinceEpicPlus: safeCounter(normalized?.pity?.opensSinceEpicPlus),
      opensSinceLegendary: safeCounter(normalized?.pity?.opensSinceLegendary)
    }
  };
}

export function getNormalizedDailyEventChestProgress(
  profile,
  { chestId = DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID } = {}
) {
  const safeChestId = normalizeChestId(chestId);
  if (!safeChestId) {
    return null;
  }

  const eventChests = normalizeProfileEventChests(profile?.eventChests);
  if (eventChests[safeChestId]) {
    return eventChests[safeChestId];
  }

  return eventChestProgressFromDailyElementChest(profile?.dailyElementChest, safeChestId);
}
