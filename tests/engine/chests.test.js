import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COSMETIC_CATALOG } from "../../src/state/cosmeticSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

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

function buildEligibleChestRewards(profile) {
  const pool = [];

  for (const [type, items] of Object.entries(COSMETIC_CATALOG)) {
    const owned = new Set(profile.ownedCosmetics?.[type] ?? []);

    for (const item of items) {
      if (
        !item?.purchasable ||
        item.defaultOwned ||
        item.supporterOnly ||
        item.rarity !== "Common" ||
        owned.has(item.id)
      ) {
        continue;
      }

      pool.push({ type, id: item.id });
    }
  }

  return pool;
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
