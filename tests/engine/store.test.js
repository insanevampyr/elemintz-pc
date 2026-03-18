import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StateCoordinator } from "../../src/state/stateCoordinator.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-store-"));
}

test("store: inventory includes required categories", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const store = await state.getStore("StoreUser");

  assert.ok(store.tokens >= 0);
  assert.ok(store.catalog.avatar);
  assert.ok(store.catalog.cardBack);
  assert.ok(store.catalog.background);
  assert.ok(store.catalog.elementCardVariant);
  assert.ok(store.catalog.title);
  assert.ok(store.catalog.badge);
});

test("store: token purchase flow deducts currency and grants ownership", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const before = await state.getStore("Buyer");
  const bought = await state.buyStoreItem({
    username: "Buyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });

  assert.equal(bought.purchase.status, "purchased");
  assert.ok(bought.store.tokens < before.tokens);
  assert.ok(bought.profile.ownedCosmetics.avatar.includes("fire_avatar_f"));
});

test("store: cosmetic unlock tracking updates first-purchase flags and total owned from successful purchases", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("TrackingBuyer", { tokens: 5000 });
  const beforeProfile = await state.profiles.getProfile("TrackingBuyer");
  const beforeTotal = beforeProfile.cosmeticUnlockTracking.TOTAL_COSMETICS_OWNED;

  const avatarPurchase = await state.buyStoreItem({
    username: "TrackingBuyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });
  const cardBackPurchase = await state.buyStoreItem({
    username: "TrackingBuyer",
    type: "cardBack",
    cosmeticId: "ember_card_back"
  });
  const backgroundPurchase = await state.buyStoreItem({
    username: "TrackingBuyer",
    type: "background",
    cosmeticId: "ruin_arena_background"
  });
  const variantPurchase = await state.buyStoreItem({
    username: "TrackingBuyer",
    type: "elementCardVariant",
    cosmeticId: "blue_fire_card"
  });

  const afterProfile = await state.profiles.getProfile("TrackingBuyer");
  const tracking = afterProfile.cosmeticUnlockTracking;

  assert.deepEqual(avatarPurchase.tracking.unlockedMilestones, ["FIRST_AVATAR_PURCHASED"]);
  assert.deepEqual(cardBackPurchase.tracking.unlockedMilestones, ["FIRST_CARD_BACK_PURCHASED"]);
  assert.deepEqual(backgroundPurchase.tracking.unlockedMilestones, ["FIRST_BACKGROUND_PURCHASED"]);
  assert.deepEqual(variantPurchase.tracking.unlockedMilestones, ["FIRST_CARD_VARIANT_PURCHASED"]);
  assert.equal(tracking.FIRST_AVATAR_PURCHASED, true);
  assert.equal(tracking.FIRST_CARD_BACK_PURCHASED, true);
  assert.equal(tracking.FIRST_BACKGROUND_PURCHASED, true);
  assert.equal(tracking.FIRST_CARD_VARIANT_PURCHASED, true);
  assert.equal(tracking.TOTAL_COSMETICS_OWNED, beforeTotal + 4);
});

test("store: cosmetic unlock tracking does not re-trigger first purchase flags for already-owned items", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("AlreadyOwnedBuyer", { tokens: 1000 });
  const first = await state.buyStoreItem({
    username: "AlreadyOwnedBuyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });
  const second = await state.buyStoreItem({
    username: "AlreadyOwnedBuyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });

  assert.deepEqual(first.tracking.unlockedMilestones, ["FIRST_AVATAR_PURCHASED"]);
  assert.equal(second.purchase.status, "already-owned");
  assert.deepEqual(second.tracking.unlockedMilestones, []);
  assert.equal(second.tracking.totalOwnedDelta, 0);
});

test("store: cosmetic unlock tracking includes first title and badge unlocks and total owned counts them", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const beforeProfile = await state.profiles.ensureProfile("UnlockTrackingUser");
  const beforeTotal = beforeProfile.cosmeticUnlockTracking.TOTAL_COSMETICS_OWNED;
  const result = await state.grantSupporterPass("UnlockTrackingUser");

  assert.equal(result.profile.cosmeticUnlockTracking.FIRST_TITLE_UNLOCKED, true);
  assert.equal(result.profile.cosmeticUnlockTracking.FIRST_BADGE_UNLOCKED, true);
  assert.ok(result.profile.cosmeticUnlockTracking.TOTAL_COSMETICS_OWNED >= beforeTotal + 3);
  assert.ok(result.profile.ownedCosmetics.title.includes("Arena Founder"));
  assert.ok(result.profile.ownedCosmetics.badge.includes("supporter_badge"));
});

test("store: equip works after purchase", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.buyStoreItem({
    username: "EquipBuyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });

  const equipped = await state.equipCosmetic({
    username: "EquipBuyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });

  assert.equal(equipped.profile.equippedCosmetics.avatar, "fire_avatar_f");
});

test("store: achievement-locked items are not purchasable", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await assert.rejects(
    () =>
      state.buyStoreItem({
        username: "LockedBuyer",
        type: "title",
        cosmeticId: "Flame Vanguard"
      }),
    /not purchasable/
  );
});

test("store: badges are not purchasable", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const store = await state.getStore("BadgeBuyer");
  const badgeItems = store.catalog.badge;

  assert.ok(badgeItems.length > 0);
  assert.ok(badgeItems.every((item) => item.purchasable === false));

  await assert.rejects(
    () =>
      state.buyStoreItem({
        username: "BadgeBuyer",
        type: "badge",
        cosmeticId: "war_machine_badge"
      }),
    /not purchasable/
  );
});

test("store: founder/supporter grant unlocks supporter cosmetics", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const result = await state.grantSupporterPass("FounderUser");

  assert.equal(result.profile.supporterPass, true);
  assert.ok(result.profile.ownedCosmetics.title.includes("Arena Founder"));
  assert.ok(result.profile.ownedCosmetics.badge.includes("supporter_badge"));
  assert.ok(result.profile.ownedCosmetics.cardBack.includes("founder_deluxe_card_back"));
  assert.ok(!result.profile.ownedCosmetics.cardBack.includes("supporter_card_back"));
});

test("store: legacy supporter card back is migrated out of inventories", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LegacySupporter", {
    supporterPass: true,
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back", "supporter_card_back"],
      background: ["default_background"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "supporter_card_back",
      background: "default_background",
      elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
      badge: "none",
      title: "Initiate"
    }
  });

  const profile = await state.profiles.getProfile("LegacySupporter");
  assert.ok(!profile.ownedCosmetics.cardBack.includes("supporter_card_back"));
  assert.ok(profile.ownedCosmetics.cardBack.includes("founder_deluxe_card_back"));
  assert.equal(profile.equippedCosmetics.cardBack, "founder_deluxe_card_back");
});

test("store: purchase deduction persists across restart-style reload", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  const before = await stateA.getStore("PersistBuyer");
  const purchase = await stateA.buyStoreItem({
    username: "PersistBuyer",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });

  assert.equal(purchase.purchase.status, "purchased");
  assert.equal(purchase.store.tokens, before.tokens - 150);

  const stateB = new StateCoordinator({ dataDir });
  const afterRestart = await stateB.getStore("PersistBuyer");

  assert.equal(afterRestart.tokens, before.tokens - 150);
  assert.ok(afterRestart.catalog.avatar.find((item) => item.id === "fire_avatar_f")?.owned);
});

