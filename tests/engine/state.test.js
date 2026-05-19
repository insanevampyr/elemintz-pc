import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMatch, playRound } from "../../src/engine/index.js";
import { HARD_PVE_WIN_CHEST_DROP_CHANCE } from "../../src/shared/basicChestDrop.js";
import {
  DAILY_BONUS_CHALLENGE_POOL,
  DAILY_CHALLENGE_DEFINITIONS,
  DAILY_FIXED_CORE_CHALLENGE_DEFINITIONS,
  WEEKLY_BONUS_CHALLENGE_POOL,
  WEEKLY_CHALLENGE_DEFINITIONS,
  WEEKLY_FIXED_CORE_CHALLENGE_DEFINITIONS,
  applyDailyChallengesForMatch,
  createDefaultDailyChallenges,
  getDailyChallengesView,
  getXpThresholds,
  normalizeProfileDailyChallenges
} from "../../src/state/dailyChallengesSystem.js";
import { COSMETIC_CATALOG, getCosmeticCatalogForProfile } from "../../src/state/cosmeticSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { applyLevelRewardsForLevelChange, buildXpBreakdown, deriveLevelFromXp } from "../../src/state/levelRewardsSystem.js";
import { MILESTONE_CHEST_TYPE } from "../../src/state/chestSystem.js";
import { deriveMatchStats } from "../../src/state/statsTracking.js";
import { buildFeaturedRotationCatalog, getStoreViewForProfile } from "../../src/state/storeSystem.js";
import { BoostEventStore } from "../../src/multiplayer/boostEventStore.js";

async function createTempDataDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-state-"));
  return root;
}

async function writeBoostEventConfig(dataDir, config) {
  const filePath = path.join(dataDir, "server-data", "boost-event.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function createBoostAwareStateCoordinator(options = {}) {
  const boostEventStore = new BoostEventStore({
    dataDir: options.dataDir,
    logger: { warn: () => {}, info: () => {} }
  });

  return new StateCoordinator({
    ...options,
    getActiveBoostEvent: (storeOptions) => boostEventStore.getActiveEvent(storeOptions)
  });
}

function markAllChallengeRewardsConsumed(challenges) {
  for (const def of DAILY_CHALLENGE_DEFINITIONS) {
    challenges.daily.completed[def.id] = true;
    challenges.daily.rewarded[def.id] = true;
  }
  for (const def of WEEKLY_CHALLENGE_DEFINITIONS) {
    challenges.weekly.completed[def.id] = true;
    challenges.weekly.rewarded[def.id] = true;
  }
  return challenges;
}

function withSelectedBonusChallenges(challenges, { daily = null, weekly = null } = {}) {
  if (Array.isArray(daily)) {
    challenges.daily.selectedBonusChallengeIds = [...daily];
    challenges.daily.setVersion = "core_bonus_v1";
  }

  if (Array.isArray(weekly)) {
    challenges.weekly.selectedBonusChallengeIds = [...weekly];
    challenges.weekly.setVersion = "core_bonus_v1";
  }

  return challenges;
}

function constantRandom(value) {
  return () => value;
}

function createRewardHookMatch({ winner = "p1", endReason = null, mode = "pve", difficulty = "normal" } = {}) {
  return {
    status: "completed",
    endReason,
    winner,
    mode,
    difficulty,
    round: 3,
    history: [
      { round: 1, result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 1, capturedOpponentCards: 1 },
      { round: 2, result: "p1", p1Card: "water", p2Card: "fire", warClashes: 1, capturedOpponentCards: 0 },
      { round: 3, result: "p1", p1Card: "earth", p2Card: "wind", warClashes: 5, capturedOpponentCards: 23 },
      { round: 4, result: "p1", p1Card: "wind", p2Card: "water", warClashes: 0, capturedOpponentCards: 0 }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };
}

function createCrownfireRewardMatch({
  winner = "p1",
  endReason = null,
  difficulty = "hard"
} = {}) {
  return {
    ...createRewardHookMatch({ winner, endReason, mode: "pve", difficulty }),
    featuredRivalId: "crownfire_duelist",
    meta: { totalCards: 20 }
  };
}

test("state: records completed match into profile and saves", async () => {
  const dataDir = await createTempDataDir();
  const state = createBoostAwareStateCoordinator({ dataDir });

  const match = createMatch();
  while (match.status === "active") {
    playRound(match);
  }

  const result = await state.recordMatchResult({
    username: "Tester",
    perspective: "p1",
    matchState: match
  });

  assert.equal(result.profile.username, "Tester");
  assert.ok(result.profile.wins + result.profile.losses >= 0);
  assert.ok(result.profile.cardsCaptured >= 0);

  const saves = await state.saves.listMatchResults();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].username, "Tester");
  assert.ok(Array.isArray(result.unlockedAchievements));
});

test("state: deriveMatchStats counts only opponent cards captured and ignores no-effect rounds", () => {
  const stats = deriveMatchStats(
    {
      winner: "p1",
      endReason: null,
      mode: "pve",
      round: 5,
      players: {
        p1: { hand: ["fire"] },
        p2: { hand: [] }
      },
      history: [
        { result: "p1", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
        { result: "none", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0 },
        { result: "none", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0 },
        { result: "none", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0 },
        { result: "p1", warClashes: 1, capturedCards: 6, capturedOpponentCards: 3 }
      ],
      meta: { totalCards: 8 }
    },
    "p1"
  );

  assert.equal(stats.cardsCaptured, 4);
  assert.equal(stats.warsEntered, 1);
  assert.equal(stats.warsWon, 1);
});

test("state: online settlement persists exact cumulative cards taken for both perspectives", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const matchState = {
    status: "completed",
    winner: "p2",
    endReason: null,
    mode: "online_pvp",
    round: 5,
    history: [
      { result: "p1", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1, p1Card: "fire", p2Card: "earth" },
      { result: "none", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0, p1Card: "water", p2Card: "water" },
      { result: "none", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0, p1Card: "earth", p2Card: "fire" },
      { result: "none", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0, p1Card: "wind", p2Card: "wind" },
      { result: "p2", warClashes: 3, capturedCards: 6, capturedOpponentCards: 3, p1Card: "fire", p2Card: "water" }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };

  try {
    await state.recordOnlineMatchResult({
      username: "OnlineCardsP1",
      matchState,
      perspective: "p1",
      settlementKey: "cards-semantic-p1"
    });
    await state.recordOnlineMatchResult({
      username: "OnlineCardsP2",
      matchState,
      perspective: "p2",
      settlementKey: "cards-semantic-p2"
    });

    const p1 = await state.profiles.getProfile("OnlineCardsP1");
    const p2 = await state.profiles.getProfile("OnlineCardsP2");

    assert.equal(p1.cardsCaptured, 1);
    assert.equal(p1.modeStats.online_pvp.cardsCaptured, 1);
    assert.equal(p2.cardsCaptured, 3);
    assert.equal(p2.modeStats.online_pvp.cardsCaptured, 3);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("state: updates and reads settings", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const initial = await state.settings.getSettings();
  assert.equal(initial.gameplay.timerSeconds, 20);
  assert.equal(initial.aiDifficulty, "normal");
  assert.equal(initial.aiOpponentStyle, "random");

  const updated = await state.settings.updateSettings({
    gameplay: { timerSeconds: 45 },
    aiDifficulty: "hard",
    aiOpponentStyle: "random",
    ui: { reducedMotion: true }
  });

  assert.equal(updated.gameplay.timerSeconds, 45);
  assert.equal(updated.aiDifficulty, "hard");
  assert.equal(updated.aiOpponentStyle, "random");
  assert.equal(updated.ui.reducedMotion, true);
});

test("state: settings backfill missing fields without overwriting existing saved choices", async () => {
  const dataDir = await createTempDataDir();
  const settingsPath = path.join(dataDir, "settings.json");
  const partialSettings = {
    gameplay: { timerSeconds: 33 },
    ui: { reducedMotion: true }
  };

  await fs.writeFile(settingsPath, JSON.stringify(partialSettings, null, 2), "utf8");

  const state = new StateCoordinator({ dataDir });
  const merged = await state.settings.getSettings();

  assert.equal(merged.gameplay.timerSeconds, 33);
  assert.equal(merged.aiDifficulty, "normal");
  assert.equal(merged.aiOpponentStyle, "random");
  assert.equal(merged.ui.reducedMotion, true);
  assert.equal(merged.ui.showRoundHistory, true);
  assert.equal(merged.audio.enabled, true);

  const persisted = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(persisted.gameplay.timerSeconds, 33);
  assert.equal(persisted.aiDifficulty, "normal");
  assert.equal(persisted.aiOpponentStyle, "random");
  assert.equal(persisted.ui.reducedMotion, true);
  assert.equal(persisted.ui.showRoundHistory, true);
});

test("state: easy PvE difficulty disables achievement unlocks while normal allows them", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const easyMatch = {
    ...createMatch({ mode: "pve", difficulty: "easy" }),
    difficulty: "easy",
    status: "completed",
    winner: "p1",
    round: 1,
    history: [
      {
        round: 1,
        result: "p1",
        p1Card: "fire",
        p2Card: "earth",
        warClashes: 0,
        capturedCards: 2
      }
    ]
  };

  const easyResult = await state.recordMatchResult({
    username: "EasyAiUser",
    perspective: "p1",
    matchState: easyMatch
  });
  assert.equal(easyResult.unlockedAchievements.length, 0);
  assert.equal(easyResult.profile.achievements?.first_flame?.count ?? 0, 0);

  const normalMatch = {
    ...easyMatch,
    difficulty: "normal"
  };
  const normalResult = await state.recordMatchResult({
    username: "NormalAiUser",
    perspective: "p1",
    matchState: normalMatch
  });

  assert.ok(normalResult.unlockedAchievements.some((item) => item.id === "first_flame"));
  assert.equal(normalResult.profile.achievements.first_flame.count, 1);
});

test("state: easy PvE practice mode suppresses rewards, stats, chests, challenges, and achievements on win", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.0)
  });

  const profileBefore = await state.profiles.ensureProfile("EasyPracticeWinUser");
  const beforeChallenges = await state.getDailyChallenges("EasyPracticeWinUser");
  const result = await state.recordMatchResult({
    username: "EasyPracticeWinUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "easy" })
  });
  const afterChallenges = await state.getDailyChallenges("EasyPracticeWinUser");

  assert.equal(result.tokenDelta, 0);
  assert.equal(result.matchTokenDelta, 0);
  assert.equal(result.challengeTokenDelta, 0);
  assert.equal(result.challengeXpDelta, 0);
  assert.equal(result.xpDelta, 0);
  assert.equal(result.profile.tokens, profileBefore.tokens);
  assert.equal(result.profile.playerXP, profileBefore.playerXP);
  assert.equal(result.profile.wins, 0);
  assert.equal(result.profile.losses, 0);
  assert.equal(result.profile.gamesPlayed, 0);
  assert.equal(result.profile.modeStats.pve.wins, 0);
  assert.equal(result.profile.modeStats.pve.losses, 0);
  assert.equal(result.profile.modeStats.pve.gamesPlayed, 0);
  assert.equal(result.profile.chests.basic, 0);
  assert.equal(result.profile.chests.epic, 0);
  assert.equal(result.unlockedAchievements.length, 0);
  assert.equal(result.profile.achievements?.first_flame?.count ?? 0, 0);
  assert.deepEqual(result.levelRewards, []);
  assert.deepEqual(result.dailyRewards, []);
  assert.deepEqual(result.weeklyRewards, []);
  assert.deepEqual(result.stats, {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    matchesUsingAllElements: 0,
    quickWins: 0,
    timeLimitWins: 0
  });
  assert.deepEqual(
    afterChallenges.daily.challenges.map((item) => item.progress),
    beforeChallenges.daily.challenges.map((item) => item.progress)
  );
  assert.deepEqual(
    afterChallenges.weekly.challenges.map((item) => item.progress),
    beforeChallenges.weekly.challenges.map((item) => item.progress)
  );
});

test("state: easy PvE practice mode suppresses progression on loss and draw", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.0)
  });

  const lossProfileBefore = await state.profiles.ensureProfile("EasyPracticeLossUser");
  const drawProfileBefore = await state.profiles.ensureProfile("EasyPracticeDrawUser");
  const lossResult = await state.recordMatchResult({
    username: "EasyPracticeLossUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p2", difficulty: "easy" })
  });
  const drawResult = await state.recordMatchResult({
    username: "EasyPracticeDrawUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "draw", difficulty: "easy" })
  });

  for (const [result, profileBefore] of [
    [lossResult, lossProfileBefore],
    [drawResult, drawProfileBefore]
  ]) {
    assert.equal(result.tokenDelta, 0);
    assert.equal(result.xpDelta, 0);
    assert.equal(result.profile.tokens, profileBefore.tokens);
    assert.equal(result.profile.playerXP, profileBefore.playerXP);
    assert.equal(result.profile.wins, 0);
    assert.equal(result.profile.losses, 0);
    assert.equal(result.profile.gamesPlayed, 0);
    assert.equal(result.profile.modeStats.pve.wins, 0);
    assert.equal(result.profile.modeStats.pve.losses, 0);
    assert.equal(result.profile.modeStats.pve.gamesPlayed, 0);
    assert.equal(result.profile.chests.basic, 0);
    assert.deepEqual(result.dailyRewards, []);
    assert.deepEqual(result.weeklyRewards, []);
    assert.equal(result.unlockedAchievements.length, 0);
  }
});

test("state: store background catalog includes all registered background assets with preserved rarity pricing", () => {
  const cosmetics = getCosmeticCatalogForProfile({ username: "BackgroundShopUser" });
  const backgroundById = new Map(cosmetics.background.map((item) => [item.id, item]));

  const expectedIds = [
    "fire_background",
    "water_background",
    "earth_background",
    "wind_background",
    "celestial_void_background",
    "lava_throne_background",
    "frozen_temple_background",
    "ruin_arena_background",
    "celestial_chamber_background",
    "storm_peak_background",
    "void_altar_background",
    "background_ancient_arena",
    "background_storm_citadel",
    "background_sky_temple"
  ];

  for (const id of expectedIds) {
    assert.ok(backgroundById.has(id), `missing background ${id}`);
  }

  assert.equal(backgroundById.get("fire_background").rarity, "Common");
  assert.equal(backgroundById.get("fire_background").price, 90);
  assert.equal(backgroundById.get("water_background").rarity, "Common");
  assert.equal(backgroundById.get("water_background").price, 90);
  assert.equal(backgroundById.get("earth_background").rarity, "Common");
  assert.equal(backgroundById.get("earth_background").price, 90);
  assert.equal(backgroundById.get("celestial_void_background").rarity, "Legendary");
  assert.equal(backgroundById.get("celestial_void_background").price, 1000);
  assert.equal(backgroundById.get("lava_throne_background").rarity, "Epic");
  assert.equal(backgroundById.get("lava_throne_background").price, 700);
  assert.equal(backgroundById.get("void_altar_background").rarity, "Legendary");
  assert.equal(backgroundById.get("void_altar_background").price, 1000);
});

test("state: rotationOnly cosmetics stay out of the normal store catalog by default", () => {
  const store = getStoreViewForProfile({ username: "RotationStoreUser" });
  const approvedRotationOnlyIds = {
    avatar: [
      "avatar_voidbound_entity",
      "avatar_inferno_crown_f",
      "avatar_inferno_crown_m",
      "avatar_golden_menace",
      "avatar_astral_archon"
    ],
    cardBack: ["void_card_back", "elemental_chest_cardback"],
    background: ["void_altar_background", "lava_throne_background", "bg_celestial_observatory"],
    elementCardVariant: ["fire_variant_crownfire"]
  };

  for (const [type, ids] of Object.entries(approvedRotationOnlyIds)) {
    for (const id of ids) {
      assert.equal(
        store.catalog[type].some((item) => item.id === id),
        false,
        `${type}:${id} should stay out of the normal store catalog`
      );
    }
  }
});

test("state: featured rotation catalog can expose approved rotationOnly items while keeping storeHidden items blocked", () => {
  const featuredCatalog = buildFeaturedRotationCatalog(
    {
      username: "RotationFeaturedUser",
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none"],
        title: ["Initiate"]
      }
    },
    {
      allowLimitedCosmeticIds: [
        "avatar_voidbound_entity",
        "void_card_back",
        "void_altar_background",
        "avatar_inferno_crown_f",
        "avatar_inferno_crown_m",
        "fire_variant_crownfire",
        "lava_throne_background",
        "avatar_golden_menace",
        "avatar_astral_archon",
        "bg_celestial_observatory",
        "elemental_chest_cardback",
        "supporter_card_back"
      ]
    }
  );

  assert.equal(featuredCatalog.avatar.some((item) => item.id === "avatar_voidbound_entity"), true);
  assert.equal(featuredCatalog.avatar.some((item) => item.id === "avatar_inferno_crown_f"), true);
  assert.equal(featuredCatalog.avatar.some((item) => item.id === "avatar_inferno_crown_m"), true);
  assert.equal(featuredCatalog.avatar.some((item) => item.id === "avatar_golden_menace"), true);
  assert.equal(featuredCatalog.avatar.some((item) => item.id === "avatar_astral_archon"), true);
  assert.equal(featuredCatalog.cardBack.some((item) => item.id === "void_card_back"), true);
  assert.equal(featuredCatalog.cardBack.some((item) => item.id === "elemental_chest_cardback"), true);
  assert.equal(featuredCatalog.background.some((item) => item.id === "void_altar_background"), true);
  assert.equal(featuredCatalog.background.some((item) => item.id === "lava_throne_background"), true);
  assert.equal(featuredCatalog.background.some((item) => item.id === "bg_celestial_observatory"), true);
  assert.equal(
    featuredCatalog.elementCardVariant.some((item) => item.id === "fire_variant_crownfire"),
    true
  );
  assert.equal(
    featuredCatalog.cardBack.some((item) => item.id === "supporter_card_back"),
    false
  );
});

test("state: Founder Pack, Level Rewards, Achievement Rewards, and Starter Set remain non-rotationOnly", () => {
  const starterAndProtectedIds = [
    ["avatar", "default_avatar"],
    ["cardBack", "default_card_back"],
    ["background", "default_background"],
    ["elementCardVariant", "default_fire_card"],
    ["badge", "none"],
    ["title", "Initiate"],
    ["cardBack", "founder_deluxe_card_back"],
    ["badge", "supporter_badge"],
    ["title", "Arena Founder"],
    ["title", "title_apprentice"],
    ["avatar", "avatar_novice_mage"],
    ["badge", "badge_element_initiate"],
    ["badge", "war_machine_badge"],
    ["title", "Flame Vanguard"]
  ];

  for (const [type, id] of starterAndProtectedIds) {
    const entry = COSMETIC_CATALOG[type].find((item) => item.id === id);
    assert.ok(entry, `expected protected catalog entry for ${type}:${id}`);
    assert.equal(entry.rotationOnly ?? false, false, `${type}:${id} should not be rotationOnly`);
  }
});

