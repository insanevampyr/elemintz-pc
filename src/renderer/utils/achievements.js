import { getAssetPath } from "./dom.js";
import {
  ACHIEVEMENT_DEFINITIONS,
  normalizeAchievementProgressEntry
} from "../../state/achievementSystem.js";

export const ACHIEVEMENT_CATALOG = Object.freeze(
  ACHIEVEMENT_DEFINITIONS.map((definition) => ({
    ...definition,
    image: getAssetPath(definition.image)
  }))
);

const CATALOG_BY_ID = new Map(ACHIEVEMENT_CATALOG.map((item) => [item.id, item]));

export function getUnlockedAchievements(profile) {
  const achievements = profile.achievements ?? {};

  return Object.entries(achievements)
    .filter(([, progress]) => normalizeAchievementProgressEntry(progress).count > 0)
    .map(([id, progress]) => {
      const base = CATALOG_BY_ID.get(id);
      if (!base) return null;
      const normalized = normalizeAchievementProgressEntry(progress);

      return {
        ...base,
        count: normalized.count,
        firstUnlockedAt: normalized.firstUnlockedAt,
        lastUnlockedAt: normalized.lastUnlockedAt
      };
    })
    .filter(Boolean);
}

export function countUnlockedAchievements(profile) {
  const achievements = profile?.achievements ?? {};

  return Object.entries(achievements).reduce((sum, [id, progress]) => {
    if (!CATALOG_BY_ID.has(id)) {
      return sum;
    }

    return sum + (normalizeAchievementProgressEntry(progress).count > 0 ? 1 : 0);
  }, 0);
}
