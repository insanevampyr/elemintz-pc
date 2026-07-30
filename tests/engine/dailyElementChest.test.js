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
  DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD,
  DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD,
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
  EVENT_CHEST_MAX_PAID_TOKEN_COST,
  normalizeEventChestOpeningRules,
  validateEventChestDefinition
} from "../../src/state/eventChestDefinitions.js";
import { getDailyElementChestStatusFromEventProjection } from "../../src/state/eventChestDailyStatusAdapter.js";
import {
  auditDailyElementChestMirrorParity,
  eventChestProgressFromDailyElementChest
} from "../../src/state/eventChestProfileProgress.js";
import {
  getActiveEventChestDefinitions,
  getDefaultDailyElementChestDefinition,
  getEventChestDefinitionById,
  getEventChestDefinitions,
  hasEventChestDefinition,
  isEventChestDefinitionActive
} from "../../src/state/eventChestRegistry.js";
import {
  EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
  EVENT_CHEST_REGISTRY_FILENAME,
  EventChestRegistryStore
} from "../../src/state/eventChestRegistryStore.js";
import { projectEventChestStatus } from "../../src/state/eventChestStatus.js";
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

function assertDailyChestMirrorMatches(profile, { openType = null, openedAt = null } = {}) {
  const mirror = profile?.eventChests?.[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID];
  assert.ok(mirror, "expected Daily Elemintz Chest eventChests mirror");
  assert.equal(mirror.chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.equal(mirror.source, "legacy_daily_element_chest_mirror");
  assert.equal(mirror.sourceProfileField, "dailyElementChest");
  assert.equal(mirror.lastOpenType, openType);
  assert.equal(mirror.lastOpenedAt, openedAt);
  assert.equal(mirror.lastUpdatedAt, openedAt);
  assert.equal(mirror.lastFreeOpenDateKey, profile.dailyElementChest.lastFreeOpenDateKey);
  assert.equal(mirror.totalOpens, profile.dailyElementChest.totalOpens);
  assert.equal(mirror.paidOpens, profile.dailyElementChest.paidOpens);
  assert.equal(mirror.freeOpens, profile.dailyElementChest.freeOpens);
  assert.deepEqual(mirror.pity, profile.dailyElementChest.pity);
}

function assertDailyChestMirrorParity(profile) {
  assert.deepEqual(auditDailyElementChestMirrorParity(profile), {
    ok: true,
    status: "matched",
    chestId: DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
    mismatches: []
  });
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

const DAILY_CHEST_STATUS_PARITY_NOW = Date.parse("2026-06-06T23:30:00.000Z");

function buildDailyChestPoolSummaryExpectation() {
  return Object.fromEntries(
    Object.entries(DAILY_ELEMENT_CHEST_POOL).map(([rarity, entries]) => [
      rarity,
      entries.map((entry) => ({
        type: entry.type,
        cosmeticId: entry.cosmeticId,
        name: COSMETIC_CATALOG[entry.type].find((item) => item.id === entry.cosmeticId)?.name ?? entry.cosmeticId
      }))
    ])
  );
}

function compareDailyElementChestStatusProjection(profile, nowMs = DAILY_CHEST_STATUS_PARITY_NOW) {
  const currentStatus = getDailyElementChestStatus(profile, nowMs);
  const projection = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, profile, { nowMs });
  const expectedMissing =
    currentStatus.collectionProgress.totalAvailable - currentStatus.collectionProgress.totalOwned;

  assert.equal(projection.totalPoolCount, currentStatus.collectionProgress.totalAvailable);
  assert.equal(projection.ownedCount, currentStatus.collectionProgress.totalOwned);
  assert.equal(projection.missingCount, expectedMissing);
  assert.equal(projection.isPoolComplete, currentStatus.collectionProgress.isComplete);
  assert.equal(projection.ownedEntries.length, currentStatus.collectionProgress.totalOwned);
  assert.equal(projection.missingEntries.length, expectedMissing);

  for (const rarity of Object.keys(currentStatus.collectionProgress.byRarity)) {
    const currentRarity = currentStatus.collectionProgress.byRarity[rarity];
    assert.deepEqual(projection.byRarity[rarity], {
      total: currentRarity.total,
      owned: currentRarity.owned,
      missing: currentRarity.total - currentRarity.owned,
      isComplete: currentRarity.isComplete
    });
    assert.deepEqual(
      projection.pool.items[rarity].map((entry) => ({
        type: entry.type,
        cosmeticId: entry.cosmeticId,
        name: entry.name,
        owned: entry.owned
      })),
      currentStatus.collectionProgress.items[rarity]
    );
  }

  assert.equal(projection.shouldHideTile, currentStatus.collectionProgress.isComplete);
  assert.equal(projection.hideTileWhenPoolComplete, true);
  assert.equal(projection.allowOpensAfterCompleteAsDuplicateConversion, true);

  assert.equal(projection.progress.totalOpens, currentStatus.dailyElementChest.totalOpens);
  assert.equal(projection.progress.paidOpens, currentStatus.dailyElementChest.paidOpens);
  assert.equal(projection.progress.freeOpens, currentStatus.dailyElementChest.freeOpens);
  assert.equal(projection.progress.lastFreeOpenDateKey, currentStatus.dailyElementChest.lastFreeOpenDateKey);
  assert.equal(projection.lastFreeOpenDateKey, currentStatus.dailyElementChest.lastFreeOpenDateKey);
  assert.deepEqual(projection.progress.pity, currentStatus.pity);

  assert.equal(projection.freeOpenAvailable, currentStatus.canOpenFree);
  assert.equal(projection.nextFreeOpenAt, currentStatus.nextFreeResetAt);
  assert.equal(projection.nextFreeResetAt, currentStatus.nextFreeResetAt);
  assert.equal(projection.msUntilNextFreeOpen, Math.max(0, Date.parse(currentStatus.nextFreeResetAt) - nowMs));
  assert.equal(projection.resetWindow.nextResetAt, currentStatus.nextFreeResetAt);
  assert.equal(projection.currentDateKey, projection.resetWindow.lastResetAt);
  assert.equal(projection.tokenBalance, currentStatus.tokens);
  assert.equal(projection.paidOpenCostTokens, currentStatus.paidOpenCost);
  assert.equal(projection.canAffordPaidOpen, currentStatus.tokens >= currentStatus.paidOpenCost);
  assert.deepEqual(projection.odds, currentStatus.odds);
  assert.deepEqual(projection.poolSummary, currentStatus.poolSummary);
  assert.deepEqual(projection.openTypes, ["free", "paid"]);
  assert.deepEqual(projection.openAvailability.free, {
    supported: true,
    available: currentStatus.canOpenFree,
    nextAvailableAt: currentStatus.canOpenFree ? null : currentStatus.nextFreeResetAt
  });
  assert.deepEqual(projection.openAvailability.paid, {
    supported: true,
    available: currentStatus.tokens >= currentStatus.paidOpenCost,
    costTokens: currentStatus.paidOpenCost,
    canAfford: currentStatus.tokens >= currentStatus.paidOpenCost
  });

  assert.equal(projection.pityDisplay.epicPlus.current, currentStatus.pity.opensSinceEpicPlus);
  assert.equal(projection.pityDisplay.epicPlus.threshold, DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD);
  assert.equal(
    projection.pityDisplay.epicPlus.displayCurrent,
    Math.min(DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD, currentStatus.pity.opensSinceEpicPlus)
  );
  assert.equal(
    projection.pityDisplay.epicPlus.displayLabel,
    `${Math.min(DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD, currentStatus.pity.opensSinceEpicPlus)} / ${DAILY_ELEMENT_CHEST_EPIC_PLUS_PITY_THRESHOLD}`
  );
  assert.equal(projection.pityDisplay.legendary.current, currentStatus.pity.opensSinceLegendary);
  assert.equal(projection.pityDisplay.legendary.threshold, DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD);
  assert.equal(
    projection.pityDisplay.legendary.displayCurrent,
    Math.min(DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD, currentStatus.pity.opensSinceLegendary)
  );
  assert.equal(
    projection.pityDisplay.legendary.displayLabel,
    `${Math.min(DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD, currentStatus.pity.opensSinceLegendary)} / ${DAILY_ELEMENT_CHEST_LEGENDARY_PITY_THRESHOLD}`
  );

  assert.equal(projection.paidOpenCostTokens, DAILY_ELEMENT_CHEST_PAID_OPEN_COST);
  assert.deepEqual(projection.odds, DAILY_ELEMENT_CHEST_ODDS);
  assert.deepEqual(projection.poolSummary, buildDailyChestPoolSummaryExpectation());

  return { currentStatus, projection };
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
  const profileAfterFirstOpen = await state.profiles.getProfile("DailyChestFreeUser");

  assert.equal(statusBefore.canOpenFree, true);
  assert.equal(firstOpen.openType, "free");
  assert.equal(firstOpen.dailyElementChest.freeOpens, 1);
  assert.equal(firstOpen.dailyElementChest.totalOpens, 1);
  assert.deepEqual(
    firstOpen.status,
    getDailyElementChestStatusFromEventProjection(firstOpen.profile, { nowMs })
  );
  assert.deepEqual(firstOpen.status, getDailyElementChestStatus(firstOpen.profile, nowMs));
  assert.equal(statusAfter.canOpenFree, false);
  assertDailyChestMirrorMatches(firstOpen.profile, {
    openType: "free",
    openedAt: new Date(nowMs).toISOString()
  });
  assert.deepEqual(
    firstOpen.profile.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID],
    profileAfterFirstOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]
  );
  assertDailyChestMirrorParity(firstOpen.profile);
  assertDailyChestMirrorParity(profileAfterFirstOpen);

  const reloadedState = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0])
  });
  const reloadedProfile = await reloadedState.profiles.getProfile("DailyChestFreeUser");
  assertDailyChestMirrorParity(reloadedProfile);

  await assert.rejects(
    () =>
      state.openDailyElementChest({
        username: "DailyChestFreeUser",
        openType: "free",
        nowMs
    }),
    /already been used/i
  );
  const profileAfterRejectedSecondOpen = await state.profiles.getProfile("DailyChestFreeUser");
  assert.deepEqual(
    profileAfterRejectedSecondOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID],
    profileAfterFirstOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]
  );
  assertDailyChestMirrorParity(profileAfterRejectedSecondOpen);

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
  const profileAfterPaidOpen = await state.profiles.getProfile("DailyChestPaidUser");

  assert.equal(opened.openType, "paid");
  assert.equal(opened.profile.tokens, 50);
  assert.equal(opened.dailyElementChest.paidOpens, 1);
  assert.equal(opened.dailyElementChest.totalOpens, 1);
  assert.deepEqual(
    opened.status,
    getDailyElementChestStatusFromEventProjection(opened.profile, {
      nowMs: Date.parse("2026-06-06T23:30:00.000Z")
    })
  );
  assert.deepEqual(
    opened.status,
    getDailyElementChestStatus(opened.profile, Date.parse("2026-06-06T23:30:00.000Z"))
  );
  assertDailyChestMirrorMatches(opened.profile, {
    openType: "paid",
    openedAt: "2026-06-06T23:30:00.000Z"
  });
  assert.deepEqual(
    opened.profile.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID],
    profileAfterPaidOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]
  );
  assertDailyChestMirrorParity(opened.profile);
  assertDailyChestMirrorParity(profileAfterPaidOpen);

  await assert.rejects(
    () =>
      state.openDailyElementChest({
        username: "DailyChestPaidUser",
        openType: "paid",
        nowMs: Date.parse("2026-06-07T00:30:00.000Z")
    }),
    /Insufficient tokens/i
  );
  const profileAfterRejectedPaidOpen = await state.profiles.getProfile("DailyChestPaidUser");
  assert.deepEqual(
    profileAfterRejectedPaidOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID],
    profileAfterPaidOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]
  );
  assertDailyChestMirrorParity(profileAfterRejectedPaidOpen);

  await fs.rm(dataDir, { recursive: true, force: true });
});