test("state: owned rotationOnly cosmetics remain visible in the owned cosmetics catalog", () => {
  const cosmetics = getCosmeticCatalogForProfile({
    username: "RotationOwner",
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_voidbound_entity", "avatar_inferno_crown_f"],
      background: ["default_background", "void_altar_background"],
      cardBack: ["default_card_back", "void_card_back", "elemental_chest_cardback"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card",
        "fire_variant_crownfire"
      ],
      badge: ["none"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "avatar_voidbound_entity",
      background: "void_altar_background",
      cardBack: "void_card_back",
      elementCardVariant: {
        fire: "fire_variant_crownfire",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      },
      badge: "none",
      title: "Initiate"
    }
  });

  assert.equal(
    cosmetics.avatar.find((item) => item.id === "avatar_voidbound_entity")?.owned,
    true
  );
  assert.equal(
    cosmetics.avatar.find((item) => item.id === "avatar_voidbound_entity")?.equipped,
    true
  );
  assert.equal(
    cosmetics.cardBack.find((item) => item.id === "void_card_back")?.owned,
    true
  );
  assert.equal(
    cosmetics.cardBack.find((item) => item.id === "void_card_back")?.equipped,
    true
  );
  assert.equal(
    cosmetics.background.find((item) => item.id === "void_altar_background")?.owned,
    true
  );
  assert.equal(
    cosmetics.background.find((item) => item.id === "void_altar_background")?.equipped,
    true
  );
  assert.equal(
    cosmetics.cardBack.find((item) => item.id === "elemental_chest_cardback")?.owned,
    true
  );
  assert.equal(
    cosmetics.elementCardVariant.find((item) => item.id === "fire_variant_crownfire")?.owned,
    true
  );
  assert.equal(
    cosmetics.elementCardVariant.find((item) => item.id === "fire_variant_crownfire")?.equipped,
    true
  );
});

test("state: cosmetic catalog covers all completed on-disk avatar, background, card back, and card variant assets", async () => {
  const avatarFiles = await fs.readdir(path.join(process.cwd(), "assets", "avatars"));
  const backgroundFiles = await fs.readdir(path.join(process.cwd(), "assets", "backgrounds"));
  const cardBackFiles = await fs.readdir(path.join(process.cwd(), "assets", "card_backs"));
  const cardFiles = await fs.readdir(path.join(process.cwd(), "assets", "cards"));

  assert.equal(new Set(COSMETIC_CATALOG.avatar.map((item) => item.id)).size, COSMETIC_CATALOG.avatar.length);
  assert.equal(new Set(COSMETIC_CATALOG.background.map((item) => item.id)).size, COSMETIC_CATALOG.background.length);
  assert.equal(new Set(COSMETIC_CATALOG.cardBack.map((item) => item.id)).size, COSMETIC_CATALOG.cardBack.length);
  assert.equal(
    new Set(COSMETIC_CATALOG.elementCardVariant.map((item) => item.id)).size,
    COSMETIC_CATALOG.elementCardVariant.length
  );

  const avatarImages = new Set(COSMETIC_CATALOG.avatar.map((item) => item.image));
  const backgroundImages = new Set(COSMETIC_CATALOG.background.map((item) => item.image));
  const cardBackImages = new Set(COSMETIC_CATALOG.cardBack.map((item) => item.image));
  const variantImages = new Set(COSMETIC_CATALOG.elementCardVariant.map((item) => item.image));

  for (const file of avatarFiles) {
    assert.ok(avatarImages.has(`avatars/${file}`), `missing avatar catalog entry for ${file}`);
  }

  for (const file of backgroundFiles) {
    assert.ok(backgroundImages.has(`backgrounds/${file}`), `missing background catalog entry for ${file}`);
  }

  for (const file of cardBackFiles) {
    assert.ok(cardBackImages.has(`card_backs/${file}`), `missing card back catalog entry for ${file}`);
  }

  const cosmeticCardFiles = cardFiles.filter((file) => !["back.jpg", "rules.jpg"].includes(file));
  for (const file of cosmeticCardFiles) {
    assert.ok(variantImages.has(`cards/${file}`), `missing card variant catalog entry for ${file}`);
  }
});

test("state: local_pvp results can be persisted for both players", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = createMatch({ mode: "local_pvp" });
  while (match.status === "active") {
    playRound(match);
  }

  const p1 = await state.recordMatchResult({
    username: "LocalP1",
    perspective: "p1",
    matchState: match
  });

  const p2 = await state.recordMatchResult({
    username: "LocalP2",
    perspective: "p2",
    matchState: match
  });

  assert.equal(p1.profile.username, "LocalP1");
  assert.equal(p2.profile.username, "LocalP2");

  const saves = await state.saves.listMatchResults();
  assert.equal(saves.length, 2);
  assert.equal(saves[0].mode, "local_pvp");
  assert.equal(saves[1].mode, "local_pvp");
});

test("state: online_pvp draw records games played, resets win streak, and avoids duplicate settlement", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("OnlineDrawUser", {
    winStreak: 4,
    bestWinStreak: 4
  });

  const match = {
    status: "completed",
    winner: "draw",
    endReason: "hand_exhaustion",
    mode: "online_pvp",
    round: 6,
    history: [
      { result: "none", warClashes: 2, capturedOpponentCards: 0 }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };

  const first = await state.recordOnlineMatchResult({
    username: "OnlineDrawUser",
    perspective: "p1",
    matchState: match,
    settlementKey: "ROOM123:match:1:OnlineDrawUser"
  });
  const second = await state.recordOnlineMatchResult({
    username: "OnlineDrawUser",
    perspective: "p1",
    matchState: match,
    settlementKey: "ROOM123:match:1:OnlineDrawUser"
  });

  assert.equal(first.duplicate ?? false, false);
  assert.equal(second.duplicate, true);

  const profile = await state.profiles.getProfile("OnlineDrawUser");
  assert.equal(profile.gamesPlayed, 1);
  assert.equal(profile.wins, 0);
  assert.equal(profile.losses, 0);
  assert.equal(profile.winStreak, 0);
  assert.equal(profile.bestWinStreak, 4);
  assert.equal(profile.warsEntered, 1);
  assert.equal(profile.warsWon, 0);
  assert.equal(profile.longestWar, 2);
  assert.equal(profile.cardsCaptured, 0);
  assert.deepEqual(profile.modeStats.online_pvp, {
    gamesPlayed: 1,
    wins: 0,
    losses: 0,
    warsEntered: 1,
    warsWon: 0,
    longestWar: 2,
    cardsCaptured: 0,
    quickWins: 0,
    timeLimitWins: 0
  });

  const saves = await state.saves.listMatchResults();
  assert.equal(
    saves.filter(
      (entry) =>
        entry.mode === "online_pvp" && entry.settlementKey === "ROOM123:match:1:OnlineDrawUser"
    ).length,
    1
  );
});

test("state: local_pvp draw records games played and resets win streak through the shared stat path", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LocalDrawUser", {
    winStreak: 4,
    bestWinStreak: 4
  });

  const result = await state.recordMatchResult({
    username: "LocalDrawUser",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "draw",
      endReason: "hand_exhaustion",
      mode: "local_pvp",
      round: 6,
      history: [{ result: "none", warClashes: 2, capturedOpponentCards: 0 }],
      players: {
        p1: { hand: [] },
        p2: { hand: [] }
      },
      meta: { totalCards: 16 }
    }
  });

  assert.equal(result.profile.gamesPlayed, 1);
  assert.equal(result.profile.wins, 0);
  assert.equal(result.profile.losses, 0);
  assert.equal(result.profile.winStreak, 0);
  assert.equal(result.profile.bestWinStreak, 4);
  assert.equal(result.profile.warsEntered, 1);
  assert.equal(result.profile.warsWon, 0);
  assert.equal(result.profile.longestWar, 2);
  assert.equal(result.profile.cardsCaptured, 0);
  assert.deepEqual(result.profile.modeStats.local_pvp, {
    gamesPlayed: 1,
    wins: 0,
    losses: 0,
    warsEntered: 1,
    warsWon: 0,
    longestWar: 2,
    cardsCaptured: 0,
    quickWins: 0,
    timeLimitWins: 0
  });
});

test("state: pve draw records games played and resets win streak through the shared stat path", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("PveDrawUser", {
    winStreak: 4,
    bestWinStreak: 4
  });

  const result = await state.recordMatchResult({
    username: "PveDrawUser",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "draw",
      endReason: "hand_exhaustion",
      mode: "pve",
      round: 6,
      history: [{ result: "none", warClashes: 2, capturedOpponentCards: 0 }],
      players: {
        p1: { hand: [] },
        p2: { hand: [] }
      },
      meta: { totalCards: 16 }
    }
  });

  assert.equal(result.profile.gamesPlayed, 1);
  assert.equal(result.profile.wins, 0);
  assert.equal(result.profile.losses, 0);
  assert.equal(result.profile.winStreak, 0);
  assert.equal(result.profile.bestWinStreak, 4);
  assert.equal(result.profile.warsEntered, 1);
  assert.equal(result.profile.warsWon, 0);
  assert.equal(result.profile.longestWar, 2);
  assert.equal(result.profile.cardsCaptured, 0);
  assert.deepEqual(result.profile.modeStats.pve, {
    gamesPlayed: 1,
    wins: 0,
    losses: 0,
    warsEntered: 1,
    warsWon: 0,
    longestWar: 2,
    cardsCaptured: 0,
    quickWins: 0,
    timeLimitWins: 0
  });
});

test("state: online_pvp rematch can settle the next completed match once and WAR counters persist", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const firstMatch = {
    status: "completed",
    winner: "p1",
    endReason: "hand_exhaustion",
    mode: "online_pvp",
    round: 5,
    history: [
      { result: "p1", warClashes: 3, capturedOpponentCards: 3 },
      { result: "p1", warClashes: 0, capturedOpponentCards: 1 }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };

  const secondMatch = {
    status: "completed",
    winner: "p1",
    endReason: "hand_exhaustion",
    mode: "online_pvp",
    round: 4,
    history: [
      { result: "p1", warClashes: 1, capturedOpponentCards: 1 },
      { result: "p1", warClashes: 0, capturedOpponentCards: 1 }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };

  await state.recordOnlineMatchResult({
    username: "OnlineRematchUser",
    perspective: "p1",
    matchState: firstMatch,
    settlementKey: "ROOMABC:match:1:OnlineRematchUser"
  });
  await state.recordOnlineMatchResult({
    username: "OnlineRematchUser",
    perspective: "p1",
    matchState: secondMatch,
    settlementKey: "ROOMABC:match:2:OnlineRematchUser"
  });

  const profile = await state.profiles.getProfile("OnlineRematchUser");
  assert.equal(profile.gamesPlayed, 2);
  assert.equal(profile.wins, 2);
  assert.equal(profile.losses, 0);
  assert.equal(profile.winStreak, 2);
  assert.equal(profile.bestWinStreak, 2);
  assert.equal(profile.warsEntered, 2);
  assert.equal(profile.warsWon, 2);
  assert.equal(profile.longestWar, 3);
  assert.equal(profile.cardsCaptured, 6);
  assert.deepEqual(profile.modeStats.online_pvp, {
    gamesPlayed: 2,
    wins: 2,
    losses: 0,
    warsEntered: 2,
    warsWon: 2,
    longestWar: 3,
    cardsCaptured: 6,
    quickWins: 0,
    timeLimitWins: 0
  });

  const saves = await state.saves.listMatchResults();
  assert.equal(
    saves.filter((entry) => entry.mode === "online_pvp" && entry.username === "OnlineRematchUser").length,
    2
  );
});

test("state: online_pvp reaches shared daily and weekly challenge hooks while also evaluating shared achievements", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const challenges = withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
    daily: ["daily_online_match_1", "daily_online_win_1", "daily_no_quit_3"],
    weekly: ["weekly_online_matches_5", "weekly_online_wins_3", "weekly_no_quit_10"]
  });
  challenges.daily.progress.completedNoQuitMatch = 2;
  challenges.daily.progress.matchesWon = 1;
  challenges.weekly.progress.matchesPlayed = 14;
  challenges.weekly.progress.matchesWon = 9;
  challenges.weekly.progress.warsWon = 8;
  challenges.weekly.progress.cardsCaptured = 63;
  challenges.weekly.progress.usedAllElementsInMatch = 4;
  challenges.weekly.progress.completedOnlineMatch = 4;
  challenges.weekly.progress.wonOnlineMatch = 2;
  challenges.weekly.progress.completedNoQuitMatch = 9;

  await state.profiles.updateProfile("OnlineChallengeUser", {
    winStreak: 2,
    bestWinStreak: 2,
    dailyChallenges: challenges,
    achievements: {
      comeback_win: { count: 4 }
    }
  });

  const match = {
    status: "completed",
    winner: "p1",
    endReason: "hand_exhaustion",
    mode: "online_pvp",
    round: 6,
    history: [
      { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 1, capturedOpponentCards: 1 },
      { result: "p1", p1Card: "water", p2Card: "fire", warClashes: 1, capturedOpponentCards: 0 },
      { result: "p1", p1Card: "earth", p2Card: "wind", warClashes: 5, capturedOpponentCards: 23 },
      { result: "p1", p1Card: "wind", p2Card: "water", warClashes: 0, capturedOpponentCards: 0 }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: { totalCards: 16 }
  };

  const result = await state.recordOnlineMatchResult({
    username: "OnlineChallengeUser",
    perspective: "p1",
    matchState: match,
    settlementKey: "ROOMHOOK:match:1:OnlineChallengeUser"
  });

  const dailyRewardIds = result.dailyRewards.map((item) => item.id);
  const weeklyRewardIds = result.weeklyRewards.map((item) => item.id);
  const dailyById = Object.fromEntries(result.dailyChallenges.challenges.map((item) => [item.id, item]));
  const weeklyById = Object.fromEntries(result.weeklyChallenges.challenges.map((item) => [item.id, item]));
  const profile = await state.profiles.getProfile("OnlineChallengeUser");

  assert.ok(dailyRewardIds.includes("daily_win_2_matches"));
  assert.ok(dailyRewardIds.includes("daily_win_1_war"));
  assert.ok(dailyRewardIds.includes("daily_capture_16_cards"));
  assert.ok(dailyRewardIds.includes("daily_use_all_4_elements"));
  assert.ok(dailyRewardIds.includes("daily_online_match_1"));
  assert.ok(dailyRewardIds.includes("daily_online_win_1"));
  assert.ok(dailyRewardIds.includes("daily_no_quit_3"));
  assert.ok(weeklyRewardIds.includes("weekly_play_15_matches"));
  assert.ok(weeklyRewardIds.includes("weekly_win_10_matches"));
  assert.ok(weeklyRewardIds.includes("weekly_win_9_wars"));
  assert.ok(weeklyRewardIds.includes("weekly_capture_64_cards"));
  assert.ok(weeklyRewardIds.includes("weekly_win_streak_3"));
  assert.ok(weeklyRewardIds.includes("weekly_use_all_4_elements_5x"));
  assert.ok(weeklyRewardIds.includes("weekly_longest_war_5"));
  assert.ok(weeklyRewardIds.includes("weekly_online_matches_5"));
  assert.ok(weeklyRewardIds.includes("weekly_online_wins_3"));
  assert.ok(weeklyRewardIds.includes("weekly_no_quit_10"));
  assert.equal(result.challengeTokenDelta, result.tokenDelta);
  assert.ok(result.challengeTokenDelta > 0);
  assert.ok(result.challengeXpDelta > 0);
  assert.equal(result.save.matchTokenDelta, 0);
  assert.equal(result.save.challengeTokenDelta, result.challengeTokenDelta);
  assert.equal(dailyById.daily_play_5_matches.progress, 1);
  assert.equal(weeklyById.weekly_play_15_matches.progress, 15);
  assert.equal(profile.achievements.first_flame.count, 1);
  assert.equal(profile.achievements.flawless_victory.count, 1);
  assert.equal(profile.achievements.comeback_win.count, 5);
  assert.equal(profile.achievements.comeback_win_5.count, 1);
  assert.ok(result.unlockedAchievements.some((item) => item.id === "first_flame"));
  assert.ok(result.unlockedAchievements.some((item) => item.id === "comeback_win"));
  assert.ok(result.unlockedAchievements.some((item) => item.id === "comeback_win_5"));
});

