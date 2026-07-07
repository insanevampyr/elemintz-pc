import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  COSMETIC_ASSIGNMENT_STATUSES,
  COSMETIC_RARITIES,
  COSMETIC_SALE_LIMIT_MODES,
  COSMETIC_CATALOG,
  getBaseCosmeticPrice,
  getCosmeticCatalogForProfile,
  getCosmeticHoverMetadata,
  normalizeCosmeticMetadata,
  normalizeCosmeticRarity
} from "../../src/state/cosmeticSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

const PERSONALITY_DROP_TITLE_DEFINITIONS = Object.freeze([
  ["title_chaos_gremlin", "Chaos Gremlin", "Common", 150, "titles/title_chaos_gremlin.png"],
  ["title_soft_doom", "Soft Doom", "Common", 150, "titles/title_soft_doom.png"],
  ["title_pretty_problem", "Pretty Problem", "Common", 150, "titles/title_pretty_problem.png"],
  ["title_silent_menace", "Silent Menace", "Rare", 350, "titles/title_silent_menace.png"],
  ["title_drama_magnet", "Drama Magnet", "Rare", 350, "titles/title_drama_magnet.png"],
  ["title_neon_rebel", "Neon Rebel", "Rare", 350, "titles/title_neon_rebel.png"],
  ["title_velvet_villain", "Velvet Villain", "Epic", 700, "titles/title_velvet_villain.png"],
  ["title_void_doll", "Void Doll", "Epic", 700, "titles/title_void_doll.png"],
  ["title_glitch_royalty", "Glitch Royalty", "Epic", 700, "titles/title_glitch_royalty.png"],
  ["title_crownless_king", "Crownless King", "Legendary", 1100, "titles/title_crownless_king.png"],
  ["title_divine_menace", "Divine Menace", "Legendary", 1100, "titles/title_divine_menace.png"],
  ["title_cataclysm_icon", "Cataclysm Icon", "Legendary", 1100, "titles/title_cataclysm_icon.png"]
]);

const PERSONALITY_DROP_AVATAR_DEFINITIONS = Object.freeze([
  ["avatar_smirk_ember", "Smirk Ember", "Common", 200, "avatars/avatar_smirk_ember.png"],
  ["avatar_bubble_brat", "Bubble Brat", "Common", 200, "avatars/avatar_bubble_brat.png"],
  ["avatar_moss_mood", "Moss Mood", "Common", 200, "avatars/avatar_moss_mood.png"],
  ["avatar_neon_puff", "Neon Puff", "Common", 200, "avatars/avatar_neon_puff.png"],
  ["avatar_stone_cold_cutie", "Stone Cold Cutie", "Rare", 400, "avatars/avatar_stone_cold_cutie.png"],
  ["avatar_storm_brat", "Storm Brat", "Rare", 400, "avatars/avatar_storm_brat.png"],
  ["avatar_tidal_diva", "Tidal Diva", "Rare", 400, "avatars/avatar_tidal_diva.png"],
  ["avatar_ashen_trickster", "Ashen Trickster", "Rare", 400, "avatars/avatar_ashen_trickster.png"],
  ["avatar_corrupt_cherub", "Corrupt Cherub", "Epic", 800, "avatars/avatar_corrupt_cherub.png"],
  ["avatar_void_glam", "Void Glam", "Epic", 800, "avatars/avatar_void_glam.png"],
  ["avatar_riot_halo", "Riot Halo", "Epic", 800, "avatars/avatar_riot_halo.png"],
  ["avatar_golden_menace", "Golden Menace", "Legendary", 1200, "avatars/avatar_golden_menace.png"],
  ["avatar_chaos_monarch", "Chaos Monarch", "Legendary", 1200, "avatars/avatar_chaos_monarch.png"],
  ["avatar_rose_riot", "Rose Riot", "Legendary", 1200, "avatars/avatar_rose_riot.png"]
]);

const NEON_ARCANA_TITLE_DEFINITIONS = Object.freeze([
  ["title_spellwired", "Spellwired", "Legendary", 1100, "titles/title_spellwired.png"]
]);

const NEON_ARCANA_AVATAR_DEFINITIONS = Object.freeze([
  ["avatar_neon_pyre_entity", "Neon Pyre Entity", "Epic", 800, "avatars/avatar_neon_pyre_entity.png"],
  ["avatar_neon_tide_entity", "Neon Tide Entity", "Epic", 800, "avatars/avatar_neon_tide_entity.png"],
  ["avatar_neon_stone_entity", "Neon Stone Entity", "Epic", 800, "avatars/avatar_neon_stone_entity.png"],
  ["avatar_neon_gale_entity", "Neon Gale Entity", "Epic", 800, "avatars/avatar_neon_gale_entity.png"]
]);

const NEON_ARCANA_VARIANT_DEFINITIONS = Object.freeze([
  ["fire_variant_neon_arcana", "Neon Arcana Fire", "fire", "cards/fire_variant_neon_arcana.png"],
  ["water_variant_neon_arcana", "Neon Arcana Water", "water", "cards/water_variant_neon_arcana.png"],
  ["earth_variant_neon_arcana", "Neon Arcana Earth", "earth", "cards/earth_variant_neon_arcana.png"],
  ["wind_variant_neon_arcana", "Neon Arcana Wind", "wind", "cards/wind_variant_neon_arcana.png"]
]);

const GOLDBOUND_RELICS_VARIANT_DEFINITIONS = Object.freeze([
  ["fire_variant_goldbound_relics", "Molten Goldfire", "fire", "cards/fire_variant_goldbound_relics.png"],
  ["earth_variant_goldbound_relics", "Auric Stone", "earth", "cards/earth_variant_goldbound_relics.png"],
  ["wind_variant_goldbound_relics", "Gilded Gale", "wind", "cards/wind_variant_goldbound_relics.png"],
  ["water_variant_goldbound_relics", "Liquid Gold Tide", "water", "cards/water_variant_goldbound_relics.png"]
]);

const FROSTVEIL_COURT_VARIANT_DEFINITIONS = Object.freeze([
  ["fire_variant_aurora_flare", "Aurora Flare Fire", "fire", "cards/fire_variant_aurora_flare.png"],
  ["earth_variant_icebound_crag", "Icebound Crag Earth", "earth", "cards/earth_variant_icebound_crag.png"],
  ["wind_variant_sleet_spiral", "Sleet Spiral Wind", "wind", "cards/wind_variant_sleet_spiral.png"],
  ["water_variant_frostbloom", "Frostbloom Water", "water", "cards/water_variant_frostbloom.png"]
]);

const VAMPIRE_ELEGANCE_VARIANT_DEFINITIONS = Object.freeze([
  ["fire_variant_flame_wings", "Flame Wings Fire", "fire", "cards/fire_variant_flame_wings.png"],
  ["earth_variant_stone_graves", "Stone Graves Earth", "earth", "cards/earth_variant_stone_graves.png"],
  ["wind_variant_wings_wind", "Wings Wind", "wind", "cards/wind_variant_wings_wind.png"],
  ["water_variant_blood_wings", "Blood Wings Water", "water", "cards/water_variant_blood_wings.png"]
]);

