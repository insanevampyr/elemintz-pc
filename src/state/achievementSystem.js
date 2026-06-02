const PHASE_ONE_TIERED_ACHIEVEMENTS = Object.freeze([
  {
    id: "match_wins_25",
    name: "Seasoned Victor",
    description: "Win 25 matches.",
    image: "badges/elementalConqueror.png",
    repeatable: false
  },
  {
    id: "match_wins_50",
    name: "Battle Hardened",
    description: "Win 50 matches.",
    image: "badges/elementalMaster.png",
    repeatable: false
  },
  {
    id: "match_wins_100",
    name: "Arena Conqueror",
    description: "Win 100 matches.",
    image: "badges/elementalGrandmaster.png",
    repeatable: false
  },
  {
    id: "match_wins_250",
    name: "Arena Tyrant",
    description: "Win 250 matches.",
    image: "badges/elementalOverlord.png",
    repeatable: false
  },
  {
    id: "matches_played_50",
    name: "Regular Contender",
    description: "Play 50 matches.",
    image: "badges/marathonGamer.png",
    repeatable: false
  },
  {
    id: "matches_played_100",
    name: "Relentless Contender",
    description: "Play 100 matches.",
    image: "badges/marathonGamer.png",
    repeatable: false
  },
  {
    id: "matches_played_250",
    name: "Endless Contender",
    description: "Play 250 matches.",
    image: "badges/marathonGamer.png",
    repeatable: false
  },
  {
    id: "cards_captured_100",
    name: "Card Hoarder II",
    description: "Capture 100 cards.",
    image: "badges/cardHoarder.png",
    repeatable: false
  },
  {
    id: "cards_captured_250",
    name: "Card Hoarder III",
    description: "Capture 250 cards.",
    image: "badges/cardHoarder.png",
    repeatable: false
  },
  {
    id: "cards_captured_500",
    name: "Card Hoarder IV",
    description: "Capture 500 cards.",
    image: "badges/cardHoarder.png",
    repeatable: false
  },
  {
    id: "cards_captured_1000",
    name: "Card Hoarder V",
    description: "Capture 1000 cards.",
    image: "badges/cardHoarder.png",
    repeatable: false
  },
  {
    id: "wars_entered_25",
    name: "War Tested",
    description: "Enter 25 WARs.",
    image: "badges/warMachine.png",
    repeatable: false
  },
  {
    id: "wars_entered_50",
    name: "War Forged",
    description: "Enter 50 WARs.",
    image: "badges/warMachine.png",
    repeatable: false
  },
  {
    id: "wars_entered_100",
    name: "War Born",
    description: "Enter 100 WARs.",
    image: "badges/warMachine.png",
    repeatable: false
  },
  {
    id: "wars_won_25",
    name: "WAR Veteran",
    description: "Win 25 WARs.",
    image: "badges/warrior.png",
    repeatable: false
  },
  {
    id: "wars_won_50",
    name: "WAR Elite",
    description: "Win 50 WARs.",
    image: "badges/warrior.png",
    repeatable: false
  },
  {
    id: "wars_won_100",
    name: "WAR Legend",
    description: "Win 100 WARs.",
    image: "badges/warrior.png",
    repeatable: false
  },
  {
    id: "level_5",
    name: "Rising Initiate",
    description: "Reach Level 5.",
    image: "badges/elementalConqueror.png",
    repeatable: false
  },
  {
    id: "level_10",
    name: "Proven Adept",
    description: "Reach Level 10.",
    image: "badges/elementalMaster.png",
    repeatable: false
  },
  {
    id: "level_25",
    name: "Ascendant Duelist",
    description: "Reach Level 25.",
    image: "badges/elementalGrandmaster.png",
    repeatable: false
  },
  {
    id: "level_50",
    name: "EleMintz Paragon",
    description: "Reach Level 50.",
    image: "badges/elementalOverlord.png",
    repeatable: false
  }
]);