test("state: online_pvp win draw and loss feed the proper shared challenge outcome hooks", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("OnlineWinOutcomeUser", {
    winStreak: 2,
    bestWinStreak: 2,
    dailyChallenges: createDefaultDailyChallenges(Date.now())
  });
  await state.profiles.updateProfile("OnlineDrawOutcomeUser", {
    winStreak: 2,
    bestWinStreak: 2,
    dailyChallenges: createDefaultDailyChallenges(Date.now())
  });
  await state.profiles.updateProfile("OnlineLossOutcomeUser", {
    winStreak: 2,
    bestWinStreak: 2,
    dailyChallenges: createDefaultDailyChallenges(Date.now())
  });

  const winResult = await state.recordOnlineMatchResult({
    username: "OnlineWinOutcomeUser",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "p1",
      endReason: "hand_exhaustion",
      mode: "online_pvp",
      round: 6,
      history: [
        { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 1, capturedOpponentCards: 2 },
        { result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedOpponentCards: 1 },
        { result: "p1", p1Card: "earth", p2Card: "wind", warClashes: 0, capturedOpponentCards: 1 },
        { result: "p1", p1Card: "wind", p2Card: "water", warClashes: 0, capturedOpponentCards: 1 }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    settlementKey: "OUTCOME:win:OnlineWinOutcomeUser"
  });
  const drawResult = await state.recordOnlineMatchResult({
    username: "OnlineDrawOutcomeUser",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "draw",
      endReason: "hand_exhaustion",
      mode: "online_pvp",
      round: 6,
      history: [
        { result: "none", p1Card: "fire", p2Card: "fire", warClashes: 0, capturedOpponentCards: 0 }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    settlementKey: "OUTCOME:draw:OnlineDrawOutcomeUser"
  });
  const lossResult = await state.recordOnlineMatchResult({
    username: "OnlineLossOutcomeUser",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "p2",
      endReason: "hand_exhaustion",
      mode: "online_pvp",
      round: 6,
      history: [
        { result: "p2", p1Card: "fire", p2Card: "water", warClashes: 0, capturedOpponentCards: 0 }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    settlementKey: "OUTCOME:loss:OnlineLossOutcomeUser"
  });

  const winDaily = Object.fromEntries(winResult.dailyChallenges.challenges.map((item) => [item.id, item]));
  const drawDaily = Object.fromEntries(drawResult.dailyChallenges.challenges.map((item) => [item.id, item]));
  const lossDaily = Object.fromEntries(lossResult.dailyChallenges.challenges.map((item) => [item.id, item]));
  const winWeekly = Object.fromEntries(winResult.weeklyChallenges.challenges.map((item) => [item.id, item]));
  const drawWeekly = Object.fromEntries(drawResult.weeklyChallenges.challenges.map((item) => [item.id, item]));
  const lossWeekly = Object.fromEntries(lossResult.weeklyChallenges.challenges.map((item) => [item.id, item]));

  assert.equal(winDaily.daily_win_1_match.progress, 1);
  assert.equal(winDaily.daily_play_5_matches.progress, 1);
  assert.equal(winDaily.daily_win_1_war.progress, 1);
  assert.equal(winDaily.daily_use_all_4_elements.progress, 1);
  assert.equal(winWeekly.weekly_win_streak_3.progress, 1);

  assert.equal(drawDaily.daily_win_1_match.progress, 0);
  assert.equal(drawDaily.daily_play_5_matches.progress, 1);
  assert.equal(drawWeekly.weekly_win_streak_3.progress, 0);
  assert.equal((await state.profiles.getProfile("OnlineDrawOutcomeUser")).winStreak, 0);

  assert.equal(lossDaily.daily_win_1_match.progress, 0);
  assert.equal(lossDaily.daily_play_5_matches.progress, 1);
  assert.equal(lossWeekly.weekly_win_streak_3.progress, 0);
  assert.equal((await state.profiles.getProfile("OnlineLossOutcomeUser")).winStreak, 0);
});

test("state: online_pvp winner loser and draw can unlock valid shared achievements and persist them to the profile", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const winnerResult = await state.recordOnlineMatchResult({
    username: "OnlineAchievementWinner",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "p1",
      endReason: "hand_exhaustion",
      mode: "online_pvp",
      round: 2,
      history: [
        { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
        { result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 }
      ],
      players: {
        p1: { hand: ["fire", "water", "earth", "wind"] },
        p2: { hand: [] }
      },
      meta: {
        totalCards: 4,
        startedAt: "2026-03-20T00:00:00.000Z",
        endedAt: "2026-03-20T00:01:40.000Z",
        durationMs: 100000
      }
    },
    settlementKey: "ACH:winner:1:OnlineAchievementWinner"
  });

  const loserResult = await state.recordOnlineMatchResult({
    username: "OnlineAchievementLoser",
    perspective: "p2",
    matchState: {
      status: "completed",
      winner: "p1",
      endReason: "hand_exhaustion",
      mode: "online_pvp",
      round: 4,
      history: [
        { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 }
      ],
      players: {
        p1: { hand: [] },
        p2: { hand: ["fire", "fire", "fire", "fire"] }
      },
      meta: {
        totalCards: 4
      }
    },
    settlementKey: "ACH:loser:1:OnlineAchievementLoser"
  });

  const drawResult = await state.recordOnlineMatchResult({
    username: "OnlineAchievementDraw",
    perspective: "p1",
    matchState: {
      status: "completed",
      winner: "draw",
      endReason: "hand_exhaustion",
      mode: "online_pvp",
      round: 6,
      history: [
        { result: "none", p1Card: "fire", p2Card: "fire", warClashes: 5, capturedOpponentCards: 0 }
      ],
      players: {
        p1: { hand: [] },
        p2: { hand: [] }
      },
      meta: {
        totalCards: 16
      }
    },
    settlementKey: "ACH:draw:1:OnlineAchievementDraw"
  });

  const winnerProfile = await state.profiles.getProfile("OnlineAchievementWinner");
  const loserProfile = await state.profiles.getProfile("OnlineAchievementLoser");
  const drawProfile = await state.profiles.getProfile("OnlineAchievementDraw");
  const winnerCatalog = await state.getAchievements("OnlineAchievementWinner");

  assert.ok(winnerResult.unlockedAchievements.some((item) => item.id === "first_flame"));
  assert.ok(winnerResult.unlockedAchievements.some((item) => item.id === "quick_draw"));
  assert.equal(winnerProfile.achievements.first_flame.count, 1);
  assert.equal(winnerProfile.achievements.quick_draw.count, 1);
  assert.ok(winnerCatalog.achievements.some((item) => item.id === "first_flame" && item.unlocked));

  assert.ok(loserResult.unlockedAchievements.some((item) => item.id === "card_hoarder"));
  assert.equal(loserProfile.achievements.card_hoarder.count, 1);

  assert.ok(drawResult.unlockedAchievements.some((item) => item.id === "longest_war_5"));
  assert.equal(drawProfile.achievements.longest_war_5.count, 1);
});

test("state: online_pvp duplicate settlement stays idempotent while rematch settlements can unlock repeatable achievements again", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const quickDrawMatch = {
    status: "completed",
    winner: "p1",
    endReason: "hand_exhaustion",
    mode: "online_pvp",
    round: 2,
    history: [
      { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
      { result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 }
    ],
    players: {
      p1: { hand: ["fire", "water", "earth", "wind"] },
      p2: { hand: [] }
    },
    meta: {
      totalCards: 4,
      startedAt: "2026-03-20T00:00:00.000Z",
      endedAt: "2026-03-20T00:01:40.000Z",
      durationMs: 100000
    }
  };

  const first = await state.recordOnlineMatchResult({
    username: "OnlineRepeatableAchievementUser",
    perspective: "p1",
    matchState: quickDrawMatch,
    settlementKey: "REMATCH:1:OnlineRepeatableAchievementUser"
  });
  const duplicate = await state.recordOnlineMatchResult({
    username: "OnlineRepeatableAchievementUser",
    perspective: "p1",
    matchState: quickDrawMatch,
    settlementKey: "REMATCH:1:OnlineRepeatableAchievementUser"
  });
  const second = await state.recordOnlineMatchResult({
    username: "OnlineRepeatableAchievementUser",
    perspective: "p1",
    matchState: quickDrawMatch,
    settlementKey: "REMATCH:2:OnlineRepeatableAchievementUser"
  });

  const profile = await state.profiles.getProfile("OnlineRepeatableAchievementUser");
  const saves = await state.saves.listMatchResults();

  assert.equal(first.duplicate ?? false, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(second.duplicate, false);
  assert.equal(profile.achievements.quick_draw.count, 2);
  assert.equal(profile.achievements.quickdraw_master.count, 2);
  assert.equal(
    saves.filter(
      (entry) => entry.mode === "online_pvp" && entry.username === "OnlineRepeatableAchievementUser"
    ).length,
    2
  );
});

test("state: cosmetic randomization preferences persist through save/load", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const updated = await state.updateCosmeticPreferences({
    username: "BackgroundToggleUser",
    patch: {
      randomizeAfterEachMatch: {
        avatar: true,
        title: true,
        background: true
      }
    }
  });

  assert.equal(updated.profile.randomizeBackgroundEachMatch, true);
  assert.equal(updated.cosmetics.preferences.randomizeBackgroundEachMatch, true);
  assert.equal(updated.profile.cosmeticRandomizeAfterMatch.avatar, true);
  assert.equal(updated.profile.cosmeticRandomizeAfterMatch.title, true);
  assert.equal(updated.profile.cosmeticRandomizeAfterMatch.background, true);
  assert.equal(updated.cosmetics.preferences.randomizeAfterEachMatch.avatar, true);
  assert.equal(updated.cosmetics.preferences.randomizeAfterEachMatch.title, true);
  assert.equal(updated.cosmetics.preferences.randomizeAfterEachMatch.background, true);

  const reloadedProfile = await state.profiles.getProfile("BackgroundToggleUser");
  const cosmetics = await state.getCosmetics("BackgroundToggleUser");

  assert.equal(reloadedProfile.randomizeBackgroundEachMatch, true);
  assert.equal(cosmetics.preferences.randomizeBackgroundEachMatch, true);
  assert.equal(reloadedProfile.cosmeticRandomizeAfterMatch.avatar, true);
  assert.equal(reloadedProfile.cosmeticRandomizeAfterMatch.title, true);
  assert.equal(reloadedProfile.cosmeticRandomizeAfterMatch.background, true);
  assert.equal(cosmetics.preferences.randomizeAfterEachMatch.avatar, true);
  assert.equal(cosmetics.preferences.randomizeAfterEachMatch.title, true);
  assert.equal(cosmetics.preferences.randomizeAfterEachMatch.background, true);
});

test("state: randomizeOwnedCosmetics uses owned pools only and leaves unchecked categories unchanged", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const originalRandom = Math.random;

  await state.profiles.updateProfile("RandomizerUser", (current) => ({
    ...current,
    ownedCosmetics: {
      ...current.ownedCosmetics,
      avatar: ["default_avatar", "fire_avatar_f"],
      background: ["default_background", "fire_background"],
      badge: ["none"],
      title: ["Initiate", "title_apprentice"],
      cardBack: ["default_card_back", "cardback_frozen_sigil"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card",
        "fire_variant_ember",
        "water_variant_crystal"
      ]
    },
    equippedCosmetics: {
      ...current.equippedCosmetics,
      avatar: "default_avatar",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  }));

  Math.random = constantRandom(0);

  try {
    const result = await state.randomizeOwnedCosmetics({
      username: "RandomizerUser",
      categories: ["avatar", "background", "elementCardVariant", "badge"]
    });

    assert.equal(result.profile.equippedCosmetics.avatar, "fire_avatar_f");
    assert.equal(result.profile.equippedCosmetics.background, "fire_background");
    assert.equal(result.profile.equippedCosmetics.badge, "none");
    assert.equal(result.profile.equippedCosmetics.title, "Initiate");
    assert.equal(result.profile.equippedCosmetics.elementCardVariant.fire, "fire_variant_ember");
    assert.equal(result.profile.equippedCosmetics.elementCardVariant.water, "water_variant_crystal");
    assert.equal(result.profile.equippedCosmetics.elementCardVariant.earth, "default_earth_card");
    assert.equal(result.profile.equippedCosmetics.elementCardVariant.wind, "default_wind_card");
    assert.equal(result.cosmetics.preferences.randomizeAfterEachMatch.background, false);
  } finally {
    Math.random = originalRandom;
  }
});

test("state: cosmetic loadouts unlock only at configured levels and start locked below level 10", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();
  const xpForLevel = (level) => thresholds[level - 1] ?? thresholds.at(-1);

  let cosmetics = await state.getCosmetics("LoadoutThresholdUser");
  assert.equal(cosmetics.loadouts.filter((slot) => slot.unlocked).length, 0);

  await state.profiles.updateProfile("LoadoutThresholdUser", (current) => ({
    ...current,
    playerXP: xpForLevel(10),
    playerLevel: 10
  }));
  cosmetics = await state.getCosmetics("LoadoutThresholdUser");
  assert.equal(cosmetics.loadouts.filter((slot) => slot.unlocked).length, 1);

  await state.profiles.updateProfile("LoadoutThresholdUser", (current) => ({
    ...current,
    playerXP: xpForLevel(20),
    playerLevel: 20
  }));
  cosmetics = await state.getCosmetics("LoadoutThresholdUser");
  assert.equal(cosmetics.loadouts.filter((slot) => slot.unlocked).length, 2);

  await state.profiles.updateProfile("LoadoutThresholdUser", (current) => ({
    ...current,
    playerXP: xpForLevel(40),
    playerLevel: 40
  }));
  cosmetics = await state.getCosmetics("LoadoutThresholdUser");
  assert.equal(cosmetics.loadouts.filter((slot) => slot.unlocked).length, 3);

  await state.profiles.updateProfile("LoadoutThresholdUser", (current) => ({
    ...current,
    playerXP: xpForLevel(60),
    playerLevel: 60
  }));
  cosmetics = await state.getCosmetics("LoadoutThresholdUser");
  assert.equal(cosmetics.loadouts.filter((slot) => slot.unlocked).length, 4);
});

test("state: loadout unlock notices trigger once per newly unlocked slot", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  await state.profiles.updateProfile("LoadoutNoticeUser", (current) => ({
    ...current,
    playerXP: thresholds[19],
    playerLevel: 20
  }));

  const first = await state.acknowledgeLoadoutUnlocks("LoadoutNoticeUser");
  assert.deepEqual(first.newlyUnlockedSlots, [1, 2]);
  assert.equal(first.nextUnlockLevel, 40);

  const second = await state.acknowledgeLoadoutUnlocks("LoadoutNoticeUser");
  assert.deepEqual(second.newlyUnlockedSlots, []);
  assert.equal(second.nextUnlockLevel, 40);

  const persisted = await state.profiles.getProfile("LoadoutNoticeUser");
  assert.deepEqual(persisted.acknowledgedLoadoutUnlockSlots, { 1: true, 2: true });
});

test("state: legacy profiles retroactively expose all earned loadout slots on load without requiring another level-up", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  await state.profiles.store.write([
    {
      username: "RetroLoadoutUser",
      playerXP: thresholds[44],
      playerLevel: 1,
      wins: 12,
      losses: 3,
      equippedCosmetics: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        badge: "none",
        title: "Initiate",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        }
      },
      ownedCosmetics: {
        avatar: ["default_avatar"],
        cardBack: ["default_card_back"],
        background: ["default_background"],
        elementCardVariant: [
          "default_fire_card",
          "default_water_card",
          "default_earth_card",
          "default_wind_card"
        ],
        badge: ["none"],
        title: ["Initiate"]
      }
    }
  ]);

  const profile = await state.profiles.getProfile("RetroLoadoutUser");
  const cosmetics = await state.getCosmetics("RetroLoadoutUser");
  const notice = await state.acknowledgeLoadoutUnlocks("RetroLoadoutUser");
  const repeatNotice = await state.acknowledgeLoadoutUnlocks("RetroLoadoutUser");

  assert.equal(profile.playerLevel, 45);
  assert.deepEqual(
    cosmetics.loadouts.map((slot) => slot.unlocked),
    [true, true, true, false]
  );
  assert.deepEqual(notice.newlyUnlockedSlots, [1, 2, 3]);
  assert.equal(notice.nextUnlockLevel, 60);
  assert.deepEqual(repeatNotice.newlyUnlockedSlots, []);
  assert.equal(repeatNotice.nextUnlockLevel, 60);
});

test("state: legacy loadout notice field migrates to a clear acknowledgedLoadoutUnlockSlots profile field", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  await state.profiles.store.write([
    {
      username: "LegacyNoticeMigrationUser",
      playerXP: thresholds[19],
      playerLevel: 1,
      loadoutUnlockNoticesSeen: { 1: true, 2: true }
    }
  ]);

  const profile = await state.profiles.getProfile("LegacyNoticeMigrationUser");
  const raw = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf8"));

  assert.deepEqual(profile.acknowledgedLoadoutUnlockSlots, { 1: true, 2: true });
  assert.equal("loadoutUnlockNoticesSeen" in profile, false);
  assert.deepEqual(raw[0].acknowledgedLoadoutUnlockSlots, { 1: true, 2: true });
  assert.equal("loadoutUnlockNoticesSeen" in raw[0], false);
});

test("state: manually clearing acknowledgedLoadoutUnlockSlots makes the loadout popup eligible again without deleting the profile", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  await state.profiles.store.write([
    {
      username: "ManualResetLoadoutUser",
      playerXP: thresholds[39],
      playerLevel: 1,
      acknowledgedLoadoutUnlockSlots: { 1: true, 2: true, 3: true }
    }
  ]);

  const before = await state.acknowledgeLoadoutUnlocks("ManualResetLoadoutUser");
  assert.deepEqual(before.newlyUnlockedSlots, []);

  await state.profiles.store.write([
    {
      ...(await state.profiles.getProfile("ManualResetLoadoutUser")),
      acknowledgedLoadoutUnlockSlots: {}
    }
  ]);

  const afterReset = await state.acknowledgeLoadoutUnlocks("ManualResetLoadoutUser");
  assert.deepEqual(afterReset.newlyUnlockedSlots, [1, 2, 3]);
  assert.equal(afterReset.nextUnlockLevel, 60);
});

test("state: cosmetic loadouts save rename and apply equipped cosmetics with per-element variants", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  await state.profiles.updateProfile("LoadoutApplyUser", (current) => ({
    ...current,
    playerXP: thresholds[19],
    playerLevel: 20,
    ownedCosmetics: {
      ...current.ownedCosmetics,
      avatar: [...new Set([...(current.ownedCosmetics?.avatar ?? []), "fire_avatar_f"])],
      badge: [...new Set([...(current.ownedCosmetics?.badge ?? []), "war_machine_badge"])],
      title: [...new Set([...(current.ownedCosmetics?.title ?? []), "title_apprentice"])],
      background: [...new Set([...(current.ownedCosmetics?.background ?? []), "lava_throne_background"])],
      cardBack: [...new Set([...(current.ownedCosmetics?.cardBack ?? []), "founder_deluxe_card_back"])],
      elementCardVariant: [
        ...new Set([
          ...(current.ownedCosmetics?.elementCardVariant ?? []),
          "fire_variant_ember",
          "water_variant_crystal",
          "earth_variant_titan",
          "wind_variant_sky_serpent"
        ])
      ]
    },
    equippedCosmetics: {
      ...current.equippedCosmetics,
      avatar: "fire_avatar_f",
      badge: "war_machine_badge",
      title: "title_apprentice",
      background: "lava_throne_background",
      cardBack: "founder_deluxe_card_back",
      elementCardVariant: {
        fire: "fire_variant_ember",
        water: "water_variant_crystal",
        earth: "earth_variant_titan",
        wind: "wind_variant_sky_serpent"
      }
    }
  }));

  await state.renameCosmeticLoadout({
    username: "LoadoutApplyUser",
    slotIndex: 0,
    name: "Arena Main"
  });
  const saved = await state.saveCosmeticLoadout({
    username: "LoadoutApplyUser",
    slotIndex: 0
  });

  assert.equal(saved.cosmetics.loadouts[0].name, "Arena Main");
  assert.equal(saved.cosmetics.loadouts[0].hasSavedLoadout, true);

  await state.equipCosmetic({
    username: "LoadoutApplyUser",
    type: "background",
    cosmeticId: "default_background"
  });
  await state.equipCosmetic({
    username: "LoadoutApplyUser",
    type: "avatar",
    cosmeticId: "default_avatar"
  });

  const applied = await state.applyCosmeticLoadout({
    username: "LoadoutApplyUser",
    slotIndex: 0
  });

  assert.equal(applied.profile.equippedCosmetics.avatar, "fire_avatar_f");
  assert.equal(applied.profile.equippedCosmetics.background, "lava_throne_background");
  assert.equal(applied.profile.equippedCosmetics.cardBack, "founder_deluxe_card_back");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.fire, "fire_variant_ember");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.water, "water_variant_crystal");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.earth, "earth_variant_titan");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.wind, "wind_variant_sky_serpent");
});

test("state: cosmetic loadouts fall back safely when saved cosmetics are invalid or no longer owned", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  await state.profiles.updateProfile("LoadoutFallbackUser", (current) => ({
    ...current,
    playerXP: thresholds[9],
    playerLevel: 10,
    cosmeticLoadouts: [
      {
        name: "Broken Slot",
        cosmetics: {
          avatar: "missing_avatar",
          title: "missing_title",
          badge: "missing_badge",
          background: "missing_background",
          cardBack: "missing_card_back",
          elementCardVariant: {
            fire: "missing_fire_variant",
            water: "missing_water_variant",
            earth: "missing_earth_variant",
            wind: "missing_wind_variant"
          }
        }
      },
      ...(current.cosmeticLoadouts ?? []).slice(1)
    ]
  }));

  const applied = await state.applyCosmeticLoadout({
    username: "LoadoutFallbackUser",
    slotIndex: 0
  });

  assert.equal(applied.profile.equippedCosmetics.avatar, "default_avatar");
  assert.equal(applied.profile.equippedCosmetics.background, "default_background");
  assert.equal(applied.profile.equippedCosmetics.cardBack, "default_card_back");
  assert.equal(applied.profile.equippedCosmetics.badge, "none");
  assert.equal(applied.profile.equippedCosmetics.title, "Initiate");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.fire, "default_fire_card");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.water, "default_water_card");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.earth, "default_earth_card");
  assert.equal(applied.profile.equippedCosmetics.elementCardVariant.wind, "default_wind_card");
});

test("state: local_pvp grants and persists XP/tokens/achievements for both players", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "local_pvp" }),
    status: "completed",
    winner: "p2",
    round: 1,
    endReason: null,
    history: [
      {
        round: 1,
        result: "p2",
        p1Card: "fire",
        p2Card: "water",
        warClashes: 1,
        capturedCards: 2
      }
    ]
  };

  const p1Result = await state.recordMatchResult({
    username: "PvpP1",
    perspective: "p1",
    matchState: match
  });
  const p2Result = await state.recordMatchResult({
    username: "PvpP2",
    perspective: "p2",
    matchState: match
  });

  assert.ok(p1Result.xpDelta >= 1);
  assert.ok(p2Result.xpDelta >= 1);
  assert.ok((p1Result.profile.tokens ?? 0) >= 200);
  assert.ok((p2Result.profile.tokens ?? 0) >= 200);
  assert.ok(p2Result.unlockedAchievements.some((item) => item.id === "first_flame"));

  const restarted = new StateCoordinator({ dataDir });
  const p1Reloaded = await restarted.profiles.getProfile("PvpP1");
  const p2Reloaded = await restarted.profiles.getProfile("PvpP2");

  assert.equal(p1Reloaded.playerXP, p1Result.profile.playerXP);
  assert.equal(p2Reloaded.playerXP, p2Result.profile.playerXP);
  assert.equal(p1Reloaded.tokens, p1Result.profile.tokens);
  assert.equal(p2Reloaded.tokens, p2Result.profile.tokens);
  assert.equal(p2Reloaded.achievements.first_flame.count, 1);
});