const LYCAN_POWER_VARIANT_DEFINITIONS = Object.freeze([
  ["fire_variant_fire_paw", "Fire Paw Fire", "fire", "cards/fire_variant_fire_paw.png"],
  ["earth_variant_stone_paw", "Stone Paw Earth", "earth", "cards/earth_variant_stone_paw.png"],
  ["wind_variant_lycan_duo", "Lycan Duo Wind", "wind", "cards/wind_variant_lycan_duo.png"],
  ["water_variant_water_wolf", "Water Wolf Water", "water", "cards/water_variant_water_wolf.png"]
]);

const ELEMENTAL_STREET_AVATAR_DEFINITIONS = Object.freeze([
  ["avatar_fire_street_duelist", "Fire Street Duelist", "Common", 200, "avatars/avatar_fire_street_duelist.png"],
  ["avatar_water_street_duelist", "Water Street Duelist", "Common", 200, "avatars/avatar_water_street_duelist.png"],
  ["avatar_earth_street_duelist", "Earth Street Duelist", "Common", 200, "avatars/avatar_earth_street_duelist.png"],
  ["avatar_wind_street_duelist", "Wind Street Duelist", "Common", 200, "avatars/avatar_wind_street_duelist.png"]
]);

const ELEMENTAL_STREET_TITLE_DEFINITIONS = Object.freeze([
  ["title_spark", "Spark", "Common", 150, "titles/title_spark.png"],
  ["title_drifter", "Drifter", "Common", 150, "titles/title_drifter.png"],
  ["title_stonehand", "Stonehand", "Common", 150, "titles/title_stonehand.png"],
  ["title_mistborn", "Mistborn", "Common", 150, "titles/title_mistborn.png"]
]);

const ELEMENTAL_STREET_VARIANT_DEFINITIONS = Object.freeze([
  ["fire_variant_street", "Street Fire", "fire", "cards/fire_variant_street.png"],
  ["water_variant_street", "Street Water", "water", "cards/water_variant_street.png"],
  ["earth_variant_street", "Street Earth", "earth", "cards/earth_variant_street.png"],
  ["wind_variant_street", "Street Wind", "wind", "cards/wind_variant_street.png"]
]);

const SIMPLE_BACKGROUNDS_DEFINITIONS = Object.freeze([
  ["background_breezewild_meadow", "Breezewild Meadow", "backgrounds/background_breezewild_meadow.png"],
  ["background_broken_yard", "Broken Yard", "backgrounds/background_broken_yard.png"],
  ["background_crystal_ruins", "Crystal Ruins", "backgrounds/background_crystal_ruins.png"],
  ["background_ember_pit", "Ember Pit", "backgrounds/background_ember_pit.png"],
  ["background_glowtide_flats", "Glowtide Flats", "backgrounds/background_glowtide_flats.png"],
  ["background_moonshade_grove", "Moonshade Grove", "backgrounds/background_moonshade_grove.png"]
]);

test("cosmetics: Unique is supported without changing invalid rarity fallback behavior", () => {
  assert.deepEqual(COSMETIC_RARITIES, ["Common", "Rare", "Epic", "Legendary", "Unique"]);
  assert.equal(normalizeCosmeticRarity("Unique"), "Unique");
  assert.equal(normalizeCosmeticRarity("Legendary"), "Legendary");
  assert.equal(normalizeCosmeticRarity("invalid"), "Common");

  const fixture = COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF");
  const originalRarity = fixture.rarity;
  try {
    fixture.rarity = "Unique";
    const catalog = getCosmeticCatalogForProfile({});
    assert.equal(
      catalog.avatar.find((item) => item.id === "fireavatarF")?.rarity,
      "Unique"
    );
  } finally {
    fixture.rarity = originalRarity;
  }
});

test("cosmetics: special metadata defaults are inert, normalized, and keep admin notes private", () => {
  assert.deepEqual(COSMETIC_ASSIGNMENT_STATUSES, ["unassigned", "assigned", "revoked"]);
  assert.deepEqual(COSMETIC_SALE_LIMIT_MODES, ["unlimited", "limited"]);

  const defaults = normalizeCosmeticMetadata({
    id: "fixture_default_metadata",
    rarity: "Legendary"
  });
  assert.equal(defaults.grantOnly, false);
  assert.equal(defaults.shopEligible, true);
  assert.equal(defaults.shopListed, true);
  assert.equal(defaults.assignmentStatus, "unassigned");
  assert.equal(defaults.createdForUsername, null);
  assert.deepEqual(defaults.royalty, {
    enabled: false,
    recipientUsername: null,
    tokenPercent: 0
  });
  assert.equal(defaults.adminNotes, "");
  assert.equal(defaults.saleLimitMode, "unlimited");
  assert.equal(defaults.saleLimitTotal, null);
  assert.equal(defaults.saleLimitSold, 0);

  const normalized = normalizeCosmeticMetadata({
    id: "fixture_special_metadata",
    rarity: "Unique",
    grantOnly: true,
    shopEligible: false,
    shopListed: false,
    assignmentStatus: "invalid",
    uniqueOwnerUsername: "  UniqueOwner  ",
    royalty: {
      enabled: true,
      recipientUsername: "  RoyaltyOwner  ",
      tokenPercent: 150
    },
    adminNotes: "  private review note  ",
    saleLimitMode: "limited",
    saleLimitTotal: 25.9,
    saleLimitSold: -4
  });
  assert.equal(normalized.rarity, "Unique");
  assert.equal(normalized.grantOnly, true);
  assert.equal(normalized.shopEligible, false);
  assert.equal(normalized.shopListed, false);
  assert.equal(normalized.assignmentStatus, "unassigned");
  assert.equal(normalized.createdForUsername, "UniqueOwner");
  assert.deepEqual(normalized.royalty, {
    enabled: true,
    recipientUsername: "RoyaltyOwner",
    tokenPercent: 100
  });
  assert.equal(normalized.adminNotes, "private review note");
  assert.equal(normalized.saleLimitMode, "limited");
  assert.equal(normalized.saleLimitTotal, 25);
  assert.equal(normalized.saleLimitSold, 0);

  const fixture = COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF");
  const originalAdminNotes = fixture.adminNotes;
  try {
    fixture.adminNotes = "server-only note";
    const clientEntry = getCosmeticCatalogForProfile({}).avatar.find(
      (item) => item.id === "fireavatarF"
    );
    assert.equal("adminNotes" in clientEntry, false);
    assert.equal("royalty" in clientEntry, false);
    assert.equal("createdForUsername" in clientEntry, false);
  } finally {
    fixture.adminNotes = originalAdminNotes;
  }
});

