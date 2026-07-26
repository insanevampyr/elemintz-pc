import { getCosmeticDefinition } from "./cosmeticSystem.js";
import { getDailyResetWindow } from "./dailyChallengesSystem.js";
import { validateEventChestDefinition } from "./eventChestDefinitions.js";

function safeCounter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.floor(numeric));
}

function getOwnedSet(profile, type) {
  return new Set(Array.isArray(profile?.ownedCosmetics?.[type]) ? profile.ownedCosmetics[type] : []);
}

function normalizeProgressState(value) {
  const safeValue = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const pity = safeValue.pity && typeof safeValue.pity === "object" && !Array.isArray(safeValue.pity)
    ? safeValue.pity
    : {};

  return {
    lastFreeOpenDateKey: String(safeValue.lastFreeOpenDateKey ?? "").trim() || null,
    totalOpens: safeCounter(safeValue.totalOpens),
    paidOpens: safeCounter(safeValue.paidOpens),
    freeOpens: safeCounter(safeValue.freeOpens),
    pity: {
      opensSinceEpicPlus: safeCounter(pity.opensSinceEpicPlus),
      opensSinceLegendary: safeCounter(pity.opensSinceLegendary)
    }
  };
}

function buildPityDisplay(progress, pityConfig) {
  const epicThreshold = safeCounter(pityConfig?.epicPlusThreshold);
  const legendaryThreshold = safeCounter(pityConfig?.legendaryThreshold);
  const epicCurrent = safeCounter(progress?.pity?.opensSinceEpicPlus);
  const legendaryCurrent = safeCounter(progress?.pity?.opensSinceLegendary);

  return {
    epicPlus: {
      current: epicCurrent,
      threshold: epicThreshold,
      displayCurrent: epicThreshold > 0 ? Math.min(epicThreshold, epicCurrent) : epicCurrent,
      displayLabel: `${epicThreshold > 0 ? Math.min(epicThreshold, epicCurrent) : epicCurrent} / ${epicThreshold}`
    },
    legendary: {
      current: legendaryCurrent,
      threshold: legendaryThreshold,
      displayCurrent: legendaryThreshold > 0 ? Math.min(legendaryThreshold, legendaryCurrent) : legendaryCurrent,
      displayLabel: `${legendaryThreshold > 0 ? Math.min(legendaryThreshold, legendaryCurrent) : legendaryCurrent} / ${legendaryThreshold}`
    }
  };
}

function buildPoolProgress(definition, profile) {
  const byRarity = {};
  const items = {};
  const ownedEntries = [];
  const missingEntries = [];
  let totalCount = 0;
  let ownedCount = 0;

  for (const [rarity, entries] of Object.entries(definition.pool ?? {})) {
    const projectedEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
      const definitionEntry = getCosmeticDefinition(entry.type, entry.cosmeticId);
      const owned = getOwnedSet(profile, entry.type).has(entry.cosmeticId);
      const projectedEntry = {
        type: entry.type,
        cosmeticId: entry.cosmeticId,
        name: definitionEntry?.name ?? entry.cosmeticId,
        rarity,
        owned,
        missing: !owned
      };

      totalCount += 1;
      if (owned) {
        ownedCount += 1;
        ownedEntries.push(projectedEntry);
      } else {
        missingEntries.push(projectedEntry);
      }

      return projectedEntry;
    });

    const rarityOwned = projectedEntries.filter((entry) => entry.owned).length;
    const rarityTotal = projectedEntries.length;
    byRarity[rarity] = {
      total: rarityTotal,
      owned: rarityOwned,
      missing: Math.max(0, rarityTotal - rarityOwned),
      isComplete: rarityTotal > 0 && rarityOwned >= rarityTotal
    };
    items[rarity] = projectedEntries;
  }

  const missingCount = Math.max(0, totalCount - ownedCount);
  return {
    totalCount,
    ownedCount,
    missingCount,
    isPoolComplete: totalCount > 0 && ownedCount >= totalCount,
    byRarity,
    items,
    ownedEntries,
    missingEntries
  };
}

function buildPoolSummary(poolProgress) {
  return Object.fromEntries(
    Object.entries(poolProgress.items).map(([rarity, entries]) => [
      rarity,
      entries.map((entry) => ({
        type: entry.type,
        cosmeticId: entry.cosmeticId,
        name: entry.name
      }))
    ])
  );
}