test("state: separates pve and local_pvp mode statistics", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const pveMatch = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 1,
    history: [
      {
        round: 1,
        result: "p1",
        warClashes: 0,
        capturedCards: 2
      }
    ]
  };

  const localMatch = {
    ...createMatch({ mode: "local_pvp" }),
    status: "completed",
    winner: "p1",
    round: 1,
    history: [
      {
        round: 1,
        result: "p1",
        warClashes: 1,
        capturedCards: 4
      }
    ]
  };

  await state.recordMatchResult({
    username: "ModeUser",
    perspective: "p1",
    matchState: pveMatch
  });

  await state.recordMatchResult({
    username: "ModeUser",
    perspective: "p1",
    matchState: localMatch
  });

  const profile = await state.profiles.getProfile("ModeUser");

  assert.ok(profile.modeStats);
  assert.equal(profile.modeStats.pve.wins, 1);
  assert.equal(profile.modeStats.pve.cardsCaptured, 1);

  assert.equal(profile.modeStats.local_pvp.wins, 1);
  assert.equal(profile.modeStats.local_pvp.cardsCaptured, 2);
  assert.equal(profile.modeStats.local_pvp.warsEntered, 1);

  assert.equal(profile.wins, 2);
  assert.equal(profile.cardsCaptured, 3);
});

test("state: profile search can find local usernames", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.ensureProfile("SearchAlpha");
  await state.profiles.ensureProfile("SearchBeta");

  const allProfiles = await state.profiles.listProfiles();
  const filtered = allProfiles.filter((profile) => profile.username.toLowerCase().includes("search"));

  assert.equal(filtered.length, 2);
  assert.ok(filtered.some((profile) => profile.username === "SearchAlpha"));
  assert.ok(filtered.some((profile) => profile.username === "SearchBeta"));
});

test("state: tracks new profile stats used by achievements", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const timeLimitMatch = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    endReason: "time_limit",
    round: 3,
    history: [
      {
        round: 1,
        result: "p1",
        warClashes: 0,
        capturedCards: 2
      }
    ]
  };

  await state.recordMatchResult({
    username: "StatsUser",
    perspective: "p1",
    matchState: timeLimitMatch
  });

  const profile = await state.profiles.getProfile("StatsUser");

  assert.equal(profile.gamesPlayed, 1);
  assert.equal(profile.quickWins, 1);
  assert.equal(profile.timeLimitWins, 1);
  assert.equal(profile.modeStats.pve.gamesPlayed, 1);
  assert.equal(profile.modeStats.pve.quickWins, 1);
  assert.equal(profile.modeStats.pve.timeLimitWins, 1);
  assert.equal(profile.matchesUsingAllElements, 0);
});

test("state: normalizes approved achievement expansion stat fields safely", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const profile = await state.profiles.ensureProfile("ExpansionFieldsUser");

  assert.equal(profile.matchesUsingAllElements, 0);
  assert.equal(profile.modeStats.pve.wins, 0);
  assert.equal(profile.modeStats.local_pvp.wins, 0);
});

test("state: completed matches using all four elements increment matchesUsingAllElements", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 4,
    history: [
      { round: 1, result: "p1", p1Card: "fire", p2Card: "wind", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, result: "none", p1Card: "earth", p2Card: "fire", warClashes: 0, capturedCards: 0, capturedOpponentCards: 0 },
      { round: 4, result: "p1", p1Card: "wind", p2Card: "water", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 }
    ]
  };

  await state.recordMatchResult({
    username: "AllElementsUser",
    perspective: "p1",
    matchState: match
  });

  const profile = await state.profiles.getProfile("AllElementsUser");
  assert.equal(profile.matchesUsingAllElements, 1);
});

test("state: approved achievement rewards grant tokens and titles on live unlock", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("RewardUser", (current) => ({
    ...current,
    longestWar: 6,
    achievements: {
      ...current.achievements,
      comeback_win: { count: 4 }
    }
  }));

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 7,
    history: [
      { round: 1, result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 7, capturedCards: 8, capturedOpponentCards: 4 }
    ],
    meta: {
      totalCards: 16,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:04:00.000Z",
      durationMs: 240000,
      minHandSizes: { p1: 3, p2: 4 }
    },
    players: {
      p1: { hand: ["fire", "water", "earth", "wind"], wonRounds: 0 },
      p2: { hand: [], wonRounds: 0 }
    }
  };

  const before = await state.profiles.getProfile("RewardUser");
  const result = await state.recordMatchResult({
    username: "RewardUser",
    perspective: "p1",
    matchState: match
  });

  assert.ok(result.unlockedAchievements.some((item) => item.id === "longest_war_7"));
  assert.ok(result.unlockedAchievements.some((item) => item.id === "comeback_win_5"));
  assert.ok(result.profile.ownedCosmetics.title.includes("Storm Breaker"));
  assert.equal(result.profile.achievements.comeback_win_5.count, 1);
  assert.equal(result.profile.achievements.longest_war_7.count, 1);
  assert.ok(result.profile.tokens >= before.tokens + 5);
});

test("state: retroactive approved achievement grants are idempotent and only use provable saved data", async () => {
  const dataDir = await createTempDataDir();
  const profilesPath = path.join(dataDir, "profiles.json");

  await fs.writeFile(
    profilesPath,
    JSON.stringify(
      [
        {
          username: "RetroUser",
          title: "Initiate",
          wins: 40,
          losses: 5,
          gamesPlayed: 60,
          warsEntered: 30,
          warsWon: 12,
          longestWar: 7,
          cardsCaptured: 80,
          playerXP: 100,
          playerLevel: 1,
          tokens: 200,
          achievements: {
            comeback_win: { count: 25 }
          },
          modeStats: {
            pve: { wins: 25, losses: 5, gamesPlayed: 30, warsEntered: 10, warsWon: 5, longestWar: 4, cardsCaptured: 30, quickWins: 0, timeLimitWins: 0 },
            local_pvp: { wins: 25, losses: 10, gamesPlayed: 30, warsEntered: 20, warsWon: 7, longestWar: 7, cardsCaptured: 50, quickWins: 0, timeLimitWins: 0 }
          }
        }
      ],
      null,
      2
    )
  );

  const first = new StateCoordinator({ dataDir });
  const profileAfterFirstLoad = await first.profiles.getProfile("RetroUser");

  assert.equal(profileAfterFirstLoad.achievements.longest_war_5.count, 1);
  assert.equal(profileAfterFirstLoad.achievements.longest_war_7.count, 1);
  assert.equal(profileAfterFirstLoad.achievements.comeback_win_5.count, 1);
  assert.equal(profileAfterFirstLoad.achievements.comeback_win_25.count, 1);
  assert.equal(profileAfterFirstLoad.achievements.local_pvp_wins_25.count, 1);
  assert.equal(profileAfterFirstLoad.achievements.pve_wins_25.count, 1);
  assert.equal(profileAfterFirstLoad.achievements.all_elements_25?.count ?? 0, 0);
  assert.ok(profileAfterFirstLoad.ownedCosmetics.title.includes("Storm Breaker"));
  assert.ok(profileAfterFirstLoad.ownedCosmetics.title.includes("Last Card Legend"));
  assert.equal(profileAfterFirstLoad.tokens, 215);

  const second = new StateCoordinator({ dataDir });
  const profileAfterSecondLoad = await second.profiles.getProfile("RetroUser");

  assert.equal(profileAfterSecondLoad.tokens, 215);
  assert.equal(profileAfterSecondLoad.achievements.longest_war_7.count, 1);
  assert.equal(profileAfterSecondLoad.achievements.comeback_win_25.count, 1);
});

test("state: persistence survives coordinator restart", async () => {
  const dataDir = await createTempDataDir();
  const first = new StateCoordinator({ dataDir });

  await first.profiles.ensureProfile("RestartUser");
  await first.buyStoreItem({ username: "RestartUser", type: "avatar", cosmeticId: "fireavatarF" });
  await first.equipCosmetic({ username: "RestartUser", type: "avatar", cosmeticId: "fireavatarF" });

  const completed = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 2,
    history: [{ round: 1, result: "p1", warClashes: 0, capturedCards: 2 }]
  };

  await first.recordMatchResult({ username: "RestartUser", perspective: "p1", matchState: completed });

  const second = new StateCoordinator({ dataDir });
  const profile = await second.profiles.getProfile("RestartUser");
  const store = await second.getStore("RestartUser");
  const profiles = await second.profiles.listProfiles();

  assert.equal(profile.username, "RestartUser");
  assert.ok(profile.tokens >= 0);
  assert.ok(profile.wins >= 1);
  assert.ok(profile.equippedCosmetics.avatar === "fireavatarF");
  assert.ok(profile.achievements && typeof profile.achievements === "object");
  assert.ok(store.catalog.avatar.some((item) => item.id === "fireavatarF" && item.owned));
  assert.ok(profiles.some((item) => item.username === "RestartUser"));
});

test("state: username-specific test token grants are not applied at runtime", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("VampyrLee", (current) => ({
    ...current,
    chests: {
      ...(current.chests ?? {}),
      milestone: 3
    }
  }));
  const profile = await state.profiles.ensureProfile("VampyrLee");
  assert.equal(profile.tokens, 200);
  assert.equal(profile.testTokenGrantApplied, false);
  assert.equal(profile.chests?.milestone ?? 0, 3);

  const reloaded = new StateCoordinator({ dataDir });
  const profileAfterRestart = await reloaded.profiles.getProfile("VampyrLee");
  assert.equal(profileAfterRestart.tokens, 200);
  assert.equal(profileAfterRestart.testTokenGrantApplied, false);
  assert.equal(profileAfterRestart.chests?.milestone ?? 0, 3);
});

test("state: AliceEvermore token update persists correctly", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("AliceEvermore", (current) => ({
    ...current,
    chests: {
      ...(current.chests ?? {}),
      milestone: 3
    }
  }));
  const before = await state.profiles.ensureProfile("AliceEvermore");
  const updated = await state.profiles.updateProfile("AliceEvermore", {
    ...before,
    tokens: Math.max(0, Number(before.tokens ?? 0)) + 1000
  });

  const restarted = new StateCoordinator({ dataDir });
  const afterRestart = await restarted.profiles.getProfile("AliceEvermore");

  assert.equal(updated.tokens, (before.tokens ?? 0) + 1000);
  assert.equal(afterRestart.tokens, updated.tokens);
  assert.equal(afterRestart.wins, before.wins);
  assert.equal(afterRestart.playerXP, before.playerXP);
  assert.equal(afterRestart.chests?.milestone ?? 0, 3);
});

test("state: first login of day grants daily login reward once", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const nowMs = Date.parse("2026-03-09T15:00:00.000Z"); // 10 AM CT

  const first = await state.claimDailyLoginReward("LoginUser", nowMs);
  const second = await state.claimDailyLoginReward("LoginUser", nowMs + 1000);

  assert.equal(first.granted, true);
  assert.equal(first.rewardTokens, 5);
  assert.equal(first.rewardXp, 2);
  assert.equal(first.profile.tokens, 205);
  assert.equal(first.profile.playerXP, 2);
  assert.equal(second.granted, false);
  assert.equal(second.profile.tokens, 205);
  assert.equal(second.profile.playerXP, 2);
});

test("state: daily login reward grants again after the next 6 PM Central reset window", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const firstDayMs = Date.parse("2026-01-15T23:30:00.000Z"); // Jan 15, 5:30 PM CT
  const nextWindowMs = Date.parse("2026-01-16T00:30:00.000Z"); // Jan 15, 6:30 PM CT

  await state.claimDailyLoginReward("NextDayUser", firstDayMs);
  const nextDay = await state.claimDailyLoginReward("NextDayUser", nextWindowMs);

  assert.equal(nextDay.granted, true);
  assert.equal(nextDay.profile.tokens, 210);
  assert.equal(nextDay.profile.playerXP, 4);
  assert.ok(nextDay.profile.lastDailyLoginClaimDate);
});

test("state: daily login reward persists across reload", async () => {
  const dataDir = await createTempDataDir();
  const first = new StateCoordinator({ dataDir });
  const nowMs = Date.parse("2026-03-09T15:00:00.000Z");

  await first.claimDailyLoginReward("ReloadLoginUser", nowMs);

  const second = new StateCoordinator({ dataDir });
  const profile = await second.profiles.getProfile("ReloadLoginUser");
  const sameDay = await second.claimDailyLoginReward("ReloadLoginUser", nowMs + 60000);

  assert.equal(profile.tokens, 205);
  assert.equal(profile.playerXP, 2);
  assert.equal(sameDay.granted, false);
  assert.equal(sameDay.profile.tokens, 205);
  assert.equal(sameDay.profile.playerXP, 2);
});

test("state: daily login reward does not reset before 6 PM Central", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const beforeResetA = Date.parse("2026-01-15T21:00:00.000Z"); // 3 PM CT
  const beforeResetB = Date.parse("2026-01-15T23:30:00.000Z"); // 5:30 PM CT

  const first = await state.claimDailyLoginReward("BoundaryLoginUser", beforeResetA);
  const second = await state.claimDailyLoginReward("BoundaryLoginUser", beforeResetB);

  assert.equal(first.granted, true);
  assert.equal(second.granted, false);
  assert.equal(second.profile.tokens, 205);
  assert.equal(second.profile.playerXP, 2);
});

test("state: daily challenges payload includes daily login status from the shared 6 PM reset window", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const beforeReset = Date.parse("2026-01-15T23:30:00.000Z"); // Jan 15, 5:30 PM CT
  const afterReset = Date.parse("2026-01-16T00:30:00.000Z"); // Jan 15, 6:30 PM CT

  await state.claimDailyLoginReward("DailyStatusUser", beforeReset);
  const sameWindowStatus = await state.getDailyChallenges("DailyStatusUser", beforeReset);

  assert.equal(sameWindowStatus.dailyLogin.eligible, false);
  assert.ok(Number(sameWindowStatus.dailyLogin.msUntilReset) > 0);

  const profile = await state.profiles.getProfile("DailyStatusUser");
  await state.profiles.updateProfile("DailyStatusUser", {
    ...profile,
    lastDailyLoginClaimDate: new Date(beforeReset - 86400000).toISOString()
  });

  const nextWindowStatus = await state.getDailyChallenges("DailyStatusUser", afterReset);
  assert.equal(nextWindowStatus.dailyLogin.eligible, true);
  assert.equal(typeof nextWindowStatus.dailyLogin.nextResetAt, "string");
});

test("state: per-match captured cards never exceed total deck cards", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 12,
    history: Array.from({ length: 12 }, (_, i) => ({ round: i + 1, result: i % 2 === 0 ? "p1" : "p2", warClashes: 0, capturedCards: 4 }))
  };

  match.players.p1.hand = ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"];
  match.players.p2.hand = [];

  const recorded = await state.recordMatchResult({
    username: "CaptureCapUser",
    perspective: "p1",
    matchState: match
  });

  assert.equal(recorded.stats.cardsCaptured, 12);
});


test("state: daily challenges progress and rewards are granted once per day on completed non-quit matches", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 4,
    endReason: null,
    history: [
      { round: 1, result: "p1", p1Card: "fire", p2Card: "wind", warClashes: 1, capturedCards: 2 },
      { round: 2, result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedCards: 2 },
      { round: 3, result: "p1", p1Card: "earth", p2Card: "wind", warClashes: 0, capturedCards: 2 },
      { round: 4, result: "p1", p1Card: "wind", p2Card: "water", warClashes: 0, capturedCards: 2 }
    ]
  };

  match.players.p1.hand = ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"];
  match.players.p2.hand = [];

  const before = await state.getStore("DailyUser");
  const first = await state.recordMatchResult({ username: "DailyUser", perspective: "p1", matchState: match });
  const afterFirst = await state.getStore("DailyUser");

  const firstRewardIds = first.dailyRewards.map((item) => item.id);
  assert.ok(firstRewardIds.includes("daily_win_1_match"));
  assert.ok(firstRewardIds.includes("daily_win_1_war"));
  assert.ok(firstRewardIds.includes("daily_use_all_4_elements"));
  assert.ok(afterFirst.tokens > before.tokens);

  const second = await state.recordMatchResult({ username: "DailyUser", perspective: "p1", matchState: match });
  const afterSecond = await state.getStore("DailyUser");

  const secondRewardIds = second.dailyRewards.map((item) => item.id);
  assert.ok(!secondRewardIds.includes("daily_win_1_match"));
  assert.ok(!secondRewardIds.includes("daily_win_1_war"));
  assert.ok(!secondRewardIds.includes("daily_use_all_4_elements"));
  assert.ok(afterSecond.tokens >= afterFirst.tokens);
});

test("state: completing all daily challenges grants 1 basic chest once per daily reset window", async () => {
  const dataDir = await createTempDataDir();
  const nowMs = Date.now();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.5)
  });

  const seededChallenges = withSelectedBonusChallenges(createDefaultDailyChallenges(nowMs), {
    daily: ["daily_hard_ai_win_1", "daily_no_quit_3", "daily_win_with_fire"]
  });
  seededChallenges.daily.progress = {
    ...seededChallenges.daily.progress,
    matchesPlayed: 4,
    matchesWon: 1,
    warsWon: 1,
    cardsCaptured: 23,
    usedAllElementsInMatch: 0,
    completedNoQuitMatch: 2
  };

  await state.profiles.updateProfile("DailyChestUser", (current) => ({
    ...current,
    dailyChallenges: seededChallenges
  }));

  const first = await state.recordMatchResult({
    username: "DailyChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });
  const second = await state.recordMatchResult({
    username: "DailyChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(first.profile.chests.basic, 1);
  assert.equal(first.profile.dailyChallenges.daily.completionChestGranted, true);
  assert.equal(second.profile.chests.basic, 1);
  assert.equal(second.profile.dailyChallenges.daily.completionChestGranted, true);
});

test("state: completing all weekly challenges grants 1 epic chest once per weekly reset window", async () => {
  const dataDir = await createTempDataDir();
  const nowMs = Date.now();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.5)
  });

  const seededChallenges = withSelectedBonusChallenges(createDefaultDailyChallenges(nowMs), {
    weekly: ["weekly_hard_ai_wins_5", "weekly_no_quit_10", "weekly_element_master_fire"]
  });
  seededChallenges.weekly.progress = {
    ...seededChallenges.weekly.progress,
    matchesPlayed: 14,
    matchesWon: 9,
    warsWon: 8,
    cardsCaptured: 63,
    usedAllElementsInMatch: 4,
    reachedWinStreak3: 0,
    survivedLongestWar5: 0,
    wonHardPveMatch: 4,
    completedNoQuitMatch: 9,
    wonRoundWithFire: 4
  };

  await state.profiles.updateProfile("WeeklyChestUser", (current) => ({
    ...current,
    winStreak: 3,
    dailyChallenges: seededChallenges
  }));

  const first = await state.recordMatchResult({
    username: "WeeklyChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });
  const second = await state.recordMatchResult({
    username: "WeeklyChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(first.profile.chests.basic, 0);
  assert.equal(first.profile.chests.epic, 1);
  assert.equal(first.profile.dailyChallenges.weekly.completionChestGranted, true);
  assert.equal(second.profile.chests.basic, 0);
  assert.equal(second.profile.chests.epic, 1);
  assert.equal(second.profile.dailyChallenges.weekly.completionChestGranted, true);
});

test("state: match win chest chance can grant one basic chest", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.05)
  });

  const result = await state.recordMatchResult({
    username: "WinChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1" })
  });

  assert.equal(result.profile.chests.basic, 1);
});

