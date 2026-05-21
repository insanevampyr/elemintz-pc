import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StateCoordinator } from "../../src/state/stateCoordinator.js";

const NEW_TITLE_EXPECTATIONS = Object.freeze([
  ["title_chaos_gremlin", "Common", 100],
  ["title_soft_doom", "Common", 100],
  ["title_pretty_problem", "Common", 100],
  ["title_silent_menace", "Rare", 250],
  ["title_drama_magnet", "Rare", 250],
  ["title_neon_rebel", "Rare", 250],
  ["title_velvet_villain", "Epic", 500],
  ["title_void_doll", "Epic", 500],
  ["title_glitch_royalty", "Epic", 500],
  ["title_crownless_king", "Legendary", 850],
  ["title_divine_menace", "Legendary", 850],
  ["title_cataclysm_icon", "Legendary", 850],
  ["title_spellwired", "Legendary", 850]
]);

const NEW_AVATAR_EXPECTATIONS = Object.freeze([
  ["avatar_smirk_ember", "Common", 150],
  ["avatar_bubble_brat", "Common", 150],
  ["avatar_moss_mood", "Common", 150],
  ["avatar_neon_puff", "Common", 150],
  ["avatar_stone_cold_cutie", "Rare", 300],
  ["avatar_storm_brat", "Rare", 300],
  ["avatar_tidal_diva", "Rare", 300],
  ["avatar_ashen_trickster", "Rare", 300],
  ["avatar_corrupt_cherub", "Epic", 600],
  ["avatar_void_glam", "Epic", 600],
  ["avatar_riot_halo", "Epic", 600],
  ["avatar_neon_pyre_entity", "Epic", 600],
  ["avatar_neon_tide_entity", "Epic", 600],
  ["avatar_neon_stone_entity", "Epic", 600],
  ["avatar_neon_gale_entity", "Epic", 600],
  ["avatar_golden_menace", "Legendary", 900],
  ["avatar_chaos_monarch", "Legendary", 900],
  ["avatar_rose_riot", "Legendary", 900]
]);

const NEON_ARCANA_AVATAR_IDS = new Set([
  "avatar_neon_pyre_entity",
  "avatar_neon_tide_entity",
  "avatar_neon_stone_entity",
  "avatar_neon_gale_entity"
]);

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
    cosmeticId: "fireavatarF"
  });

  assert.equal(bought.purchase.status, "purchased");
  assert.ok(bought.store.tokens < before.tokens);
  assert.ok(bought.profile.ownedCosmetics.avatar.includes("fireavatarF"));
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
    cosmeticId: "fireavatarF"
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
    cosmeticId: "fireavatarF"
  });
  const second = await state.buyStoreItem({
    username: "AlreadyOwnedBuyer",
    type: "avatar",
    cosmeticId: "fireavatarF"
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
    cosmeticId: "fireavatarF"
  });

  const equipped = await state.equipCosmetic({
    username: "EquipBuyer",
    type: "avatar",
    cosmeticId: "fireavatarF"
  });

  assert.equal(equipped.profile.equippedCosmetics.avatar, "fireavatarF");
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

test("store: founder status grant is idempotent-safe and grants the founder bundle once", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  const first = await state.grantFounderStatus("FounderGrantUser");

  assert.equal(first.founderStatusActive, true);
  assert.equal(first.profile.supporterPass, true);
  assert.deepEqual(
    first.grantedItems.map((item) => item.cosmeticId).sort(),
    ["Arena Founder", "founder_deluxe_card_back", "supporter_badge"].sort()
  );
  assert.deepEqual(first.skippedItems, []);

  const second = await state.grantFounderStatus("FounderGrantUser");

  assert.equal(second.founderStatusActive, true);
  assert.equal(second.profile.supporterPass, true);
  assert.deepEqual(second.grantedItems, []);
  assert.deepEqual(
    second.skippedItems.map((item) => item.cosmeticId).sort(),
    ["Arena Founder", "founder_deluxe_card_back", "supporter_badge"].sort()
  );
});

