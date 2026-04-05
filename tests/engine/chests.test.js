import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COSMETIC_CATALOG } from "../../src/state/cosmeticSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { applyDailyChallengesForMatch, WEEKLY_CHALLENGE_DEFINITIONS } from "../../src/state/dailyChallengesSystem.js";
import { getXpThresholds } from "../../src/state/levelRewardsSystem.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-chests-"));
}

function randomSequence(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

function buildEligibleChestRewards(profile, { rarities = ["Common"] } = {}) {
  const pool = [];
  const allowedRarities = new Set(rarities);

  for (const [type, items] of Object.entries(COSMETIC_CATALOG)) {
    const owned = new Set(profile.ownedCosmetics?.[type] ?? []);

    for (const item of items) {
      if (
        !item?.purchasable ||
        item.defaultOwned ||
        item.supporterOnly ||
        !allowedRarities.has(item.rarity) ||
        owned.has(item.id)
      ) {
        continue;
      }

      pool.push({ type, id: item.id, rarity: item.rarity });
    }
  }

  return pool;
}

function createCompletedMatch({
  winner = "p1",
  mode = "pve",
  history = [
    {
      result: winner,
      warClashes: 0,
      capturedCards: 2,
      capturedOpponentCards: winner === "draw" ? 0 : 1,
      p1Card: "fire",
      p2Card: "earth"
    }
  ]
} = {}) {
  return {
    status: "completed",
    endReason: null,
    winner,
    mode,
    round: history.length,
    difficulty: "hard",
    history,
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: {
      totalCards: 16
    }
  };
}

function buildCompletedWeeklyProfile(profile) {
  const completedFlags = Object.fromEntries(
    WEEKLY_CHALLENGE_DEFINITIONS.map((challenge) => [challenge.id, true])
  );

  return {
    ...profile,
    dailyChallenges: {
      ...profile.dailyChallenges,
      weekly: {
        ...profile.dailyChallenges.weekly,
        completed: completedFlags,
        rewarded: completedFlags,
        completionChestGranted: false
      }
    }
  };
}

test("chests: grant increments chest inventory", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const granted = await state.grantChest({
    username: "ChestGrantUser",
    chestType: "basic",
    amount: 2
  });

  assert.equal(granted.profile.chests.basic, 2);
  assert.equal(granted.chests.basic, 2);
  assert.deepEqual(granted.granted, { chestType: "basic", amount: 2 });
});

test("chests: basic chest XP branch grants 5 XP", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0])
  });

  await state.grantChest({
    username: "ChestXpUser",
    chestType: "basic",
    amount: 1
  });

  const opened = await state.openChest({
    username: "ChestXpUser",
    chestType: "basic"
  });

  assert.equal(opened.consumed, 1);
  assert.equal(opened.remaining, 0);
  assert.equal(opened.profile.chests.basic, 0);
  assert.equal(opened.rewards.xp, 5);
  assert.equal(opened.rewards.tokens, 0);
  assert.equal(opened.profile.playerXP, 5);
  assert.equal(opened.profile.tokens, 200);
  assert.equal(opened.rewards.cosmetic, null);
});

test("chests: basic chest token branch grants 10 tokens", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0.7])
  });

  await state.grantChest({
    username: "ChestTokenUser",
    chestType: "basic",
    amount: 1
  });

  const opened = await state.openChest({
    username: "ChestTokenUser",
    chestType: "basic"
  });

  assert.equal(opened.remaining, 0);
  assert.equal(opened.rewards.xp, 0);
  assert.equal(opened.rewards.tokens, 10);
  assert.equal(opened.profile.tokens, 210);
  assert.equal(opened.rewards.cosmetic, null);
});

test("chests: basic chest cosmetic branch grants one unowned common cosmetic", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0.97, 0])
  });

  await state.grantChest({
    username: "ChestCosmeticUser",
    chestType: "basic",
    amount: 1
  });

  const opened = await state.openChest({
    username: "ChestCosmeticUser",
    chestType: "basic"
  });

  assert.equal(opened.remaining, 0);
  assert.equal(opened.rewards.xp, 0);
  assert.equal(opened.rewards.tokens, 0);
  assert.ok(opened.rewards.cosmetic);
  assert.equal(opened.rewards.cosmetic.type, "avatar");
  assert.equal(opened.rewards.cosmetic.id, "fireavatarF");
  assert.ok(opened.profile.ownedCosmetics.avatar.includes("fireavatarF"));
});