test("state: match loss chest chance can grant one basic chest", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.01)
  });

  const result = await state.recordMatchResult({
    username: "LossChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p2" })
  });

  assert.equal(result.profile.chests.basic, 1);
});

test("state: match draw chest chance can grant one basic chest", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.01)
  });

  const result = await state.recordMatchResult({
    username: "DrawChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "draw" })
  });

  assert.equal(result.profile.chests.basic, 1);
});

test("state: easy PvE disables chest drops for all outcomes", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.0)
  });

  const winResult = await state.recordMatchResult({
    username: "EasyChestWinUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "easy" })
  });
  const lossResult = await state.recordMatchResult({
    username: "EasyChestLossUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p2", difficulty: "easy" })
  });
  const drawResult = await state.recordMatchResult({
    username: "EasyChestDrawUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "draw", difficulty: "easy" })
  });

  assert.equal(winResult.profile.chests.basic, 0);
  assert.equal(lossResult.profile.chests.basic, 0);
  assert.equal(drawResult.profile.chests.basic, 0);
});

test("state: hard PvE win grants +5 XP and +5 tokens over normal PvE", async () => {
  const normalDataDir = await createTempDataDir();
  const hardDataDir = await createTempDataDir();
  const normalState = new StateCoordinator({
    dataDir: normalDataDir,
    random: constantRandom(0.99)
  });
  const hardState = new StateCoordinator({
    dataDir: hardDataDir,
    random: constantRandom(0.99)
  });

  const normalResult = await normalState.recordMatchResult({
    username: "NormalRewardUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "normal" })
  });
  const hardResult = await hardState.recordMatchResult({
    username: "HardRewardUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(hardResult.matchTokenDelta, normalResult.matchTokenDelta + 5);
  assert.equal(hardResult.tokenDelta, normalResult.tokenDelta + 5);
  assert.equal(hardResult.xpDelta, normalResult.xpDelta + 5);
  assert.ok(hardResult.xpBreakdown.lines.some((line) => line.label === "Hard AI Victory Bonus" && line.amount === 5));
  assert.ok(normalResult.xpBreakdown.lines.every((line) => line.label !== "Hard AI Victory Bonus"));
});

test("state: hard PvE win has a slightly better basic chest chance than normal PvE", async () => {
  assert.equal(HARD_PVE_WIN_CHEST_DROP_CHANCE, 0.12);

  const normalDataDir = await createTempDataDir();
  const hardDataDir = await createTempDataDir();
  const normalState = new StateCoordinator({
    dataDir: normalDataDir,
    random: constantRandom(0.11)
  });
  const hardState = new StateCoordinator({
    dataDir: hardDataDir,
    random: constantRandom(0.11)
  });

  const normalResult = await normalState.recordMatchResult({
    username: "NormalChestChanceUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "normal" })
  });
  const hardResult = await hardState.recordMatchResult({
    username: "HardChestChanceUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(normalResult.profile.chests.basic, 0);
  assert.equal(hardResult.profile.chests.basic, 1);
});

test("state: hard PvE loss and draw do not receive the hard-mode win bonus", async () => {
  const normalLossDataDir = await createTempDataDir();
  const hardLossDataDir = await createTempDataDir();
  const normalDrawDataDir = await createTempDataDir();
  const hardDrawDataDir = await createTempDataDir();

  const normalLossState = new StateCoordinator({ dataDir: normalLossDataDir, random: constantRandom(0.99) });
  const hardLossState = new StateCoordinator({ dataDir: hardLossDataDir, random: constantRandom(0.99) });
  const normalDrawState = new StateCoordinator({ dataDir: normalDrawDataDir, random: constantRandom(0.99) });
  const hardDrawState = new StateCoordinator({ dataDir: hardDrawDataDir, random: constantRandom(0.99) });

  const normalLoss = await normalLossState.recordMatchResult({
    username: "NormalLossRewardUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p2", difficulty: "normal" })
  });
  const hardLoss = await hardLossState.recordMatchResult({
    username: "HardLossRewardUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p2", difficulty: "hard" })
  });
  const normalDraw = await normalDrawState.recordMatchResult({
    username: "NormalDrawRewardUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "draw", difficulty: "normal" })
  });
  const hardDraw = await hardDrawState.recordMatchResult({
    username: "HardDrawRewardUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "draw", difficulty: "hard" })
  });

  assert.equal(hardLoss.matchTokenDelta, normalLoss.matchTokenDelta);
  assert.equal(hardLoss.tokenDelta, normalLoss.tokenDelta);
  assert.equal(hardLoss.xpDelta, normalLoss.xpDelta);
  assert.equal(hardDraw.matchTokenDelta, normalDraw.matchTokenDelta);
  assert.equal(hardDraw.tokenDelta, normalDraw.tokenDelta);
  assert.equal(hardDraw.xpDelta, normalDraw.xpDelta);
  assert.ok(hardLoss.xpBreakdown.lines.every((line) => line.label !== "Hard AI Victory Bonus"));
  assert.ok(hardDraw.xpBreakdown.lines.every((line) => line.label !== "Hard AI Victory Bonus"));
});

test("state: Crownfire first win of the day grants the featured rival daily bonus once", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.99)
  });

  const first = await state.recordMatchResult({
    username: "CrownfireDailyWinner",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1" })
  });
  const second = await state.recordMatchResult({
    username: "CrownfireDailyWinner",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1" })
  });

  assert.equal(first.featuredRivalReward.granted, true);
  assert.equal(first.featuredRivalReward.xpDelta, 30);
  assert.equal(first.featuredRivalReward.tokenDelta, 15);
  assert.equal(
    first.profile.featuredRivalRewards.crownfire_duelist.lastDailyWinRewardDate,
    first.featuredRivalReward.rewardDateKey
  );
  assert.ok(first.xpBreakdown.lines.some((line) => line.label === "Crownfire First Win Bonus" && line.amount === 30));
  assert.equal(second.featuredRivalReward.granted, false);
  assert.equal(second.featuredRivalReward.xpDelta, 0);
  assert.equal(second.featuredRivalReward.tokenDelta, 0);
  assert.ok(second.xpBreakdown.lines.every((line) => line.label !== "Crownfire First Win Bonus"));
});

test("state: Crownfire loss and quit do not grant the featured rival daily bonus", async () => {
  const lossDataDir = await createTempDataDir();
  const quitDataDir = await createTempDataDir();
  const lossState = new StateCoordinator({ dataDir: lossDataDir, random: constantRandom(0.99) });
  const quitState = new StateCoordinator({ dataDir: quitDataDir, random: constantRandom(0.99) });

  const lossResult = await lossState.recordMatchResult({
    username: "CrownfireLossUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p2" })
  });
  const quitResult = await quitState.recordMatchResult({
    username: "CrownfireQuitUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p2", endReason: "quit_forfeit" })
  });

  assert.equal(lossResult.featuredRivalReward.granted, false);
  assert.equal(quitResult.featuredRivalReward.granted, false);
  assert.ok(lossResult.xpBreakdown.lines.every((line) => line.label !== "Crownfire First Win Bonus"));
  assert.ok(quitResult.xpBreakdown.lines.every((line) => line.label !== "Crownfire First Win Bonus"));
});

test("state: Crownfire reward lock survives reload and old profiles normalize safely", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.99)
  });

  const first = await state.recordMatchResult({
    username: "CrownfireReloadUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1" })
  });

  const reloadedState = new StateCoordinator({
    dataDir,
    random: constantRandom(0.99)
  });
  const second = await reloadedState.recordMatchResult({
    username: "CrownfireReloadUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1" })
  });
  const reloadedProfile = await reloadedState.profiles.getProfile("CrownfireReloadUser");

  assert.equal(first.featuredRivalReward.granted, true);
  assert.equal(second.featuredRivalReward.granted, false);
  assert.equal(
    reloadedProfile.featuredRivalRewards.crownfire_duelist.lastDailyWinRewardDate,
    first.featuredRivalReward.rewardDateKey
  );

  const legacyDataDir = await createTempDataDir();
  const legacyProfilesPath = path.join(legacyDataDir, "profiles.json");
  await fs.writeFile(
    legacyProfilesPath,
    JSON.stringify(
      [
        {
          username: "LegacyCrownfireUser",
          wins: 0,
          losses: 0,
          gamesPlayed: 0,
          tokens: 200,
          playerXP: 0,
          playerLevel: 1
        }
      ],
      null,
      2
    ),
    "utf8"
  );
  const legacyState = new StateCoordinator({ dataDir: legacyDataDir, random: constantRandom(0.99) });
  const legacyProfile = await legacyState.profiles.ensureProfile("LegacyCrownfireUser");
  assert.equal(legacyProfile.featuredRivalRewards.crownfire_duelist.lastDailyWinRewardDate, null);
});

test("state: normal PvE wins do not set the Crownfire daily reward lock", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.99)
  });

  const result = await state.recordMatchResult({
    username: "NormalPveNoCrownfireLock",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(result.featuredRivalReward.granted, false);
  assert.equal(result.profile.featuredRivalRewards.crownfire_duelist.lastDailyWinRewardDate, null);
  assert.ok(result.xpBreakdown.lines.every((line) => line.label !== "Crownfire First Win Bonus"));
});

