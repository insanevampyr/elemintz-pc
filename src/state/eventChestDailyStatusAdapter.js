import { getDefaultDailyElementChestDefinition } from "./eventChestRegistry.js";
import { projectEventChestStatus } from "./eventChestStatus.js";

function buildCollectionProgress(projection) {
  const byRarity = Object.fromEntries(
    Object.entries(projection.byRarity ?? {}).map(([rarity, progress]) => [
      rarity,
      {
        owned: progress.owned,
        total: progress.total,
        isComplete: progress.isComplete
      }
    ])
  );
  const items = Object.fromEntries(
    Object.entries(projection.pool?.items ?? {}).map(([rarity, entries]) => [
      rarity,
      entries.map((entry) => ({
        type: entry.type,
        cosmeticId: entry.cosmeticId,
        name: entry.name,
        owned: entry.owned
      }))
    ])
  );

  return {
    totalOwned: projection.ownedCount,
    totalAvailable: projection.totalPoolCount,
    isComplete: projection.isPoolComplete,
    byRarity,
    items
  };
}

export function getDailyElementChestStatusFromEventProjection(profile = {}, options = {}) {
  const definition = getDefaultDailyElementChestDefinition();
  if (!definition) {
    throw new Error("Daily EleMintz Chest Event Chest definition is unavailable.");
  }

  const projection = projectEventChestStatus(definition, profile, options);

  return {
    canOpenFree: projection.freeOpenAvailable,
    nextFreeResetAt: projection.nextFreeResetAt,
    paidOpenCost: projection.paidOpenCostTokens,
    tokens: projection.tokenBalance,
    dailyElementChest: {
      lastFreeOpenDateKey: projection.progress.lastFreeOpenDateKey,
      totalOpens: projection.progress.totalOpens,
      paidOpens: projection.progress.paidOpens,
      freeOpens: projection.progress.freeOpens,
      pity: {
        opensSinceEpicPlus: projection.progress.pity.opensSinceEpicPlus,
        opensSinceLegendary: projection.progress.pity.opensSinceLegendary
      }
    },
    pity: {
      opensSinceEpicPlus: projection.progress.pity.opensSinceEpicPlus,
      opensSinceLegendary: projection.progress.pity.opensSinceLegendary
    },
    odds: { ...projection.odds },
    poolSummary: structuredClone(projection.poolSummary),
    collectionProgress: buildCollectionProgress(projection)
  };
}