test("chests: cosmetic branch falls back to 10 tokens when no eligible common cosmetics remain", async () => {
  const dataDir = await createTempDataDir();
  const baseState = new StateCoordinator({ dataDir });
  const baseProfile = await baseState.profiles.ensureProfile("ChestNoDuplicateUser");
  const eligible = buildEligibleChestRewards(baseProfile);

  await baseState.profiles.updateProfile("ChestNoDuplicateUser", (current) => ({
    ...current,
    ownedCosmetics: Object.fromEntries(
      Object.entries(current.ownedCosmetics).map(([type, ids]) => [
        type,
        [
          ...new Set([
            ...ids,
            ...eligible
              .filter((item) => item.type === type)
              .map((item) => item.id)
          ])
        ]
      ])
    )
  }));

  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0.97, 0])
  });

  await state.grantChest({
    username: "ChestNoDuplicateUser",
    chestType: "basic",
    amount: 1
  });

  const opened = await state.openChest({
    username: "ChestNoDuplicateUser",
    chestType: "basic"
  });

  assert.equal(opened.rewards.xp, 0);
  assert.equal(opened.rewards.tokens, 10);
  assert.equal(opened.rewards.cosmetic, null);
  assert.equal(opened.profile.tokens, 210);
});

test("chests: epic chest always grants guaranteed tokens and XP plus a common cosmetic on the cosmetic roll", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0, 0.1, 0.1, 0])
  });

  await state.grantChest({
    username: "EpicCosmeticUser",
    chestType: "epic",
    amount: 1
  });

  const opened = await state.openChest({
    username: "EpicCosmeticUser",
    chestType: "epic"
  });

  assert.equal(opened.rewards.tokens, 40);
  assert.equal(opened.rewards.xp, 20);
  assert.equal(opened.rewards.cosmetic?.rarity, "Common");
  assert.equal(opened.profile.tokens, 240);
  assert.equal(opened.profile.playerXP, 20);
});

test("chests: epic chest falls back to bonus tokens when the rolled cosmetic rarity pool is unavailable", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const profile = await state.profiles.ensureProfile("EpicFallbackUser");
  const rareEligible = buildEligibleChestRewards(profile, { rarities: ["Rare"] });

  await state.profiles.updateProfile("EpicFallbackUser", (current) => ({
    ...current,
    ownedCosmetics: Object.fromEntries(
      Object.entries(current.ownedCosmetics).map(([type, ids]) => [
        type,
        [
          ...new Set([
            ...ids,
            ...rareEligible.filter((item) => item.type === type).map((item) => item.id)
          ])
        ]
      ])
    )
  }));

  const fallbackState = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0, 0.1, 0.95, 0])
  });

  await fallbackState.grantChest({
    username: "EpicFallbackUser",
    chestType: "epic",
    amount: 1
  });

  const opened = await fallbackState.openChest({
    username: "EpicFallbackUser",
    chestType: "epic"
  });

  assert.equal(opened.rewards.xp, 20);
  assert.equal(opened.rewards.tokens, 60);
  assert.equal(opened.rewards.cosmetic, null);
  assert.equal(opened.profile.tokens, 260);
});

test("chests: legendary chest always grants guaranteed tokens and XP plus the rolled bonus-token branch when no cosmetic is rolled", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0, 0.9, 0])
  });

  await state.grantChest({
    username: "LegendaryTokenUser",
    chestType: "legendary",
    amount: 1
  });

  const opened = await state.openChest({
    username: "LegendaryTokenUser",
    chestType: "legendary"
  });

  assert.equal(opened.rewards.xp, 50);
  assert.equal(opened.rewards.tokens, 175);
  assert.equal(opened.rewards.cosmetic, null);
  assert.equal(opened.profile.tokens, 375);
  assert.equal(opened.profile.playerXP, 50);
});

test("chests: legendary chest can grant an epic cosmetic and falls back to bonus tokens when that pool is unavailable", async () => {
  const dataDir = await createTempDataDir();
  const baseState = new StateCoordinator({ dataDir });
  const baseProfile = await baseState.profiles.ensureProfile("LegendaryCosmeticUser");
  const epicEligible = buildEligibleChestRewards(baseProfile, { rarities: ["Epic"] });

  await baseState.grantChest({
    username: "LegendaryCosmeticUser",
    chestType: "legendary",
    amount: 1
  });

  const cosmeticState = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0, 0.1, 0.95, 0])
  });

  const openedCosmetic = await cosmeticState.openChest({
    username: "LegendaryCosmeticUser",
    chestType: "legendary"
  });

  assert.equal(openedCosmetic.rewards.xp, 50);
  assert.equal(openedCosmetic.rewards.tokens, 100);
  assert.equal(openedCosmetic.rewards.cosmetic?.rarity, "Epic");

  await baseState.profiles.updateProfile("LegendaryCosmeticUser", (current) => ({
    ...current,
    chests: {
      ...current.chests,
      legendary: 1
    },
    ownedCosmetics: Object.fromEntries(
      Object.entries(current.ownedCosmetics).map(([type, ids]) => [
        type,
        [
          ...new Set([
            ...ids,
            ...epicEligible.filter((item) => item.type === type).map((item) => item.id)
          ])
        ]
      ])
    )
  }));

  const fallbackState = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0, 0.1, 0.95, 0])
  });

  const openedFallback = await fallbackState.openChest({
    username: "LegendaryCosmeticUser",
    chestType: "legendary"
  });

  assert.equal(openedFallback.rewards.xp, 50);
  assert.equal(openedFallback.rewards.tokens, 175);
  assert.equal(openedFallback.rewards.cosmetic, null);
});

