import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  COSMETIC_CATALOG,
  getCosmeticCatalogForProfile
} from "../../src/state/cosmeticSystem.js";
import {
  DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
  DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS,
  DAILY_ELEMENT_CHEST_ODDS,
  DAILY_ELEMENT_CHEST_PAID_OPEN_COST,
  DAILY_ELEMENT_CHEST_POOL,
  getDailyChestPoolStatus,
  getDailyChestRewardPool,
  getDailyElementChestStatus,
  isDailyChestPoolComplete,
  normalizeProfileDailyElementChest,
  openDailyElementChest
} from "../../src/state/dailyElementChestSystem.js";
import {
  DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
  validateEventChestDefinition
} from "../../src/state/eventChestDefinitions.js";
import {
  getActiveEventChestDefinitions,
  getDefaultDailyElementChestDefinition,
  getEventChestDefinitionById,
  getEventChestDefinitions,
  isEventChestDefinitionActive
} from "../../src/state/eventChestRegistry.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { getStoreViewForProfile } from "../../src/state/storeSystem.js";
import {
  getArenaBackground,
  getAvatarImage,
  getCardBackImage,
  getVariantCardImages
} from "../../src/renderer/utils/assets.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-daily-chest-"));
}

function randomSequence(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

const DAILY_CHEST_EXPECTATIONS = Object.freeze([
  ["title", "title_first_light", "Common"],
  ["title", "title_element_touched", "Common"],
  ["badge", "badge_daily_emblem", "Common"],
  ["avatar", "avatar_chestbound_adept", "Rare"],
  ["background", "background_morning_sanctum", "Rare"],
  ["cardBack", "cardback_daily_element_chest", "Epic"],
  ["elementCardVariant", "fire_variant_sunflare", "Epic"],
  ["elementCardVariant", "water_variant_tideglass", "Epic"],
  ["elementCardVariant", "earth_variant_verdant_core", "Epic"],
  ["elementCardVariant", "wind_variant_cloudcoil", "Epic"],
  ["avatar", "avatar_element_chosen", "Legendary"],
  ["background", "background_chamber_of_the_four", "Legendary"]
]);

function buildDailyChestCompletionProfile(overrides = {}) {
  return {
    username: "DailyChestCompletionUser",
    tokens: 400,
    ownedCosmetics: {
      avatar: ["default_avatar"],
      background: ["default_background"],
      cardBack: ["default_card_back"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"],
      ...(overrides.ownedCosmetics ?? {})
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      },
      badge: "none",
      title: "Initiate",
      ...(overrides.equippedCosmetics ?? {})
    },
    ...overrides
  };
}

function addDailyChestPoolOwnership(profile, entries = DAILY_CHEST_EXPECTATIONS) {
  const next = {
    ...profile,
    ownedCosmetics: {
      avatar: [...(profile.ownedCosmetics?.avatar ?? [])],
      background: [...(profile.ownedCosmetics?.background ?? [])],
      cardBack: [...(profile.ownedCosmetics?.cardBack ?? [])],
      elementCardVariant: [...(profile.ownedCosmetics?.elementCardVariant ?? [])],
      badge: [...(profile.ownedCosmetics?.badge ?? [])],
      title: [...(profile.ownedCosmetics?.title ?? [])]
    }
  };

  for (const [type, cosmeticId] of entries) {
    if (!next.ownedCosmetics[type].includes(cosmeticId)) {
      next.ownedCosmetics[type].push(cosmeticId);
    }
  }

  return next;
}

test("daily chest: approved cosmetics exist in catalog with final rarity and chest-only flags", () => {
  for (const [type, id, rarity] of DAILY_CHEST_EXPECTATIONS) {
    const item = COSMETIC_CATALOG[type].find((entry) => entry.id === id);
    assert.ok(item, `missing catalog entry for ${type}:${id}`);
    assert.equal(item.rarity, rarity);
    assert.equal(item.collection, "Daily EleMintz Chest");
    assert.equal(item.source, "daily_chest");
    assert.equal(item.dailyChestEligible, true);
    assert.equal(item.chestOnly, true);
    assert.equal(item.shopEligible, false);
    assert.equal(item.purchasable, false);
    assert.equal(item.releaseTag, "daily_elemintz_chest_2026_06");
    assert.equal(item.isNew, true);
  }
});

test("daily chest: copied assets and required resolver entries exist", async () => {
  const assetRoot = "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\assets";
  const expectedFiles = [
    "avatars/avatar_chestbound_adept.png",
    "avatars/avatar_element_chosen.png",
    "backgrounds/background_morning_sanctum.png",
    "backgrounds/background_chamber_of_the_four.png",
    "badges/badge_daily_emblem.png",
    "card_backs/cardback_daily_element_chest.png",
    "cards/fire_variant_sunflare.png",
    "cards/water_variant_tideglass.png",
    "cards/earth_variant_verdant_core.png",
    "cards/wind_variant_cloudcoil.png",
    "titles/title_first_light.png",
    "titles/title_element_touched.png"
  ];

  for (const relativePath of expectedFiles) {
    await fs.access(path.join(assetRoot, relativePath));
  }

  assert.match(getAvatarImage("avatar_chestbound_adept"), /assets\/avatars\/avatar_chestbound_adept\.png$/);
  assert.match(getAvatarImage("avatar_element_chosen"), /assets\/avatars\/avatar_element_chosen\.png$/);
  assert.match(
    getCardBackImage("cardback_daily_element_chest"),
    /assets\/card_backs\/cardback_daily_element_chest\.png$/
  );

  const variants = getVariantCardImages({
    fire: "fire_variant_sunflare",
    water: "water_variant_tideglass",
    earth: "earth_variant_verdant_core",
    wind: "wind_variant_cloudcoil"
  });
  assert.match(variants.fire, /assets\/cards\/fire_variant_sunflare\.png$/);
  assert.match(variants.water, /assets\/cards\/water_variant_tideglass\.png$/);
  assert.match(variants.earth, /assets\/cards\/earth_variant_verdant_core\.png$/);
  assert.match(variants.wind, /assets\/cards\/wind_variant_cloudcoil\.png$/);
  assert.match(getArenaBackground("background_morning_sanctum"), /assets\/backgrounds\/background_morning_sanctum\.png$/);
  assert.match(
    getArenaBackground("background_chamber_of_the_four"),
    /assets\/backgrounds\/background_chamber_of_the_four\.png$/
  );
});

test("daily chest: cosmetics stay out of the normal store catalog while owned items remain visible and equippable", async () => {
  const store = getStoreViewForProfile({ username: "DailyChestStoreUser" });

  for (const [type, id] of DAILY_CHEST_EXPECTATIONS) {
    assert.equal(
      store.catalog[type].some((item) => item.id === id),
      false,
      `${type}:${id} should stay out of the normal store catalog`
    );
  }

  const ownedCatalog = getCosmeticCatalogForProfile({
    username: "DailyChestOwner",
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_chestbound_adept", "avatar_element_chosen"],
      background: ["default_background", "background_morning_sanctum", "background_chamber_of_the_four"],
      cardBack: ["default_card_back", "cardback_daily_element_chest"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card",
        "fire_variant_sunflare",
        "water_variant_tideglass",
        "earth_variant_verdant_core",
        "wind_variant_cloudcoil"
      ],
      badge: ["none", "badge_daily_emblem"],
      title: ["Initiate", "title_first_light", "title_element_touched"]
    },
    equippedCosmetics: {
      avatar: "avatar_chestbound_adept",
      background: "background_morning_sanctum",
      cardBack: "cardback_daily_element_chest",
      elementCardVariant: {
        fire: "fire_variant_sunflare",
        water: "water_variant_tideglass",
        earth: "earth_variant_verdant_core",
        wind: "wind_variant_cloudcoil"
      },
      badge: "badge_daily_emblem",
      title: "title_first_light"
    }
  });

  assert.equal(ownedCatalog.avatar.find((item) => item.id === "avatar_chestbound_adept")?.owned, true);
  assert.equal(
    ownedCatalog.cardBack.find((item) => item.id === "cardback_daily_element_chest")?.equipped,
    true
  );
  assert.equal(
    ownedCatalog.background.find((item) => item.id === "background_morning_sanctum")?.equipped,
    true
  );
});