test("cosmetics: Unique rarity does not imply special metadata behavior", () => {
  const normalized = normalizeCosmeticMetadata({
    id: "fixture_unique_independence",
    rarity: "Unique"
  });

  assert.equal(normalized.rarity, "Unique");
  assert.equal(normalized.grantOnly, false);
  assert.equal(normalized.shopEligible, true);
  assert.equal(normalized.shopListed, true);
  assert.equal(normalized.assignmentStatus, "unassigned");
  assert.equal(normalized.createdForUsername, null);
  assert.equal(normalized.royalty.enabled, false);
  assert.equal(normalized.saleLimitMode, "unlimited");
});

test("cosmetics: Lycan Anubis is an inactive grant-only Unique avatar", async () => {
  const matchingItems = COSMETIC_CATALOG.avatar.filter(
    (candidate) => candidate.id === "avatar_lycan_anubis"
  );
  const [item] = matchingItems;

  assert.equal(matchingItems.length, 1);
  assert.ok(item);
  assert.equal(item.name, "Lycan Anubis");
  assert.equal(item.image, "avatars/avatar_lycan_anubis.png");
  assert.equal(item.rarity, "Unique");
  assert.equal(item.collection, undefined);
  assert.equal(item.releaseTag, "copycell_uniques");
  assert.equal(item.isNew, false);
  assert.equal(item.defaultOwned, false);
  assert.equal(item.purchasable, false);
  assert.equal(item.grantOnly, true);
  assert.equal(item.shopEligible, false);
  assert.equal(item.shopListed, false);
  assert.equal(item.storeHidden, true);
  assert.equal(item.rotationOnly, false);
  assert.equal(item.chestOnly, false);
  assert.equal(item.supporterOnly, false);
  assert.equal(item.price, undefined);
  assert.deepEqual(item.royalty, {
    enabled: false,
    recipientUsername: null,
    tokenPercent: 0
  });
  assert.equal(item.saleLimitMode, "unlimited");
  assert.equal(item.saleLimitTotal, null);

  const unowned = getCosmeticCatalogForProfile({}).avatar.find(
    (candidate) => candidate.id === item.id
  );
  const owned = getCosmeticCatalogForProfile({
    ownedCosmetics: { avatar: [item.id] }
  }).avatar.find((candidate) => candidate.id === item.id);

  assert.equal(unowned?.owned, false);
  assert.equal(owned?.owned, true);
  await fs.access(path.resolve("assets/avatars/avatar_lycan_anubis.png"));
});

test("cosmetics: Bane Flame Fire is a collectionless inactive Unique Fire variant", async () => {
  const matchingItems = COSMETIC_CATALOG.elementCardVariant.filter(
    (candidate) => candidate.id === "fire_variant_bane_flame"
  );
  const [item] = matchingItems;

  assert.equal(matchingItems.length, 1);
  assert.ok(item);
  assert.equal(item.name, "Bane Flame Fire");
  assert.equal(item.image, "cards/fire_variant_bane_flame.png");
  assert.equal(item.element, "fire");
  assert.equal(item.rarity, "Unique");
  assert.equal(item.collection, undefined);
  assert.equal(item.dropKey, "enab_uniques");
  assert.equal(item.releaseTag, "enab_uniques");
  assert.equal(item.isNew, false);
  assert.equal(item.defaultOwned, false);
  assert.equal(item.purchasable, false);
  assert.equal(item.grantOnly, true);
  assert.equal(item.shopEligible, false);
  assert.equal(item.shopListed, false);
  assert.equal(item.storeHidden, true);
  assert.equal(item.rotationOnly, false);
  assert.equal(item.chestOnly, false);
  assert.equal(item.supporterOnly, false);
  assert.equal(item.price, undefined);
  assert.deepEqual(item.royalty, {
    enabled: false,
    recipientUsername: null,
    tokenPercent: 0
  });

  const unowned = getCosmeticCatalogForProfile({}).elementCardVariant.find(
    (candidate) => candidate.id === item.id
  );
  const owned = getCosmeticCatalogForProfile({
    ownedCosmetics: { elementCardVariant: [item.id] }
  }).elementCardVariant.find((candidate) => candidate.id === item.id);

  assert.equal(unowned?.owned, false);
  assert.equal(owned?.owned, true);
  await fs.access(path.resolve("assets/cards/fire_variant_bane_flame.png"));
});

test("cosmetics: owned Unique remains visible with Created For metadata when unavailable in Store", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-owned-unique-"));
  const state = new StateCoordinator({ dataDir });
  const fixture = COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF");
  const originalRarity = fixture.rarity;

  try {
    fixture.rarity = "Unique";
    const seeded = await state.specialCosmeticRegistry.upsertConfig({
      cosmeticId: fixture.id,
      status: "assigned",
      assignmentStatus: "assigned",
      createdForUsername: "CopyCell",
      grantOnly: false,
      shopEligible: true,
      shopListed: false,
      storeHidden: true,
      rotationOnly: false,
      price: 750,
      saleLimitMode: "limited",
      saleLimitTotal: 1,
      saleLimitSold: 1,
      adminNotes: "must remain private"
    });
    await state.specialCosmeticRegistry.store.write({
      version: 1,
      records: [{ ...seeded, saleLimitSold: 1 }]
    });
    await state.profiles.updateProfile("Enab", (profile) => ({
      ...profile,
      ownedCosmetics: {
        ...profile.ownedCosmetics,
        avatar: [...profile.ownedCosmetics.avatar, fixture.id]
      }
    }));

    const cosmetics = await state.getCosmetics("Enab");
    const ownedItem = cosmetics.catalog.avatar.find((item) => item.id === fixture.id);

    assert.equal(ownedItem?.owned, true);
    assert.equal(ownedItem?.rarity, "Unique");
    assert.equal(ownedItem?.createdForUsername, "CopyCell");
    assert.equal(ownedItem?.shopListed, false);
    assert.equal(ownedItem?.storeHidden, true);
    assert.equal(ownedItem?.saleLimitSold, 1);
    assert.equal("adminNotes" in ownedItem, false);
    assert.equal("royalty" in ownedItem, false);
    assert.equal((await state.getStore("Enab")).catalog.avatar.some((item) => item.id === fixture.id), false);

    const equipped = await state.equipCosmetic({
      username: "Enab",
      type: "avatar",
      cosmeticId: fixture.id
    });
    const equippedItem = equipped.cosmetics.catalog.avatar.find((item) => item.id === fixture.id);
    assert.equal(equippedItem?.equipped, true);
    assert.equal(equippedItem?.createdForUsername, "CopyCell");

    await state.specialCosmeticRegistry.updateShopConfig({
      cosmeticId: fixture.id,
      config: {
        grantOnly: false,
        shopEligible: true,
        shopListed: true,
        storeHidden: false,
        rotationOnly: false,
        price: 750,
        saleLimitMode: "limited",
        saleLimitTotal: 1
      }
    });
    assert.equal(
      (await state.getStore("Enab")).catalog.avatar.some((item) => item.id === fixture.id),
      false
    );

    const creatorCosmetics = await state.getCosmetics("CopyCell");
    const creatorItem = creatorCosmetics.catalog.avatar.find((item) => item.id === fixture.id);
    assert.equal(creatorItem?.createdForUsername, "CopyCell");
    assert.equal(creatorItem?.owned, false);
    const normalItem = creatorCosmetics.catalog.avatar.find(
      (item) => item.rarity !== "Unique"
    );
    assert.equal("createdForUsername" in normalItem, false);
  } finally {
    fixture.rarity = originalRarity;
  }
});

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