test("daily chest: post-open status follows updated legacy dailyElementChest over stale eventChests", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0.99, 0])
  });
  const nowMs = Date.parse("2026-06-06T23:30:00.000Z");

  await state.profiles.updateProfile("DailyChestPostOpenLegacyStatusUser", (current) => ({
    ...current,
    tokens: 500,
    dailyElementChest: {
      lastFreeOpenDateKey: null,
      totalOpens: 2,
      paidOpens: 1,
      freeOpens: 1,
      pity: {
        opensSinceEpicPlus: 2,
        opensSinceLegendary: 2
      }
    },
    eventChests: {
      [DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]: eventChestProgressFromDailyElementChest(
        {
          lastFreeOpenDateKey: "2026-06-05T23:00:00.000Z",
          totalOpens: 99,
          paidOpens: 88,
          freeOpens: 11,
          pity: {
            opensSinceEpicPlus: 9,
            opensSinceLegendary: 29
          }
        },
        DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
        {
          openedAt: "2026-06-05T23:30:00.000Z",
          lastOpenType: "paid"
        }
      )
    }
  }));

  const opened = await state.openDailyElementChest({
    username: "DailyChestPostOpenLegacyStatusUser",
    openType: "paid",
    nowMs
  });

  assert.equal(opened.dailyElementChest.totalOpens, 3);
  assert.equal(opened.dailyElementChest.paidOpens, 2);
  assert.equal(opened.dailyElementChest.freeOpens, 1);
  assert.deepEqual(opened.status.dailyElementChest, opened.dailyElementChest);
  assert.deepEqual(opened.status, getDailyElementChestStatus(opened.profile, nowMs));
  assertDailyChestMirrorParity(opened.profile);

  await fs.rm(dataDir, { recursive: true, force: true });
});