test("chests: weekly completion now grants exactly one epic chest and does not duplicate on repeat processing", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const profile = buildCompletedWeeklyProfile(await state.profiles.ensureProfile("WeeklyChestUser"));
  const matchState = createCompletedMatch();
  const matchStats = {
    gamesPlayed: 1,
    wins: 1,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 1,
    matchesUsingAllElements: 0,
    quickWins: 1,
    timeLimitWins: 0
  };

  const first = applyDailyChallengesForMatch({
    profile,
    matchState,
    perspective: "p1",
    matchStats
  });
  const second = applyDailyChallengesForMatch({
    profile: first.profile,
    matchState,
    perspective: "p1",
    matchStats
  });

  assert.equal(first.profile.chests.epic, 1);
  assert.equal(first.profile.chests.basic, 0);
  assert.equal(second.profile.chests.epic, 1);
});

test("chests: win streak grants epic at exactly 3, legendary at exactly 6, and a fresh later streak can grant epic again", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: () => 0.99
  });
  const winMatch = createCompletedMatch({ winner: "p1" });
  const lossMatch = createCompletedMatch({
    winner: "p2",
    history: [
      {
        result: "p2",
        warClashes: 0,
        capturedCards: 2,
        capturedOpponentCards: 1,
        p1Card: "fire",
        p2Card: "water"
      }
    ]
  });

  for (let index = 0; index < 3; index += 1) {
    await state.recordMatchResult({
      username: "StreakChestUser",
      matchState: winMatch,
      perspective: "p1"
    });
  }

  let profile = await state.profiles.getProfile("StreakChestUser");
  assert.equal(profile.chests.epic, 1);
  assert.equal(profile.chests.legendary, 0);

  await state.recordMatchResult({
    username: "StreakChestUser",
    matchState: winMatch,
    perspective: "p1"
  });

  profile = await state.profiles.getProfile("StreakChestUser");
  assert.equal(profile.chests.epic, 1);

  for (let index = 0; index < 2; index += 1) {
    await state.recordMatchResult({
      username: "StreakChestUser",
      matchState: winMatch,
      perspective: "p1"
    });
  }

  profile = await state.profiles.getProfile("StreakChestUser");
  assert.equal(profile.chests.epic, 1);
  assert.equal(profile.chests.legendary, 1);

  await state.recordMatchResult({
    username: "StreakChestUser",
    matchState: lossMatch,
    perspective: "p1"
  });

  for (let index = 0; index < 3; index += 1) {
    await state.recordMatchResult({
      username: "StreakChestUser",
      matchState: winMatch,
      perspective: "p1"
    });
  }

  profile = await state.profiles.getProfile("StreakChestUser");
  assert.equal(profile.chests.epic, 2);
  assert.equal(profile.chests.legendary, 1);
});

test("chests: legendary level milestones grant exactly once at 25-level intervals and stay stable on reload", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const xpThresholds = getXpThresholds();

  for (const [level, expectedCount] of [
    [25, 1],
    [50, 2],
    [75, 3],
    [100, 4]
  ]) {
    await state.profiles.updateProfile("LegendaryLevelUser", (current) => ({
      ...current,
      playerXP: xpThresholds[level - 1]
    }));

    const profile = await state.profiles.getProfile("LegendaryLevelUser");
    assert.equal(profile.playerLevel, level);
    assert.equal(profile.chests.legendary, expectedCount);
  }

  const reloaded = await state.profiles.getProfile("LegendaryLevelUser");
  assert.equal(reloaded.chests.legendary, 4);
});

test("chests: opening with zero inventory fails safely", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await assert.rejects(
    () =>
      state.openChest({
        username: "NoChestOpenUser",
        chestType: "legendary"
      }),
    /No 'legendary' chests available/
  );
});