const APPROVED_EXPANSION_ACHIEVEMENTS = Object.freeze([
  {
    id: "long_match_25",
    name: "Long Fight",
    description: "Reach 25 rounds in one match.",
    image: "badges/longest_match_badge.png",
    repeatable: false
  },
  {
    id: "long_match_50",
    name: "War of Attrition",
    description: "Reach 50 rounds in one match.",
    image: "badges/longest_match_badge.png",
    repeatable: false
  },
  {
    id: "long_match_75",
    name: "Never Say Die",
    description: "Reach 75 rounds in one match.",
    image: "badges/longest_match_badge.png",
    repeatable: false
  },
  {
    id: "long_match_100",
    name: "Bloodbath",
    description: "Reach 100 rounds in one match.",
    image: "badges/longest_match_badge.png",
    repeatable: false
  },
  {
    id: "longest_war_5",
    name: "Endless WAR",
    description: "Survive a WAR that lasts 5 clashes.",
    image: "badges/badge_longest_war_5.png",
    repeatable: false
  },
  {
    id: "longest_war_7",
    name: "Cataclysm Clash",
    description: "Survive a WAR that lasts 7 clashes.",
    image: "badges/badge_longest_war_7.png",
    repeatable: false
  },
  {
    id: "comeback_win_5",
    name: "Clutch Duelist",
    description: "Earn 5 comeback victories.",
    image: "badges/badge_comeback_win_5.png",
    repeatable: false
  },
  {
    id: "comeback_win_25",
    name: "Last Card Legend",
    description: "Earn 25 comeback victories.",
    image: "badges/badge_comeback_win_25.png",
    repeatable: false
  },
  {
    id: "local_pvp_wins_25",
    name: "Arena Duelist",
    description: "Win 25 local PvP matches.",
    image: "badges/badge_local_pvp_wins_25.png",
    repeatable: false
  },
  {
    id: "pve_wins_25",
    name: "AI Conqueror",
    description: "Win 25 PvE matches.",
    image: "badges/badge_pve_wins_25.png",
    repeatable: false
  },
  {
    id: "all_elements_25",
    name: "Elemental Versatility",
    description: "Use all 4 elements in 25 completed matches.",
    image: "badges/badge_all_elements_25.png",
    repeatable: false
  }
]);

const FIRST_EXPANSION_BATCH_ACHIEVEMENTS = Object.freeze([
  {
    id: "online_wins_10",
    name: "Online Challenger",
    description: "Win 10 Online matches.",
    image: "badges/elementalConqueror.png",
    repeatable: false
  },
  {
    id: "online_wins_25",
    name: "Online Contender",
    description: "Win 25 Online matches.",
    image: "badges/elementalMaster.png",
    repeatable: false
  },
  {
    id: "online_wins_50",
    name: "Online Elite",
    description: "Win 50 Online matches.",
    image: "badges/elementalGrandmaster.png",
    repeatable: false
  },
  {
    id: "local_pvp_wins_50",
    name: "Arena Rival",
    description: "Win 50 local PvP matches.",
    image: "badges/badge_local_pvp_wins_25.png",
    repeatable: false
  },
  {
    id: "pve_wins_50",
    name: "AI Breaker",
    description: "Win 50 PvE matches.",
    image: "badges/badge_pve_wins_25.png",
    repeatable: false
  },
  {
    id: "matches_played_500",
    name: "Enduring Contender",
    description: "Play 500 matches.",
    image: "badges/marathonGamer.png",
    repeatable: false
  },
  {
    id: "cards_captured_2000",
    name: "Card Hoarder VI",
    description: "Capture 2000 cards.",
    image: "badges/cardHoarder.png",
    repeatable: false
  },
  {
    id: "wars_entered_250",
    name: "War Eternal",
    description: "Enter 250 WARs.",
    image: "badges/warMachine.png",
    repeatable: false
  },
  {
    id: "wars_won_250",
    name: "WAR Mythic",
    description: "Win 250 WARs.",
    image: "badges/warrior.png",
    repeatable: false
  },
  {
    id: "win_streak_10",
    name: "Streak Commander",
    description: "Reach a 10-match win streak.",
    image: "badges/unbreakableStreak.png",
    repeatable: false
  }
]);

const FEATURED_RIVAL_ACHIEVEMENTS = Object.freeze([
  {
    id: "rival_defeats_10",
    name: "Boss Breaker",
    description: "Defeat Featured Rivals 10 times.",
    image: "badges/featuredRival.png",
    repeatable: false
  },
  {
    id: "rival_defeats_20",
    name: "Rival Hunter",
    description: "Defeat Featured Rivals 20 times.",
    image: "badges/featuredRival.png",
    repeatable: false
  },
  {
    id: "rival_defeats_30",
    name: "Boss Slayer",
    description: "Defeat Featured Rivals 30 times.",
    image: "badges/featuredRival.png",
    repeatable: false
  },
  {
    id: "rival_defeats_50",
    name: "Regent Breaker",
    description: "Defeat Featured Rivals 50 times.",
    image: "badges/featuredRival.png",
    repeatable: false
  }
]);

