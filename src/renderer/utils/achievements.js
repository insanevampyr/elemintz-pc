import { getAssetPath } from "./dom.js";
import { normalizeAchievementProgressEntry } from "../../state/achievementSystem.js";

export const ACHIEVEMENT_CATALOG = Object.freeze([
  {
    id: "first_flame",
    name: "First Flame",
    description: "Win your first match.",
    image: getAssetPath("badges/firstFlame.png"),
    repeatable: false
  },
  {
    id: "flawless_victory",
    name: "Flawless Victory",
    description: "Win a match without losing any cards.",
    image: getAssetPath("badges/flawlessVictory.png"),
    repeatable: false
  },
  {
    id: "quick_draw",
    name: "Quick Draw",
    description: "Win a completed match in less than 3 minutes.",
    image: getAssetPath("badges/quickDraw.png"),
    repeatable: true
  },
  {
    id: "quickdraw_master",
    name: "Quickdraw Master",
    description: "Win a completed match in less than 2 minutes.",
    image: getAssetPath("badges/quickdrawMaster.png"),
    repeatable: true
  },
  {
    id: "card_hoarder",
    name: "Card Hoarder",
    description: "Collect all 4 cards of one element.",
    image: getAssetPath("badges/cardHoarder.png"),
    repeatable: true
  },
  {
    id: "war_machine",
    name: "War Machine",
    description: "Win 3 WARs in a single match.",
    image: getAssetPath("badges/warMachine.png"),
    repeatable: true
  },
  {
    id: "perfect_warrior",
    name: "Perfect Warrior",
    description: "Win with a full hand and at least 4 cards captured.",
    image: getAssetPath("badges/perfectWarrior.png"),
    repeatable: false
  },
  {
    id: "overtime_champion",
    name: "Overtime Champion",
    description: "Win a match when the 5-minute timer expires.",
    image: getAssetPath("badges/overtimeChampion.png"),
    repeatable: true
  },
  {
    id: "marathon_gamer",
    name: "Marathon Gamer",
    description: "Complete 25 matches.",
    image: getAssetPath("badges/marathonGamer.png"),
    repeatable: false
  },
  {
    id: "elemental_conqueror",
    name: "Elemental Conqueror",
    description: "Reach 25 total wins.",
    image: getAssetPath("badges/elementalConqueror.png"),
    repeatable: false
  },
  {
    id: "elemental_master",
    name: "Elemental Master",
    description: "Reach 50 total wins.",
    image: getAssetPath("badges/elementalMaster.png"),
    repeatable: false
  },
  {
    id: "elemental_grandmaster",
    name: "Elemental Grandmaster",
    description: "Reach 100 total wins.",
    image: getAssetPath("badges/elementalGrandmaster.png"),
    repeatable: false
  },
  {
    id: "elemental_overlord",
    name: "Elemental Overlord",
    description: "Reach 200 total wins.",
    image: getAssetPath("badges/elementalOverlord.png"),
    repeatable: false
  },
  {
    id: "collector",
    name: "Collector",
    description: "Capture 25 total cards.",
    image: getAssetPath("badges/collector.png"),
    repeatable: false
  },
  {
    id: "collector_supreme",
    name: "Collector Supreme",
    description: "Capture 100 total cards.",
    image: getAssetPath("badges/collectorSupreme.png"),
    repeatable: false
  },
  {
    id: "collector_lord",
    name: "Collector Lord",
    description: "Capture 250 total cards.",
    image: getAssetPath("badges/collectorLord.png"),
    repeatable: false
  },
  {
    id: "warrior",
    name: "Warrior",
    description: "Win 10 total WAR rounds.",
    image: getAssetPath("badges/warrior.png"),
    repeatable: false
  },
  {
    id: "card_hoarder_elite",
    name: "Card Hoarder Elite",
    description: "Unlock Card Hoarder 5 times.",
    image: getAssetPath("badges/cardHoarderElite.png"),
    repeatable: false
  },
  {
    id: "unbreakable_streak",
    name: "Unbreakable Streak",
    description: "Reach a 5-match win streak.",
    image: getAssetPath("badges/unbreakableStreak.png"),
    repeatable: false
  },
  {
    id: "streak_lord",
    name: "Streak Lord",
    description: "Reach a 15-match win streak.",
    image: getAssetPath("badges/streakLord.png"),
    repeatable: false
  },
  {
    id: "the_immortal",
    name: "The Immortal",
    description: "Reach 10 wins without a loss.",
    image: getAssetPath("badges/theImmortal.png"),
    repeatable: false
  },
  {
    id: "comeback_win",
    name: "Come Back Win",
    description: "Win a match after being reduced to your last 3 cards.",
    image: getAssetPath("badges/comeback_win.png"),
    repeatable: true
  },
  {
    id: "longest_war_5",
    name: "Endless WAR",
    description: "Survive a WAR that lasts 5 clashes.",
    image: getAssetPath("badges/badge_longest_war_5.png"),
    repeatable: false
  },
  {
    id: "longest_war_7",
    name: "Cataclysm Clash",
    description: "Survive a WAR that lasts 7 clashes.",
    image: getAssetPath("badges/badge_longest_war_7.png"),
    repeatable: false
  },
  {
    id: "comeback_win_5",
    name: "Clutch Duelist",
    description: "Earn 5 comeback victories.",
    image: getAssetPath("badges/badge_comeback_win_5.png"),
    repeatable: false
  },
  {
    id: "comeback_win_25",
    name: "Last Card Legend",
    description: "Earn 25 comeback victories.",
    image: getAssetPath("badges/badge_comeback_win_25.png"),
    repeatable: false
  },
  {
    id: "local_pvp_wins_25",
    name: "Arena Duelist",
    description: "Win 25 local PvP matches.",
    image: getAssetPath("badges/badge_local_pvp_wins_25.png"),
    repeatable: false
  },
  {
    id: "pve_wins_25",
    name: "AI Conqueror",
    description: "Win 25 PvE matches.",
    image: getAssetPath("badges/badge_pve_wins_25.png"),
    repeatable: false
  },
  {
    id: "all_elements_25",
    name: "Elemental Versatility",
    description: "Use all 4 elements in 25 completed matches.",
    image: getAssetPath("badges/badge_all_elements_25.png"),
    repeatable: false
  }
]);

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