test("cosmetics: normal purchasable store cosmetics use centralized base rarity pricing", () => {
  for (const type of ["avatar", "title", "cardBack", "elementCardVariant", "background"]) {
    for (const item of COSMETIC_CATALOG[type] ?? []) {
      if (!item.purchasable) {
        continue;
      }

      assert.equal(
        item.price,
        getBaseCosmeticPrice(type, item.rarity),
        `${type}:${item.id} should match centralized ${item.rarity} pricing`
      );
    }
  }
});

test("cosmetics: Daily EleMintz Chest hover metadata uses the approved source label", () => {
  const dailyChestCosmetics = [
    ["title", "title_first_light"],
    ["badge", "badge_daily_emblem"],
    ["avatar", "avatar_chestbound_adept"],
    ["cardBack", "cardback_daily_element_chest"],
    ["elementCardVariant", "fire_variant_sunflare"]
  ];

  for (const [type, id] of dailyChestCosmetics) {
    assert.equal(
      getCosmeticHoverMetadata(type, id).description,
      "Daily EleMintz Chest #1",
      `${type}:${id} should expose the approved Daily Chest source label`
    );
  }

  assert.equal(
    getCosmeticHoverMetadata("background", "background_morning_sanctum").description,
    "Daily EleMintz Chest #1"
  );
});

test("cosmetics: existing hover source descriptions remain unchanged", () => {
  assert.equal(getCosmeticHoverMetadata("title", "title_apprentice").description, "Level Reward: Reach Level 3.");
  assert.equal(getCosmeticHoverMetadata("title", "Flame Vanguard").description, "Achievement Reward: Win your first match.");
  assert.equal(getCosmeticHoverMetadata("title", "title_spellwired").description, "Store purchase.");
  assert.equal(getCosmeticHoverMetadata("title", "Initiate").description, "Default cosmetic.");
  assert.equal(getCosmeticHoverMetadata("title", "Arena Founder").description, "Founder / Supporter reward.");
});

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
  assert.deepEqual(profile.profileShowcaseSlots, [null, null, null]);

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

test("cosmetics: Goldbound Relics normal store purchases exclude the limited card back while keeping the other approved items purchasable", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("GoldboundStoreUser", { tokens: 3000 });

  const avatarPurchase = await state.buyStoreItem({
    username: "GoldboundStoreUser",
    type: "avatar",
    cosmeticId: "avatar_aurelian_archon"
  });
  const titlePurchase = await state.buyStoreItem({
    username: "GoldboundStoreUser",
    type: "title",
    cosmeticId: "title_goldbound"
  });
  const earthVariantPurchase = await state.buyStoreItem({
    username: "GoldboundStoreUser",
    type: "elementCardVariant",
    cosmeticId: "earth_variant_goldbound_relics"
  });
  await assert.rejects(
    state.buyStoreItem({
      username: "GoldboundStoreUser",
      type: "cardBack",
      cosmeticId: "cardback_goldbound_relic"
    }),
    /Store item not found for cardBack:cardback_goldbound_relic\./
  );

  const profile = await state.profiles.getProfile("GoldboundStoreUser");

  assert.equal(avatarPurchase.purchase?.status, "purchased");
  assert.equal(avatarPurchase.purchase?.price, 1200);
  assert.equal(titlePurchase.purchase?.status, "purchased");
  assert.equal(titlePurchase.purchase?.price, 700);
  assert.equal(earthVariantPurchase.purchase?.status, "purchased");
  assert.equal(earthVariantPurchase.purchase?.price, 650);
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_aurelian_archon"));
  assert.ok(profile.ownedCosmetics.title.includes("title_goldbound"));
  assert.ok(!profile.ownedCosmetics.cardBack.includes("cardback_goldbound_relic"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("earth_variant_goldbound_relics"));
  assert.equal(profile.tokens, 450);
});

test("cosmetics: Frostveil Court normal store purchases exclude the limited card back while keeping the other approved items purchasable", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("FrostveilStoreUser", { tokens: 5000 });

  const purchaseTargets = [
    { type: "avatar", cosmeticId: "avatar_frostveil_heir", expectedPrice: 1200 },
    { type: "title", cosmeticId: "title_shiverborne", expectedPrice: 700 },
    { type: "elementCardVariant", cosmeticId: "fire_variant_aurora_flare", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "earth_variant_icebound_crag", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "wind_variant_sleet_spiral", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "water_variant_frostbloom", expectedPrice: 650 }
  ];

  for (const target of purchaseTargets) {
    const response = await state.buyStoreItem({
      username: "FrostveilStoreUser",
      type: target.type,
      cosmeticId: target.cosmeticId
    });
    assert.equal(response.purchase?.status, "purchased");
    assert.equal(response.purchase?.price, target.expectedPrice);
  }
  await assert.rejects(
    state.buyStoreItem({
      username: "FrostveilStoreUser",
      type: "cardBack",
      cosmeticId: "cardback_glacier_sigil"
    }),
    /Store item not found for cardBack:cardback_glacier_sigil\./
  );

  const profile = await state.profiles.getProfile("FrostveilStoreUser");
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_frostveil_heir"));
  assert.ok(profile.ownedCosmetics.title.includes("title_shiverborne"));
  assert.ok(!profile.ownedCosmetics.cardBack.includes("cardback_glacier_sigil"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("fire_variant_aurora_flare"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("earth_variant_icebound_crag"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("wind_variant_sleet_spiral"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("water_variant_frostbloom"));
  assert.equal(profile.tokens, 500);
});

test("cosmetics: authoritative store lookup accepts composite Frostveil store keys while the limited card back stays excluded from the normal store", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("FrostveilCompositeLookupUser", { tokens: 5000 });

  const purchaseTargets = [
    "avatar:avatar_frostveil_heir",
    "title:title_shiverborne",
    "elementCardVariant:fire_variant_aurora_flare",
    "elementCardVariant:earth_variant_icebound_crag",
    "elementCardVariant:wind_variant_sleet_spiral",
    "elementCardVariant:water_variant_frostbloom"
  ];

  for (const compositeKey of purchaseTargets) {
    const response = await state.buyStoreItem({
      username: "FrostveilCompositeLookupUser",
      type: compositeKey
    });
    assert.equal(response.purchase?.status, "purchased", `${compositeKey} should purchase cleanly`);
  }
  await assert.rejects(
    state.buyStoreItem({
      username: "FrostveilCompositeLookupUser",
      type: "cardBack:cardback_glacier_sigil"
    }),
    /Store item not found for cardBack:cardback_glacier_sigil\./
  );

  const profile = await state.profiles.getProfile("FrostveilCompositeLookupUser");
  assert.equal(profile.ownedCosmetics.avatar.filter((item) => item === "avatar_frostveil_heir").length, 1);
  assert.equal(profile.ownedCosmetics.title.filter((item) => item === "title_shiverborne").length, 1);
  assert.equal(profile.ownedCosmetics.cardBack.filter((item) => item === "cardback_glacier_sigil").length, 0);
  assert.equal(
    profile.ownedCosmetics.elementCardVariant.filter((item) => item === "fire_variant_aurora_flare").length,
    1
  );
  assert.equal(
    profile.ownedCosmetics.elementCardVariant.filter((item) => item === "earth_variant_icebound_crag").length,
    1
  );
  assert.equal(
    profile.ownedCosmetics.elementCardVariant.filter((item) => item === "wind_variant_sleet_spiral").length,
    1
  );
  assert.equal(
    profile.ownedCosmetics.elementCardVariant.filter((item) => item === "water_variant_frostbloom").length,
    1
  );
});

test("cosmetics: Personality Drop avatar and title catalog entries remain present but are no longer marked new", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const titles = new Map(COSMETIC_CATALOG.title.map((item) => [item.id, item]));

  assert.equal(
    new Set(
      Object.values(COSMETIC_CATALOG)
        .flatMap((items) => items.map((item) => item.id))
    ).size,
    Object.values(COSMETIC_CATALOG).reduce((sum, items) => sum + items.length, 0),
    "duplicate cosmetic ids found"
  );

  assert.equal(PERSONALITY_DROP_TITLE_DEFINITIONS.length, 12);
  assert.equal(PERSONALITY_DROP_AVATAR_DEFINITIONS.length, 14);

  for (const [id, name, rarity, price, image] of PERSONALITY_DROP_TITLE_DEFINITIONS) {
    const item = titles.get(id);
    assert.ok(item, `missing title ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.image, image);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.releaseTag, "v0.1.6");
    assert.equal(item.isNew, false);
  }

  for (const [id, name, rarity, price, image] of PERSONALITY_DROP_AVATAR_DEFINITIONS) {
    const item = avatars.get(id);
    assert.ok(item, `missing avatar ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.image, image);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.releaseTag, "v0.1.6");
    assert.equal(item.isNew, false);
  }

  assert.equal(avatars.get("avatar_smirk_ember")?.collection, "Ember");
  assert.equal(avatars.get("avatar_bubble_brat")?.collection, "Cutesy");
  assert.equal(avatars.get("avatar_rose_riot")?.collection, "Velvet & Rose");
  assert.equal(titles.get("title_soft_doom")?.collection, "Gothic Corruption");
  assert.equal(titles.get("title_void_doll")?.collection, "Void");
  assert.equal(titles.get("title_divine_menace")?.collection, "Celestial");
});

