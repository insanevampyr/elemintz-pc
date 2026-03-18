import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StateCoordinator } from "../../src/state/stateCoordinator.js";

function buildCompletedMatch({
  winner = "p1",
  rounds = 3,
  history = [],
  p1Hand = ["fire", "water", "earth", "wind"],
  p2Hand = []
} = {}) {
  return {
    id: "match-cos",
    status: "completed",
    round: rounds,
    mode: "pve",
    difficulty: "balanced",
    winner,
    currentPile: [],
    players: {
      p1: { hand: [...p1Hand], wonRounds: 0 },
      p2: { hand: [...p2Hand], wonRounds: 0 }
    },
    war: {
      active: false,
      clashes: history.reduce((sum, entry) => sum + (entry.warClashes ?? 0), 0)
    },
    history,
    meta: {
      totalCards: p1Hand.length + p2Hand.length
    }
  };
}

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-cosmetics-"));
}

test("cosmetics: new profile has default owned and equipped cosmetics", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const profile = await state.profiles.ensureProfile("CosmeticDefaultUser");

  assert.equal(profile.equippedCosmetics.avatar, "default_avatar");
  assert.equal(profile.equippedCosmetics.cardBack, "default_card_back");
  assert.equal(profile.equippedCosmetics.background, "default_background");
  assert.equal(profile.equippedCosmetics.badge, "none");
  assert.equal(profile.equippedCosmetics.title, "Initiate");
  assert.deepEqual(profile.equippedCosmetics.elementCardVariant, {
    fire: "default_fire_card",
    water: "default_water_card",
    earth: "default_earth_card",
    wind: "default_wind_card"
  });

  assert.ok(profile.ownedCosmetics.avatar.includes("default_avatar"));
  assert.ok(profile.ownedCosmetics.cardBack.includes("default_card_back"));
  assert.ok(profile.ownedCosmetics.background.includes("default_background"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("default_fire_card"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("default_water_card"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("default_earth_card"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("default_wind_card"));
  assert.ok(profile.ownedCosmetics.title.includes("Initiate"));

  const cosmetics = await state.getCosmetics("CosmeticDefaultUser");
  const unlockTag = cosmetics.catalog.title.find((item) => item.id === "Flame Vanguard").unlockSource.type;
  assert.equal(unlockTag, "achievement reward");
});

test("cosmetics: achievement reward grants unlockable title", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 3,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"],
    p2Hand: []
  });

  const result = await state.recordMatchResult({
    username: "RewardUser",
    perspective: "p1",
    matchState: match
  });

  assert.ok(result.grantedCosmetics.some((item) => item.id === "Flame Vanguard"));
  assert.ok(result.profile.ownedCosmetics.title.includes("Flame Vanguard"));
});

test("cosmetics: equip updates profile and legacy fields", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const match = buildCompletedMatch({
    winner: "p1",
    rounds: 3,
    history: [{ result: "p1", warClashes: 0, capturedCards: 2 }],
    p1Hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire", "water", "earth", "wind"],
    p2Hand: []
  });

  await state.recordMatchResult({
    username: "EquipUser",
    perspective: "p1",
    matchState: match
  });

  const equipped = await state.equipCosmetic({
    username: "EquipUser",
    type: "title",
    cosmeticId: "Flame Vanguard"
  });

  assert.equal(equipped.profile.equippedCosmetics.title, "Flame Vanguard");
  assert.equal(equipped.profile.title, "Flame Vanguard");
});

test("cosmetics: missing background migration falls back to default background", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("BackgroundMig", {
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      badge: "none",
      title: "Initiate"
    }
  });

  const profile = await state.profiles.getProfile("BackgroundMig");
  assert.equal(profile.equippedCosmetics.background, "default_background");
});

test("cosmetics: existing selected background is preserved", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const purchased = await state.buyStoreItem({
    username: "BackgroundKeep",
    type: "background",
    cosmeticId: "wind_background"
  });

  await state.equipCosmetic({
    username: "BackgroundKeep",
    type: "background",
    cosmeticId: "wind_background"
  });

  const profile = await state.profiles.getProfile("BackgroundKeep");
  assert.equal(profile.equippedCosmetics.background, "wind_background");
  assert.ok(purchased.profile.ownedCosmetics.background.includes("wind_background"));
});