test("daily chest: default state normalizes safely onto profiles", () => {
  const normalized = normalizeProfileDailyElementChest({ username: "DailyChestNormalizeUser" });

  assert.deepEqual(normalized.dailyElementChest, {
    lastFreeOpenDateKey: null,
    totalOpens: 0,
    paidOpens: 0,
    freeOpens: 0,
    pity: {
      opensSinceEpicPlus: 0,
      opensSinceLegendary: 0
    }
  });
});

test("daily chest: free open is available once per reset window and second free open is rejected cleanly", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0])
  });
  const nowMs = Date.parse("2026-06-06T23:30:00.000Z");

  const statusBefore = await state.getDailyElementChestStatus("DailyChestFreeUser", nowMs);
  const firstOpen = await state.openDailyElementChest({
    username: "DailyChestFreeUser",
    openType: "free",
    nowMs
  });
  const statusAfter = await state.getDailyElementChestStatus("DailyChestFreeUser", nowMs);

  assert.equal(statusBefore.canOpenFree, true);
  assert.equal(firstOpen.openType, "free");
  assert.equal(firstOpen.dailyElementChest.freeOpens, 1);
  assert.equal(firstOpen.dailyElementChest.totalOpens, 1);
  assert.equal(statusAfter.canOpenFree, false);

  await assert.rejects(
    () =>
      state.openDailyElementChest({
        username: "DailyChestFreeUser",
        openType: "free",
        nowMs
      }),
    /already been used/i
  );

  await fs.rm(dataDir, { recursive: true, force: true });
});