const ACHIEVEMENT_TOKEN_REWARDS = Object.freeze({
  comeback_win_5: 5,
  local_pvp_wins_25: 5,
  pve_wins_25: 5,
  all_elements_25: 10,
  online_wins_10: 5,
  online_wins_25: 10,
  online_wins_50: 15,
  local_pvp_wins_50: 10,
  pve_wins_50: 10,
  win_streak_10: 10
});

const TIERED_UNLOCK_RULES = Object.freeze([
  { id: "match_wins_25", key: "wins", threshold: 25 },
  { id: "match_wins_50", key: "wins", threshold: 50 },
  { id: "match_wins_100", key: "wins", threshold: 100 },
  { id: "match_wins_250", key: "wins", threshold: 250 },
  { id: "matches_played_50", key: "gamesPlayed", threshold: 50 },
  { id: "matches_played_100", key: "gamesPlayed", threshold: 100 },
  { id: "matches_played_250", key: "gamesPlayed", threshold: 250 },
  { id: "cards_captured_100", key: "cardsCaptured", threshold: 100 },
  { id: "cards_captured_250", key: "cardsCaptured", threshold: 250 },
  { id: "cards_captured_500", key: "cardsCaptured", threshold: 500 },
  { id: "cards_captured_1000", key: "cardsCaptured", threshold: 1000 },
  { id: "wars_entered_25", key: "warsEntered", threshold: 25 },
  { id: "wars_entered_50", key: "warsEntered", threshold: 50 },
  { id: "wars_entered_100", key: "warsEntered", threshold: 100 },
  { id: "wars_won_25", key: "warsWon", threshold: 25 },
  { id: "wars_won_50", key: "warsWon", threshold: 50 },
  { id: "wars_won_100", key: "warsWon", threshold: 100 },
  { id: "rival_defeats_10", key: "featuredRivalWins", threshold: 10 },
  { id: "rival_defeats_20", key: "featuredRivalWins", threshold: 20 },
  { id: "rival_defeats_30", key: "featuredRivalWins", threshold: 30 },
  { id: "rival_defeats_50", key: "featuredRivalWins", threshold: 50 },
  { id: "level_5", key: "playerLevel", threshold: 5 },
  { id: "level_10", key: "playerLevel", threshold: 10 },
  { id: "level_25", key: "playerLevel", threshold: 25 },
  { id: "level_50", key: "playerLevel", threshold: 50 }
]);