test("cosmetics: Neon Arcana entries keep exact metadata and collection mappings after NEW retirement", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const titles = new Map(COSMETIC_CATALOG.title.map((item) => [item.id, item]));
  const cardBacks = new Map(COSMETIC_CATALOG.cardBack.map((item) => [item.id, item]));
  const variants = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));

  for (const [avatarId] of NEON_ARCANA_AVATAR_DEFINITIONS) {
    const item = avatars.get(avatarId);
    assert.ok(item, `missing Neon Arcana avatar ${avatarId}`);
    assert.equal(item.rarity, "Epic");
    assert.equal(item.price, 800);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, false);
    assert.equal(item.releaseTag, "neon_arcana_01");
    assert.equal(item.collection, "Neon Arcana");
    assert.match(item.image, /^avatars\//);
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
  }

  for (const [titleId, name, rarity, price, image] of NEON_ARCANA_TITLE_DEFINITIONS) {
    const item = titles.get(titleId);
    assert.ok(item, `missing Neon Arcana title ${titleId}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.image, image);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, false);
    assert.equal(item.releaseTag, "neon_arcana_01");
    assert.equal(item.collection, "Neon Arcana");
  }

  const title = titles.get("title_spellwired");
  assert.ok(title);
  assert.equal(title.name, "Spellwired");
  assert.equal(title.image, "titles/title_spellwired.png");
  assert.equal(title.rarity, "Legendary");
  assert.equal(title.price, 1100);
  assert.equal(title.purchasable, true);
  assert.equal(title.isNew, false);
  assert.equal(title.releaseTag, "neon_arcana_01");
  assert.equal(title.collection, "Neon Arcana");
  assert.equal(title.rotationOnly ?? false, false);
  assert.equal(title.storeHidden ?? false, false);

  const cardBack = cardBacks.get("cardback_neon_arcana");
  assert.ok(cardBack);
  assert.equal(cardBack.name, "Neon Arcana Card Back");
  assert.equal(cardBack.image, "card_backs/cardback_neon_arcana.png");
  assert.equal(cardBack.rarity, "Legendary");
  assert.equal(cardBack.price, 1050);
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.isNew, false);
  assert.equal(cardBack.releaseTag, "neon_arcana_01");
  assert.equal(cardBack.collection, "Neon Arcana");
  assert.equal(cardBack.rotationOnly ?? false, false);
  assert.equal(cardBack.storeHidden ?? false, false);

  for (const [id, name, element, image] of NEON_ARCANA_VARIANT_DEFINITIONS) {
    const item = variants.get(id);
    assert.ok(item, `missing Neon Arcana variant ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.image, image);
    assert.equal(item.element, element);
    assert.equal(item.rarity, "Rare");
    assert.equal(item.price, 350);
    assert.equal(item.purchasable, true);
    assert.equal(item.isNew, false);
    assert.equal(item.releaseTag, "neon_arcana_01");
    assert.equal(item.collection, "Neon Arcana");
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
  }
});