test("daily chest: paid opens cost 100 tokens and reject cleanly when tokens are insufficient", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0.7, 0])
  });

  await state.profiles.updateProfile("DailyChestPaidUser", (current) => ({
    ...current,
    tokens: 150
  }));

  const opened = await state.openDailyElementChest({
    username: "DailyChestPaidUser",
    openType: "paid",
    nowMs: Date.parse("2026-06-06T23:30:00.000Z")
  });

  assert.equal(opened.openType, "paid");
  assert.equal(opened.profile.tokens, 50);
  assert.equal(opened.dailyElementChest.paidOpens, 1);
  assert.equal(opened.dailyElementChest.totalOpens, 1);

  await assert.rejects(
    () =>
      state.openDailyElementChest({
        username: "DailyChestPaidUser",
        openType: "paid",
        nowMs: Date.parse("2026-06-07T00:30:00.000Z")
      }),
    /Insufficient tokens/i
  );

  await fs.rm(dataDir, { recursive: true, force: true });
});

test("daily chest: Epic-plus pity triggers at 10 misses and Legendary pity wins at 30 misses", () => {
  const epicPityResult = openDailyElementChest(
    {
      username: "DailyChestEpicPityUser",
      tokens: 200,
      dailyElementChest: {
        lastFreeOpenDateKey: null,
        totalOpens: 9,
        paidOpens: 0,
        freeOpens: 9,
        pity: {
          opensSinceEpicPlus: 9,
          opensSinceLegendary: 9
        }
      }
    },
    {
      openType: "free",
      nowMs: Date.parse("2026-06-06T23:30:00.000Z"),
      random: randomSequence([0, 0])
    }
  );

  assert.equal(epicPityResult.pityApplied.epicPlus, true);
  assert.equal(epicPityResult.pityApplied.legendary, false);
  assert.equal(epicPityResult.rarity, "epic");
  assert.equal(epicPityResult.dailyElementChest.pity.opensSinceEpicPlus, 0);
  assert.equal(epicPityResult.dailyElementChest.pity.opensSinceLegendary, 10);

  const legendaryPityResult = openDailyElementChest(
    {
      username: "DailyChestLegendaryPityUser",
      tokens: 200,
      dailyElementChest: {
        lastFreeOpenDateKey: null,
        totalOpens: 29,
        paidOpens: 0,
        freeOpens: 29,
        pity: {
          opensSinceEpicPlus: 29,
          opensSinceLegendary: 29
        }
      }
    },
    {
      openType: "free",
      nowMs: Date.parse("2026-06-06T23:30:00.000Z"),
      random: randomSequence([0.5, 0])
    }
  );

  assert.equal(legendaryPityResult.pityApplied.epicPlus, true);
  assert.equal(legendaryPityResult.pityApplied.legendary, true);
  assert.equal(legendaryPityResult.rarity, "legendary");
  assert.equal(legendaryPityResult.dailyElementChest.pity.opensSinceEpicPlus, 0);
  assert.equal(legendaryPityResult.dailyElementChest.pity.opensSinceLegendary, 0);
});