export const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  {
    id: "first_flame",
    name: "First Flame",
    description: "Win your first match.",
    image: "badges/firstFlame.png",
    repeatable: false
  },
  {
    id: "flawless_victory",
    name: "Flawless Victory",
    description: "Win a match without losing any cards.",
    image: "badges/flawlessVictory.png",
    repeatable: false
  },
  {
    id: "quick_draw",
    name: "Quick Draw",
    description: "Win a completed match in less than 3 minutes.",
    image: "badges/quickDraw.png",
    repeatable: true
  },
  {
    id: "quickdraw_master",
    name: "Quickdraw Master",
    description: "Win a completed match in less than 2 minutes.",
    image: "badges/quickdrawMaster.png",
    repeatable: true
  },
  {
    id: "card_hoarder",
    name: "Card Hoarder",
    description: "Collect all 4 cards of one element.",
    image: "badges/cardHoarder.png",
    repeatable: true
  },
  {
    id: "war_machine",
    name: "War Machine",
    description: "Win 3 WARs in a single match.",
    image: "badges/warMachine.png",
    repeatable: true
  },
  {
    id: "perfect_warrior",
    name: "Perfect Warrior",
    description: "Win with a full hand and at least 4 cards captured.",
    image: "badges/perfectWarrior.png",
    repeatable: false
  },
  {
    id: "overtime_champion",
    name: "Overtime Champion",
    description: "Win a match when the 5-minute timer expires.",
    image: "badges/overtimeChampion.png",
    repeatable: true
  },
  {
    id: "marathon_gamer",
    name: "Marathon Gamer",
    description: "Complete 25 matches.",
    image: "badges/marathonGamer.png",
    repeatable: false
  },
  {
    id: "elemental_overlord",
    name: "Elemental Overlord",
    description: "Reach 200 total wins.",
    image: "badges/elementalOverlord.png",
    repeatable: false
  },
  {
    id: "collector",
    name: "Collector",
    description: "Capture 25 total cards.",
    image: "badges/collector.png",
    repeatable: false
  },
  {
    id: "warrior",
    name: "Warrior",
    description: "Win 10 total WAR rounds.",
    image: "badges/warrior.png",
    repeatable: false
  },
  {
    id: "card_hoarder_elite",
    name: "Card Hoarder Elite",
    description: "Unlock Card Hoarder 5 times.",
    image: "badges/cardHoarderElite.png",
    repeatable: false
  },
  {
    id: "unbreakable_streak",
    name: "Unbreakable Streak",
    description: "Reach a 5-match win streak.",
    image: "badges/unbreakableStreak.png",
    repeatable: false
  },
  {
    id: "streak_lord",
    name: "Streak Lord",
    description: "Reach a 15-match win streak.",
    image: "badges/streakLord.png",
    repeatable: false
  },
  {
    id: "the_immortal",
    name: "The Immortal",
    description: "Reach 10 wins without a loss.",
    image: "badges/theImmortal.png",
    repeatable: false
  },
  {
    id: "comeback_win",
    name: "Come Back Win",
    description: "Win a match after being reduced to your last 3 cards.",
    image: "badges/comeback_win.png",
    repeatable: true
  },
  ...APPROVED_EXPANSION_ACHIEVEMENTS,
  ...FIRST_EXPANSION_BATCH_ACHIEVEMENTS,
  ...FEATURED_RIVAL_ACHIEVEMENTS,
  ...PHASE_ONE_TIERED_ACHIEVEMENTS
]);

const DEFINITION_MAP = new Map(ACHIEVEMENT_DEFINITIONS.map((item) => [item.id, item]));