test("store: founder status grant only fills missing founder bundle items", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("PartialFounderUser", {
    supporterPass: false,
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["default_background"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none", "supporter_badge"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      },
      badge: "none",
      title: "Initiate"
    }
  });

  const result = await state.grantFounderStatus("PartialFounderUser");

  assert.equal(result.profile.supporterPass, true);
  assert.deepEqual(
    result.grantedItems.map((item) => item.cosmeticId).sort(),
    ["Arena Founder", "founder_deluxe_card_back"].sort()
  );
  assert.deepEqual(result.skippedItems.map((item) => item.cosmeticId), ["supporter_badge"]);
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
    cosmeticId: "fireavatarF"
  });

  assert.equal(purchase.purchase.status, "purchased");
  assert.equal(purchase.store.tokens, before.tokens - 150);

  const stateB = new StateCoordinator({ dataDir });
  const afterRestart = await stateB.getStore("PersistBuyer");

  assert.equal(afterRestart.tokens, before.tokens - 150);
  assert.ok(afterRestart.catalog.avatar.find((item) => item.id === "fireavatarF")?.owned);
});

test("store: username-specific test token grant is not applied through store access", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  const first = await stateA.getStore("VampyrLee");
  assert.equal(first.tokens, 200);

  await stateA.buyStoreItem({
    username: "VampyrLee",
    type: "avatar",
    cosmeticId: "fireavatarF"
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

  await state.profiles.updateProfile("WindAvatarBuyer", { tokens: 500 });
  const before = await state.getStore("WindAvatarBuyer");
  const purchased = await state.buyStoreItem({
    username: "WindAvatarBuyer",
    type: "avatar",
    cosmeticId: "wind_avatar_m"
  });

  assert.equal(purchased.purchase.status, "purchased");
  assert.equal(purchased.store.tokens, before.tokens - 300);

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
  const cosmetics = await state.getCosmetics("RarityUser");

  const byType = (type) => new Map((store.catalog[type] ?? []).map((item) => [item.id, item]));
  const cosmeticByType = (type) => new Map((cosmetics.catalog[type] ?? []).map((item) => [item.id, item]));
  const avatars = byType("avatar");
  const backs = byType("cardBack");
  const backgrounds = byType("background");
  const variants = byType("elementCardVariant");
  const titles = byType("title");
  const badges = byType("badge");
  const cosmeticAvatars = cosmeticByType("avatar");
  const cosmeticBackgrounds = cosmeticByType("background");
  const cosmeticVariants = cosmeticByType("elementCardVariant");

  assert.equal(avatars.get("fire_avatar_m")?.rarity, "Rare");
  assert.equal(avatars.get("fire_avatar_m")?.price, 300);
  assert.equal(avatars.get("wateravatarF")?.rarity, "Common");
  assert.equal(avatars.get("wateravatarF")?.price, 150);
  assert.equal(avatars.get("earthavatarM")?.rarity, "Common");
  assert.equal(avatars.get("earthavatarM")?.price, 150);
  assert.equal(avatars.get("wind_avatar_f")?.rarity, "Rare");
  assert.equal(avatars.get("wind_avatar_f")?.price, 300);
  assert.equal(avatars.get("avatar_flame_spirit_f")?.rarity, "Epic");
  assert.equal(avatars.get("avatar_flame_spirit_f")?.price, 600);
  assert.equal(avatars.get("avatar_tidal_warden_m")?.rarity, "Epic");
  assert.equal(avatars.get("avatar_tidal_warden_m")?.price, 600);
  assert.equal(avatars.get("avatar_veteran_champion")?.price, 600);

  assert.equal(backs.get("ember_card_back")?.rarity, "Rare");
  assert.equal(backs.get("ember_card_back")?.price, 250);
  assert.equal(backs.get("crystal_card_back")?.rarity, "Rare");
  assert.equal(backs.get("crystal_card_back")?.price, 250);
  assert.equal(backs.get("storm_sigil_card_back")?.rarity, "Common");
  assert.equal(backs.get("storm_sigil_card_back")?.price, 120);
  assert.ok(!backs.has("void_card_back"));
  assert.equal(backs.get("cardback_lava_core")?.rarity, "Epic");
  assert.equal(backs.get("cardback_lava_core")?.price, 500);
  assert.equal(backs.get("cardback_obsidian_halo")?.rarity, "Rare");
  assert.equal(backs.get("cardback_obsidian_halo")?.price, 250);
  assert.equal(backs.get("founder_deluxe_card_back")?.rarity, "Legendary");
  assert.equal(backs.get("founder_deluxe_card_back")?.price, 800);
  assert.equal(backs.get("founder_deluxe_card_back")?.purchasable, false);
  assert.equal(backs.get("founder_deluxe_card_back")?.unlockSource?.type, "supporter");
  assert.ok(!backs.has("supporter_card_back"));
  assert.equal(backs.get("default_card_back")?.image, "card_backs/default_back.jpg");

  assert.ok(!backgrounds.has("lava_throne_background"));
  assert.equal(cosmeticBackgrounds.get("lava_throne_background")?.rarity, "Epic");
  assert.equal(cosmeticBackgrounds.get("lava_throne_background")?.price, 700);
  assert.equal(backgrounds.get("frozen_temple_background")?.rarity, "Rare");
  assert.equal(backgrounds.get("frozen_temple_background")?.price, 350);
  assert.equal(backgrounds.get("ruin_arena_background")?.rarity, "Common");
  assert.equal(backgrounds.get("ruin_arena_background")?.price, 90);
  assert.ok(!backgrounds.has("void_altar_background"));
  assert.equal(cosmeticBackgrounds.get("void_altar_background")?.rarity, "Legendary");
  assert.equal(cosmeticBackgrounds.get("void_altar_background")?.price, 1000);

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
  assert.equal(variants.get("rock_storm_card")?.rarity, "Epic");
  assert.equal(variants.get("rock_storm_card")?.price, 450);
  assert.equal(variants.get("smokey_wind_card")?.rarity, "Rare");
  assert.equal(variants.get("smokey_wind_card")?.price, 250);
  assert.equal(variants.get("water_variant_crystal")?.rarity, "Rare");
  assert.equal(variants.get("water_variant_crystal")?.price, 250);
  assert.equal(variants.get("earth_variant_titan")?.rarity, "Epic");
  assert.equal(variants.get("earth_variant_titan")?.price, 450);
  assert.equal(variants.get("fire_variant_blue_inferno")?.rarity, "Epic");
  assert.equal(variants.get("fire_variant_blue_inferno")?.price, 450);
  assert.ok(!variants.has("fire_variant_crownfire"));
  assert.equal(cosmeticVariants.get("fire_variant_crownfire")?.rarity, "Legendary");
  assert.equal(cosmeticVariants.get("fire_variant_crownfire")?.price, 700);
  assert.equal(variants.get("fire_variant_ember_core")?.rarity, "Epic");
  assert.equal(variants.get("fire_variant_ember_core")?.price, 450);
  assert.equal(variants.get("fire_variant_transparent_flame")?.rarity, "Legendary");
  assert.equal(variants.get("fire_variant_transparent_flame")?.price, 700);
  assert.equal(variants.get("water_variant_transparent_wave")?.rarity, "Legendary");
  assert.equal(variants.get("water_variant_transparent_wave")?.price, 700);
  assert.equal(variants.get("earth_variant_transparent_crystal")?.rarity, "Legendary");
  assert.equal(variants.get("earth_variant_transparent_crystal")?.price, 700);
  assert.equal(variants.get("wind_variant_transparent_vortex")?.rarity, "Legendary");
  assert.equal(variants.get("wind_variant_transparent_vortex")?.price, 700);

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

test("store: new avatar and title cosmetics are purchasable and visible with exact rarity pricing", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const store = await state.getStore("NewCosmeticsStoreUser");
  const cosmetics = await state.getCosmetics("NewCosmeticsStoreUser");

  const titles = new Map((store.catalog.title ?? []).map((item) => [item.id, item]));
  const avatars = new Map((store.catalog.avatar ?? []).map((item) => [item.id, item]));
  const cosmeticAvatars = new Map((cosmetics.catalog.avatar ?? []).map((item) => [item.id, item]));

  for (const [id, rarity, price] of NEW_TITLE_EXPECTATIONS) {
    const item = titles.get(id);
    assert.ok(item, `missing store title ${id}`);
    assert.equal(item.purchasable, true);
    assert.equal(item.owned, false);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.releaseTag, id === "title_spellwired" ? "neon_arcana_01" : "v0.1.6");
    assert.equal(item.isNew, true);
  }

  for (const [id, rarity, price] of NEW_AVATAR_EXPECTATIONS) {
    const visibleStoreItem = avatars.get(id);
    const catalogItem = cosmeticAvatars.get(id);
    assert.ok(catalogItem, `missing cosmetic catalog avatar ${id}`);
    assert.equal(catalogItem.purchasable, true);
    assert.equal(catalogItem.owned, false);
    assert.equal(catalogItem.rarity, rarity);
    assert.equal(catalogItem.price, price);
    assert.equal(catalogItem.releaseTag, NEON_ARCANA_AVATAR_IDS.has(id) ? "neon_arcana_01" : "v0.1.6");
    assert.equal(catalogItem.isNew, true);

    if (id === "avatar_golden_menace") {
      assert.equal(visibleStoreItem, undefined);
      assert.equal(catalogItem.rotationOnly, true);
      continue;
    }

    assert.ok(visibleStoreItem, `missing store avatar ${id}`);
    assert.equal(visibleStoreItem.rarity, rarity);
    assert.equal(visibleStoreItem.price, price);
  }
});

test("store: Neon Arcana card back and element variants are visible, purchasable, and tagged as new", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const store = await state.getStore("NeonArcanaStoreUser");

  const cardBacks = new Map((store.catalog.cardBack ?? []).map((item) => [item.id, item]));
  const variants = new Map((store.catalog.elementCardVariant ?? []).map((item) => [item.id, item]));

  const cardBack = cardBacks.get("cardback_neon_arcana");
  assert.ok(cardBack);
  assert.equal(cardBack.name, "Neon Arcana Card Back");
  assert.equal(cardBack.image, "card_backs/cardback_neon_arcana.png");
  assert.equal(cardBack.rarity, "Legendary");
  assert.equal(cardBack.price, 800);
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.releaseTag, "neon_arcana_01");
  assert.equal(cardBack.isNew, true);
  assert.equal(cardBack.collection, "Neon Arcana");
  assert.equal(cardBack.rotationOnly ?? false, false);
  assert.equal(cardBack.storeHidden ?? false, false);

  for (const [id, element] of [
    ["fire_variant_neon_arcana", "fire"],
    ["water_variant_neon_arcana", "water"],
    ["earth_variant_neon_arcana", "earth"],
    ["wind_variant_neon_arcana", "wind"]
  ]) {
    const item = variants.get(id);
    assert.ok(item, `missing store element variant ${id}`);
    assert.equal(item.rarity, "Rare");
    assert.equal(item.price, 250);
    assert.equal(item.purchasable, true);
    assert.equal(item.releaseTag, "neon_arcana_01");
    assert.equal(item.isNew, true);
    assert.equal(item.collection, "Neon Arcana");
    assert.equal(item.element, element);
    assert.match(item.image, /^cards\//);
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
  }
});