test("daily chest: rolled rarity prefers unowned cosmetics within that rarity bucket", () => {
  const result = openDailyElementChest(
    {
      username: "DailyChestUnownedFirstUser",
      tokens: 200,
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none"],
        title: ["Initiate", "title_first_light"]
      }
    },
    {
      openType: "free",
      nowMs: Date.parse("2026-06-06T23:30:00.000Z"),
      random: randomSequence([0, 0])
    }
  );

  assert.equal(result.rarity, "common");
  assert.equal(result.cosmetic?.cosmeticId, "title_element_touched");
  assert.equal(result.duplicateConversion, null);
  assert.ok(result.profile.ownedCosmetics.title.includes("title_element_touched"));
});

test("daily chest: duplicate rewards convert to the correct token amount only when the full rarity bucket is already owned", () => {
  const result = openDailyElementChest(
    {
      username: "DailyChestDuplicateUser",
      tokens: 200,
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none", "badge_daily_emblem"],
        title: ["Initiate", "title_first_light", "title_element_touched"]
      }
    },
    {
      openType: "free",
      nowMs: Date.parse("2026-06-06T23:30:00.000Z"),
      random: randomSequence([0, 0])
    }
  );

  assert.equal(result.rarity, "common");
  assert.equal(result.cosmetic, null);
  assert.deepEqual(result.duplicateConversion, {
    tokensGranted: DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS.common
  });
  assert.equal(result.profile.tokens, 200 + DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS.common);
  assert.equal(result.profile.ownedCosmetics.title.filter((id) => id === "title_first_light").length, 1);
});

test("daily chest: full collection completion still allows opens and converts by rolled rarity", () => {
  const fullyOwnedProfile = DAILY_CHEST_EXPECTATIONS.reduce(
    (profile, [type, cosmeticId]) => {
      profile.ownedCosmetics[type].push(cosmeticId);
      return profile;
    },
    {
      username: "DailyChestCompleteUser",
      tokens: 200,
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none"],
        title: ["Initiate"]
      }
    }
  );

  const result = openDailyElementChest(fullyOwnedProfile, {
    openType: "free",
    nowMs: Date.parse("2026-06-06T23:30:00.000Z"),
    random: randomSequence([0.7, 0])
  });

  assert.equal(result.rarity, "rare");
  assert.equal(result.cosmetic, null);
  assert.deepEqual(result.duplicateConversion, {
    tokensGranted: DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS.rare
  });
});

test("daily chest: pity-triggered rarity still prefers unowned cosmetics within the guaranteed rarity", () => {
  const result = openDailyElementChest(
    {
      username: "DailyChestEpicPityUnownedUser",
      tokens: 200,
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back", "cardback_daily_element_chest"],
        elementCardVariant: [
          "default_fire_card",
          "default_water_card",
          "default_earth_card",
          "default_wind_card",
          "fire_variant_sunflare"
        ],
        badge: ["none"],
        title: ["Initiate"]
      },
      dailyElementChest: {
        lastFreeOpenDateKey: null,
        totalOpens: 9,
        paidOpens: 0,
        freeOpens: 9,
        pity: {
          opensSinceEpicPlus: 9,
          opensSinceLegendary: 9
        }
      }
    },
    {
      openType: "free",
      nowMs: Date.parse("2026-06-06T23:30:00.000Z"),
      random: randomSequence([0, 0])
    }
  );

  assert.equal(result.rarity, "epic");
  assert.equal(result.cosmetic?.cosmeticId, "water_variant_tideglass");
  assert.equal(result.duplicateConversion, null);
});

