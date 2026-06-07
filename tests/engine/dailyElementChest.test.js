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
  DAILY_ELEMENT_CHEST_DUPLICATE_TOKEN_REWARDS,
  DAILY_ELEMENT_CHEST_ODDS,
  DAILY_ELEMENT_CHEST_PAID_OPEN_COST,
  DAILY_ELEMENT_CHEST_POOL,
  getDailyElementChestStatus,
  normalizeProfileDailyElementChest,
  openDailyElementChest
} from "../../src/state/dailyElementChestSystem.js";
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