test("daily chest: invalid open type does not mutate the event chest mirror", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({
    dataDir,
    random: randomSequence([0, 0])
  });
  const nowMs = Date.parse("2026-06-06T23:30:00.000Z");

  await state.openDailyElementChest({
    username: "DailyChestInvalidTypeUser",
    openType: "free",
    nowMs
  });
  const profileAfterOpen = await state.profiles.getProfile("DailyChestInvalidTypeUser");

  await assert.rejects(
    () =>
      state.openDailyElementChest({
        username: "DailyChestInvalidTypeUser",
        openType: "bonus",
        nowMs: Date.parse("2026-06-07T23:30:00.000Z")
      }),
    /openType/i
  );

  const profileAfterRejectedOpen = await state.profiles.getProfile("DailyChestInvalidTypeUser");
  assert.deepEqual(
    profileAfterRejectedOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID],
    profileAfterOpen.eventChests[DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]
  );
  assert.deepEqual(profileAfterRejectedOpen.dailyElementChest, profileAfterOpen.dailyElementChest);
  assertDailyChestMirrorParity(profileAfterRejectedOpen);

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

test("daily chest: StateCoordinator status uses the Event Chest adapter without shape drift", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const nowMs = Date.parse("2026-06-06T23:30:00.000Z");

  try {
    await state.profiles.updateProfile("DailyChestStatusAdapterUser", (current) => ({
      ...current,
      tokens: 345,
      ownedCosmetics: {
        ...(current?.ownedCosmetics ?? {}),
        avatar: ["default_avatar", "avatar_chestbound_adept"],
        background: ["default_background"],
        cardBack: ["default_card_back", "cardback_daily_element_chest"],
        elementCardVariant: [
          "default_fire_card",
          "default_water_card",
          "default_earth_card",
          "default_wind_card"
        ],
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
    }));

    const profile = await state.profiles.getProfile("DailyChestStatusAdapterUser");
    assert.deepEqual(
      await state.getDailyElementChestStatus("DailyChestStatusAdapterUser", nowMs),
      getDailyElementChestStatus(profile, nowMs)
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("daily chest: StateCoordinator status remains based on legacy dailyElementChest, not eventChests mirror", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const nowMs = Date.parse("2026-06-06T23:30:00.000Z");
  const legacyDailyElementChest = {
    lastFreeOpenDateKey: null,
    totalOpens: 2,
    paidOpens: 1,
    freeOpens: 1,
    pity: {
      opensSinceEpicPlus: 2,
      opensSinceLegendary: 2
    }
  };

  try {
    await state.profiles.updateProfile("DailyChestLegacyAuthorityUser", (current) => ({
      ...current,
      tokens: 400,
      dailyElementChest: legacyDailyElementChest,
      eventChests: {
        [DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID]: eventChestProgressFromDailyElementChest(
          {
            lastFreeOpenDateKey: "2026-06-05T23:00:00.000Z",
            totalOpens: 99,
            paidOpens: 88,
            freeOpens: 11,
            pity: {
              opensSinceEpicPlus: 9,
              opensSinceLegendary: 29
            }
          },
          DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID,
          {
            openedAt: "2026-06-05T23:30:00.000Z",
            lastOpenType: "paid"
          }
        )
      }
    }));

    const status = await state.getDailyElementChestStatus("DailyChestLegacyAuthorityUser", nowMs);

    assert.deepEqual(
      status.dailyElementChest,
      normalizeProfileDailyElementChest({ dailyElementChest: legacyDailyElementChest }).dailyElementChest
    );
    assert.equal(status.dailyElementChest.totalOpens, 2);
    assert.equal(status.pity.opensSinceEpicPlus, 2);
    assert.equal(status.pity.opensSinceLegendary, 2);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("daily chest: registry copy mutation cannot affect StateCoordinator status output", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const nowMs = Date.parse("2026-06-06T23:30:00.000Z");

  try {
    await state.profiles.updateProfile("DailyChestRegistryMutationUser", (current) => ({
      ...current,
      tokens: 400
    }));
    const baseline = await state.getDailyElementChestStatus("DailyChestRegistryMutationUser", nowMs);

    const registryCopy = getEventChestDefinitionById(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
    registryCopy.paidTokenCost = 999;
    registryCopy.odds.common = 0;
    registryCopy.pool.common[0].cosmeticId = "mutated_cosmetic";

    assert.deepEqual(
      await state.getDailyElementChestStatus("DailyChestRegistryMutationUser", nowMs),
      baseline
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
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
    epicPlusEnabled: true,
    legendaryEnabled: true,
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

test("event chest definitions: opening methods and paid cost are bounded", () => {
  const entitlementOnly = {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    openTypes: ["entitlement"],
    freeOpenPolicy: null,
    paidTokenCost: 0
  };
  assert.equal(validateEventChestDefinition(entitlementOnly).ok, true);
  assert.equal(
    validateEventChestDefinition({
      ...entitlementOnly,
      openTypes: ["paid"],
      paidTokenCost: 125
    }).ok,
    true
  );

  for (const paidTokenCost of [0, -1, 1.5, EVENT_CHEST_MAX_PAID_TOKEN_COST + 1]) {
    const result = validateEventChestDefinition({
      ...entitlementOnly,
      openTypes: ["paid"],
      paidTokenCost
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("paidTokenCost")));
  }

  for (const openTypes of [[], ["paid", "paid"], ["unsupported"]]) {
    assert.equal(
      validateEventChestDefinition({
        ...entitlementOnly,
        openTypes,
        paidTokenCost: openTypes.includes("paid") ? 100 : 0
      }).ok,
      false
    );
  }
  assert.deepEqual(
    normalizeEventChestOpeningRules({
      ...entitlementOnly,
      openTypes: ["paid", "entitlement", "free"]
    }).openTypes,
    ["entitlement", "free", "paid"]
  );
});

test("event chest definitions: free opening policy is strict and timezone-aware", () => {
  const base = {
    ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET),
    openTypes: ["free"],
    paidTokenCost: 0
  };
  assert.equal(validateEventChestDefinition(base).ok, true);
  for (const freeOpenPolicy of [
    null,
    { cadence: "weekly", resetTimeZone: "America/Chicago", resetHour: 18 },
    { cadence: "daily", resetTimeZone: "Not/A_Zone", resetHour: 18 },
    { cadence: "daily", resetTimeZone: "America/Chicago", resetHour: 24 },
    {
      cadence: "daily",
      resetTimeZone: "America/Chicago",
      resetHour: 18,
      claimsPerWindow: 2
    }
  ]) {
    const result = validateEventChestDefinition({
      ...base,
      freeOpenPolicy
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("freeOpenPolicy")));
  }
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

test("event chest definitions: validator rejects catalog rarity bucket mismatch", () => {
  const definition = cloneEventChestPreset({
    pool: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      common: [{ type: "avatar", cosmeticId: "avatar_chestbound_adept" }]
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /rarity bucket does not match catalog rarity 'rare'/i);
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

test("event chest definitions: validator rejects unsafe normal Event Chest reward cosmetics", () => {
  const definition = cloneEventChestPreset({
    pool: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      common: [{ type: "avatar", cosmeticId: "default_avatar" }],
      legendary: [{ type: "avatar", cosmeticId: "avatar_lycan_anubis" }]
    }
  });
  const validation = validateEventChestDefinition(definition);
  const errors = validation.errors.join("\n");

  assert.equal(validation.ok, false);
  assert.match(errors, /default_owned/i);
  assert.match(errors, /unique_rarity|unsupported_rarity/i);
  assert.match(errors, /grant_only/i);
  assert.match(errors, /store_hidden_not_chest_eligible/i);
});

test("event chest definitions: validator rejects private fields directly", () => {
  const definition = cloneEventChestPreset({
    pool: {
      ...structuredClone(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET.pool),
      common: [
        {
          type: "title",
          cosmeticId: "title_first_light",
          ownedCosmetics: { title: ["title_first_light"] }
        }
      ]
    }
  });
  const validation = validateEventChestDefinition(definition);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /private player\/profile field 'pool\.common\[0\]\.ownedCosmetics'/i);
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
  assert.equal(hasEventChestDefinition(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID), true);
  assert.equal(hasEventChestDefinition("missing_event_chest"), false);
  assert.equal(hasEventChestDefinition(""), false);
  assert.equal(hasEventChestDefinition(null), false);
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

function buildEventChestRegistryDocument(definitions = [DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET], overrides = {}) {
  return {
    schemaVersion: EVENT_CHEST_REGISTRY_DOCUMENT_VERSION,
    registryId: "test_event_chest_registry",
    registryRevisionId: "test_registry_revision_1",
    publishedAt: "2026-07-26T12:00:00.000Z",
    publishedBy: "test-admin",
    definitions: structuredClone(definitions),
    ...overrides
  };
}

async function writeEventChestRegistryFixture(dataDir, payload) {
  const filePath = path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

test("event chest registry store: missing file returns static Daily EleMintz Chest fallback without writing", async () => {
  const dataDir = await createTempDataDir();
  const store = new EventChestRegistryStore({
    dataDir,
    now: () => "2026-07-26T12:00:00.000Z",
    logger: { warn: () => {} }
  });

  try {
    const result = await store.getPublishedEventChestRegistry();

    assert.equal(result.ok, true);
    assert.equal(result.source, "fallback_static");
    assert.equal(result.registry.registryRevisionId, "static_daily_elemintz_chest_default");
    assert.equal(result.definitions.length, 1);
    assert.equal(result.definitions[0].chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
    await assert.rejects(
      fs.access(path.join(dataDir, "server-data", EVENT_CHEST_REGISTRY_FILENAME)),
      /ENOENT/
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry store: valid file loads and returns defensive copies", async () => {
  const dataDir = await createTempDataDir();
  const document = buildEventChestRegistryDocument();
  await writeEventChestRegistryFixture(dataDir, document);
  const store = new EventChestRegistryStore({
    dataDir,
    now: () => "2026-07-26T12:05:00.000Z",
    logger: { warn: () => {} }
  });

  try {
    const result = await store.getPublishedEventChestRegistry();
    assert.equal(result.ok, true);
    assert.equal(result.source, "file");
    assert.equal(result.readAt, "2026-07-26T12:05:00.000Z");
    assert.equal(result.registry.registryId, "test_event_chest_registry");
    assert.equal(result.definitions[0].chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);

    result.definitions[0].title = "Mutated";
    const lookup = await store.getEventChestDefinitionById(DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
    assert.equal(lookup.title, "Daily EleMintz Chest");
    assert.equal(await store.getEventChestDefinitionById("missing_chest"), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry store: malformed JSON falls back with an admin-safe error", async () => {
  const dataDir = await createTempDataDir();
  await writeEventChestRegistryFixture(dataDir, "{ nope");
  const store = new EventChestRegistryStore({
    dataDir,
    now: () => "2026-07-26T12:10:00.000Z",
    logger: { warn: () => {} }
  });

  try {
    const result = await store.getPublishedEventChestRegistry();
    assert.equal(result.ok, false);
    assert.equal(result.source, "fallback_static");
    assert.equal(result.definitions[0].chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
    assert.match(result.errors.join("\n"), /Unable to read event chest registry/i);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("event chest registry store: invalid definition and duplicate chestId do not become authoritative", async () => {
  const invalidDataDir = await createTempDataDir();
  const duplicateDataDir = await createTempDataDir();

  try {
    await writeEventChestRegistryFixture(
      invalidDataDir,
      buildEventChestRegistryDocument([
        cloneEventChestPreset({
          chestId: "invalid_loaded_chest",
          odds: {
            common: 1,
            rare: 1,
            epic: 1,
            legendary: 1
          }
        })
      ])
    );
    const invalidStore = new EventChestRegistryStore({
      dataDir: invalidDataDir,
      logger: { warn: () => {} }
    });
    const invalidResult = await invalidStore.getPublishedEventChestRegistry();
    assert.equal(invalidResult.ok, false);
    assert.equal(invalidResult.source, "fallback_static");
    assert.equal(invalidResult.definitions.some((definition) => definition.chestId === "invalid_loaded_chest"), false);
    assert.match(invalidResult.errors.join("\n"), /odds must sum to 1/i);

    await writeEventChestRegistryFixture(
      duplicateDataDir,
      buildEventChestRegistryDocument([
        DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
        cloneEventChestPreset({ title: "Duplicate Daily Chest" })
      ])
    );
    const duplicateStore = new EventChestRegistryStore({
      dataDir: duplicateDataDir,
      logger: { warn: () => {} }
    });
    const duplicateResult = await duplicateStore.getPublishedEventChestRegistry();
    assert.equal(duplicateResult.ok, false);
    assert.equal(duplicateResult.source, "fallback_static");
    assert.match(duplicateResult.errors.join("\n"), /duplicate chestId/i);
    assert.equal(duplicateResult.definitions.length, 1);
    assert.equal(duplicateResult.definitions[0].title, "Daily EleMintz Chest");
  } finally {
    await fs.rm(invalidDataDir, { recursive: true, force: true });
    await fs.rm(duplicateDataDir, { recursive: true, force: true });
  }
});

test("event chest status: Daily EleMintz Chest projects empty profile pool progress", () => {
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, buildDailyChestCompletionProfile());

  assert.equal(status.chestId, DEFAULT_DAILY_ELEMENT_CHEST_POOL_ID);
  assert.equal(status.totalPoolCount, 12);
  assert.equal(status.ownedCount, 0);
  assert.equal(status.missingCount, 12);
  assert.equal(status.isPoolComplete, false);
  assert.equal(status.shouldHideTile, false);
  assert.equal(status.hideTileWhenPoolComplete, true);
  assert.equal(status.allowOpensAfterCompleteAsDuplicateConversion, true);
  assert.equal(status.missingEntries.length, 12);
  assert.equal(status.ownedEntries.length, 0);
});

test("event chest status: Daily EleMintz Chest projects full pool completion", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile());
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, profile);

  assert.equal(status.totalPoolCount, 12);
  assert.equal(status.ownedCount, 12);
  assert.equal(status.missingCount, 0);
  assert.equal(status.isPoolComplete, true);
  assert.equal(status.shouldHideTile, true);
  assert.equal(status.missingEntries.length, 0);
  assert.equal(status.ownedEntries.length, 12);
});

test("event chest status: unrelated owned cosmetics do not count toward pool progress", () => {
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, {
    username: "EventChestUnrelatedUser",
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_fire_mage"],
      background: ["default_background", "forest_glade_background"],
      cardBack: ["default_card_back", "fire_card_back"],
      elementCardVariant: ["default_fire_card", "fire_variant_ember"],
      badge: ["none", "war_machine"],
      title: ["Initiate", "Flame Vanguard"]
    }
  });

  assert.equal(status.ownedCount, 0);
  assert.equal(status.missingCount, 12);
  assert.equal(status.isPoolComplete, false);
});

test("event chest status: per-rarity progress is computed from the definition pool", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile(), [
    ["title", "title_first_light"],
    ["avatar", "avatar_chestbound_adept"],
    ["cardBack", "cardback_daily_element_chest"],
    ["avatar", "avatar_element_chosen"]
  ]);
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, profile);

  assert.deepEqual(status.byRarity.common, { total: 3, owned: 1, missing: 2, isComplete: false });
  assert.deepEqual(status.byRarity.rare, { total: 2, owned: 1, missing: 1, isComplete: false });
  assert.deepEqual(status.byRarity.epic, { total: 5, owned: 1, missing: 4, isComplete: false });
  assert.deepEqual(status.byRarity.legendary, { total: 2, owned: 1, missing: 1, isComplete: false });
});

test("event chest status: hide tile flag only hides complete pools when enabled", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile());
  const hiddenStatus = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, profile);
  const visibleDefinition = cloneEventChestPreset({ hideTileWhenPoolComplete: false });
  const visibleStatus = projectEventChestStatus(visibleDefinition, profile);

  assert.equal(hiddenStatus.isPoolComplete, true);
  assert.equal(hiddenStatus.shouldHideTile, true);
  assert.equal(visibleStatus.isPoolComplete, true);
  assert.equal(visibleStatus.shouldHideTile, false);
  assert.equal(visibleStatus.hideTileWhenPoolComplete, false);
});

test("event chest status: existing Daily Chest progress and pity display project without mutation", () => {
  const profile = buildDailyChestCompletionProfile({
    dailyElementChest: {
      lastFreeOpenDateKey: "2026-06-06T23:00:00.000Z",
      totalOpens: 17,
      paidOpens: 12,
      freeOpens: 5,
      pity: {
        opensSinceEpicPlus: 7,
        opensSinceLegendary: 14
      }
    }
  });
  const before = structuredClone(profile);
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, profile);

  assert.deepEqual(status.progress, {
    lastFreeOpenDateKey: "2026-06-06T23:00:00.000Z",
    totalOpens: 17,
    paidOpens: 12,
    freeOpens: 5,
    pity: {
      opensSinceEpicPlus: 7,
      opensSinceLegendary: 14
    }
  });
  assert.deepEqual(status.pityDisplay, {
    epicPlus: {
      current: 7,
      threshold: 10,
      displayCurrent: 7,
      displayLabel: "7 / 10"
    },
    legendary: {
      current: 14,
      threshold: 30,
      displayCurrent: 14,
      displayLabel: "14 / 30"
    }
  });
  assert.deepEqual(profile, before);
});

test("event chest status: pity display values are capped at current Daily Chest thresholds", () => {
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, {
    dailyElementChest: {
      totalOpens: 200,
      paidOpens: 100,
      freeOpens: 100,
      pity: {
        opensSinceEpicPlus: 99,
        opensSinceLegendary: 99
      }
    }
  });

  assert.equal(status.pityDisplay.epicPlus.current, 99);
  assert.equal(status.pityDisplay.epicPlus.threshold, 10);
  assert.equal(status.pityDisplay.epicPlus.displayCurrent, 10);
  assert.equal(status.pityDisplay.epicPlus.displayLabel, "10 / 10");
  assert.equal(status.pityDisplay.legendary.current, 99);
  assert.equal(status.pityDisplay.legendary.threshold, 30);
  assert.equal(status.pityDisplay.legendary.displayCurrent, 30);
  assert.equal(status.pityDisplay.legendary.displayLabel, "30 / 30");
});

test("event chest status: malformed profile progress normalizes safely for projection", () => {
  const status = projectEventChestStatus(DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET, {
    dailyElementChest: {
      lastFreeOpenDateKey: "   ",
      totalOpens: "not-a-number",
      paidOpens: -5,
      freeOpens: 2.9,
      pity: {
        opensSinceEpicPlus: "bad",
        opensSinceLegendary: 4.7
      }
    }
  });

  assert.deepEqual(status.progress, {
    lastFreeOpenDateKey: null,
    totalOpens: 0,
    paidOpens: 0,
    freeOpens: 2,
    pity: {
      opensSinceEpicPlus: 0,
      opensSinceLegendary: 4
    }
  });
});

test("event chest status: projection output mutations do not alter inputs", () => {
  const definition = cloneEventChestPreset();
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile(), [["title", "title_first_light"]]);
  const beforeDefinition = structuredClone(definition);
  const beforeProfile = structuredClone(profile);
  const status = projectEventChestStatus(definition, profile);

  status.byRarity.common.owned = 99;
  status.ownedEntries[0].cosmeticId = "mutated_cosmetic";
  status.progress.totalOpens = 99;

  assert.deepEqual(definition, beforeDefinition);
  assert.deepEqual(profile, beforeProfile);
  assert.equal(definition.pool.common[0].cosmeticId, "title_first_light");
  assert.equal(profile.ownedCosmetics.title.includes("title_first_light"), true);
});

test("event chest parity: empty/default profile matches current Daily Chest status overlap", () => {
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(
    buildDailyChestCompletionProfile()
  );

  assert.equal(currentStatus.collectionProgress.totalOwned, 0);
  assert.equal(projection.ownedCount, 0);
  assert.equal(projection.missingCount, 12);
  assert.equal(projection.isPoolComplete, false);
  assert.equal(projection.freeOpenAvailable, true);
  assert.equal(projection.canAffordPaidOpen, true);
});

test("event chest parity: partial ownership profile matches current Daily Chest status overlap", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile(), [
    ["title", "title_first_light"],
    ["badge", "badge_daily_emblem"],
    ["avatar", "avatar_chestbound_adept"],
    ["cardBack", "cardback_daily_element_chest"]
  ]);
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(profile);

  assert.equal(currentStatus.collectionProgress.totalOwned, 4);
  assert.equal(projection.ownedCount, 4);
  assert.equal(projection.byRarity.common.owned, 2);
  assert.equal(projection.byRarity.rare.owned, 1);
  assert.equal(projection.byRarity.epic.owned, 1);
  assert.equal(projection.byRarity.legendary.owned, 0);
});

test("event chest parity: full pool ownership and hide-tile condition match current Daily Chest status", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile());
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(profile);

  assert.equal(currentStatus.collectionProgress.isComplete, true);
  assert.equal(projection.isPoolComplete, true);
  assert.equal(projection.shouldHideTile, true);
  assert.equal(projection.missingEntries.length, 0);
});

test("event chest parity: pity progress and paid/free open counts match current Daily Chest status", () => {
  const profile = buildDailyChestCompletionProfile({
    dailyElementChest: {
      lastFreeOpenDateKey: "2026-06-05",
      totalOpens: 19,
      paidOpens: 13,
      freeOpens: 6,
      pity: {
        opensSinceEpicPlus: 8,
        opensSinceLegendary: 21
      }
    }
  });
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(profile);

  assert.equal(currentStatus.dailyElementChest.totalOpens, 19);
  assert.equal(projection.progress.totalOpens, 19);
  assert.equal(projection.progress.paidOpens, 13);
  assert.equal(projection.progress.freeOpens, 6);
  assert.equal(projection.pityDisplay.epicPlus.displayLabel, "8 / 10");
  assert.equal(projection.pityDisplay.legendary.displayLabel, "21 / 30");
});

test("event chest parity: capped pity display matches current Daily Chest threshold expectations", () => {
  const profile = buildDailyChestCompletionProfile({
    dailyElementChest: {
      totalOpens: 120,
      paidOpens: 80,
      freeOpens: 40,
      pity: {
        opensSinceEpicPlus: 22,
        opensSinceLegendary: 44
      }
    }
  });
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(profile);

  assert.equal(currentStatus.pity.opensSinceEpicPlus, 22);
  assert.equal(currentStatus.pity.opensSinceLegendary, 44);
  assert.equal(projection.pityDisplay.epicPlus.current, 22);
  assert.equal(projection.pityDisplay.epicPlus.displayCurrent, 10);
  assert.equal(projection.pityDisplay.legendary.current, 44);
  assert.equal(projection.pityDisplay.legendary.displayCurrent, 30);
});

test("event chest parity: unrelated cosmetics are ignored by both status models", () => {
  const profile = buildDailyChestCompletionProfile({
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_fire_mage"],
      background: ["default_background", "forest_glade_background"],
      cardBack: ["default_card_back", "fire_card_back"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none", "war_machine"],
      title: ["Initiate", "Flame Vanguard"]
    }
  });
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(profile);

  assert.equal(currentStatus.collectionProgress.totalOwned, 0);
  assert.equal(projection.ownedCount, 0);
  assert.equal(projection.missingCount, 12);
});

test("event chest full status: used free open projects unavailable until the next reset", () => {
  const initialProjection = projectEventChestStatus(
    DAILY_ELEMINTZ_CHEST_DEFAULT_PRESET,
    buildDailyChestCompletionProfile(),
    { nowMs: DAILY_CHEST_STATUS_PARITY_NOW }
  );
  const profile = buildDailyChestCompletionProfile({
    dailyElementChest: {
      lastFreeOpenDateKey: initialProjection.currentDateKey,
      totalOpens: 1,
      paidOpens: 0,
      freeOpens: 1,
      pity: {
        opensSinceEpicPlus: 1,
        opensSinceLegendary: 1
      }
    }
  });
  const { currentStatus, projection } = compareDailyElementChestStatusProjection(profile);

  assert.equal(currentStatus.canOpenFree, false);
  assert.equal(projection.freeOpenAvailable, false);
  assert.equal(projection.openAvailability.free.available, false);
  assert.equal(projection.openAvailability.free.nextAvailableAt, currentStatus.nextFreeResetAt);
});

test("event chest full status: token affordability is projected from the profile balance", () => {
  const affordable = compareDailyElementChestStatusProjection(
    buildDailyChestCompletionProfile({ tokens: 100 })
  ).projection;
  const unaffordable = compareDailyElementChestStatusProjection(
    buildDailyChestCompletionProfile({ tokens: 99 })
  ).projection;

  assert.equal(affordable.paidOpenCostTokens, 100);
  assert.equal(affordable.tokenBalance, 100);
  assert.equal(affordable.canAffordPaidOpen, true);
  assert.equal(affordable.openAvailability.paid.available, true);
  assert.equal(unaffordable.paidOpenCostTokens, 100);
  assert.equal(unaffordable.tokenBalance, 99);
  assert.equal(unaffordable.canAffordPaidOpen, false);
  assert.equal(unaffordable.openAvailability.paid.available, false);
});

test("event chest full status: projection adds Daily Chest reset and UI status fields without mutating inputs", () => {
  const profile = buildDailyChestCompletionProfile({
    tokens: 125,
    dailyElementChest: {
      lastFreeOpenDateKey: null,
      totalOpens: 6,
      paidOpens: 4,
      freeOpens: 2,
      pity: {
        opensSinceEpicPlus: 3,
        opensSinceLegendary: 6
      }
    }
  });
  const definition = cloneEventChestPreset();
  const beforeProfile = structuredClone(profile);
  const beforeDefinition = structuredClone(definition);
  const projection = projectEventChestStatus(definition, profile, { nowMs: DAILY_CHEST_STATUS_PARITY_NOW });

  assert.equal(projection.currentDateKey, projection.resetWindow.lastResetAt);
  assert.equal(projection.nextFreeOpenAt, projection.resetWindow.nextResetAt);
  assert.equal(projection.nextFreeResetAt, projection.resetWindow.nextResetAt);
  assert.equal(projection.msUntilNextFreeOpen, Date.parse(projection.nextFreeOpenAt) - DAILY_CHEST_STATUS_PARITY_NOW);
  assert.deepEqual(projection.odds, DAILY_ELEMENT_CHEST_ODDS);
  assert.deepEqual(projection.poolSummary, buildDailyChestPoolSummaryExpectation());
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(definition, beforeDefinition);
});

function assertDailyStatusAdapterMatchesCurrent(profile, nowMs = DAILY_CHEST_STATUS_PARITY_NOW) {
  assert.deepEqual(
    getDailyElementChestStatusFromEventProjection(profile, { nowMs }),
    getDailyElementChestStatus(profile, nowMs)
  );
}

test("event chest Daily status adapter: empty/default profile matches current status shape", () => {
  assertDailyStatusAdapterMatchesCurrent(buildDailyChestCompletionProfile());
});

test("event chest Daily status adapter: used free open matches current status shape", () => {
  const usedFreeStatus = getDailyElementChestStatusFromEventProjection(buildDailyChestCompletionProfile(), {
    nowMs: DAILY_CHEST_STATUS_PARITY_NOW
  });
  const profile = buildDailyChestCompletionProfile({
    dailyElementChest: {
      lastFreeOpenDateKey: new Date(Date.parse(usedFreeStatus.nextFreeResetAt) - 24 * 60 * 60 * 1000).toISOString(),
      totalOpens: 1,
      paidOpens: 0,
      freeOpens: 1,
      pity: {
        opensSinceEpicPlus: 1,
        opensSinceLegendary: 1
      }
    }
  });

  assertDailyStatusAdapterMatchesCurrent(profile);
  assert.equal(getDailyElementChestStatusFromEventProjection(profile, { nowMs: DAILY_CHEST_STATUS_PARITY_NOW }).canOpenFree, false);
});

test("event chest Daily status adapter: paid-open affordability matches current status shape", () => {
  assertDailyStatusAdapterMatchesCurrent(buildDailyChestCompletionProfile({ tokens: 100 }));
  assertDailyStatusAdapterMatchesCurrent(buildDailyChestCompletionProfile({ tokens: 99 }));
});

test("event chest Daily status adapter: partial ownership matches current status shape", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile(), [
    ["title", "title_first_light"],
    ["badge", "badge_daily_emblem"],
    ["avatar", "avatar_chestbound_adept"],
    ["cardBack", "cardback_daily_element_chest"]
  ]);

  assertDailyStatusAdapterMatchesCurrent(profile);
});

test("event chest Daily status adapter: full ownership matches current completed status shape", () => {
  assertDailyStatusAdapterMatchesCurrent(addDailyChestPoolOwnership(buildDailyChestCompletionProfile()));
});

test("event chest Daily status adapter: existing and capped pity progress match current status shape", () => {
  assertDailyStatusAdapterMatchesCurrent(buildDailyChestCompletionProfile({
    dailyElementChest: {
      lastFreeOpenDateKey: null,
      totalOpens: 19,
      paidOpens: 13,
      freeOpens: 6,
      pity: {
        opensSinceEpicPlus: 8,
        opensSinceLegendary: 21
      }
    }
  }));
  assertDailyStatusAdapterMatchesCurrent(buildDailyChestCompletionProfile({
    dailyElementChest: {
      lastFreeOpenDateKey: null,
      totalOpens: 120,
      paidOpens: 80,
      freeOpens: 40,
      pity: {
        opensSinceEpicPlus: 22,
        opensSinceLegendary: 44
      }
    }
  }));
});

test("event chest Daily status adapter: unrelated cosmetics are ignored like current status", () => {
  assertDailyStatusAdapterMatchesCurrent(buildDailyChestCompletionProfile({
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_fire_mage"],
      background: ["default_background", "forest_glade_background"],
      cardBack: ["default_card_back", "fire_card_back"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none", "war_machine"],
      title: ["Initiate", "Flame Vanguard"]
    }
  }));
});

test("event chest Daily status adapter: returned object mutation does not mutate profile or future calls", () => {
  const profile = addDailyChestPoolOwnership(buildDailyChestCompletionProfile(), [
    ["title", "title_first_light"]
  ]);
  const beforeProfile = structuredClone(profile);
  const first = getDailyElementChestStatusFromEventProjection(profile, { nowMs: DAILY_CHEST_STATUS_PARITY_NOW });
  first.dailyElementChest.pity.opensSinceEpicPlus = 99;
  first.pity.opensSinceLegendary = 99;
  first.odds.common = 0;
  first.poolSummary.common[0].cosmeticId = "mutated";
  first.collectionProgress.items.common[0].owned = false;

  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(
    getDailyElementChestStatusFromEventProjection(profile, { nowMs: DAILY_CHEST_STATUS_PARITY_NOW }),
    getDailyElementChestStatus(profile, DAILY_CHEST_STATUS_PARITY_NOW)
  );
});