test("daily chest: equipping granted chest-exclusive cosmetics works where relevant", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });

  await state.profiles.updateProfile("DailyChestEquipUser", (current) => ({
    ...current,
    ownedCosmetics: {
      ...current.ownedCosmetics,
      avatar: [...current.ownedCosmetics.avatar, "avatar_chestbound_adept"],
      background: [...current.ownedCosmetics.background, "background_morning_sanctum"],
      cardBack: [...current.ownedCosmetics.cardBack, "cardback_daily_element_chest"],
      elementCardVariant: [...current.ownedCosmetics.elementCardVariant, "fire_variant_sunflare"]
    }
  }));

  await state.equipCosmetic({
    username: "DailyChestEquipUser",
    type: "avatar",
    cosmeticId: "avatar_chestbound_adept"
  });
  await state.equipCosmetic({
    username: "DailyChestEquipUser",
    type: "background",
    cosmeticId: "background_morning_sanctum"
  });
  await state.equipCosmetic({
    username: "DailyChestEquipUser",
    type: "cardBack",
    cosmeticId: "cardback_daily_element_chest"
  });
  const variantEquip = await state.equipCosmetic({
    username: "DailyChestEquipUser",
    type: "elementCardVariant",
    cosmeticId: "fire_variant_sunflare"
  });

  assert.equal(variantEquip.profile.equippedCosmetics.avatar, "avatar_chestbound_adept");
  assert.equal(variantEquip.profile.equippedCosmetics.background, "background_morning_sanctum");
  assert.equal(variantEquip.profile.equippedCosmetics.cardBack, "cardback_daily_element_chest");
  assert.equal(variantEquip.profile.equippedCosmetics.elementCardVariant.fire, "fire_variant_sunflare");

  await fs.rm(dataDir, { recursive: true, force: true });
});