test("store: username-specific test token grant is not applied through store access", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  const first = await stateA.getStore("VampyrLee");
  assert.equal(first.tokens, 200);

  await stateA.buyStoreItem({
    username: "VampyrLee",
    type: "avatar",
    cosmeticId: "fire_avatar_f"
  });

  const stateB = new StateCoordinator({ dataDir });
  const afterRestart = await stateB.getStore("VampyrLee");
  assert.equal(afterRestart.tokens, 50);
});

test("store: buying one element variant does not grant other element variants", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("ElementBuyer", { tokens: 1000 });

  await state.buyStoreItem({
    username: "ElementBuyer",
    type: "elementCardVariant",
    cosmeticId: "arcane_fire_card"
  });

  const cosmetics = await state.getCosmetics("ElementBuyer");
  const owned = cosmetics.owned.elementCardVariant;

  assert.ok(owned.includes("arcane_fire_card"));
  assert.ok(!owned.includes("arcane_water_card"));
  assert.ok(!owned.includes("arcane_earth_card"));
  assert.ok(!owned.includes("arcane_wind_card"));
});

test("store: avatar catalog includes all elemental avatar options", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const store = await state.getStore("AvatarCatalogUser");
  const avatarIds = new Set(store.catalog.avatar.map((item) => item.id));

  const expected = [
    "default_avatar",
    "fireavatarF",
    "fireavatarM",
    "wateravatarF",
    "wateravatarM",
    "earthavatarF",
    "earthavatarM",
    "windavatarF",
    "windavatarM",
    "fire_avatar_f",
    "fire_avatar_m",
    "water_avatar_f",
    "water_avatar_m",
    "earth_avatar_f",
    "earth_avatar_m",
    "wind_avatar_f",
    "wind_avatar_m"
  ];

  for (const id of expected) {
    assert.ok(avatarIds.has(id), `missing avatar ${id}`);
  }
});