test("boost events: Crownfire XP bonus stays fixed under an active PvE XP boost", async () => {
  const baselineDataDir = await createTempDataDir();
  const boostedDataDir = await createTempDataDir();

  await writeBoostEventConfig(boostedDataDir, {
    enabled: true,
    title: "Double Crownfire XP Weekend",
    message: "Boosted PvE XP.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "pve",
    excludeDifficulties: [],
    xpMultiplier: 2,
    tokenMultiplier: 1
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const boostedState = createBoostAwareStateCoordinator({ dataDir: boostedDataDir, random: constantRandom(0.99) });

  const baseline = await baselineState.recordMatchResult({
    username: "BaselineCrownfireXpBoostUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });
  const boosted = await boostedState.recordMatchResult({
    username: "BoostedCrownfireXpBoostUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(baseline.featuredRivalReward.granted, true);
  assert.equal(boosted.featuredRivalReward.granted, true);
  assert.equal(baseline.featuredRivalReward.xpDelta, 30);
  assert.equal(boosted.featuredRivalReward.xpDelta, 30);
  assert.equal(baseline.featuredRivalReward.tokenDelta, 15);
  assert.equal(boosted.featuredRivalReward.tokenDelta, 15);
  assert.equal(boosted.matchXpDelta, baseline.matchXpDelta * 2);
  assert.equal(boosted.matchTokenDelta, baseline.matchTokenDelta);
  assert.equal(boosted.challengeXpDelta, baseline.challengeXpDelta);
  assert.equal(boosted.challengeTokenDelta, baseline.challengeTokenDelta);
  assert.equal(boosted.xpDelta, boosted.matchXpDelta + boosted.challengeXpDelta + 30);
  assert.ok(
    boosted.xpBreakdown.lines.some((line) => line.label === "Crownfire First Win Bonus" && line.amount === 30)
  );
});

test("boost events: Crownfire token bonus stays fixed under an active PvE token boost", async () => {
  const baselineDataDir = await createTempDataDir();
  const boostedDataDir = await createTempDataDir();

  await writeBoostEventConfig(boostedDataDir, {
    enabled: true,
    title: "Double Crownfire Tokens Weekend",
    message: "Boosted PvE tokens.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "pve",
    excludeDifficulties: [],
    xpMultiplier: 1,
    tokenMultiplier: 2
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const boostedState = createBoostAwareStateCoordinator({ dataDir: boostedDataDir, random: constantRandom(0.99) });

  const baseline = await baselineState.recordMatchResult({
    username: "BaselineCrownfireTokenBoostUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });
  const boosted = await boostedState.recordMatchResult({
    username: "BoostedCrownfireTokenBoostUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(boosted.featuredRivalReward.granted, true);
  assert.equal(boosted.featuredRivalReward.xpDelta, 30);
  assert.equal(boosted.featuredRivalReward.tokenDelta, 15);
  assert.equal(boosted.matchXpDelta, baseline.matchXpDelta);
  assert.equal(boosted.matchTokenDelta, baseline.matchTokenDelta * 2);
  assert.equal(boosted.challengeXpDelta, baseline.challengeXpDelta);
  assert.equal(boosted.challengeTokenDelta, baseline.challengeTokenDelta);
  assert.equal(
    boosted.tokenDelta,
    boosted.matchTokenDelta + boosted.challengeTokenDelta + boosted.featuredRivalReward.tokenDelta
  );
});

test("boost events: all-scope boosts do not multiply the Crownfire first-win bonus", async () => {
  const baselineDataDir = await createTempDataDir();
  const boostedDataDir = await createTempDataDir();

  await writeBoostEventConfig(boostedDataDir, {
    enabled: true,
    title: "Everything Weekend",
    message: "All-mode reward boost.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "all",
    excludeDifficulties: [],
    xpMultiplier: 2,
    tokenMultiplier: 2
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const boostedState = createBoostAwareStateCoordinator({ dataDir: boostedDataDir, random: constantRandom(0.99) });

  const baseline = await baselineState.recordMatchResult({
    username: "BaselineCrownfireAllBoostUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });
  const boosted = await boostedState.recordMatchResult({
    username: "BoostedCrownfireAllBoostUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(boosted.featuredRivalReward.granted, true);
  assert.equal(boosted.featuredRivalReward.xpDelta, 30);
  assert.equal(boosted.featuredRivalReward.tokenDelta, 15);
  assert.equal(boosted.matchXpDelta, baseline.matchXpDelta * 2);
  assert.equal(boosted.matchTokenDelta, baseline.matchTokenDelta * 2);
  assert.equal(boosted.xpDelta, boosted.matchXpDelta + boosted.challengeXpDelta + 30);
  assert.equal(boosted.tokenDelta, boosted.matchTokenDelta + boosted.challengeTokenDelta + 15);
});

test("boost events: repeat Crownfire win does not regrant the daily bonus during an active boost", async () => {
  const dataDir = await createTempDataDir();

  await writeBoostEventConfig(dataDir, {
    enabled: true,
    title: "Boosted Crownfire Day",
    message: "PvE rewards are boosted today.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "pve",
    excludeDifficulties: [],
    xpMultiplier: 2,
    tokenMultiplier: 2
  });

  const state = createBoostAwareStateCoordinator({ dataDir, random: constantRandom(0.99) });

  const first = await state.recordMatchResult({
    username: "RepeatBoostedCrownfireUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });
  const second = await state.recordMatchResult({
    username: "RepeatBoostedCrownfireUser",
    perspective: "p1",
    matchState: createCrownfireRewardMatch({ winner: "p1", difficulty: "hard" })
  });

  assert.equal(first.featuredRivalReward.granted, true);
  assert.equal(first.featuredRivalReward.xpDelta, 30);
  assert.equal(first.featuredRivalReward.tokenDelta, 15);
  assert.equal(second.featuredRivalReward.granted, false);
  assert.equal(second.featuredRivalReward.xpDelta, 0);
  assert.equal(second.featuredRivalReward.tokenDelta, 0);
  assert.ok(second.xpBreakdown.lines.every((line) => line.label !== "Crownfire First Win Bonus"));
  assert.equal(second.matchXpDelta, first.matchXpDelta);
  assert.equal(second.matchTokenDelta, first.matchTokenDelta);
});

test("state: local_pvp draw chest chance can grant one basic chest", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: constantRandom(0.01)
  });

  const result = await state.recordMatchResult({
    username: "LocalDrawChestUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "draw", mode: "local_pvp" })
  });

  assert.equal(result.profile.chests.basic, 1);
});

test("boost events: no active boost leaves local PvE base rewards unchanged", async () => {
  const baselineDataDir = await createTempDataDir();
  const disabledDataDir = await createTempDataDir();

  await writeBoostEventConfig(disabledDataDir, {
    enabled: false,
    title: "Disabled Boost",
    message: "Should not apply.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "pve",
    excludeDifficulties: [],
    xpMultiplier: 2,
    tokenMultiplier: 2
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const disabledState = createBoostAwareStateCoordinator({ dataDir: disabledDataDir, random: constantRandom(0.99) });

  const baseline = await baselineState.recordMatchResult({
    username: "BaselineBoostUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "normal" })
  });
  const disabled = await disabledState.recordMatchResult({
    username: "DisabledBoostUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "normal" })
  });

  assert.equal(disabled.matchTokenDelta, baseline.matchTokenDelta);
  assert.equal(disabled.challengeTokenDelta, baseline.challengeTokenDelta);
  assert.equal(disabled.matchXpDelta, baseline.matchXpDelta);
  assert.equal(disabled.challengeXpDelta, baseline.challengeXpDelta);
  assert.equal(disabled.xpDelta, baseline.xpDelta);
});

test("boost events: PvE scope boosts local base match rewards without boosting challenge rewards", async () => {
  const baselineDataDir = await createTempDataDir();
  const boostedDataDir = await createTempDataDir();

  await writeBoostEventConfig(boostedDataDir, {
    enabled: true,
    title: "PvE Double Weekend",
    message: "Double match rewards in PvE.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "pve",
    excludeDifficulties: [],
    xpMultiplier: 2,
    tokenMultiplier: 2
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const boostedState = createBoostAwareStateCoordinator({ dataDir: boostedDataDir, random: constantRandom(0.99) });

  const baseline = await baselineState.recordMatchResult({
    username: "BaselinePveBoostUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "normal", mode: "pve" })
  });
  const boosted = await boostedState.recordMatchResult({
    username: "BoostedPveBoostUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", difficulty: "normal", mode: "pve" })
  });

  assert.equal(boosted.matchTokenDelta, baseline.matchTokenDelta * 2);
  assert.equal(boosted.challengeTokenDelta, baseline.challengeTokenDelta);
  assert.equal(boosted.matchXpDelta, baseline.matchXpDelta * 2);
  assert.equal(boosted.challengeXpDelta, baseline.challengeXpDelta);
  assert.equal(boosted.xpDelta, boosted.matchXpDelta + boosted.challengeXpDelta);
  assert.deepEqual(boosted.boostDisplay, {
    xpApplied: true,
    tokenApplied: true,
    xpMultiplier: 2,
    tokenMultiplier: 2
  });
  assert.ok(
    boosted.xpBreakdown.lines.some(
      (line) => line.label === "Boost Event Match XP Bonus" && line.amount === baseline.matchXpDelta
    )
  );
});

test("boost events: local_pvp scope boosts local PvP base rewards only", async () => {
  const baselineDataDir = await createTempDataDir();
  const boostedDataDir = await createTempDataDir();

  await writeBoostEventConfig(boostedDataDir, {
    enabled: true,
    title: "Local PvP Night",
    message: "Double local PvP rewards.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "local_pvp",
    excludeDifficulties: [],
    xpMultiplier: 1.5,
    tokenMultiplier: 2
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const boostedState = createBoostAwareStateCoordinator({ dataDir: boostedDataDir, random: constantRandom(0.99) });

  const baseline = await baselineState.recordMatchResult({
    username: "BaselineLocalBoostUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", mode: "local_pvp" })
  });
  const boosted = await boostedState.recordMatchResult({
    username: "BoostedLocalBoostUser",
    perspective: "p1",
    matchState: createRewardHookMatch({ winner: "p1", mode: "local_pvp" })
  });

  assert.equal(boosted.matchTokenDelta, baseline.matchTokenDelta * 2);
  assert.equal(boosted.challengeTokenDelta, baseline.challengeTokenDelta);
  assert.equal(boosted.matchXpDelta, Math.floor(baseline.matchXpDelta * 1.5));
  assert.equal(boosted.challengeXpDelta, baseline.challengeXpDelta);
});

test("boost events: local_pvp scope boosts both tracked local players using floor rounding", async () => {
  const baselineDataDir = await createTempDataDir();
  const boostedDataDir = await createTempDataDir();

  await writeBoostEventConfig(boostedDataDir, {
    enabled: true,
    title: "Local PvP Boost",
    message: "Boost local PvP base rewards.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "local_pvp",
    excludeDifficulties: [],
    xpMultiplier: 1.5,
    tokenMultiplier: 1.5
  });

  const baselineState = createBoostAwareStateCoordinator({ dataDir: baselineDataDir, random: constantRandom(0.99) });
  const boostedState = createBoostAwareStateCoordinator({ dataDir: boostedDataDir, random: constantRandom(0.99) });
  const winnerMatch = createRewardHookMatch({ winner: "p1", mode: "local_pvp" });

  const baselineWinner = await baselineState.recordMatchResult({
    username: "BaselineLocalWinner",
    perspective: "p1",
    matchState: winnerMatch
  });
  const baselineLoser = await baselineState.recordMatchResult({
    username: "BaselineLocalLoser",
    perspective: "p2",
    matchState: winnerMatch
  });
  const boostedWinner = await boostedState.recordMatchResult({
    username: "BoostedLocalWinner",
    perspective: "p1",
    matchState: winnerMatch
  });
  const boostedLoser = await boostedState.recordMatchResult({
    username: "BoostedLocalLoser",
    perspective: "p2",
    matchState: winnerMatch
  });

  assert.equal(boostedWinner.matchTokenDelta, Math.floor(baselineWinner.matchTokenDelta * 1.5));
  assert.equal(boostedWinner.matchXpDelta, Math.floor(baselineWinner.matchXpDelta * 1.5));
  assert.equal(boostedLoser.matchTokenDelta, Math.floor(baselineLoser.matchTokenDelta * 1.5));
  assert.equal(boostedLoser.matchXpDelta, Math.floor(baselineLoser.matchXpDelta * 1.5));
  assert.equal(boostedWinner.challengeTokenDelta, baselineWinner.challengeTokenDelta);
  assert.equal(boostedLoser.challengeTokenDelta, baselineLoser.challengeTokenDelta);
  assert.equal(boostedWinner.challengeXpDelta, baselineWinner.challengeXpDelta);
  assert.equal(boostedLoser.challengeXpDelta, baselineLoser.challengeXpDelta);
  assert.deepEqual(boostedWinner.boostDisplay, {
    xpApplied: true,
    tokenApplied: true,
    xpMultiplier: 1.5,
    tokenMultiplier: 1.5
  });
  assert.equal(boostedLoser.boostDisplay, null);
});

test("state: quit forfeits do not grant daily challenge progress", async () => {
  const dataDir = await createTempDataDir();
  const state = createBoostAwareStateCoordinator({ dataDir });

  const quitMatch = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p2",
    endReason: "quit_forfeit",
    round: 1,
    history: []
  };

  const before = await state.getDailyChallenges("QuitDailyUser");
  const result = await state.recordMatchResult({ username: "QuitDailyUser", perspective: "p1", matchState: quitMatch });
  const after = await state.getDailyChallenges("QuitDailyUser");

  assert.equal(result.dailyRewards.length, 0);
  assert.deepEqual(after.daily.challenges.map((item) => item.progress), before.daily.challenges.map((item) => item.progress));
});

test("state: local_pvp quit forfeit applies a loss to both players", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const quitMatch = {
    ...createMatch({ mode: "local_pvp" }),
    status: "completed",
    winner: "draw",
    endReason: "quit_forfeit",
    round: 1,
    history: []
  };

  await state.recordMatchResult({ username: "QuitP1", perspective: "p1", matchState: quitMatch });
  await state.recordMatchResult({ username: "QuitP2", perspective: "p2", matchState: quitMatch });

  const p1 = await state.profiles.getProfile("QuitP1");
  const p2 = await state.profiles.getProfile("QuitP2");

  assert.equal(p1.modeStats.local_pvp.losses, 1);
  assert.equal(p2.modeStats.local_pvp.losses, 1);
});

test("state: settlementKey keeps local authoritative match settlement idempotent", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const match = createRewardHookMatch({ winner: "p1", mode: "pve" });

  const first = await state.recordMatchResult({
    username: "AuthoritativePveUser",
    perspective: "p1",
    matchState: match,
    settlementKey: "PVE:authoritative:1"
  });
  const second = await state.recordMatchResult({
    username: "AuthoritativePveUser",
    perspective: "p1",
    matchState: match,
    settlementKey: "PVE:authoritative:1"
  });

  const profile = await state.profiles.getProfile("AuthoritativePveUser");
  const saves = await state.saves.listMatchResults();

  assert.equal(first.duplicate ?? false, false);
  assert.equal(second.duplicate, true);
  assert.equal(profile.gamesPlayed, 1);
  assert.equal(profile.wins, 1);
  assert.equal(
    saves.filter(
      (entry) =>
        entry.username === "AuthoritativePveUser" &&
        entry.mode === "pve" &&
        entry.settlementKey === "PVE:authoritative:1"
    ).length,
    1
  );
});

test("daily: before 6 PM America/Chicago does not reset same-boundary data", () => {
  const nowMs = Date.parse("2026-01-15T23:30:00.000Z"); // 5:30 PM CT
  const boundaryMs = Date.parse("2026-01-15T00:00:00.000Z"); // Jan 14 6 PM CT

  const profile = normalizeProfileDailyChallenges({
    username: "DailyBoundaryUser",
    tokens: 0,
    dailyChallenges: {
      dailyChallengeLastReset: new Date(boundaryMs).toISOString(),
      progress: {
        matchesPlayed: 2,
        matchesWon: 1,
        warsWon: 1,
        cardsCaptured: 6,
        usedAllElementsInMatch: 0
      },
      completed: {},
      rewarded: {}
    }
  }, nowMs);

  const view = getDailyChallengesView(profile, nowMs);
  const progressById = Object.fromEntries(
    view.view.daily.challenges.map((item) => [item.id, item.progress])
  );
  assert.equal(progressById.daily_win_1_match, 1);
  assert.equal(progressById.daily_win_2_matches, 1);
  assert.equal(progressById.daily_win_1_war, 1);
  assert.equal(progressById.daily_capture_16_cards, 6);
  assert.equal(progressById.daily_play_5_matches, 2);
  assert.equal(progressById.daily_use_all_4_elements, 0);
});

test("daily: after 6 PM America/Chicago resets challenge progress", () => {
  const nowMs = Date.parse("2026-01-16T00:30:00.000Z"); // 6:30 PM CT
  const staleBoundaryMs = Date.parse("2026-01-15T00:00:00.000Z"); // previous reset boundary

  const profile = normalizeProfileDailyChallenges({
    username: "DailyBoundaryResetUser",
    tokens: 0,
    dailyChallenges: {
      dailyChallengeLastReset: new Date(staleBoundaryMs).toISOString(),
      progress: {
        matchesPlayed: 3,
        matchesWon: 1,
        warsWon: 1,
        cardsCaptured: 10,
        usedAllElementsInMatch: 1
      },
      completed: {
        daily_win_1_match: true
      },
      rewarded: {
        daily_win_1_match: true
      }
    }
  }, nowMs);

  const view = getDailyChallengesView(profile, nowMs);
  assert.ok(view.view.daily.challenges.every((item) => item.progress === 0));
});

test("daily: multiple reads after reset boundary do not reset repeatedly", () => {
  const nowMs = Date.parse("2026-01-16T00:30:00.000Z"); // 6:30 PM CT
  const currentBoundaryMs = Date.parse("2026-01-16T00:00:00.000Z"); // Jan 15 6 PM CT

  const profile = normalizeProfileDailyChallenges({
    username: "DailyNoRepeatResetUser",
    tokens: 0,
    dailyChallenges: {
      dailyChallengeLastReset: new Date(currentBoundaryMs).toISOString(),
      progress: {
        matchesPlayed: 1,
        matchesWon: 1,
        warsWon: 0,
        cardsCaptured: 2,
        usedAllElementsInMatch: 0
      },
      completed: {
        daily_win_1_match: true
      },
      rewarded: {
        daily_win_1_match: true
      }
    }
  }, nowMs);

  const once = normalizeProfileDailyChallenges(profile, nowMs);
  const twice = normalizeProfileDailyChallenges(once, nowMs);
  assert.deepEqual(once.dailyChallenges.progress, twice.dailyChallenges.progress);
  assert.equal(
    once.dailyChallenges.dailyChallengeLastReset,
    twice.dailyChallenges.dailyChallengeLastReset
  );
});
test("daily: countdown targets next 6 PM America/Chicago boundary", () => {
  const nowMs = Date.parse("2026-01-15T23:30:00.000Z"); // 5:30 PM CT
  const profile = normalizeProfileDailyChallenges({
    username: "DailyCountdownUser",
    tokens: 0,
    dailyChallenges: {
      dailyChallengeLastReset: "2026-01-15T00:00:00.000Z",
      progress: {},
      completed: {},
      rewarded: {}
    }
  }, nowMs);

  const view = getDailyChallengesView(profile, nowMs);
  assert.equal(view.view.daily.msUntilReset, 30 * 60 * 1000);
});

test("weekly: resets at Monday 6 PM America/Chicago boundary", () => {
  const beforeBoundary = Date.parse("2026-01-19T23:30:00.000Z"); // Monday 5:30 PM CT
  const afterBoundary = Date.parse("2026-01-20T00:30:00.000Z"); // Monday 6:30 PM CT

  const stale = {
    username: "WeeklyBoundaryUser",
    tokens: 0,
    dailyChallenges: {
      weekly: {
        lastReset: "2026-01-13T00:00:00.000Z",
        progress: { matchesPlayed: 8, matchesWon: 3, warsWon: 2, cardsCaptured: 20, usedAllElementsInMatch: 1 },
        completed: {},
        rewarded: {}
      }
    }
  };

  const notReset = normalizeProfileDailyChallenges(stale, beforeBoundary);
  assert.ok((notReset.dailyChallenges.weekly.progress.matchesPlayed ?? 0) > 0);

  const reset = normalizeProfileDailyChallenges(stale, afterBoundary);
  assert.equal(reset.dailyChallenges.weekly.progress.matchesPlayed, 0);
});

test("weekly: completed matches update weekly progress", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    endReason: null,
    round: 4,
    history: [
      { round: 1, result: "p1", p1Card: "fire", p2Card: "wind", warClashes: 1, capturedCards: 2 },
      { round: 2, result: "p1", p1Card: "water", p2Card: "fire", warClashes: 0, capturedCards: 2 },
      { round: 3, result: "p1", p1Card: "earth", p2Card: "wind", warClashes: 0, capturedCards: 2 },
      { round: 4, result: "p1", p1Card: "wind", p2Card: "water", warClashes: 0, capturedCards: 2 }
    ]
  };

  match.players.p1.hand = ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"];
  match.players.p2.hand = [];

  const result = await state.recordMatchResult({ username: "WeeklyProgressUser", perspective: "p1", matchState: match });

  assert.ok(Array.isArray(result.weeklyRewards));
  assert.ok(result.weeklyChallenges.challenges.some((item) => item.progress >= 1));
});

test("state: local_pvp Player 2 receives daily and weekly challenge progress from their own match perspective", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "local_pvp" }),
    status: "completed",
    winner: "p2",
    endReason: null,
    round: 4,
    history: [
      { round: 1, result: "p2", p1Card: "earth", p2Card: "fire", warClashes: 1, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, result: "p2", p1Card: "fire", p2Card: "water", warClashes: 1, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, result: "p2", p1Card: "wind", p2Card: "earth", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, result: "p2", p1Card: "water", p2Card: "wind", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 }
    ],
    players: {
      p1: { hand: [], wonRounds: 0 },
      p2: { hand: ["fire", "water", "earth", "wind"], wonRounds: 0 }
    },
    meta: {
      totalCards: 16,
      minHandSizes: { p1: 0, p2: 4 }
    }
  };

  const recorded = await state.recordMatchResult({
    username: "LocalP2ProgressUser",
    perspective: "p2",
    matchState: match
  });

  const dailyById = Object.fromEntries(recorded.dailyChallenges.challenges.map((item) => [item.id, item]));
  const weeklyById = Object.fromEntries(recorded.weeklyChallenges.challenges.map((item) => [item.id, item]));

  assert.equal(recorded.profile.modeStats.local_pvp.wins, 1);
  assert.equal(dailyById.daily_win_1_match.progress, 1);
  assert.equal(dailyById.daily_win_1_war.progress, 1);
  assert.equal(dailyById.daily_use_all_4_elements.progress, 1);
  assert.equal(weeklyById.weekly_win_9_wars.progress, 2);
  assert.equal(weeklyById.weekly_use_all_4_elements_5x.progress, 1);
});

test("xp: completed matches grant XP and quit forfeits do not", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const completedMatch = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    endReason: null,
    round: 1,
    history: [{ round: 1, result: "p1", warClashes: 1, capturedCards: 2 }]
  };

  const done = await state.recordMatchResult({ username: "XpUser", perspective: "p1", matchState: completedMatch });
  assert.equal(done.xpDelta, 14); // +4 base +10 daily challenge XP (win match + win WAR)

  const quitMatch = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p2",
    endReason: "quit_forfeit",
    round: 1,
    history: []
  };

  const quit = await state.recordMatchResult({ username: "XpUser", perspective: "p1", matchState: quitMatch });
  assert.equal(quit.xpDelta, 0);
});

test("economy: match token rewards apply as win=2, loss=1, tie=1, quit=0", () => {
  const challenges = createDefaultDailyChallenges(Date.now());
  markAllChallengeRewardsConsumed(challenges);

  const baseProfile = {
    username: "EconomyUser",
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    dailyChallenges: challenges
  };

  const baseMatch = {
    status: "completed",
    endReason: null,
    winner: "p1",
    history: [],
    players: { p1: { hand: [] }, p2: { hand: [] } },
    meta: { totalCards: 16 }
  };

  const win = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: { ...baseMatch, winner: "p1", endReason: null },
    perspective: "p1",
    matchStats: { warsWon: 0, cardsCaptured: 0 },
    nowMs: Date.now()
  });
  assert.equal(win.matchTokenDelta, 2);
  assert.equal(win.tokenDelta, 2);

  const loss = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: { ...baseMatch, winner: "p2", endReason: null },
    perspective: "p1",
    matchStats: { warsWon: 0, cardsCaptured: 0 },
    nowMs: Date.now()
  });
  assert.equal(loss.matchTokenDelta, 1);
  assert.equal(loss.tokenDelta, 1);

  const tie = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: { ...baseMatch, winner: "draw", endReason: null },
    perspective: "p1",
    matchStats: { warsWon: 0, cardsCaptured: 0 },
    nowMs: Date.now()
  });
  assert.equal(tie.matchTokenDelta, 1);
  assert.equal(tie.tokenDelta, 1);

  const quit = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: { ...baseMatch, winner: "p2", endReason: "quit_forfeit" },
    perspective: "p1",
    matchStats: { warsWon: 0, cardsCaptured: 0 },
    nowMs: Date.now()
  });
  assert.equal(quit.matchTokenDelta, 0);
  assert.equal(quit.tokenDelta, 0);
  assert.equal(quit.xpDelta, 0);
});

test("boost events: all scope boosts eligible direct match rewards but easy exclusion blocks Easy AI boosts", () => {
  const challenges = markAllChallengeRewardsConsumed(createDefaultDailyChallenges(Date.now()));
  const baseProfile = {
    username: "DirectBoostUser",
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    dailyChallenges: challenges
  };
  const baseMatch = {
    status: "completed",
    endReason: null,
    winner: "p1",
    history: [],
    players: { p1: { hand: [] }, p2: { hand: [] } },
    meta: { totalCards: 16 }
  };

  const boostedLocalPvp = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: { ...baseMatch, mode: "local_pvp" },
    perspective: "p1",
    matchStats: { warsWon: 0, cardsCaptured: 0 },
    nowMs: Date.now(),
    options: {
      boostEvent: {
        enabled: true,
        scope: "all",
        excludeDifficulties: [],
        xpMultiplier: 1.5,
        tokenMultiplier: 2
      }
    }
  });
  assert.equal(boostedLocalPvp.matchTokenDelta, 4);
  assert.equal(boostedLocalPvp.matchXpDelta, 4);

  const excludedEasyPve = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: { ...baseMatch, mode: "pve", difficulty: "easy" },
    perspective: "p1",
    matchStats: { warsWon: 0, cardsCaptured: 0 },
    nowMs: Date.now(),
    options: {
      practiceMode: false,
      boostEvent: {
        enabled: true,
        scope: "all",
        excludeDifficulties: ["easy"],
        xpMultiplier: 2,
        tokenMultiplier: 2
      }
    }
  });
  assert.equal(excludedEasyPve.matchTokenDelta, 2);
  assert.equal(excludedEasyPve.matchXpDelta, 3);
});

test("boost events: daily login and admin grants stay unboosted", async () => {
  const dataDir = await createTempDataDir();
  await writeBoostEventConfig(dataDir, {
    enabled: true,
    title: "Global Boost",
    message: "Should not affect non-match rewards.",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    scope: "all",
    excludeDifficulties: [],
    xpMultiplier: 3,
    tokenMultiplier: 3
  });
  const state = new StateCoordinator({ dataDir });

  const dailyLogin = await state.claimDailyLoginReward("DailyLoginBoostUser", Date.parse("2026-05-16T12:00:00.000Z"));
  assert.equal(dailyLogin.rewardTokens, 5);
  assert.equal(dailyLogin.rewardXp, 2);

  const adminGrant = await state.applyAdminGrant({
    username: "AdminGrantBoostUser",
    xp: 10,
    tokens: 15
  });
  assert.equal(adminGrant.xpDelta, 10);
  assert.equal(adminGrant.tokenDelta, 15);
});

test("economy: daily and weekly challenge rewards include stage1 token+xp values", () => {
  const byDailyId = Object.fromEntries(DAILY_CHALLENGE_DEFINITIONS.map((item) => [item.id, item]));
  const byWeeklyId = Object.fromEntries(WEEKLY_CHALLENGE_DEFINITIONS.map((item) => [item.id, item]));

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(byDailyId).map(([id, item]) => [id, [item.rewardTokens, item.rewardXp]])
    ),
    {
      daily_play_5_matches: [3, 6],
      daily_win_1_match: [2, 5],
      daily_win_2_matches: [3, 7],
      daily_win_1_war: [2, 5],
      daily_capture_16_cards: [3, 6],
      daily_use_all_4_elements: [3, 6],
      daily_online_match_1: [4, 8],
      daily_online_win_1: [5, 10],
      daily_hard_ai_win_1: [4, 9],
      daily_local_pvp_match_1: [3, 7],
      daily_comeback_win: [4, 8],
      daily_no_quit_3: [3, 6],
      daily_win_with_fire: [3, 6],
      daily_win_with_water: [3, 6],
      daily_win_with_earth: [3, 6],
      daily_win_with_wind: [3, 6]
    }
  );

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(byWeeklyId).map(([id, item]) => [id, [item.rewardTokens, item.rewardXp]])
    ),
    {
      weekly_play_15_matches: [5, 15],
      weekly_win_10_matches: [5, 15],
      weekly_win_9_wars: [8, 18],
      weekly_capture_64_cards: [8, 18],
      weekly_win_streak_3: [10, 25],
      weekly_use_all_4_elements_5x: [8, 18],
      weekly_longest_war_5: [12, 30],
      weekly_online_matches_5: [12, 28],
      weekly_online_wins_3: [15, 35],
      weekly_hard_ai_wins_5: [12, 30],
      weekly_local_pvp_matches_5: [10, 25],
      weekly_comeback_wins_5: [12, 30],
      weekly_no_quit_10: [10, 25],
      weekly_element_master_fire: [10, 25],
      weekly_element_master_water: [10, 25],
      weekly_element_master_earth: [10, 25],
      weekly_element_master_wind: [10, 25]
    }
  );
});