const NUMERIC_PROGRESS_RULES = Object.freeze({
  marathon_gamer: { target: 25, current: (profile) => Number(profile?.gamesPlayed ?? 0) },
  elemental_overlord: { target: 200, current: (profile) => Number(profile?.wins ?? 0) },
  collector: { target: 25, current: (profile) => Number(profile?.cardsCaptured ?? 0) },
  warrior: { target: 10, current: (profile) => Number(profile?.warsWon ?? 0) },
  match_wins_25: { target: 25, current: (profile) => Number(profile?.wins ?? 0) },
  match_wins_50: { target: 50, current: (profile) => Number(profile?.wins ?? 0) },
  match_wins_100: { target: 100, current: (profile) => Number(profile?.wins ?? 0) },
  match_wins_250: { target: 250, current: (profile) => Number(profile?.wins ?? 0) },
  matches_played_50: { target: 50, current: (profile) => Number(profile?.gamesPlayed ?? 0) },
  matches_played_100: { target: 100, current: (profile) => Number(profile?.gamesPlayed ?? 0) },
  matches_played_250: { target: 250, current: (profile) => Number(profile?.gamesPlayed ?? 0) },
  matches_played_500: { target: 500, current: (profile) => Number(profile?.gamesPlayed ?? 0) },
  cards_captured_100: { target: 100, current: (profile) => Number(profile?.cardsCaptured ?? 0) },
  cards_captured_250: { target: 250, current: (profile) => Number(profile?.cardsCaptured ?? 0) },
  cards_captured_500: { target: 500, current: (profile) => Number(profile?.cardsCaptured ?? 0) },
  cards_captured_1000: { target: 1000, current: (profile) => Number(profile?.cardsCaptured ?? 0) },
  cards_captured_2000: { target: 2000, current: (profile) => Number(profile?.cardsCaptured ?? 0) },
  wars_entered_25: { target: 25, current: (profile) => Number(profile?.warsEntered ?? 0) },
  wars_entered_50: { target: 50, current: (profile) => Number(profile?.warsEntered ?? 0) },
  wars_entered_100: { target: 100, current: (profile) => Number(profile?.warsEntered ?? 0) },
  wars_entered_250: { target: 250, current: (profile) => Number(profile?.warsEntered ?? 0) },
  wars_won_25: { target: 25, current: (profile) => Number(profile?.warsWon ?? 0) },
  wars_won_50: { target: 50, current: (profile) => Number(profile?.warsWon ?? 0) },
  wars_won_100: { target: 100, current: (profile) => Number(profile?.warsWon ?? 0) },
  wars_won_250: { target: 250, current: (profile) => Number(profile?.warsWon ?? 0) },
  rival_defeats_10: { target: 10, current: (profile) => Number(profile?.featuredRivalWins ?? 0) },
  rival_defeats_20: { target: 20, current: (profile) => Number(profile?.featuredRivalWins ?? 0) },
  rival_defeats_30: { target: 30, current: (profile) => Number(profile?.featuredRivalWins ?? 0) },
  rival_defeats_50: { target: 50, current: (profile) => Number(profile?.featuredRivalWins ?? 0) },
  level_5: { target: 5, current: (profile) => Number(profile?.playerLevel ?? 0) },
  level_10: { target: 10, current: (profile) => Number(profile?.playerLevel ?? 0) },
  level_25: { target: 25, current: (profile) => Number(profile?.playerLevel ?? 0) },
  level_50: { target: 50, current: (profile) => Number(profile?.playerLevel ?? 0) },
  local_pvp_wins_25: { target: 25, current: (profile) => getModeWins(profile, "local_pvp") },
  local_pvp_wins_50: { target: 50, current: (profile) => getModeWins(profile, "local_pvp") },
  pve_wins_25: { target: 25, current: (profile) => getModeWins(profile, "pve") },
  pve_wins_50: { target: 50, current: (profile) => getModeWins(profile, "pve") },
  online_wins_10: { target: 10, current: (profile) => getModeWins(profile, "online_pvp") },
  online_wins_25: { target: 25, current: (profile) => getModeWins(profile, "online_pvp") },
  online_wins_50: { target: 50, current: (profile) => getModeWins(profile, "online_pvp") },
  all_elements_25: { target: 25, current: (profile) => Number(profile?.matchesUsingAllElements ?? 0) },
  long_match_25: { target: 25, current: (profile) => getLongestMatchRounds(profile) },
  long_match_50: { target: 50, current: (profile) => getLongestMatchRounds(profile) },
  long_match_75: { target: 75, current: (profile) => getLongestMatchRounds(profile) },
  long_match_100: { target: 100, current: (profile) => getLongestMatchRounds(profile) },
  longest_war_5: { target: 5, current: (profile) => Number(profile?.longestWar ?? 0) },
  longest_war_7: { target: 7, current: (profile) => Number(profile?.longestWar ?? 0) },
  unbreakable_streak: { target: 5, current: (profile) => Number(profile?.winStreak ?? 0) },
  win_streak_10: { target: 10, current: (profile) => Number(profile?.winStreak ?? 0) },
  streak_lord: { target: 15, current: (profile) => Number(profile?.winStreak ?? 0) },
  card_hoarder_elite: {
    target: 5,
    current: (profile) => getRepeatableAchievementCount(profile, "card_hoarder")
  },
  comeback_win_5: {
    target: 5,
    current: (profile) => getRepeatableAchievementCount(profile, "comeback_win")
  },
  comeback_win_25: {
    target: 25,
    current: (profile) => getRepeatableAchievementCount(profile, "comeback_win")
  }
});

export function normalizeAchievementProgressEntry(entry) {
  if (entry === true) {
    return {
      count: 1,
      firstUnlockedAt: null,
      lastUnlockedAt: null
    };
  }

  if (entry === false || entry == null) {
    return {
      count: 0,
      firstUnlockedAt: null,
      lastUnlockedAt: null
    };
  }

  if (typeof entry === "number" && Number.isFinite(entry)) {
    return {
      count: Math.max(0, Math.floor(entry)),
      firstUnlockedAt: null,
      lastUnlockedAt: null
    };
  }

  return {
    count: Math.max(0, Math.floor(Number(entry?.count ?? 0) || 0)),
    firstUnlockedAt: entry?.firstUnlockedAt ?? null,
    lastUnlockedAt: entry?.lastUnlockedAt ?? null
  };
}