test("store: expanded per-element variant catalog is available", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const store = await state.getStore("VariantCatalogUser");
  const variants = store.catalog.elementCardVariant;
  const byId = new Map(variants.map((item) => [item.id, item]));

  const expected = [
    ["arcane_blue_flame_card", "fire"],
    ["blue_fire_card", "fire"],
    ["classic_flame_card", "fire"],
    ["water_pool_card", "water"],
    ["wave_water_card", "water"],
    ["bold_earth_card", "earth"],
    ["rock_storm_card", "earth"],
    ["smoke_wind_card", "wind"],
    ["smokey_wind_card", "wind"]
  ];

  for (const [id, element] of expected) {
    const item = byId.get(id);
    assert.ok(item, `missing variant ${id}`);
    assert.equal(item.element, element);
    assert.equal(item.purchasable, true);
  }
});

test("store: newly added elemental avatar can be purchased and equipped", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const before = await state.getStore("WindAvatarBuyer");
  const purchased = await state.buyStoreItem({
    username: "WindAvatarBuyer",
    type: "avatar",
    cosmeticId: "wind_avatar_m"
  });

  assert.equal(purchased.purchase.status, "purchased");
  assert.equal(purchased.store.tokens, before.tokens - 150);

  const equipped = await state.equipCosmetic({
    username: "WindAvatarBuyer",
    type: "avatar",
    cosmeticId: "wind_avatar_m"
  });

  assert.equal(equipped.profile.equippedCosmetics.avatar, "wind_avatar_m");
});