test("cosmetics: default background remains owned even after malformed ownership update", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("DefaultOwnedGuard", {
    ownedCosmetics: {
      avatar: [],
      cardBack: [],
      background: [],
      elementCardVariant: [],
      badge: [],
      title: []
    }
  });

  const profile = await state.profiles.getProfile("DefaultOwnedGuard");
  assert.ok(profile.ownedCosmetics.background.includes("default_background"));
});

test("cosmetics: elemental variant purchase/equip applies to one element only", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("VariantUser", { tokens: 1000 });

  await state.buyStoreItem({
    username: "VariantUser",
    type: "elementCardVariant",
    cosmeticId: "arcane_fire_card"
  });

  const equipped = await state.equipCosmetic({
    username: "VariantUser",
    type: "elementCardVariant",
    cosmeticId: "arcane_fire_card"
  });

  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.fire, "arcane_fire_card");
  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.water, "default_water_card");
  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.earth, "default_earth_card");
  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.wind, "default_wind_card");
  assert.ok(equipped.profile.ownedCosmetics.elementCardVariant.includes("arcane_fire_card"));
});

test("cosmetics: legacy bundle migration maps equipped variants per element", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LegacyVariantUser", {
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["default_background"],
      elementCardVariant: ["default_element_cards", "arcane_element_cards"],
      badge: ["none"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      elementCardVariant: "arcane_element_cards",
      badge: "none",
      title: "Initiate"
    }
  });

  const profile = await state.profiles.getProfile("LegacyVariantUser");
  assert.deepEqual(profile.equippedCosmetics.elementCardVariant, {
    fire: "arcane_fire_card",
    water: "arcane_water_card",
    earth: "arcane_earth_card",
    wind: "arcane_wind_card"
  });
});

test("cosmetics: equipped background persists across restart-style reload", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  await stateA.buyStoreItem({
    username: "BgPersistUser",
    type: "background",
    cosmeticId: "wind_background"
  });

  await stateA.equipCosmetic({
    username: "BgPersistUser",
    type: "background",
    cosmeticId: "wind_background"
  });

  const stateB = new StateCoordinator({ dataDir });
  const profile = await stateB.profiles.getProfile("BgPersistUser");
  assert.equal(profile.equippedCosmetics.background, "wind_background");
  assert.equal(profile.cosmetics.background, "wind_background");
});

test("cosmetics: equipped featured badge persists across restart-style reload", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  await stateA.grantSupporterPass("BadgePersistUser");
  await stateA.equipCosmetic({
    username: "BadgePersistUser",
    type: "badge",
    cosmeticId: "supporter_badge"
  });

  const stateB = new StateCoordinator({ dataDir });
  const profile = await stateB.profiles.getProfile("BadgePersistUser");
  assert.equal(profile.equippedCosmetics.badge, "supporter_badge");
});

test("cosmetics: legacy background path values migrate to supported background ids", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LegacyBgUser", {
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["assets/EleMintzIcon.png", "assets/backgrounds/windBattleArena.png"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "assets/backgrounds/windBattleArena.png",
      elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
      badge: "none",
      title: "Initiate"
    }
  });

  const profile = await state.profiles.getProfile("LegacyBgUser");
  assert.equal(profile.equippedCosmetics.background, "wind_background");
  assert.ok(profile.ownedCosmetics.background.includes("default_background"));
  assert.ok(profile.ownedCosmetics.background.includes("wind_background"));
});

test("cosmetics: newly added water variant equips only water and persists across restart", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  await stateA.profiles.updateProfile("WaterVariantUser", { tokens: 1000 });

  await stateA.buyStoreItem({
    username: "WaterVariantUser",
    type: "elementCardVariant",
    cosmeticId: "wave_water_card"
  });

  const equipped = await stateA.equipCosmetic({
    username: "WaterVariantUser",
    type: "elementCardVariant",
    cosmeticId: "wave_water_card"
  });

  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.water, "wave_water_card");
  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.fire, "default_fire_card");
  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.earth, "default_earth_card");
  assert.equal(equipped.profile.equippedCosmetics.elementCardVariant.wind, "default_wind_card");

  const stateB = new StateCoordinator({ dataDir });
  const profile = await stateB.profiles.getProfile("WaterVariantUser");
  assert.equal(profile.equippedCosmetics.elementCardVariant.water, "wave_water_card");
});