export function normalizeAchievementProgressMap(achievements) {
  if (!achievements || typeof achievements !== "object" || Array.isArray(achievements)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(achievements)
      .filter(([id]) => DEFINITION_MAP.has(id))
      .map(([id, entry]) => [id, normalizeAchievementProgressEntry(entry)])
  );
}

function clampAchievementProgress(current, target) {
  const safeTarget = Math.max(0, Math.floor(Number(target ?? 0) || 0));
  const safeCurrent = Math.max(0, Math.floor(Number(current ?? 0) || 0));
  return Math.min(safeCurrent, safeTarget);
}

function buildAchievementProgress(profile, definitionId) {
  const rule = NUMERIC_PROGRESS_RULES[definitionId];
  if (!rule) {
    return null;
  }

  const target = Math.max(0, Math.floor(Number(rule.target ?? 0) || 0));
  if (target <= 0) {
    return null;
  }

  const current = clampAchievementProgress(rule.current(profile), target);
  return {
    current,
    target,
    label: `${current} / ${target}`,
    kind: "numeric"
  };
}

function getMatchDurationMs(matchState) {
  const explicit = Number(matchState?.meta?.durationMs ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const startedAt = Date.parse(String(matchState?.meta?.startedAt ?? ""));
  const endedAt = Date.parse(String(matchState?.meta?.endedAt ?? ""));
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt) {
    return endedAt - startedAt;
  }

  return Infinity;
}

function getPerspectiveState(matchState, perspective) {
  return perspective === "p2" ? matchState.players.p2 : matchState.players.p1;
}

function getMinimumHandSize(matchState, perspective) {
  const tracked = Number(matchState?.meta?.minHandSizes?.[perspective]);
  if (Number.isFinite(tracked) && tracked >= 0) {
    return tracked;
  }

  return getPerspectiveState(matchState, perspective)?.hand?.length ?? Infinity;
}

function countElementCards(cards) {
  const counts = {
    fire: 0,
    water: 0,
    earth: 0,
    wind: 0
  };

  for (const card of cards) {
    if (card in counts) {
      counts[card] += 1;
    }
  }

  return counts;
}

function isMatchWon(matchState, perspective) {
  return matchState.winner === perspective;
}

function cardsCapturedByOpponent(matchState, perspective) {
  const opponent = perspective === "p1" ? "p2" : "p1";
  return matchState.history.reduce((sum, round) => {
    if (round.result === opponent) {
      const explicit = Number(round.capturedOpponentCards);
      if (Number.isFinite(explicit) && explicit >= 0) {
        return sum + explicit;
      }

      return sum + Math.max(0, Math.floor(Number(round.capturedCards ?? 0) / 2));
    }
    return sum;
  }, 0);
}

function warWinsInMatch(matchState, perspective) {
  return matchState.history.reduce((sum, round) => {
    if ((round.warClashes ?? 0) > 0 && round.result === perspective) {
      return sum + 1;
    }
    return sum;
  }, 0);
}

function hasUnlocked(profile, id) {
  return normalizeAchievementProgressEntry(profile.achievements?.[id]).count > 0;
}

function unlock(definitionId, unlocks) {
  const definition = DEFINITION_MAP.get(definitionId);
  if (!definition) return;
  unlocks.push(definition);
}

function hasPendingUnlock(unlocks, definitionId) {
  return unlocks.some((item) => item.id === definitionId);
}

function applyTieredUnlockRules(profileAfter, unlocks) {
  for (const rule of TIERED_UNLOCK_RULES) {
    if ((profileAfter?.[rule.key] ?? 0) >= rule.threshold) {
      unlock(rule.id, unlocks);
    }
  }
}

function getModeWins(profile, modeKey) {
  return Number(profile?.modeStats?.[modeKey]?.wins ?? 0);
}

function getRepeatableAchievementCount(profile, id) {
  return normalizeAchievementProgressEntry(profile?.achievements?.[id]).count;
}

function getLongestMatchRounds(profile) {
  return Math.max(0, Number(profile?.longestMatch?.rounds ?? 0) || 0);
}