test("daily chest: status returns free eligibility, paid cost, pity counters, pool summary, and collection progress", () => {
  const status = getDailyElementChestStatus(
    {
      username: "DailyChestStatusUser",
      tokens: 345,
      ownedCosmetics: {
        avatar: ["default_avatar", "avatar_chestbound_adept"],
        background: ["default_background"],
        cardBack: ["default_card_back", "cardback_daily_element_chest"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none", "badge_daily_emblem"],
        title: ["Initiate", "title_first_light"]
      },
      dailyElementChest: {
        lastFreeOpenDateKey: null,
        totalOpens: 10,
        paidOpens: 7,
        freeOpens: 3,
        pity: {
          opensSinceEpicPlus: 4,
          opensSinceLegendary: 10
        }
      }
    },
    Date.parse("2026-06-06T23:30:00.000Z")
  );

  assert.equal(status.canOpenFree, true);
  assert.equal(status.paidOpenCost, DAILY_ELEMENT_CHEST_PAID_OPEN_COST);
  assert.equal(status.tokens, 345);
  assert.deepEqual(status.odds, DAILY_ELEMENT_CHEST_ODDS);
  assert.equal(status.pity.opensSinceEpicPlus, 4);
  assert.equal(status.pity.opensSinceLegendary, 10);
  assert.deepEqual(status.poolSummary.common, DAILY_ELEMENT_CHEST_POOL.common.map((entry) => ({
    type: entry.type,
    cosmeticId: entry.cosmeticId,
    name: COSMETIC_CATALOG[entry.type].find((item) => item.id === entry.cosmeticId)?.name ?? entry.cosmeticId
  })));
  assert.deepEqual(status.collectionProgress, {
    totalOwned: 4,
    totalAvailable: 12,
    isComplete: false,
    byRarity: {
      common: { owned: 2, total: 3, isComplete: false },
      rare: { owned: 1, total: 2, isComplete: false },
      epic: { owned: 1, total: 5, isComplete: false },
      legendary: { owned: 0, total: 2, isComplete: false }
    },
    items: {
      common: [
        { type: "title", cosmeticId: "title_first_light", name: "First Light", owned: true },
        { type: "title", cosmeticId: "title_element_touched", name: "Element Touched", owned: false },
        { type: "badge", cosmeticId: "badge_daily_emblem", name: "Daily Emblem", owned: true }
      ],
      rare: [
        { type: "avatar", cosmeticId: "avatar_chestbound_adept", name: "Chestbound Adept", owned: true },
        { type: "background", cosmeticId: "background_morning_sanctum", name: "Morning Sanctum", owned: false }
      ],
      epic: [
        {
          type: "cardBack",
          cosmeticId: "cardback_daily_element_chest",
          name: "Daily Element Chest",
          owned: true
        },
        {
          type: "elementCardVariant",
          cosmeticId: "fire_variant_sunflare",
          name: "Sunflare Fire",
          owned: false
        },
        {
          type: "elementCardVariant",
          cosmeticId: "water_variant_tideglass",
          name: "Tideglass Water",
          owned: false
        },
        {
          type: "elementCardVariant",
          cosmeticId: "earth_variant_verdant_core",
          name: "Verdant Core Earth",
          owned: false
        },
        {
          type: "elementCardVariant",
          cosmeticId: "wind_variant_cloudcoil",
          name: "Cloudcoil Wind",
          owned: false
        }
      ],
      legendary: [
        { type: "avatar", cosmeticId: "avatar_element_chosen", name: "Element Chosen", owned: false },
        {
          type: "background",
          cosmeticId: "background_chamber_of_the_four",
          name: "Chamber Of The Four",
          owned: false
        }
      ]
    }
  });
});

test("daily chest: pool completion helpers report incomplete when any current pool cosmetic is missing", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile(), DAILY_CHEST_EXPECTATIONS.slice(1));
  const status = getDailyChestPoolStatus(profile);
  const expectedTotal = Object.values(DAILY_ELEMENT_CHEST_POOL).reduce((total, entries) => total + entries.length, 0);

  assert.equal(getDailyChestRewardPool(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID), DAILY_ELEMENT_CHEST_POOL);
  assert.equal(status.poolId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.equal(status.totalAvailable, expectedTotal);
  assert.equal(status.totalOwned, expectedTotal - 1);
  assert.equal(status.isComplete, false);
  assert.equal(isDailyChestPoolComplete(profile), false);
  assert.equal(status.byRarity.common.owned, 2);
  assert.equal(status.byRarity.common.total, DAILY_ELEMENT_CHEST_POOL.common.length);
  assert.equal(status.items.common.some((entry) => entry.cosmeticId === "title_first_light" && entry.owned === false), true);
});

test("daily chest: pool completion helpers report complete only when every current pool cosmetic is owned", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile());
  const status = getDailyChestPoolStatus(profile);
  const expectedTotal = Object.values(DAILY_ELEMENT_CHEST_POOL).reduce((total, entries) => total + entries.length, 0);

  assert.equal(status.totalAvailable, expectedTotal);
  assert.equal(status.totalOwned, expectedTotal);
  assert.equal(status.isComplete, true);
  assert.equal(isDailyChestPoolComplete(profile), true);
  assert.equal(Object.values(status.byRarity).every((entry) => entry.isComplete === true), true);
  assert.equal(Object.values(status.items).flat().every((entry) => entry.owned === true), true);
});

test("daily chest: claimed or cooldown state does not affect pool completion helpers", () => {
  const incompleteProfile = addDailyChestPoolOwnership(
    buildDailyChestCompletionProfile({
      dailyElementChest: {
        lastFreeOpenDateKey: new Date(Date.parse("2026-06-06T23:00:00.000Z")).toISOString(),
        totalOpens: 99,
        paidOpens: 40,
        freeOpens: 59,
        pity: {
          opensSinceEpicPlus: 9,
          opensSinceLegendary: 29
        }
      }
    }),
    DAILY_CHEST_EXPECTATIONS.slice(0, -1)
  );

  assert.equal(isDailyChestPoolComplete(incompleteProfile), false);
  assert.equal(getDailyChestPoolStatus(incompleteProfile).isComplete, false);
});