test("cosmetics: Goldbound Relics entries keep exact metadata and collection mappings after NEW retirement", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const titles = new Map(COSMETIC_CATALOG.title.map((item) => [item.id, item]));
  const cardBacks = new Map(COSMETIC_CATALOG.cardBack.map((item) => [item.id, item]));
  const variants = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));

  const avatar = avatars.get("avatar_aurelian_archon");
  assert.ok(avatar);
  assert.equal(avatar.name, "Aurelian Archon");
  assert.equal(avatar.image, "avatars/avatar_aurelian_archon.png");
  assert.equal(avatar.rarity, "Legendary");
  assert.equal(avatar.price, 1200);
  assert.equal(avatar.purchasable, true);
  assert.equal(avatar.defaultOwned, false);
  assert.equal(avatar.isNew, false);
  assert.equal(avatar.releaseTag, "goldbound_relics_01");
  assert.equal(avatar.collection, "Goldbound Relics");
  assert.equal(avatar.rotationOnly ?? false, false);
  assert.equal(avatar.storeHidden ?? false, false);

  const title = titles.get("title_goldbound");
  assert.ok(title);
  assert.equal(title.name, "Goldbound");
  assert.equal(title.image, "titles/title_goldbound.png");
  assert.equal(title.rarity, "Epic");
  assert.equal(title.price, 700);
  assert.equal(title.purchasable, true);
  assert.equal(title.defaultOwned, false);
  assert.equal(title.isNew, false);
  assert.equal(title.releaseTag, "goldbound_relics_01");
  assert.equal(title.collection, "Goldbound Relics");
  assert.equal(title.rotationOnly ?? false, false);
  assert.equal(title.storeHidden ?? false, false);

  const cardBack = cardBacks.get("cardback_goldbound_relic");
  assert.ok(cardBack);
  assert.equal(cardBack.name, "Goldbound Relic");
  assert.equal(cardBack.image, "card_backs/cardback_goldbound_relic.png");
  assert.equal(cardBack.rarity, "Legendary");
  assert.equal(cardBack.price, 1050);
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.defaultOwned, false);
  assert.equal(cardBack.isNew, false);
  assert.equal(cardBack.releaseTag, "goldbound_relics_01");
  assert.equal(cardBack.collection, "Goldbound Relics");
  assert.equal(cardBack.rotationOnly ?? false, true);
  assert.equal(cardBack.storeHidden ?? false, false);

  for (const [id, name, element, image] of GOLDBOUND_RELICS_VARIANT_DEFINITIONS) {
    const item = variants.get(id);
    assert.ok(item, `missing Goldbound Relics variant ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.image, image);
    assert.equal(item.element, element);
    assert.equal(item.rarity, "Epic");
    assert.equal(item.price, 650);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, false);
    assert.equal(item.releaseTag, "goldbound_relics_01");
    assert.equal(item.collection, "Goldbound Relics");
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
  }
});

test("cosmetics: Frostveil Court entries keep exact metadata and collection mappings after NEW retirement", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const titles = new Map(COSMETIC_CATALOG.title.map((item) => [item.id, item]));
  const cardBacks = new Map(COSMETIC_CATALOG.cardBack.map((item) => [item.id, item]));
  const variants = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));

  const avatar = avatars.get("avatar_frostveil_heir");
  assert.ok(avatar);
  assert.equal(avatar.name, "Frostveil Heir");
  assert.equal(avatar.image, "avatars/avatar_frostveil_heir.png");
  assert.equal(avatar.rarity, "Legendary");
  assert.equal(avatar.price, 1200);
  assert.equal(avatar.purchasable, true);
  assert.equal(avatar.defaultOwned, false);
  assert.equal(avatar.isNew, false);
  assert.equal(avatar.releaseTag, "frostveil_court_2026_05");
  assert.equal(avatar.collection, "Frostveil Court");
  assert.equal(avatar.rotationOnly ?? false, false);
  assert.equal(avatar.storeHidden ?? false, false);

  const title = titles.get("title_shiverborne");
  assert.ok(title);
  assert.equal(title.name, "Shiverborne");
  assert.equal(title.image, "titles/title_shiverborne.png");
  assert.equal(title.rarity, "Epic");
  assert.equal(title.price, 700);
  assert.equal(title.purchasable, true);
  assert.equal(title.defaultOwned, false);
  assert.equal(title.isNew, false);
  assert.equal(title.releaseTag, "frostveil_court_2026_05");
  assert.equal(title.collection, "Frostveil Court");
  assert.equal(title.rotationOnly ?? false, false);
  assert.equal(title.storeHidden ?? false, false);

  const cardBack = cardBacks.get("cardback_glacier_sigil");
  assert.ok(cardBack);
  assert.equal(cardBack.name, "Glacier Sigil");
  assert.equal(cardBack.image, "card_backs/cardback_glacier_sigil.png");
  assert.equal(cardBack.rarity, "Legendary");
  assert.equal(cardBack.price, 1050);
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.defaultOwned, false);
  assert.equal(cardBack.isNew, false);
  assert.equal(cardBack.releaseTag, "frostveil_court_2026_05");
  assert.equal(cardBack.collection, "Frostveil Court");
  assert.equal(cardBack.rotationOnly ?? false, true);
  assert.equal(cardBack.storeHidden ?? false, false);

  for (const [id, name, element, image] of FROSTVEIL_COURT_VARIANT_DEFINITIONS) {
    const item = variants.get(id);
    assert.ok(item, `missing Frostveil Court variant ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.image, image);
    assert.equal(item.element, element);
    assert.equal(item.rarity, "Epic");
    assert.equal(item.price, 650);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, false);
    assert.equal(item.releaseTag, "frostveil_court_2026_05");
    assert.equal(item.collection, "Frostveil Court");
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
  }

  assert.equal(avatars.get("avatar_neon_pyre_entity")?.isNew, false);
  assert.equal(avatars.get("avatar_aurelian_archon")?.isNew, false);
});