function applyApprovedExpansionUnlockRules(profileBefore, profileAfter, unlocks) {
  if (getLongestMatchRounds(profileAfter) >= 25) {
    unlock("long_match_25", unlocks);
  }

  if (getLongestMatchRounds(profileAfter) >= 50) {
    unlock("long_match_50", unlocks);
  }

  if (getLongestMatchRounds(profileAfter) >= 75) {
    unlock("long_match_75", unlocks);
  }

  if (getLongestMatchRounds(profileAfter) >= 100) {
    unlock("long_match_100", unlocks);
  }

  if ((profileAfter.longestWar ?? 0) >= 5) {
    unlock("longest_war_5", unlocks);
  }

  if ((profileAfter.longestWar ?? 0) >= 7) {
    unlock("longest_war_7", unlocks);
  }

  const priorComebackCount = getRepeatableAchievementCount(profileBefore, "comeback_win");
  const nextComebackCount =
    priorComebackCount + (hasPendingUnlock(unlocks, "comeback_win") ? 1 : 0);

  if (nextComebackCount >= 5) {
    unlock("comeback_win_5", unlocks);
  }

  if (nextComebackCount >= 25) {
    unlock("comeback_win_25", unlocks);
  }

  if (getModeWins(profileAfter, "local_pvp") >= 25) {
    unlock("local_pvp_wins_25", unlocks);
  }

  if (getModeWins(profileAfter, "pve") >= 25) {
    unlock("pve_wins_25", unlocks);
  }

  if ((profileAfter.matchesUsingAllElements ?? 0) >= 25) {
    unlock("all_elements_25", unlocks);
  }
}

function applyFirstExpansionBatchUnlockRules(profileAfter, unlocks) {
  if (getModeWins(profileAfter, "online_pvp") >= 10) {
    unlock("online_wins_10", unlocks);
  }

  if (getModeWins(profileAfter, "online_pvp") >= 25) {
    unlock("online_wins_25", unlocks);
  }

  if (getModeWins(profileAfter, "online_pvp") >= 50) {
    unlock("online_wins_50", unlocks);
  }

  if (getModeWins(profileAfter, "local_pvp") >= 50) {
    unlock("local_pvp_wins_50", unlocks);
  }

  if (getModeWins(profileAfter, "pve") >= 50) {
    unlock("pve_wins_50", unlocks);
  }

  if ((profileAfter.gamesPlayed ?? 0) >= 500) {
    unlock("matches_played_500", unlocks);
  }

  if ((profileAfter.cardsCaptured ?? 0) >= 2000) {
    unlock("cards_captured_2000", unlocks);
  }

  if ((profileAfter.warsEntered ?? 0) >= 250) {
    unlock("wars_entered_250", unlocks);
  }

  if ((profileAfter.warsWon ?? 0) >= 250) {
    unlock("wars_won_250", unlocks);
  }

  if ((profileAfter.winStreak ?? 0) >= 10) {
    unlock("win_streak_10", unlocks);
  }
}