test("daily chest: duplicate fallback-like state does not affect pool completion helpers", () => {
  const incompleteProfile = addDailyChestPoolOwnership(
    buildDailyChestCompletionProfile({
      tokens: 9999,
      dailyElementChest: {
        lastFreeOpenDateKey: null,
        totalOpens: 30,
        paidOpens: 30,
        freeOpens: 0,
        pity: {
          opensSinceEpicPlus: 0,
          opensSinceLegendary: 0
        }
      }
    }),
    DAILY_CHEST_EXPECTATIONS.filter(([, cosmeticId]) => cosmeticId !== "background_morning_sanctum")
  );

  assert.equal(isDailyChestPoolComplete(incompleteProfile), false);
  assert.equal(getDailyChestPoolStatus(incompleteProfile).byRarity.rare.isComplete, false);
});

test("daily chest: unrelated owned and equipped cosmetics do not affect pool completion helpers", () => {
  const unrelatedProfile = buildDailyChestCompletionProfile({
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_fire_mage"],
      background: ["default_background", "forest_glade_background"],
      cardBack: ["default_card_back", "fire_card_back"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card",
        "fire_variant_ember"
      ],
      badge: ["none", "war_machine"],
      title: ["Initiate", "Flame Vanguard"]
    },
    equippedCosmetics: {
      avatar: "avatar_fire_mage",
      background: "forest_glade_background",
      cardBack: "fire_card_back",
      badge: "war_machine",
      title: "Flame Vanguard"
    }
  });
  const status = getDailyChestPoolStatus(unrelatedProfile);

  assert.equal(status.totalOwned, 0);
  assert.equal(status.isComplete, false);
  assert.equal(isDailyChestPoolComplete(unrelatedProfile), false);
});

function cloneEventChestPreset(overrides = {}) {
  return {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    ...overrides
  };
}

test("event chest definitions: Daily EleMintz Chest default preset validates with current behavior values", () => {
  const validation = validateEventChestDefinition(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET);
  const poolEntryCount = Object.values(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool).reduce(
    (total, entries) => total + entries.length,
    0
  );

  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.title, "Daily EleMintz Chest");
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.icons.closed, "icons/daily_chest.png");
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.icons.open, "icons/daily_chest_open.png");
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.icons.fallbackClosed, "icons/loot_chest.png");
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.icons.fallbackOpen, "icons/loot_chest_open.png");
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.openTypes, ["free", "paid"]);
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.freeOpenPolicy, {
    cadence: "daily",
    resetTimeZone: "America/Chicago",
    resetHour: 18
  });
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.paidTokenCost, DAILY_ELEMENT_CHEST_PAID_OPEN_COST);
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.odds, DAILY_ELEMENT_CHEST_ODDS);
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pity, {
    epicPlusThreshold: 10,
    legendaryThreshold: 30,
    epicPlusTable: [
      { rarity: "epic", weight: 0.875 },
      { rarity: "legendary", weight: 0.125 }
    ]
  });
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.duplicateTokenRewards, DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS);
  assert.deepEqual(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool, DAILY_ELEMENT_CHEST_POOL);
  assert.equal(poolEntryCount, 12);
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.preferUnownedWithinRolledRarity, true);
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.hideTileWhenPoolComplete, true);
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.allowOpensAfterCompleteAsDuplicateConversion, true);
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.preserveHistoryOnReactivation, true);
  assert.equal(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.profileProgressField, "dailyElementChest");
});

test("event chest definitions: validator rejects missing chestId", () => {
  const definition = cloneEventChestPreset({ chestId: "" });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /chestId/i);
});