test("cosmetics: Vampire Elegance entries use exact metadata across categories and collection mappings", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const cardBacks = new Map(COSMETIC_CATALOG.cardBack.map((item) => [item.id, item]));
  const variants = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));

  for (const [id, name] of [
    ["avatar_vampire_female", "Vampire Female"],
    ["avatar_vampire_male", "Vampire Male"]
  ]) {
    const item = avatars.get(id);
    assert.ok(item, `missing Vampire Elegance avatar ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, "Legendary");
    assert.equal(item.price, 1200);
    assert.equal(item.image, `avatars/${id}.png`);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "vampire_elegance_2026_05");
    assert.equal(item.collection, "Vampire Elegance");
  }

  for (const [id, name] of [
    ["cardback_blood_gem", "Blood Gem"],
    ["cardback_winged_coffin", "Winged Coffin"]
  ]) {
    const item = cardBacks.get(id);
    assert.ok(item, `missing Vampire Elegance card back ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, "Legendary");
    assert.equal(item.price, 1050);
    assert.equal(item.image, `card_backs/${id}.png`);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "vampire_elegance_2026_05");
    assert.equal(item.collection, "Vampire Elegance");
  }

  for (const [id, name, element, image] of VAMPIRE_ELEGANCE_VARIANT_DEFINITIONS) {
    const item = variants.get(id);
    assert.ok(item, `missing Vampire Elegance variant ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.element, element);
    assert.equal(item.image, image);
    assert.equal(item.rarity, "Epic");
    assert.equal(item.price, 650);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "vampire_elegance_2026_05");
    assert.equal(item.collection, "Vampire Elegance");
  }
});

test("cosmetics: Lycan Power entries use exact metadata across categories and collection mappings", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const backgrounds = new Map(COSMETIC_CATALOG.background.map((item) => [item.id, item]));
  const cardBacks = new Map(COSMETIC_CATALOG.cardBack.map((item) => [item.id, item]));
  const variants = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));

  for (const [id, name] of [
    ["avatar_lycan_female", "Lycan Female"],
    ["avatar_lycan_male", "Lycan Male"]
  ]) {
    const item = avatars.get(id);
    assert.ok(item, `missing Lycan Power avatar ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, "Legendary");
    assert.equal(item.price, 1200);
    assert.equal(item.image, `avatars/${id}.png`);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "lycan_power_2026_05");
    assert.equal(item.collection, "Lycan Power");
  }

  const background = backgrounds.get("background_bg_lycan_law");
  assert.ok(background);
  assert.equal(background.name, "Lycan Law");
  assert.equal(background.rarity, "Epic");
  assert.equal(background.price, 900);
  assert.equal(background.image, "backgrounds/background_bg_lycan_law.png");
  assert.equal(background.purchasable, true);
  assert.equal(background.defaultOwned, false);
  assert.equal(background.isNew, true);
  assert.equal(background.releaseTag, "lycan_power_2026_05");
  assert.equal(background.collection, "Lycan Power");

  const cardBack = cardBacks.get("cardback_lycan_pack");
  assert.ok(cardBack);
  assert.equal(cardBack.name, "Lycan Pack");
  assert.equal(cardBack.rarity, "Legendary");
  assert.equal(cardBack.price, 1050);
  assert.equal(cardBack.image, "card_backs/cardback_lycan_pack.png");
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.defaultOwned, false);
  assert.equal(cardBack.isNew, true);
  assert.equal(cardBack.releaseTag, "lycan_power_2026_05");
  assert.equal(cardBack.collection, "Lycan Power");

  for (const [id, name, element, image] of LYCAN_POWER_VARIANT_DEFINITIONS) {
    const item = variants.get(id);
    assert.ok(item, `missing Lycan Power variant ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.element, element);
    assert.equal(item.image, image);
    assert.equal(item.rarity, "Epic");
    assert.equal(item.price, 650);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "lycan_power_2026_05");
    assert.equal(item.collection, "Lycan Power");
  }
});

test("cosmetics: Elemental Street collectionless entries use matched Common and Rare pricing without a visible collection", () => {
  const avatars = new Map(COSMETIC_CATALOG.avatar.map((item) => [item.id, item]));
  const titles = new Map(COSMETIC_CATALOG.title.map((item) => [item.id, item]));
  const cardBacks = new Map(COSMETIC_CATALOG.cardBack.map((item) => [item.id, item]));
  const variants = new Map(COSMETIC_CATALOG.elementCardVariant.map((item) => [item.id, item]));

  for (const [id, name, rarity, price, image] of ELEMENTAL_STREET_AVATAR_DEFINITIONS) {
    const item = avatars.get(id);
    assert.ok(item, `missing Elemental Street avatar ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.image, image);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "elemental_street_2026_06");
    assert.equal("collection" in item, false);
  }

  for (const [id, name, rarity, price, image] of ELEMENTAL_STREET_TITLE_DEFINITIONS) {
    const item = titles.get(id);
    assert.ok(item, `missing Elemental Street title ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.image, image);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "elemental_street_2026_06");
    assert.equal("collection" in item, false);
  }

  const cardBack = cardBacks.get("cardback_four_element_street_emblem");
  assert.ok(cardBack);
  assert.equal(cardBack.name, "Four Element Street Emblem");
  assert.equal(cardBack.rarity, "Rare");
  assert.equal(cardBack.price, 350);
  assert.equal(cardBack.image, "card_backs/cardback_four_element_street_emblem.png");
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.defaultOwned, false);
  assert.equal(cardBack.isNew, true);
  assert.equal(cardBack.releaseTag, "elemental_street_2026_06");
  assert.equal("collection" in cardBack, false);

  for (const [id, name, element, image] of ELEMENTAL_STREET_VARIANT_DEFINITIONS) {
    const item = variants.get(id);
    assert.ok(item, `missing Elemental Street variant ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.element, element);
    assert.equal(item.image, image);
    assert.equal(item.rarity, "Rare");
    assert.equal(item.price, 350);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "elemental_street_2026_06");
    assert.equal("collection" in item, false);
  }
});