export function evaluateAchievements({
  profileBefore,
  profileAfter,
  matchState,
  perspective,
  matchStats
}) {
  const unlocks = [];
  const won = isMatchWon(matchState, perspective);
  const lostCardsToOpponent = cardsCapturedByOpponent(matchState, perspective);
  const warsWonThisMatch = warWinsInMatch(matchState, perspective);
  const perspectiveState = getPerspectiveState(matchState, perspective);
  const isQuitForfeit = String(matchState?.endReason ?? "") === "quit_forfeit";
  const durationMs = getMatchDurationMs(matchState);
  const endHandCount = perspectiveState.hand.length;
  const fullHandCount = matchState.meta.totalCards;
  const elementCounts = countElementCards(perspectiveState.hand);
  const minimumHandSize = getMinimumHandSize(matchState, perspective);

  if (won && (profileBefore.gamesPlayed ?? 0) === 0) {
    unlock("first_flame", unlocks);
  }

  if (won && lostCardsToOpponent === 0) {
    unlock("flawless_victory", unlocks);
  }

  if (won && !isQuitForfeit && durationMs < 180000) {
    unlock("quick_draw", unlocks);
  }

  if (won && !isQuitForfeit && durationMs < 120000) {
    unlock("quickdraw_master", unlocks);
  }

  if (Object.values(elementCounts).some((count) => count >= 4)) {
    unlock("card_hoarder", unlocks);
  }

  if (won && warsWonThisMatch >= 3) {
    unlock("war_machine", unlocks);
  }

  if (won && endHandCount === fullHandCount && (matchStats.cardsCaptured ?? 0) >= 4) {
    unlock("perfect_warrior", unlocks);
  }

  if (won && matchState.endReason === "time_limit") {
    unlock("overtime_champion", unlocks);
  }

  if ((profileAfter.gamesPlayed ?? 0) >= 25) {
    unlock("marathon_gamer", unlocks);
  }

  if ((profileAfter.wins ?? 0) >= 200) {
    unlock("elemental_overlord", unlocks);
  }

  if ((profileAfter.cardsCaptured ?? 0) >= 25) {
    unlock("collector", unlocks);
  }

  if ((profileAfter.warsWon ?? 0) >= 10) {
    unlock("warrior", unlocks);
  }

  const priorCardHoarderCount = normalizeAchievementProgressEntry(
    profileBefore?.achievements?.card_hoarder
  ).count;
  const cardHoarderCount =
    priorCardHoarderCount + (hasPendingUnlock(unlocks, "card_hoarder") ? 1 : 0);
  if (cardHoarderCount >= 5) {
    unlock("card_hoarder_elite", unlocks);
  }

  if ((profileAfter.winStreak ?? 0) >= 5) {
    unlock("unbreakable_streak", unlocks);
  }

  if ((profileAfter.winStreak ?? 0) >= 15) {
    unlock("streak_lord", unlocks);
  }

  if ((profileAfter.wins ?? 0) >= 10 && (profileAfter.losses ?? 0) === 0) {
    unlock("the_immortal", unlocks);
  }

  if (won && minimumHandSize <= 3) {
    unlock("comeback_win", unlocks);
  }

  applyApprovedExpansionUnlockRules(profileBefore, profileAfter, unlocks);
  applyFirstExpansionBatchUnlockRules(profileAfter, unlocks);
  applyTieredUnlockRules(profileAfter, unlocks);

  return unlocks.filter((definition) => definition.repeatable || !hasUnlocked(profileBefore, definition.id));
}

export function evaluateRetroactiveAchievements(profile) {
  const normalizedProfile = {
    ...profile,
    achievements: normalizeAchievementProgressMap(profile?.achievements)
  };
  const unlocks = [];

  applyApprovedExpansionUnlockRules(normalizedProfile, normalizedProfile, unlocks);
  applyFirstExpansionBatchUnlockRules(normalizedProfile, unlocks);
  applyTieredUnlockRules(normalizedProfile, unlocks);

  return unlocks.filter((definition) => definition.repeatable || !hasUnlocked(normalizedProfile, definition.id));
}

export function applyAchievementUnlocks(profile, unlockedDefinitions) {
  const nextAchievements = normalizeAchievementProgressMap(profile.achievements);
  const unlockedAt = new Date().toISOString();

  const unlockEvents = [];

  for (const definition of unlockedDefinitions) {
    const current = normalizeAchievementProgressEntry(nextAchievements[definition.id]);
    const nextCount = current.count + 1;

    nextAchievements[definition.id] = {
      count: nextCount,
      firstUnlockedAt: current.firstUnlockedAt ?? unlockedAt,
      lastUnlockedAt: unlockedAt
    };

    unlockEvents.push({
      ...definition,
      count: nextCount,
      unlockedAt
    });
  }

  return {
    profile: {
      ...profile,
      achievements: nextAchievements
    },
    unlockEvents
  };
}

export function applyAchievementTokenRewards(profile, unlockedAchievements) {
  const tokenDelta = unlockedAchievements.reduce(
    (sum, achievement) => sum + (ACHIEVEMENT_TOKEN_REWARDS[achievement.id] ?? 0),
    0
  );

  return {
    profile:
      tokenDelta > 0
        ? {
            ...profile,
            tokens: Math.max(0, Number(profile?.tokens ?? 0)) + tokenDelta
          }
        : profile,
    tokenDelta
  };
}

export function buildAchievementCatalog(profile) {
  const progress = normalizeAchievementProgressMap(profile?.achievements);

  return ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const entry = progress[definition.id];
    const count = entry?.count ?? 0;
    const numericProgress = buildAchievementProgress(profile, definition.id);

    return {
      ...definition,
      count,
      unlocked: count > 0,
      progress: numericProgress,
      firstUnlockedAt: entry?.firstUnlockedAt ?? null,
      lastUnlockedAt: entry?.lastUnlockedAt ?? null
    };
  });
}

export function buildAchievementView(profile) {
  return buildAchievementCatalog(profile).filter((item) => item.unlocked);
}