function buildFreeOpenStatus(definition, progress, nowMs) {
  const allowsFreeOpen = Array.isArray(definition.openTypes) && definition.openTypes.includes("free");
  const policy = definition.freeOpenPolicy;
  const supportsDailyReset =
    allowsFreeOpen &&
    policy?.cadence === "daily" &&
    policy?.resetTimeZone === "America/Chicago" &&
    policy?.resetHour === 18;

  if (!supportsDailyReset) {
    return {
      freeOpenAvailable: false,
      currentDateKey: null,
      nextFreeOpenAt: null,
      nextFreeResetAt: null,
      msUntilNextFreeOpen: null,
      resetWindow: null
    };
  }

  const resetWindow = getDailyResetWindow(nowMs);
  const currentDateKey = new Date(resetWindow.lastResetMs).toISOString();
  const nextFreeOpenAt = new Date(resetWindow.nextResetMs).toISOString();

  return {
    freeOpenAvailable: progress.lastFreeOpenDateKey !== currentDateKey,
    currentDateKey,
    nextFreeOpenAt,
    nextFreeResetAt: nextFreeOpenAt,
    msUntilNextFreeOpen: Math.max(0, resetWindow.nextResetMs - nowMs),
    resetWindow: {
      lastResetAt: currentDateKey,
      nextResetAt: nextFreeOpenAt,
      lastResetMs: resetWindow.lastResetMs,
      nextResetMs: resetWindow.nextResetMs
    }
  };
}

function buildOpenAvailability(definition, freeStatus, tokenBalance) {
  const openTypes = Array.isArray(definition.openTypes) ? definition.openTypes : [];
  const paidOpenCostTokens = openTypes.includes("paid") ? safeCounter(definition.paidTokenCost) : null;
  const canAffordPaidOpen =
    paidOpenCostTokens !== null && tokenBalance >= paidOpenCostTokens;

  return {
    paidOpenCostTokens,
    canAffordPaidOpen,
    availableOpenTypes: openTypes.filter((openType) => (
      openType === "free"
        ? freeStatus.freeOpenAvailable
        : openType === "paid"
          ? canAffordPaidOpen
          : false
    )),
    openAvailability: {
      free: {
        supported: openTypes.includes("free"),
        available: freeStatus.freeOpenAvailable,
        nextAvailableAt: freeStatus.freeOpenAvailable ? null : freeStatus.nextFreeOpenAt
      },
      paid: {
        supported: openTypes.includes("paid"),
        available: canAffordPaidOpen,
        costTokens: paidOpenCostTokens,
        canAfford: canAffordPaidOpen
      }
    }
  };
}

export function projectEventChestStatus(definition, profile = {}, options = {}) {
  const validation = validateEventChestDefinition(definition);
  if (!validation.ok) {
    throw new Error(`Invalid Event Chest definition: ${validation.errors.join("; ")}`);
  }

  const nowMs = Number.isFinite(Number(options?.nowMs)) ? Number(options.nowMs) : Date.now();
  const poolProgress = buildPoolProgress(definition, profile);
  const progressField = String(definition.profileProgressField ?? "").trim();
  const progress = normalizeProgressState(progressField ? profile?.[progressField] : null);
  const shouldHideTile = definition.hideTileWhenPoolComplete === true && poolProgress.isPoolComplete;
  const tokenBalance = safeCounter(profile?.tokens);
  const freeStatus = buildFreeOpenStatus(definition, progress, nowMs);
  const openAvailability = buildOpenAvailability(definition, freeStatus, tokenBalance);

  return {
    chestId: definition.chestId,
    presetId: definition.presetId ?? null,
    title: definition.title,
    chestType: definition.chestType,
    progressField: progressField || null,
    pool: poolProgress,
    totalPoolCount: poolProgress.totalCount,
    ownedCount: poolProgress.ownedCount,
    missingCount: poolProgress.missingCount,
    isPoolComplete: poolProgress.isPoolComplete,
    byRarity: poolProgress.byRarity,
    ownedEntries: poolProgress.ownedEntries,
    missingEntries: poolProgress.missingEntries,
    shouldHideTile,
    hideTileWhenPoolComplete: definition.hideTileWhenPoolComplete === true,
    allowOpensAfterCompleteAsDuplicateConversion:
      definition.allowOpensAfterCompleteAsDuplicateConversion === true,
    progress,
    lastFreeOpenDateKey: progress.lastFreeOpenDateKey,
    freeOpenAvailable: freeStatus.freeOpenAvailable,
    currentDateKey: freeStatus.currentDateKey,
    nextFreeOpenAt: freeStatus.nextFreeOpenAt,
    nextFreeResetAt: freeStatus.nextFreeResetAt,
    msUntilNextFreeOpen: freeStatus.msUntilNextFreeOpen,
    resetWindow: freeStatus.resetWindow,
    tokenBalance,
    paidOpenCostTokens: openAvailability.paidOpenCostTokens,
    canAffordPaidOpen: openAvailability.canAffordPaidOpen,
    openTypes: [...definition.openTypes],
    availableOpenTypes: openAvailability.availableOpenTypes,
    openAvailability: openAvailability.openAvailability,
    odds: { ...definition.odds },
    poolSummary: buildPoolSummary(poolProgress),
    pityDisplay: buildPityDisplay(progress, definition.pity)
  };
}