test("event chest definitions: validator rejects odds that do not sum to one", () => {
  const definition = cloneEventChestPreset({
    odds: {
      common: 0.7,
      rare: 0.22,
      epic: 0.07,
      legendary: 0.02
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /odds must sum to 1/i);
});

test("event chest definitions: validator rejects unknown cosmetic ids", () => {
  const definition = cloneEventChestPreset({
    pool: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      common: [{ type: "title", cosmeticId: "missing_daily_chest_title" }]
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /unknown cosmetic/i);
});

test("event chest definitions: validator rejects duplicate cosmetic entries inside one chest", () => {
  const definition = cloneEventChestPreset({
    pool: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      rare: [
        { type: "avatar", cosmeticId: "avatar_chestbound_adept" },
        { type: "avatar", cosmeticId: "avatar_chestbound_adept" }
      ]
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /duplicate cosmetic/i);
});

test("event chest definitions: validator rejects unsupported open type and cosmetic type", () => {
  const definition = cloneEventChestPreset({
    openTypes: ["free", "bonus"],
    pool: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      common: [{ type: "taunt", cosmeticId: "taunt_daily_chest" }]
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /openType 'bonus' is unsupported/i);
  assert.match(validation.errors.join("\n"), /type is unsupported/i);
});

test("event chest definitions: validator rejects invalid pity config", () => {
  const definition = cloneEventChestPreset({
    pity: {
      epicPlusThreshold: 0,
      legendaryThreshold: 5,
      epicPlusTable: [
        { rarity: "epic", weight: 0.75 },
        { rarity: "mythic", weight: 0.25 }
      ]
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /epicPlusThreshold/i);
  assert.match(validation.errors.join("\n"), /rarity is unsupported/i);
});

test("event chest registry: includes and looks up the Daily EleMintz Chest default preset", () => {
  const definitions = getEventChestDefinitions();
  const lookup = getEventChestDefinitionById(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  const defaultLookup = getDefaultDailyElementChestDefinition();

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.deepEqual(lookup, DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET);
  assert.deepEqual(defaultLookup, DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET);
});

test("event chest registry: unknown or blank lookup fails safely", () => {
  assert.equal(getEventChestDefinitionById("missing_event_chest"), null);
  assert.equal(getEventChestDefinitionById(""), null);
  assert.equal(getEventChestDefinitionById(null), null);
});

test("event chest registry: every registry definition validates", () => {
  for (const definition of getEventChestDefinitions()) {
    const validation = validateEventChestDefinition(definition);
    assert.equal(validation.ok, true, validation.errors.join("; "));
  }
});

test("event chest registry: returned definitions are defensive copies", () => {
  const firstLookup = getEventChestDefinitionById(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  firstLookup.title = "Mutated Chest";
  firstLookup.pool.common[0].cosmeticId = "mutated_cosmetic";
  firstLookup.icons.closed = "icons/mutated.png";

  const secondLookup = getEventChestDefinitionById(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  const listLookup = getEventChestDefinitions()[0];

  assert.equal(secondLookup.title, "Daily EleMintz Chest");
  assert.equal(secondLookup.pool.common[0].cosmeticId, "title_first_light");
  assert.equal(secondLookup.icons.closed, "icons/daily_chest.png");
  assert.equal(listLookup.title, "Daily EleMintz Chest");
  assert.equal(listLookup.pool.common[0].cosmeticId, "title_first_light");
});

test("event chest registry: active lookup returns the default active chest", () => {
  const activeDefinitions = getActiveEventChestDefinitions(Date.parse("2026-06-06T23:30:00.000Z"));

  assert.equal(activeDefinitions.length, 1);
  assert.equal(activeDefinitions[0].chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.equal(isEventChestDefinitionActive(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET), true);
});

test("event chest registry: active window helper respects explicit windows", () => {
  const definition = cloneEventChestPreset({
    activeWindows: [
      {
        startsAt: "2026-06-01T00:00:00.000Z",
        endsAt: "2026-06-30T23:59:59.000Z"
      }
    ]
  });
  const inactiveDefinition = cloneEventChestPreset({
    lifecycle: {
      status: "inactive",
      defaultPreset: true
    }
  });

  assert.equal(isEventChestDefinitionActive(definition, "2026-06-15T12:00:00.000Z"), true);
  assert.equal(isEventChestDefinitionActive(definition, "2026-07-01T00:00:00.000Z"), false);
  assert.equal(isEventChestDefinitionActive(inactiveDefinition, "2026-06-15T12:00:00.000Z"), false);
});