test("store: rarity metadata and stage 2 prices are set correctly", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const store = await state.getStore("RarityUser");

  const byType = (type) => new Map((store.catalog[type] ?? []).map((item) => [item.id, item]));
  const avatars = byType("avatar");
  const backs = byType("cardBack");
  const backgrounds = byType("background");
  const variants = byType("elementCardVariant");
  const titles = byType("title");
  const badges = byType("badge");

  assert.equal(avatars.get("fire_avatar_m")?.rarity, "Common");
  assert.equal(avatars.get("fire_avatar_m")?.price, 150);
  assert.equal(avatars.get("water_avatar_f")?.rarity, "Rare");
  assert.equal(avatars.get("water_avatar_f")?.price, 300);
  assert.equal(avatars.get("earth_avatar_m")?.rarity, "Rare");
  assert.equal(avatars.get("earth_avatar_m")?.price, 300);
  assert.equal(avatars.get("wind_avatar_f")?.rarity, "Common");
  assert.equal(avatars.get("wind_avatar_f")?.price, 150);
  assert.equal(avatars.get("avatar_veteran_champion")?.price, 600);

  assert.equal(backs.get("ember_card_back")?.rarity, "Common");
  assert.equal(backs.get("ember_card_back")?.price, 120);
  assert.equal(backs.get("crystal_card_back")?.rarity, "Rare");
  assert.equal(backs.get("crystal_card_back")?.price, 250);
  assert.equal(backs.get("void_card_back")?.rarity, "Epic");
  assert.equal(backs.get("void_card_back")?.price, 500);
  assert.equal(backs.get("founder_deluxe_card_back")?.rarity, "Legendary");
  assert.equal(backs.get("founder_deluxe_card_back")?.price, 800);
  assert.equal(backs.get("founder_deluxe_card_back")?.purchasable, false);
  assert.equal(backs.get("founder_deluxe_card_back")?.unlockSource?.type, "supporter");
  assert.ok(!backs.has("supporter_card_back"));
  assert.equal(backs.get("default_card_back")?.image, "card_backs/default_back.jpg");

  assert.equal(backgrounds.get("lava_throne_background")?.rarity, "Epic");
  assert.equal(backgrounds.get("lava_throne_background")?.price, 700);
  assert.equal(backgrounds.get("frozen_temple_background")?.rarity, "Rare");
  assert.equal(backgrounds.get("frozen_temple_background")?.price, 350);
  assert.equal(backgrounds.get("ruin_arena_background")?.rarity, "Common");
  assert.equal(backgrounds.get("ruin_arena_background")?.price, 90);
  assert.equal(backgrounds.get("void_altar_background")?.rarity, "Legendary");
  assert.equal(backgrounds.get("void_altar_background")?.price, 1000);

  assert.equal(avatars.get("avatar_battle_adept")?.rarity, "Rare");
  assert.equal(avatars.get("avatar_battle_adept")?.price, 300);
  assert.equal(avatars.get("avatar_veteran_champion")?.rarity, "Epic");
  assert.equal(avatars.get("avatar_veteran_champion")?.price, 600);
  assert.equal(avatars.get("avatar_grand_archmage")?.rarity, "Legendary");
  assert.equal(avatars.get("avatar_grand_archmage")?.price, 900);

  assert.equal(backgrounds.get("background_storm_citadel")?.rarity, "Rare");
  assert.equal(backgrounds.get("background_storm_citadel")?.price, 350);
  assert.equal(backgrounds.get("background_sky_temple")?.rarity, "Epic");
  assert.equal(backgrounds.get("background_sky_temple")?.price, 700);

  assert.equal(variants.get("arcane_fire_card")?.rarity, "Rare");
  assert.equal(variants.get("arcane_fire_card")?.price, 250);
  assert.equal(variants.get("arcane_blue_flame_card")?.rarity, "Rare");
  assert.equal(variants.get("arcane_blue_flame_card")?.price, 250);
  assert.equal(variants.get("blue_fire_card")?.rarity, "Common");
  assert.equal(variants.get("blue_fire_card")?.price, 120);
  assert.equal(variants.get("wave_water_card")?.rarity, "Rare");
  assert.equal(variants.get("wave_water_card")?.price, 250);
  assert.equal(variants.get("arcane_water_card")?.rarity, "Rare");
  assert.equal(variants.get("arcane_water_card")?.price, 250);
  assert.equal(variants.get("bold_earth_card")?.rarity, "Rare");
  assert.equal(variants.get("bold_earth_card")?.price, 250);
  assert.equal(variants.get("rock_storm_card")?.rarity, "Rare");
  assert.equal(variants.get("rock_storm_card")?.price, 250);
  assert.equal(variants.get("smokey_wind_card")?.rarity, "Rare");
  assert.equal(variants.get("smokey_wind_card")?.price, 250);
  assert.equal(variants.get("water_variant_crystal")?.rarity, "Rare");
  assert.equal(variants.get("water_variant_crystal")?.price, 250);
  assert.equal(variants.get("earth_variant_titan")?.rarity, "Epic");
  assert.equal(variants.get("earth_variant_titan")?.price, 450);

  assert.equal(titles.get("Arena Founder")?.rarity, "Legendary");
  assert.equal(titles.get("Arena Founder")?.price, 500);
  assert.equal(titles.get("title_war_master")?.rarity, "Rare");
  assert.equal(titles.get("title_war_master")?.price, 200);
  assert.equal(titles.get("title_element_sovereign")?.rarity, "Epic");
  assert.equal(titles.get("title_element_sovereign")?.price, 350);
  assert.equal(titles.get("title_master_elemintz")?.rarity, "Legendary");
  assert.equal(titles.get("title_master_elemintz")?.price, 500);
  assert.equal(titles.get("Token Tycoon")?.rarity, "Common");
  assert.equal(titles.get("Token Tycoon")?.price, 100);

  assert.equal(badges.get("supporter_badge")?.rarity, "Legendary");
  assert.equal(badges.get("supporter_badge")?.price, 500);
  assert.ok(!badges.has("war_machine_badge"));
  assert.equal(badges.get("badge_arena_challenger")?.rarity, "Rare");
  assert.equal(badges.get("badge_arena_challenger")?.price, 200);
  assert.equal(badges.get("badge_element_veteran")?.rarity, "Epic");
  assert.equal(badges.get("badge_element_veteran")?.price, 350);
  assert.equal(badges.get("badge_arena_legend")?.rarity, "Legendary");
  assert.equal(badges.get("badge_arena_legend")?.price, 500);
});

test("store: war machine badge is hidden from store and remains achievement-locked", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const store = await state.getStore("BadgeVisibilityUser");
  const badgeIds = new Set((store.catalog.badge ?? []).map((item) => item.id));
  assert.ok(!badgeIds.has("war_machine_badge"));

  const cosmetics = await state.getCosmetics("BadgeVisibilityUser");
  const warMachine = (cosmetics.catalog.badge ?? []).find((item) => item.id === "war_machine_badge");
  assert.ok(warMachine);
  assert.equal(warMachine.purchasable, false);
  assert.equal(warMachine.unlockSource?.type, "achievement reward");
  assert.equal(warMachine.unlockSource?.achievementId, "war_machine");
});