test("cosmetics: Vampire Elegance store purchases succeed for all approved items", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("VampireStoreUser", { tokens: 8000 });

  const purchaseTargets = [
    { type: "avatar", cosmeticId: "avatar_vampire_female", expectedPrice: 1200 },
    { type: "avatar", cosmeticId: "avatar_vampire_male", expectedPrice: 1200 },
    { type: "cardBack", cosmeticId: "cardback_blood_gem", expectedPrice: 1050 },
    { type: "cardBack", cosmeticId: "cardback_winged_coffin", expectedPrice: 1050 },
    { type: "elementCardVariant", cosmeticId: "earth_variant_stone_graves", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "fire_variant_flame_wings", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "water_variant_blood_wings", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "wind_variant_wings_wind", expectedPrice: 650 }
  ];

  for (const target of purchaseTargets) {
    const response = await state.buyStoreItem({
      username: "VampireStoreUser",
      type: target.type,
      cosmeticId: target.cosmeticId
    });
    assert.equal(response.purchase?.status, "purchased");
    assert.equal(response.purchase?.price, target.expectedPrice);
  }

  const profile = await state.profiles.getProfile("VampireStoreUser");
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_vampire_female"));
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_vampire_male"));
  assert.ok(profile.ownedCosmetics.cardBack.includes("cardback_blood_gem"));
  assert.ok(profile.ownedCosmetics.cardBack.includes("cardback_winged_coffin"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("earth_variant_stone_graves"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("fire_variant_flame_wings"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("water_variant_blood_wings"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("wind_variant_wings_wind"));
  assert.equal(profile.tokens, 900);
});

test("cosmetics: Lycan Power store purchases succeed for all approved items", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("LycanStoreUser", { tokens: 8000 });

  const purchaseTargets = [
    { type: "avatar", cosmeticId: "avatar_lycan_female", expectedPrice: 1200 },
    { type: "avatar", cosmeticId: "avatar_lycan_male", expectedPrice: 1200 },
    { type: "background", cosmeticId: "background_bg_lycan_law", expectedPrice: 900 },
    { type: "cardBack", cosmeticId: "cardback_lycan_pack", expectedPrice: 1050 },
    { type: "elementCardVariant", cosmeticId: "earth_variant_stone_paw", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "fire_variant_fire_paw", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "water_variant_water_wolf", expectedPrice: 650 },
    { type: "elementCardVariant", cosmeticId: "wind_variant_lycan_duo", expectedPrice: 650 }
  ];

  for (const target of purchaseTargets) {
    const response = await state.buyStoreItem({
      username: "LycanStoreUser",
      type: target.type,
      cosmeticId: target.cosmeticId
    });
    assert.equal(response.purchase?.status, "purchased");
    assert.equal(response.purchase?.price, target.expectedPrice);
  }

  const profile = await state.profiles.getProfile("LycanStoreUser");
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_lycan_female"));
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_lycan_male"));
  assert.ok(profile.ownedCosmetics.background.includes("background_bg_lycan_law"));
  assert.ok(profile.ownedCosmetics.cardBack.includes("cardback_lycan_pack"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("earth_variant_stone_paw"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("fire_variant_fire_paw"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("water_variant_water_wolf"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("wind_variant_lycan_duo"));
  assert.equal(profile.tokens, 1050);
});

test("cosmetics: Simple Backgrounds collectionless entries use exact Common metadata without a visible collection", async () => {
  const backgrounds = new Map(COSMETIC_CATALOG.background.map((item) => [item.id, item]));

  for (const [id, name, image] of SIMPLE_BACKGROUNDS_DEFINITIONS) {
    const item = backgrounds.get(id);
    assert.ok(item, `missing Simple Backgrounds item ${id}`);
    assert.equal(item.name, name);
    assert.equal(item.image, image);
    assert.equal(item.rarity, "Common");
    assert.equal(item.price, 150);
    assert.equal(item.purchasable, true);
    assert.equal(item.defaultOwned, false);
    assert.equal(item.isNew, true);
    assert.equal(item.releaseTag, "simple_backgrounds_2026_06");
    assert.equal("collection" in item, false);
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
    assert.equal(item.grantOnly ?? false, false);
    assert.equal(item.chestOnly ?? false, false);
    assert.equal(item.supporterOnly ?? false, false);
    await fs.access(path.join(process.cwd(), "assets", image));
  }
});

test("cosmetics: Vampire Elegance, Lycan Power, Elemental Street, and Simple Backgrounds are the active NEW drops", () => {
  const expectedNewIds = new Set([
    "avatar_vampire_female",
    "avatar_vampire_male",
    "cardback_blood_gem",
    "cardback_winged_coffin",
    "earth_variant_stone_graves",
    "fire_variant_flame_wings",
    "water_variant_blood_wings",
    "wind_variant_wings_wind",
    "avatar_lycan_female",
    "avatar_lycan_male",
    "background_bg_lycan_law",
    "cardback_lycan_pack",
    "earth_variant_stone_paw",
    "fire_variant_fire_paw",
    "water_variant_water_wolf",
    "wind_variant_lycan_duo",
    "avatar_fire_street_duelist",
    "avatar_water_street_duelist",
    "avatar_earth_street_duelist",
    "avatar_wind_street_duelist",
    "title_spark",
    "title_drifter",
    "title_stonehand",
    "title_mistborn",
    "cardback_four_element_street_emblem",
    "fire_variant_street",
    "water_variant_street",
    "earth_variant_street",
    "wind_variant_street",
    "background_breezewild_meadow",
    "background_broken_yard",
    "background_crystal_ruins",
    "background_chamber_of_the_four",
    "background_ember_pit",
    "background_glowtide_flats",
    "background_moonshade_grove",
    "background_morning_sanctum",
    "avatar_chestbound_adept",
    "avatar_element_chosen",
    "badge_daily_emblem",
    "cardback_daily_element_chest",
    "earth_variant_verdant_core",
    "fire_variant_sunflare",
    "title_element_touched",
    "title_first_light",
    "water_variant_tideglass",
    "wind_variant_cloudcoil"
  ]);

  const definitions = Object.values(COSMETIC_CATALOG).flat();
  const actualNewIds = definitions.filter((item) => item.isNew).map((item) => item.id).sort();
  const expectedSorted = [...expectedNewIds].sort();

  assert.deepEqual(actualNewIds, expectedSorted);
});

test("cosmetics: Elemental Street store purchases succeed for all approved collectionless items with matched catalog pricing", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("ElementalStreetUser", { tokens: 4000 });

  const purchaseTargets = [
    { type: "avatar", cosmeticId: "avatar_fire_street_duelist", expectedPrice: 200 },
    { type: "avatar", cosmeticId: "avatar_water_street_duelist", expectedPrice: 200 },
    { type: "avatar", cosmeticId: "avatar_earth_street_duelist", expectedPrice: 200 },
    { type: "avatar", cosmeticId: "avatar_wind_street_duelist", expectedPrice: 200 },
    { type: "title", cosmeticId: "title_spark", expectedPrice: 150 },
    { type: "title", cosmeticId: "title_drifter", expectedPrice: 150 },
    { type: "title", cosmeticId: "title_stonehand", expectedPrice: 150 },
    { type: "title", cosmeticId: "title_mistborn", expectedPrice: 150 },
    { type: "cardBack", cosmeticId: "cardback_four_element_street_emblem", expectedPrice: 350 },
    { type: "elementCardVariant", cosmeticId: "fire_variant_street", expectedPrice: 350 },
    { type: "elementCardVariant", cosmeticId: "water_variant_street", expectedPrice: 350 },
    { type: "elementCardVariant", cosmeticId: "earth_variant_street", expectedPrice: 350 },
    { type: "elementCardVariant", cosmeticId: "wind_variant_street", expectedPrice: 350 }
  ];

  for (const target of purchaseTargets) {
    const response = await state.buyStoreItem({
      username: "ElementalStreetUser",
      type: target.type,
      cosmeticId: target.cosmeticId
    });
    assert.equal(response.purchase?.status, "purchased");
    assert.equal(response.purchase?.price, target.expectedPrice);
  }

  const profile = await state.profiles.getProfile("ElementalStreetUser");
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_fire_street_duelist"));
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_water_street_duelist"));
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_earth_street_duelist"));
  assert.ok(profile.ownedCosmetics.avatar.includes("avatar_wind_street_duelist"));
  assert.ok(profile.ownedCosmetics.title.includes("title_spark"));
  assert.ok(profile.ownedCosmetics.title.includes("title_drifter"));
  assert.ok(profile.ownedCosmetics.title.includes("title_stonehand"));
  assert.ok(profile.ownedCosmetics.title.includes("title_mistborn"));
  assert.ok(profile.ownedCosmetics.cardBack.includes("cardback_four_element_street_emblem"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("fire_variant_street"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("water_variant_street"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("earth_variant_street"));
  assert.ok(profile.ownedCosmetics.elementCardVariant.includes("wind_variant_street"));
  assert.equal(profile.tokens, 850);
});

test("cosmetics: Simple Backgrounds store purchases and background equip succeed for all approved items", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("SimpleBackgroundsUser", { tokens: 1200 });

  for (const [id] of SIMPLE_BACKGROUNDS_DEFINITIONS) {
    const response = await state.buyStoreItem({
      username: "SimpleBackgroundsUser",
      type: "background",
      cosmeticId: id
    });
    assert.equal(response.purchase?.status, "purchased");
    assert.equal(response.purchase?.price, 150);
  }

  const equipped = await state.equipCosmetic({
    username: "SimpleBackgroundsUser",
    type: "background",
    cosmeticId: "background_glowtide_flats"
  });

  const profile = await state.profiles.getProfile("SimpleBackgroundsUser");
  for (const [id] of SIMPLE_BACKGROUNDS_DEFINITIONS) {
    assert.ok(profile.ownedCosmetics.background.includes(id), `missing owned background ${id}`);
  }
  assert.equal(equipped.profile.equippedCosmetics.background, "background_glowtide_flats");
  assert.equal(profile.equippedCosmetics.background, "background_glowtide_flats");
  assert.equal(profile.cosmetics.background, "background_glowtide_flats");
  assert.equal(profile.tokens, 300);
});