test("daily: active challenge count remains 9 with 6 fixed core and 3 selected bonus quests", () => {
  const view = getDailyChallengesView({
    username: "DailyActiveCountUser",
    dailyChallenges: createDefaultDailyChallenges(Date.now())
  });

  assert.equal(view.view.daily.challenges.length, 9);
  assert.deepEqual(
    view.view.daily.challenges
      .map((item) => item.id)
      .filter((id) => DAILY_FIXED_CORE_CHALLENGE_DEFINITIONS.some((def) => def.id === id)).length,
    6
  );
});

test("weekly: active challenge count remains 10 with 7 fixed core and 3 selected bonus quests", () => {
  const view = getDailyChallengesView({
    username: "WeeklyActiveCountUser",
    dailyChallenges: createDefaultDailyChallenges(Date.now())
  });

  assert.equal(view.view.weekly.challenges.length, 10);
  assert.deepEqual(
    view.view.weekly.challenges
      .map((item) => item.id)
      .filter((id) => WEEKLY_FIXED_CORE_CHALLENGE_DEFINITIONS.some((def) => def.id === id)).length,
    7
  );
});

test("daily: selected bonus IDs are unique and include at most one elemental quest", () => {
  const selected = createDefaultDailyChallenges(Date.now()).daily.selectedBonusChallengeIds;
  const elementalIds = new Set(
    DAILY_BONUS_CHALLENGE_POOL.filter((item) => item.bonusFamily === "elemental").map((item) => item.id)
  );

  assert.equal(selected.length, 3);
  assert.equal(new Set(selected).size, 3);
  assert.ok(selected.filter((id) => elementalIds.has(id)).length <= 1);
});

test("weekly: selected bonus IDs are unique and include at most one elemental quest", () => {
  const selected = createDefaultDailyChallenges(Date.now()).weekly.selectedBonusChallengeIds;
  const elementalIds = new Set(
    WEEKLY_BONUS_CHALLENGE_POOL.filter((item) => item.bonusFamily === "elemental").map((item) => item.id)
  );

  assert.equal(selected.length, 3);
  assert.equal(new Set(selected).size, 3);
  assert.ok(selected.filter((id) => elementalIds.has(id)).length <= 1);
});

test("daily: selection persists through the reset window and does not reroll on read/login", () => {
  const nowMs = Date.parse("2026-01-15T20:00:00.000Z");
  const normalized = normalizeProfileDailyChallenges({
    username: "DailySelectionPersistUser",
    dailyChallenges: createDefaultDailyChallenges(nowMs)
  }, nowMs);

  const firstIds = normalized.dailyChallenges.daily.selectedBonusChallengeIds;
  const firstView = getDailyChallengesView(normalized, nowMs);
  const secondView = getDailyChallengesView(firstView.profile, nowMs + 60_000);

  assert.deepEqual(firstView.profile.dailyChallenges.daily.selectedBonusChallengeIds, firstIds);
  assert.deepEqual(secondView.profile.dailyChallenges.daily.selectedBonusChallengeIds, firstIds);
  assert.equal(firstView.view.daily.challenges.length, 9);
});

test("weekly: selection persists through the reset window and rerolls only at the reset boundary", () => {
  const beforeBoundary = Date.parse("2026-01-19T23:30:00.000Z");
  const afterBoundary = Date.parse("2026-01-20T00:30:00.000Z");
  const beforeProfile = normalizeProfileDailyChallenges({
    username: "WeeklySelectionBoundaryUser",
    dailyChallenges: createDefaultDailyChallenges(beforeBoundary)
  }, beforeBoundary);
  const beforeIds = beforeProfile.dailyChallenges.weekly.selectedBonusChallengeIds;
  const sameWindowIds = getDailyChallengesView(beforeProfile, beforeBoundary + 60_000).profile.dailyChallenges.weekly.selectedBonusChallengeIds;
  const afterProfile = normalizeProfileDailyChallenges(beforeProfile, afterBoundary);

  assert.deepEqual(sameWindowIds, beforeIds);
  assert.equal(afterProfile.dailyChallenges.weekly.selectedBonusChallengeIds.length, 3);
  assert.notDeepEqual(afterProfile.dailyChallenges.weekly.selectedBonusChallengeIds, beforeIds);
});

test("daily: missing or invalid selected bonus IDs are repaired once and remain stable after repair", () => {
  const nowMs = Date.parse("2026-01-15T20:00:00.000Z");
  const normalized = normalizeProfileDailyChallenges({
    username: "DailySelectionRepairUser",
    dailyChallenges: {
      daily: {
        lastReset: new Date(nowMs).toISOString(),
        selectedBonusChallengeIds: ["daily_win_with_fire", "daily_win_with_fire", "missing_bonus"],
        progress: {},
        completed: {},
        rewarded: {}
      }
    }
  }, nowMs);
  const repairedIds = normalized.dailyChallenges.daily.selectedBonusChallengeIds;
  const second = normalizeProfileDailyChallenges(normalized, nowMs);

  assert.equal(repairedIds.length, 3);
  assert.equal(new Set(repairedIds).size, 3);
  assert.deepEqual(second.dailyChallenges.daily.selectedBonusChallengeIds, repairedIds);
});

test("daily: legacy challenge windows normalize selected bonus ids and exclude retired quests from the active view", () => {
  const nowMs = Date.now();
  const legacyProfile = {
    username: "LegacyQuestUiUser",
    dailyChallenges: {
      daily: {
        lastReset: new Date(nowMs).toISOString(),
        progress: {},
        completed: {
          daily_win_1_match: false,
          daily_win_2_matches: false,
          daily_win_1_war: false,
          daily_win_2_wars: false,
          daily_trigger_2_wars_one_match: false,
          daily_capture_16_cards: false,
          daily_capture_24_cards: false,
          daily_play_5_matches: false,
          daily_use_all_4_elements: false
        },
        rewarded: {},
        completionChestGranted: false
      },
      weekly: {
        lastReset: new Date(nowMs).toISOString(),
        progress: {},
        completed: {
          weekly_win_10_matches: false,
          weekly_win_20_matches: false,
          weekly_win_9_wars: false,
          weekly_win_15_wars: false,
          weekly_capture_64_cards: false,
          weekly_play_15_matches: false,
          weekly_win_streak_3: false,
          weekly_use_all_4_elements_5x: false,
          weekly_use_all_4_elements_10x: false,
          weekly_longest_war_5: false
        },
        rewarded: {},
        completionChestGranted: false
      }
    }
  };

  const normalized = normalizeProfileDailyChallenges(legacyProfile, nowMs);
  const view = getDailyChallengesView(legacyProfile, nowMs);
  const selectedDailyIds = normalized.dailyChallenges.daily.selectedBonusChallengeIds;
  const selectedWeeklyIds = normalized.dailyChallenges.weekly.selectedBonusChallengeIds;
  const dailyIds = view.view.daily.challenges.map((challenge) => challenge.id);
  const weeklyIds = view.view.weekly.challenges.map((challenge) => challenge.id);
  const dailyBonusPoolIds = new Set(DAILY_BONUS_CHALLENGE_POOL.map((challenge) => challenge.id));
  const weeklyBonusPoolIds = new Set(WEEKLY_BONUS_CHALLENGE_POOL.map((challenge) => challenge.id));
  const dailySelectedElementalCount = selectedDailyIds.filter((id) =>
    DAILY_BONUS_CHALLENGE_POOL.some((challenge) => challenge.id === id && challenge.bonusFamily === "elemental")
  ).length;
  const weeklySelectedElementalCount = selectedWeeklyIds.filter((id) =>
    WEEKLY_BONUS_CHALLENGE_POOL.some((challenge) => challenge.id === id && challenge.bonusFamily === "elemental")
  ).length;

  assert.equal(normalized.dailyChallenges.daily.setVersion, "core_bonus_v1");
  assert.equal(normalized.dailyChallenges.weekly.setVersion, "core_bonus_v1");
  assert.equal(selectedDailyIds.length, 3);
  assert.equal(selectedWeeklyIds.length, 3);
  assert.equal(new Set(selectedDailyIds).size, 3);
  assert.equal(new Set(selectedWeeklyIds).size, 3);
  assert.ok(selectedDailyIds.every((id) => dailyBonusPoolIds.has(id)));
  assert.ok(selectedWeeklyIds.every((id) => weeklyBonusPoolIds.has(id)));
  assert.equal(dailySelectedElementalCount <= 1, true);
  assert.equal(weeklySelectedElementalCount <= 1, true);
  for (const id of selectedDailyIds) {
    assert.ok(dailyIds.includes(id));
  }
  for (const id of selectedWeeklyIds) {
    assert.ok(weeklyIds.includes(id));
  }
  assert.equal(dailyIds.includes("daily_win_2_wars"), false);
  assert.equal(dailyIds.includes("daily_trigger_2_wars_one_match"), false);
  assert.equal(dailyIds.includes("daily_capture_24_cards"), false);
  assert.equal(weeklyIds.includes("weekly_win_20_matches"), false);
  assert.equal(weeklyIds.includes("weekly_win_15_wars"), false);
  assert.equal(weeklyIds.includes("weekly_use_all_4_elements_10x"), false);
});

test("daily: new fixed core and bonus challenges unlock from the configured thresholds", () => {
  const challenges = withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
    daily: ["daily_comeback_win", "daily_no_quit_3", "daily_win_with_fire"]
  });
  challenges.daily.progress.matchesPlayed = 4;
  challenges.daily.progress.matchesWon = 1;
  const baseProfile = {
    username: "ExpandedDailyUser",
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    winStreak: 2,
    dailyChallenges: challenges
  };

  const result = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: {
      status: "completed",
      endReason: null,
      winner: "p1",
      history: [
        { p1Card: "fire", result: "p2" },
        { p1Card: "water", result: "p1" },
        { p1Card: "earth", result: "p1" },
        { p1Card: "wind", result: "p1" },
        { p1Card: "fire", result: "p1" }
      ],
      mode: "pve",
      difficulty: "normal",
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    perspective: "p1",
    matchStats: {
      warsEntered: 2,
      warsWon: 2,
      cardsCaptured: 24,
      longestWar: 5
    },
    nowMs: Date.now()
  });

  const rewardIds = result.rewards.daily.map((item) => item.id);
  assert.ok(rewardIds.includes("daily_play_5_matches"));
  assert.ok(rewardIds.includes("daily_win_1_match"));
  assert.ok(rewardIds.includes("daily_win_2_matches"));
  assert.ok(rewardIds.includes("daily_win_1_war"));
  assert.ok(rewardIds.includes("daily_capture_16_cards"));
  assert.ok(rewardIds.includes("daily_use_all_4_elements"));
  assert.ok(rewardIds.includes("daily_comeback_win"));
  assert.ok(rewardIds.includes("daily_win_with_fire"));
});

test("weekly: new fixed core and bonus challenges unlock from the configured thresholds", () => {
  const challenges = withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
    weekly: ["weekly_online_wins_3", "weekly_comeback_wins_5", "weekly_element_master_fire"]
  });
  challenges.weekly.progress.matchesPlayed = 14;
  challenges.weekly.progress.matchesWon = 9;
  challenges.weekly.progress.warsWon = 8;
  challenges.weekly.progress.cardsCaptured = 63;
  challenges.weekly.progress.usedAllElementsInMatch = 4;
  challenges.weekly.progress.comebackWin = 4;
  challenges.weekly.progress.wonOnlineMatch = 2;
  challenges.weekly.progress.wonRoundWithFire = 4;

  const baseProfile = {
    username: "ExpandedWeeklyUser",
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    winStreak: 3,
    dailyChallenges: challenges
  };

  const result = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: {
      status: "completed",
      endReason: null,
      winner: "p1",
      mode: "online_pvp",
      history: [
        { p1Card: "fire", result: "p2" },
        { p1Card: "water", result: "p1" },
        { p1Card: "earth", result: "p1" },
        { p1Card: "wind", result: "p1" },
        { p1Card: "fire", result: "p1" }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    perspective: "p1",
    matchStats: {
      warsEntered: 2,
      warsWon: 1,
      cardsCaptured: 4,
      longestWar: 5
    },
    nowMs: Date.now()
  });

  const rewardIds = result.rewards.weekly.map((item) => item.id);
  assert.ok(rewardIds.includes("weekly_play_15_matches"));
  assert.ok(rewardIds.includes("weekly_win_10_matches"));
  assert.ok(rewardIds.includes("weekly_win_9_wars"));
  assert.ok(rewardIds.includes("weekly_capture_64_cards"));
  assert.ok(rewardIds.includes("weekly_win_streak_3"));
  assert.ok(rewardIds.includes("weekly_use_all_4_elements_5x"));
  assert.ok(rewardIds.includes("weekly_longest_war_5"));
  assert.ok(rewardIds.includes("weekly_online_wins_3"));
  assert.ok(rewardIds.includes("weekly_comeback_wins_5"));
  assert.ok(rewardIds.includes("weekly_element_master_fire"));
});

test("daily: reward-once behavior remains intact for rotating bonus challenges", () => {
  const nowMs = Date.now();
  const baseProfile = {
    username: "SingleRewardUser",
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    winStreak: 3,
    dailyChallenges: withSelectedBonusChallenges(createDefaultDailyChallenges(nowMs), {
      daily: ["daily_comeback_win", "daily_no_quit_3", "daily_win_with_fire"]
    })
  };

  const matchState = {
    status: "completed",
    endReason: null,
    winner: "p1",
    mode: "pve",
    history: [
      { p1Card: "fire", result: "p2" },
      { p1Card: "water", result: "p1" },
      { p1Card: "earth", result: "p1" },
      { p1Card: "wind", result: "p1" },
      { p1Card: "fire", result: "p1" }
    ],
    players: { p1: { hand: [] }, p2: { hand: [] } },
    meta: { totalCards: 16 }
  };
  const matchStats = {
    warsEntered: 2,
    warsWon: 2,
    cardsCaptured: 24,
    longestWar: 5
  };

  const first = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState,
    perspective: "p1",
    matchStats,
    nowMs
  });
  const second = applyDailyChallengesForMatch({
    profile: first.profile,
    matchState,
    perspective: "p1",
    matchStats,
    nowMs
  });

  assert.ok(first.rewards.daily.some((item) => item.id === "daily_comeback_win"));
  assert.ok(second.rewards.daily.every((item) => item.id !== "daily_comeback_win"));
});

test("daily: completion chest uses the active set only and retired ids do not count toward active completion", () => {
  const nowMs = Date.now();
  const challenges = withSelectedBonusChallenges(createDefaultDailyChallenges(nowMs), {
    daily: ["daily_online_match_1", "daily_no_quit_3", "daily_win_with_fire"]
  });
  for (const definition of DAILY_FIXED_CORE_CHALLENGE_DEFINITIONS) {
    challenges.daily.completed[definition.id] = true;
  }
  challenges.daily.completed.daily_online_match_1 = true;
  challenges.daily.completed.daily_no_quit_3 = true;
  challenges.daily.completed.daily_trigger_2_wars_one_match = true;
  challenges.daily.completed.daily_capture_24_cards = true;
  challenges.daily.rewarded.daily_trigger_2_wars_one_match = true;
  challenges.daily.rewarded.daily_capture_24_cards = true;

  const result = applyDailyChallengesForMatch({
    profile: {
      username: "ActiveChestSetUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      dailyChallenges: challenges
    },
    matchState: {
      status: "completed",
      endReason: null,
      winner: "p1",
      mode: "online_pvp",
      history: [
        { p1Card: "fire", result: "p1" },
        { p1Card: "water", result: "p1" },
        { p1Card: "earth", result: "p1" },
        { p1Card: "wind", result: "p1" }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    perspective: "p1",
    matchStats: {
      warsEntered: 0,
      warsWon: 0,
      cardsCaptured: 0,
      longestWar: 0
    },
    nowMs
  });

  assert.equal(result.dailyChestDelta, 1);
  assert.equal(result.profile.chests.basic, 1);
});

test("daily: online bonus quests progress correctly", () => {
  const result = applyDailyChallengesForMatch({
    profile: {
      username: "OnlineBonusQuestUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      dailyChallenges: withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
        daily: ["daily_online_match_1", "daily_online_win_1", "daily_no_quit_3"]
      })
    },
    matchState: createRewardHookMatch({ winner: "p1", mode: "online_pvp" }),
    perspective: "p1",
    matchStats: { warsEntered: 2, warsWon: 2, cardsCaptured: 24, longestWar: 5 }
  });

  const rewardIds = result.rewards.daily.map((item) => item.id);
  assert.ok(rewardIds.includes("daily_online_match_1"));
  assert.ok(rewardIds.includes("daily_online_win_1"));
});

test("daily: hard AI bonus quests progress correctly", () => {
  const result = applyDailyChallengesForMatch({
    profile: {
      username: "HardAiBonusQuestUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      dailyChallenges: withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
        daily: ["daily_hard_ai_win_1", "daily_no_quit_3", "daily_win_with_fire"]
      })
    },
    matchState: createRewardHookMatch({ winner: "p1", mode: "pve", difficulty: "hard" }),
    perspective: "p1",
    matchStats: { warsEntered: 2, warsWon: 2, cardsCaptured: 24, longestWar: 5 }
  });

  assert.ok(result.rewards.daily.some((item) => item.id === "daily_hard_ai_win_1"));
});

test("daily: local PvP bonus quests progress correctly", () => {
  const result = applyDailyChallengesForMatch({
    profile: {
      username: "LocalBonusQuestUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      dailyChallenges: withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
        daily: ["daily_local_pvp_match_1", "daily_no_quit_3", "daily_win_with_fire"]
      })
    },
    matchState: createRewardHookMatch({ winner: "p1", mode: "local_pvp" }),
    perspective: "p1",
    matchStats: { warsEntered: 2, warsWon: 2, cardsCaptured: 24, longestWar: 5 }
  });

  assert.ok(result.rewards.daily.some((item) => item.id === "daily_local_pvp_match_1"));
});

test("daily: comeback, element, and no-quit bonus quests progress correctly", () => {
  const result = applyDailyChallengesForMatch({
    profile: {
      username: "DerivedBonusQuestUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      dailyChallenges: withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
        daily: ["daily_comeback_win", "daily_no_quit_3", "daily_win_with_fire"]
      })
    },
    matchState: {
      status: "completed",
      endReason: null,
      winner: "p1",
      mode: "pve",
      difficulty: "normal",
      history: [
        { p1Card: "fire", result: "p2", warClashes: 0, capturedOpponentCards: 0 },
        { p1Card: "water", result: "p1", warClashes: 0, capturedOpponentCards: 1 },
        { p1Card: "fire", result: "p1", warClashes: 0, capturedOpponentCards: 1 }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    perspective: "p1",
    matchStats: { warsEntered: 0, warsWon: 0, cardsCaptured: 2, longestWar: 0 }
  });

  const rewardIds = result.rewards.daily.map((item) => item.id);
  assert.ok(rewardIds.includes("daily_comeback_win"));
  assert.ok(rewardIds.includes("daily_no_quit_3") === false);
  assert.ok(rewardIds.includes("daily_win_with_fire"));
  assert.equal(result.profile.dailyChallenges.daily.progress.completedNoQuitMatch, 1);
});

test("weekly: online, hard AI, local PvP, comeback, element, and no-quit bonus quests progress correctly", () => {
  const challenges = withSelectedBonusChallenges(createDefaultDailyChallenges(Date.now()), {
    weekly: ["weekly_online_matches_5", "weekly_online_wins_3", "weekly_element_master_fire"]
  });
  challenges.weekly.progress.completedOnlineMatch = 4;
  challenges.weekly.progress.wonOnlineMatch = 2;
  challenges.weekly.progress.wonRoundWithFire = 4;

  const result = applyDailyChallengesForMatch({
    profile: {
      username: "WeeklyDerivedBonusQuestUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      dailyChallenges: challenges
    },
    matchState: {
      status: "completed",
      endReason: null,
      winner: "p1",
      mode: "online_pvp",
      history: [
        { p1Card: "fire", result: "p1", warClashes: 0, capturedOpponentCards: 1 }
      ],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    perspective: "p1",
    matchStats: { warsEntered: 0, warsWon: 0, cardsCaptured: 1, longestWar: 0 }
  });

  const rewardIds = result.rewards.weekly.map((item) => item.id);
  assert.ok(rewardIds.includes("weekly_online_matches_5"));
  assert.ok(rewardIds.includes("weekly_online_wins_3"));
  assert.ok(rewardIds.includes("weekly_element_master_fire"));
});

test("daily: quit forfeits do not count toward new daily and weekly challenges", () => {
  const nowMs = Date.now();
  const baseProfile = {
    username: "NoQuitChallengeUser",
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    winStreak: 3,
    dailyChallenges: createDefaultDailyChallenges(nowMs)
  };

  const result = applyDailyChallengesForMatch({
    profile: baseProfile,
    matchState: {
      status: "completed",
      endReason: "quit_forfeit",
      winner: "p1",
      history: [{ p1Card: "fire" }, { p1Card: "water" }, { p1Card: "earth" }, { p1Card: "wind" }],
      players: { p1: { hand: [] }, p2: { hand: [] } },
      meta: { totalCards: 16 }
    },
    perspective: "p1",
    matchStats: {
      warsEntered: 2,
      warsWon: 2,
      cardsCaptured: 24,
      longestWar: 5
    },
    nowMs
  });

  assert.equal(result.rewards.daily.length, 0);
  assert.equal(result.rewards.weekly.length, 0);
  assert.equal(result.profile.dailyChallenges.daily.progress.triggeredTwoWarsInMatch, 0);
  assert.equal(result.profile.dailyChallenges.weekly.progress.reachedWinStreak3, 0);
});

test("daily: normalizes new progress keys for older profiles safely", () => {
  const normalized = normalizeProfileDailyChallenges({
    username: "LegacyChallengeKeysUser",
    dailyChallenges: {
      daily: {
        lastReset: new Date().toISOString(),
        progress: {
          matchesPlayed: 1,
          matchesWon: 1,
          warsWon: 1,
          cardsCaptured: 1,
          usedAllElementsInMatch: 1
        },
        completed: {},
        rewarded: {}
      },
      weekly: {
        lastReset: new Date().toISOString(),
        progress: {
          matchesPlayed: 1,
          matchesWon: 1,
          warsWon: 1,
          cardsCaptured: 1,
          usedAllElementsInMatch: 1
        },
        completed: {},
        rewarded: {}
      }
    }
  });

  assert.equal(normalized.dailyChallenges.daily.progress.triggeredTwoWarsInMatch, 0);
  assert.equal(normalized.dailyChallenges.weekly.progress.reachedWinStreak3, 0);
  assert.equal(normalized.dailyChallenges.weekly.progress.survivedLongestWar5, 0);
});

test("daily: hydration marks newly added challenges completed when stored progress already meets the goal", () => {
  const normalized = normalizeProfileDailyChallenges({
    username: "HydratedChallengeUser",
    dailyChallenges: {
      daily: {
        lastReset: new Date().toISOString(),
        selectedBonusChallengeIds: ["daily_online_match_1", "daily_no_quit_3", "daily_win_with_fire"],
        progress: {
          matchesPlayed: 5,
          matchesWon: 2,
          warsWon: 2,
          cardsCaptured: 24,
          usedAllElementsInMatch: 1,
          completedOnlineMatch: 1,
          completedNoQuitMatch: 3,
          wonRoundWithFire: 1
        },
        completed: {
          daily_win_1_match: true,
          daily_win_1_war: true
        },
        rewarded: {
          daily_win_1_match: true,
          daily_win_1_war: true
        }
      }
    }
  });

  const view = getDailyChallengesView(normalized);
  const byId = Object.fromEntries(view.view.daily.challenges.map((item) => [item.id, item]));

  assert.equal(byId.daily_win_2_matches.completed, true);
  assert.equal(byId.daily_online_match_1.completed, true);
  assert.equal(byId.daily_no_quit_3.completed, true);
  assert.equal(byId.daily_win_with_fire.completed, true);
});

test("daily: hydration completion sync does not duplicate already-granted rewards", () => {
  const normalized = normalizeProfileDailyChallenges({
    username: "HydratedRewardUser",
    tokens: 200,
    playerXP: 0,
    playerLevel: 1,
    dailyChallenges: {
      daily: {
        lastReset: new Date().toISOString(),
        selectedBonusChallengeIds: ["daily_online_match_1", "daily_no_quit_3", "daily_win_with_fire"],
        progress: {
          matchesPlayed: 2,
          matchesWon: 2,
          warsWon: 2,
          cardsCaptured: 24,
          usedAllElementsInMatch: 1,
          completedOnlineMatch: 1,
          completedNoQuitMatch: 3,
          wonRoundWithFire: 1
        },
        completed: {},
        rewarded: {
          daily_win_2_matches: true,
          daily_online_match_1: true
        }
      }
    }
  });

  const firstView = getDailyChallengesView(normalized);
  const secondView = getDailyChallengesView(firstView.profile);
  const byId = Object.fromEntries(secondView.view.daily.challenges.map((item) => [item.id, item]));

  assert.equal(byId.daily_win_2_matches.completed, true);
  assert.equal(byId.daily_online_match_1.completed, true);
  assert.equal(secondView.profile.dailyChallenges.daily.rewarded.daily_win_2_matches, true);
  assert.equal(secondView.profile.dailyChallenges.daily.rewarded.daily_online_match_1, true);
});

test("xp: level threshold table scales through level 100", () => {
  const thresholds = getXpThresholds();
  assert.equal(thresholds.length, 100);
  assert.equal(thresholds[0], 0);
  assert.equal(thresholds[1], 25);
  assert.equal(thresholds[2], 60);
  assert.equal(thresholds[3], 110);

  for (let i = 1; i < thresholds.length; i += 1) {
    assert.ok(thresholds[i] > thresholds[i - 1]);
  }
});

test("state: normalization preserves existing non-zero profile progress", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.store.write([
    {
      username: "PreserveUser",
      title: "Initiate",
      wins: 7,
      losses: 2,
      gamesPlayed: 9,
      cardsCaptured: 15,
      playerXP: 44,
      playerLevel: 3,
      achievements: { first_flame: { count: 1 } },
      modeStats: {
        pve: { gamesPlayed: 9, wins: 7, losses: 2, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 15, quickWins: 0, timeLimitWins: 0 },
        local_pvp: { gamesPlayed: 0, wins: 0, losses: 0, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, quickWins: 0, timeLimitWins: 0 }
      }
    }
  ]);

  const profile = await state.profiles.ensureProfile("PreserveUser");
  assert.equal(profile.wins, 7);
  assert.equal(profile.losses, 2);
  assert.equal(profile.gamesPlayed, 9);
  assert.equal(profile.cardsCaptured, 15);
  assert.equal(profile.playerXP, 44);
  assert.equal(profile.playerLevel, 2);
  assert.equal(profile.achievements.first_flame.count, 1);
});

test("state: profile load derives level from cumulative XP even if stored level is stale", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.store.write([
    {
      username: "LevelLoadUser",
      playerXP: 112,
      playerLevel: 1
    }
  ]);

  const profile = await state.profiles.getProfile("LevelLoadUser");
  const xpView = await state.getDailyChallenges("LevelLoadUser");

  assert.equal(profile.playerXP, 112);
  assert.equal(profile.playerLevel, 4);
  assert.equal(xpView.xp.playerLevel, 4);
  assert.equal(xpView.xp.currentLevelXp, 110);
  assert.equal(xpView.xp.nextLevelXp, 165);
});

test("state: viewed-profile lookup source returns level derived from cumulative XP", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.store.write([
    {
      username: "LookupLevelUser",
      playerXP: 112,
      playerLevel: 1
    }
  ]);

  const listed = await state.profiles.listProfiles();
  const lookup = listed.find((profile) => profile.username === "LookupLevelUser");

  assert.equal(lookup.playerXP, 112);
  assert.equal(lookup.playerLevel, 4);
});

test("state: completed match commits progress for sparse legacy profile", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.store.write([
    {
      username: "SparseLegacy",
      title: "Initiate",
      achievements: { first_flame: { count: 1 } }
    }
  ]);

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 2,
    endReason: null,
    history: [{ round: 1, result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedCards: 2 }]
  };

  match.players.p1.hand = ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water"];
  match.players.p2.hand = ["earth", "wind", "water", "fire", "earth", "wind"];

  const recorded = await state.recordMatchResult({
    username: "SparseLegacy",
    perspective: "p1",
    matchState: match
  });

  assert.ok(recorded.profile.wins >= 1);
  assert.ok(recorded.profile.gamesPlayed >= 1);
  assert.ok(recorded.profile.playerXP >= 1);
  assert.ok(recorded.profile.playerLevel >= 1);
  assert.equal(recorded.profile.achievements.first_flame.count, 1);

  const reloaded = await state.profiles.getProfile("SparseLegacy");
  assert.equal(reloaded.wins, recorded.profile.wins);
  assert.equal(reloaded.gamesPlayed, recorded.profile.gamesPlayed);
  assert.equal(reloaded.playerXP, recorded.profile.playerXP);
  assert.equal(reloaded.playerLevel, recorded.profile.playerLevel);
});

test("state: concurrent local_pvp commits do not lose either player's stats", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "local_pvp" }),
    status: "completed",
    winner: "p1",
    round: 4,
    endReason: null,
    currentPile: [],
    history: [
      { round: 1, result: "p1", warClashes: 0, capturedCards: 2 },
      { round: 2, result: "p2", warClashes: 0, capturedCards: 2 },
      { round: 3, result: "p1", warClashes: 1, capturedCards: 4 },
      { round: 4, result: "p1", warClashes: 0, capturedCards: 2 }
    ]
  };

  match.players.p1.hand = ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water"];
  match.players.p2.hand = ["earth", "wind"];
  match.meta.totalCards = 16;

  await Promise.all([
    state.recordMatchResult({ username: "RaceP1", perspective: "p1", matchState: match }),
    state.recordMatchResult({ username: "RaceP2", perspective: "p2", matchState: match })
  ]);

  const p1 = await state.profiles.getProfile("RaceP1");
  const p2 = await state.profiles.getProfile("RaceP2");

  assert.equal(p1.modeStats.local_pvp.wins, 1);
  assert.equal(p1.modeStats.local_pvp.gamesPlayed, 1);
  assert.equal(p1.modeStats.local_pvp.cardsCaptured, 4);

  assert.equal(p2.modeStats.local_pvp.losses, 1);
  assert.equal(p2.modeStats.local_pvp.gamesPlayed, 1);
  assert.equal(p2.modeStats.local_pvp.cardsCaptured, 1);
});

test("state: comeback_win persists to profile data after unlock", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    round: 6,
    endReason: null,
    currentPile: [],
    history: [
      { round: 1, result: "p2", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, result: "p2", warClashes: 0, capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, result: "p1", warClashes: 1, capturedCards: 6, capturedOpponentCards: 3 }
    ],
    meta: {
      totalCards: 16,
      minHandSizes: { p1: 3, p2: 4 },
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:04:00.000Z",
      durationMs: 240000
    }
  };
  match.players.p1.hand = ["fire", "water", "earth", "wind"];
  match.players.p2.hand = [];

  const recorded = await state.recordMatchResult({
    username: "ComebackPersistUser",
    perspective: "p1",
    matchState: match
  });

  assert.ok(recorded.unlockedAchievements.some((item) => item.id === "comeback_win"));
  assert.ok(recorded.profile.achievements.comeback_win);

  const reloaded = await state.profiles.getProfile("ComebackPersistUser");
  assert.equal(reloaded.achievements.comeback_win.count, 1);
});

test("state: legacy boolean comeback_win data is normalized safely", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LegacyComebackUser", {
    username: "LegacyComebackUser",
    achievements: {
      comeback_win: true
    }
  });

  const profile = await state.profiles.getProfile("LegacyComebackUser");
  assert.equal(profile.achievements.comeback_win.count, 1);
  assert.equal(profile.achievements.comeback_win.firstUnlockedAt, null);
});


test("level rewards: multi-level gains grant all missed rewards once", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const profile = await state.profiles.ensureProfile("LevelRewardUser");
  const granted = applyLevelRewardsForLevelChange(profile, { fromLevel: 1, toLevel: 20 });

  const ids = new Set(granted.grantedRewards.map((reward) => reward.id));
  assert.ok(ids.has("lvl2_tokens"));
  assert.ok(ids.has("lvl3_title_apprentice"));
  assert.ok(ids.has("lvl5_avatar_novice_mage"));
  assert.ok(ids.has("lvl7_tokens"));
  assert.ok(ids.has("lvl10_badge_element_initiate"));
  assert.ok(ids.has("lvl12_tokens"));
  assert.ok(ids.has("lvl15_fire_variant_ember"));
  assert.ok(ids.has("lvl18_background_ancient_arena"));
  assert.ok(ids.has("lvl20_title_elementalist"));
  assert.equal(granted.tokenDelta, 300);

  const second = applyLevelRewardsForLevelChange(granted.profile, { fromLevel: 1, toLevel: 20 });
  assert.equal(second.grantedRewards.length, 0);
  assert.equal(second.tokenDelta, 0);
});

test("state: level milestone chest grants exactly once at level 5 and does not re-grant on reload", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  const updated = await state.profiles.updateProfile("MilestoneChestUser", (current) => ({
    ...current,
    playerXP: thresholds[4],
    playerLevel: 5
  }));

  assert.equal(updated.chests?.milestone ?? 0, 1);
  assert.equal(updated.pendingMilestoneChestRewardLevel, 5);
  assert.equal(updated.milestoneChestGrantedLevels?.["5"], true);

  const reloaded = new StateCoordinator({ dataDir });
  const afterReload = await reloaded.profiles.getProfile("MilestoneChestUser");

  assert.equal(afterReload.chests?.milestone ?? 0, 1);
  assert.equal(afterReload.milestoneChestGrantedLevels?.["5"], true);
});

test("state: level milestone chest grants again at level 10 and skips non-milestone levels", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const thresholds = getXpThresholds();

  const levelFour = await state.profiles.updateProfile("MilestoneStepUser", (current) => ({
    ...current,
    playerXP: thresholds[3],
    playerLevel: 4
  }));
  assert.equal(levelFour.chests?.milestone ?? 0, 0);

  const levelFive = await state.profiles.updateProfile("MilestoneStepUser", (current) => ({
    ...current,
    playerXP: thresholds[4],
    playerLevel: 5
  }));
  assert.equal(levelFive.chests?.milestone ?? 0, 1);

  const levelTen = await state.profiles.updateProfile("MilestoneStepUser", (current) => ({
    ...current,
    playerXP: thresholds[9],
    playerLevel: 10
  }));
  assert.equal(levelTen.chests?.milestone ?? 0, 2);
  assert.equal(levelTen.pendingMilestoneChestRewardLevel, 10);
  assert.equal(levelTen.milestoneChestGrantedLevels?.["5"], true);
  assert.equal(levelTen.milestoneChestGrantedLevels?.["10"], true);
});

test("state: opening a milestone chest grants persisted token rewards in the 2 to 100 range", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir, random: constantRandom(0) });

  const granted = await state.grantChest({
    username: "MilestoneRewardUser",
    chestType: MILESTONE_CHEST_TYPE,
    amount: 1
  });
  assert.equal(granted.chests?.milestone ?? 0, 1);

  const opened = await state.openChest({
    username: "MilestoneRewardUser",
    chestType: MILESTONE_CHEST_TYPE
  });

  assert.equal(opened.rewards.tokens, 2);
  assert.equal(opened.rewards.xp, 0);
  assert.equal(opened.rewards.cosmetic, null);
  assert.equal(opened.profile.chests?.milestone ?? 0, 0);

  const persisted = await state.profiles.getProfile("MilestoneRewardUser");
  assert.equal(persisted.tokens, opened.profile.tokens);
  assert.ok(opened.rewards.tokens >= 2 && opened.rewards.tokens <= 100);
});

test("level rewards: level cap never exceeds 100", () => {
  assert.equal(deriveLevelFromXp(999999999), 100);
});

test("xp breakdown: includes only applicable lines", () => {
  const win = buildXpBreakdown({ isCompleted: true, isQuit: false, didWin: true, warsWon: 2 });
  assert.equal(win.total, 5);
  assert.deepEqual(win.lines.map((line) => line.label), ["Match Completed", "Victory Bonus", "WAR Victory"]);

  const quit = buildXpBreakdown({ isCompleted: true, isQuit: true, didWin: false, warsWon: 0 });
  assert.equal(quit.total, 0);
  assert.equal(quit.lines.length, 0);
});

test("state: level-up grants configured level reward on match completion", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LevelUpMatchUser", {
    playerXP: 24,
    playerLevel: 1,
    tokens: 0,
    dailyChallenges: {
      daily: { lastReset: new Date().toISOString(), progress: { matchesPlayed: 0, matchesWon: 0, warsWon: 0, cardsCaptured: 0, usedAllElementsInMatch: 0 }, completed: {}, rewarded: {} },
      weekly: { lastReset: new Date().toISOString(), progress: { matchesPlayed: 0, matchesWon: 0, warsWon: 0, cardsCaptured: 0, usedAllElementsInMatch: 0 }, completed: {}, rewarded: {} }
    }
  });

  const match = {
    ...createMatch({ mode: "pve" }),
    status: "completed",
    winner: "p1",
    endReason: null,
    round: 1,
    history: [{ round: 1, result: "p1", warClashes: 0, capturedCards: 2 }]
  };

  const result = await state.recordMatchResult({ username: "LevelUpMatchUser", perspective: "p1", matchState: match });
  assert.equal(result.levelAfter, 2);
  assert.ok(result.levelRewards.some((reward) => reward.id === "lvl2_tokens"));
});

test("state: unlocked level title can be equipped and persists after reload", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const profile = await state.profiles.ensureProfile("TitlePersistUser");
  const leveled = applyLevelRewardsForLevelChange(profile, { fromLevel: 1, toLevel: 20 });
  assert.ok(leveled.profile.ownedCosmetics.title.includes("title_apprentice"));
  assert.ok(leveled.profile.ownedCosmetics.title.includes("title_elementalist"));

  await state.profiles.updateProfile("TitlePersistUser", leveled.profile);
  await state.equipCosmetic({
    username: "TitlePersistUser",
    type: "title",
    cosmeticId: "title_elementalist"
  });

  const reloadedState = new StateCoordinator({ dataDir });
  const reloaded = await reloadedState.profiles.getProfile("TitlePersistUser");

  assert.equal(reloaded.equippedCosmetics.title, "title_elementalist");
  assert.ok(reloaded.ownedCosmetics.title.includes("title_elementalist"));
});

