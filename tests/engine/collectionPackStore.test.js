import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  calculateCollectionPackPriceForOwnedCosmetics,
  CollectionPackStore,
  DEFAULT_COLLECTION_PACK_DISCOUNT_PERCENT,
  listEligibleCollectionPackCosmetics,
  resolveCollectionPackCosmetic,
  validateCollectionPackDraft
} from "../../src/state/collectionPackStore.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-collection-packs-"));
}

function basePack(overrides = {}) {
  return {
    packId: "classic_avatar_pack",
    name: "Classic Avatar Pack",
    description: "A normal cosmetic collection pack fixture.",
    cosmeticIds: ["fireavatarF", "wateravatarF"],
    active: false,
    visible: false,
    saleLimitMode: "unlimited",
    ...overrides
  };
}

function priceOf(cosmeticId) {
  return resolveCollectionPackCosmetic(cosmeticId)?.item?.price ?? 0;
}

function activePack(overrides = {}) {
  return basePack({
    active: true,
    visible: true,
    ...overrides
  });
}

async function createCoordinator(t, { now = "2026-06-23T12:00:00.000Z" } = {}) {
  const dataDir = await createTempDataDir();
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return new StateCoordinator({
    dataDir,
    now: () => now
  });
}

async function seedProfile(state, username, patch = {}) {
  return state.profiles.updateProfile(username, (current) => ({
    ...current,
    ...patch,
    ownedCosmetics: {
      ...current.ownedCosmetics,
      ...(patch.ownedCosmetics ?? {})
    }
  }));
}

test("collection packs: valid normal pack definition passes with default discount", () => {
  const normalized = validateCollectionPackDraft(basePack());

  assert.equal(normalized.packId, "classic_avatar_pack");
  assert.equal(normalized.discountPercent, DEFAULT_COLLECTION_PACK_DISCOUNT_PERCENT);
  assert.equal(normalized.saleLimitMode, "unlimited");
  assert.equal(normalized.saleLimitTotal, null);
  assert.equal(normalized.soldCount, 0);
  assert.deepEqual(normalized.cosmeticIds, ["fireavatarF", "wateravatarF"]);
});

test("collection packs: eligible cosmetic picker model includes only normal purchasable Store cosmetics", () => {
  const cosmetics = listEligibleCollectionPackCosmetics({
    catalog: {
      avatar: [
        { id: "valid_avatar", name: "Valid Avatar", rarity: "Common", purchasable: true, price: 100, collection: "Vampire Elegance" },
        { id: "unique_avatar", name: "Unique Avatar", rarity: "Unique", purchasable: true, price: 100 },
        { id: "hidden_avatar", name: "Hidden Avatar", rarity: "Common", hidden: true, purchasable: true, price: 100 },
        { id: "store_hidden_avatar", name: "Store Hidden Avatar", rarity: "Common", storeHidden: true, purchasable: true, price: 100 },
        { id: "rotation_avatar", name: "Rotation Avatar", rarity: "Common", rotationOnly: true, purchasable: true, price: 100 },
        { id: "grant_avatar", name: "Grant Avatar", rarity: "Common", grantOnly: true, purchasable: true, price: 100 },
        { id: "chest_avatar", name: "Chest Avatar", rarity: "Common", chestOnly: true, purchasable: true, price: 100 },
        { id: "supporter_avatar", name: "Supporter Avatar", rarity: "Common", supporterOnly: true, purchasable: true, price: 100 },
        { id: "not_purchasable_avatar", name: "Not Purchasable Avatar", rarity: "Common", purchasable: false, price: 100 },
        { id: "zero_price_avatar", name: "Zero Price Avatar", rarity: "Common", purchasable: true, price: 0 },
        { id: "decimal_price_avatar", name: "Decimal Price Avatar", rarity: "Common", purchasable: true, price: 100.5 }
      ]
    }
  });

  assert.deepEqual(cosmetics, [{
    type: "avatar",
    id: "valid_avatar",
    name: "Valid Avatar",
    rarity: "Common",
    price: 100,
    purchasable: true,
    collectionName: "Vampire Elegance"
  }]);

  const collectionless = listEligibleCollectionPackCosmetics({
    catalog: {
      avatar: [
        { id: "valid_avatar", name: "Valid Avatar", rarity: "Common", purchasable: true, price: 100 }
      ]
    }
  });
  assert.equal(collectionless[0].collectionName, null);
});

test("collection packs: eligible picker derives collection names from the catalog key map when item.collection is absent", () => {
  const cosmetics = listEligibleCollectionPackCosmetics({
    catalog: {
      avatar: [
        {
          id: "avatar_frostveil_heir",
          name: "Heir",
          rarity: "Legendary",
          purchasable: true,
          price: 1200
        },
        {
          id: "avatar_vampire_female",
          name: "Duchess",
          rarity: "Legendary",
          purchasable: true,
          price: 1200
        }
      ],
      background: [
        {
          id: "background_bg_lycan_law",
          name: "Pack Law",
          rarity: "Epic",
          purchasable: true,
          price: 900
        }
      ]
    }
  });

  assert.equal(cosmetics.find((entry) => entry.id === "avatar_frostveil_heir")?.collectionName, "Frostveil Court");
  assert.equal(cosmetics.find((entry) => entry.id === "avatar_vampire_female")?.collectionName, "Vampire Elegance");
  assert.equal(cosmetics.find((entry) => entry.id === "background_bg_lycan_law")?.collectionName, "Lycan Power");
});

test("collection packs: discount boundaries are enforced", () => {
  assert.equal(validateCollectionPackDraft(basePack({ discountPercent: 1 })).discountPercent, 1);
  assert.equal(validateCollectionPackDraft(basePack({ discountPercent: 30 })).discountPercent, 30);

  assert.throws(
    () => validateCollectionPackDraft(basePack({ discountPercent: 0 })),
    /discountPercent must be between 1 and 30/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ discountPercent: 31 })),
    /discountPercent must be between 1 and 30/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ discountPercent: 1.5 })),
    /discountPercent must be between 1 and 30/
  );
});

test("collection packs: duplicate IDs, fewer than two items, and unknown IDs fail", () => {
  assert.throws(
    () => validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF", "fireavatarF"] })),
    /cosmeticIds must be unique/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF"] })),
    /at least two eligible cosmetics/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF", "missing_cosmetic"] })),
    /Unknown cosmeticId 'missing_cosmetic'/
  );
});

test("collection packs: Unique cosmetics are excluded", () => {
  assert.throws(
    () => validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF", "avatar_lycan_anubis"] })),
    /cannot include Unique cosmetic 'avatar_lycan_anubis'/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF", "fire_variant_bane_flame"] })),
    /cannot include Unique cosmetic 'fire_variant_bane_flame'/
  );
});

test("collection packs: unsupported normal cosmetic sources are rejected", () => {
  const cases = [
    ["rotation-only", "avatar_inferno_crown_f", /rotation-only/],
    ["hidden", "war_machine_badge", /hidden/],
    ["chest-only", "background_morning_sanctum", /chest-only/],
    ["supporter-only", "supporter_badge", /supporter-only/],
    ["not normally purchasable", "default_avatar", /not normally purchasable/]
  ];

  for (const [label, cosmeticId, expected] of cases) {
    assert.throws(
      () => validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF", cosmeticId] })),
      expected,
      label
    );
  }

  const fireAvatar = resolveCollectionPackCosmetic("fireavatarF").item;
  const waterAvatar = resolveCollectionPackCosmetic("wateravatarF").item;
  assert.throws(
    () =>
      validateCollectionPackDraft(basePack({ cosmeticIds: ["fireavatarF", "wateravatarF"] }), {
        catalog: {
          avatar: [
            fireAvatar,
            {
              ...waterAvatar,
              grantOnly: true
            }
          ]
        }
      }),
    /grant-only/
  );
});

test("collection packs: limited sales and schedule windows validate safely", () => {
  const limited = validateCollectionPackDraft(
    basePack({ saleLimitMode: "limited", saleLimitTotal: 10, soldCount: 4 })
  );
  assert.equal(limited.saleLimitMode, "limited");
  assert.equal(limited.saleLimitTotal, 10);
  assert.equal(limited.soldCount, 4);

  assert.throws(
    () => validateCollectionPackDraft(basePack({ saleLimitMode: "limited" })),
    /saleLimitTotal must be a positive integer/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ saleLimitMode: "limitd" })),
    /saleLimitMode must be "unlimited" or "limited"/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ saleLimitMode: "limited", saleLimitTotal: 3, soldCount: 4 })),
    /soldCount cannot exceed saleLimitTotal/
  );
  assert.throws(
    () => validateCollectionPackDraft(basePack({ soldCount: -1 })),
    /soldCount must be a non-negative integer/
  );
  assert.throws(
    () =>
      validateCollectionPackDraft(
        basePack({
          startsAt: "2026-06-20T12:00:00.000Z",
          endsAt: "2026-06-20T12:00:00.000Z"
        })
      ),
    /startsAt must be before endsAt/
  );
});

test("collection packs: price helper discounts remaining unowned value only and does not mutate input", () => {
  const pack = basePack({ discountPercent: 15 });
  const before = JSON.stringify(pack);
  const fullValue = priceOf("fireavatarF") + priceOf("wateravatarF");

  const noOwnership = calculateCollectionPackPriceForOwnedCosmetics(pack, []);
  assert.deepEqual(noOwnership.remainingCosmeticIds, ["fireavatarF", "wateravatarF"]);
  assert.equal(noOwnership.remainingNormalValue, fullValue);
  assert.equal(noOwnership.savings, Math.floor(fullValue * 0.15));
  assert.equal(noOwnership.finalPrice, fullValue - Math.floor(fullValue * 0.15));
  assert.equal(noOwnership.status, "available");

  const partial = calculateCollectionPackPriceForOwnedCosmetics(pack, ["fireavatarF"]);
  assert.deepEqual(partial.remainingCosmeticIds, ["wateravatarF"]);
  assert.equal(partial.remainingNormalValue, priceOf("wateravatarF"));
  assert.equal(partial.savings, Math.floor(priceOf("wateravatarF") * 0.15));
  assert.equal(partial.finalPrice, priceOf("wateravatarF") - Math.floor(priceOf("wateravatarF") * 0.15));
  assert.equal(partial.status, "available");

  const complete = calculateCollectionPackPriceForOwnedCosmetics(pack, ["fireavatarF", "wateravatarF"]);
  assert.deepEqual(complete.remainingCosmeticIds, []);
  assert.equal(complete.remainingNormalValue, 0);
  assert.equal(complete.savings, 0);
  assert.equal(complete.finalPrice, 0);
  assert.equal(complete.status, "complete");

  assert.equal(JSON.stringify(pack), before);
});

test("collection packs: persistence initializes, lists, fetches, validates, and survives reload", async (t) => {
  const dataDir = await createTempDataDir();
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const store = new CollectionPackStore({
    dataDir,
    now: () => "2026-06-23T12:00:00.000Z"
  });
  assert.deepEqual(await store.listPacks(), []);

  const saved = await store.upsertPack(basePack({ sortPriority: 5 }));
  assert.equal(saved.createdAt, "2026-06-23T12:00:00.000Z");
  assert.equal(saved.updatedAt, "2026-06-23T12:00:00.000Z");
  assert.equal((await store.getPack("classic_avatar_pack")).name, "Classic Avatar Pack");
  assert.equal(store.validateDraft(basePack()).packId, "classic_avatar_pack");
  assert.equal(store.calculateDraftValue(basePack(), ["fireavatarF"]).status, "available");

  const persisted = JSON.parse(
    await fs.readFile(path.join(dataDir, "collection-packs.json"), "utf8")
  );
  assert.equal(persisted.version, 1);
  assert.equal(persisted.packs.length, 1);

  const reloaded = new CollectionPackStore({ dataDir });
  assert.deepEqual(await reloaded.listPacks(), [saved]);
});

test("collection packs: normalized records do not preserve unknown public fields", () => {
  const normalized = validateCollectionPackDraft(
    basePack({
      fixedPrice: 100,
      rarity: "Legendary",
      playerFacingPayload: {
        unsafe: true
      }
    })
  );

  assert.equal("fixedPrice" in normalized, false);
  assert.equal("rarity" in normalized, false);
  assert.equal("playerFacingPayload" in normalized, false);
});

test("collection packs: player deals are sanitized and priced for the current owner", async (t) => {
  const state = await createCoordinator(t);
  await state.collectionPackStore.upsertPack(
    activePack({
      adminNotes: "admin-only note",
      createdAt: "2026-06-20T12:00:00.000Z",
      updatedAt: "2026-06-21T12:00:00.000Z"
    })
  );
  await state.collectionPackStore.upsertPack(
    activePack({ packId: "inactive_pack", active: false })
  );
  await state.collectionPackStore.upsertPack(
    activePack({ packId: "hidden_pack", visible: false })
  );
  await state.collectionPackStore.upsertPack(
    activePack({ packId: "future_pack", startsAt: "2026-06-24T12:00:00.000Z" })
  );
  await state.collectionPackStore.upsertPack(
    activePack({ packId: "expired_pack", endsAt: "2026-06-22T12:00:00.000Z" })
  );
  await state.collectionPackStore.upsertPack(
    activePack({
      packId: "sold_out_pack",
      saleLimitMode: "limited",
      saleLimitTotal: 1,
      soldCount: 1
    })
  );
  await seedProfile(state, "DealsViewer", {
    ownedCosmetics: {
      avatar: ["default_avatar", "fireavatarF"]
    }
  });

  const deals = await state.getCollectionPackDeals("DealsViewer");
  const dealIds = deals.map((deal) => deal.packId);
  const partial = deals.find((deal) => deal.packId === "classic_avatar_pack");
  const soldOut = deals.find((deal) => deal.packId === "sold_out_pack");
  const remainingValue = priceOf("wateravatarF");
  const savings = Math.floor(remainingValue * 0.15);

  assert.deepEqual(dealIds, ["classic_avatar_pack", "sold_out_pack"]);
  assert.equal(partial.status, "available");
  assert.deepEqual(partial.remainingCosmeticIds, ["wateravatarF"]);
  assert.equal(partial.ownedItemCount, 1);
  assert.equal(partial.remainingNormalValue, remainingValue);
  assert.equal(partial.savings, savings);
  assert.equal(partial.finalPrice, remainingValue - savings);
  assert.equal(partial.saleLimitMode, "unlimited");
  assert.equal(partial.saleLimitTotal, null);
  assert.equal(partial.soldCount, null);
  assert.equal("adminNotes" in partial, false);
  assert.equal("createdAt" in partial, false);
  assert.equal("updatedAt" in partial, false);
  assert.equal("sortPriority" in partial, false);
  assert.equal("collectionName" in partial, false);
  assert.equal("startsAt" in partial, false);
  assert.equal("endsAt" in partial, false);
  assert.equal(soldOut.status, "sold_out");
  assert.equal(soldOut.saleLimitMode, "limited");
  assert.equal(soldOut.saleLimitTotal, 1);
  assert.equal(soldOut.soldCount, 1);
  assert.equal(soldOut.remainingPurchases, 0);
});

test("collection packs: coordinator purchase grants all remaining items and deducts discounted price", async (t) => {
  const state = await createCoordinator(t);
  await state.collectionPackStore.upsertPack(activePack());
  await seedProfile(state, "PackBuyer", { tokens: 1000 });

  const result = await state.completeCollectionPackPurchase({
    username: "PackBuyer",
    packId: "classic_avatar_pack",
    transactionId: "pack-full-transaction-1"
  });
  const fullValue = priceOf("fireavatarF") + priceOf("wateravatarF");
  const savings = Math.floor(fullValue * 0.15);
  const finalPrice = fullValue - savings;

  assert.equal(result.purchase.kind, "collection_pack");
  assert.deepEqual(result.purchase.grantedCosmeticIds, ["fireavatarF", "wateravatarF"]);
  assert.equal(result.purchase.remainingNormalValue, fullValue);
  assert.equal(result.purchase.savings, savings);
  assert.equal(result.purchase.price, finalPrice);
  assert.equal(result.profile.tokens, 1000 - finalPrice);
  assert.ok(result.profile.ownedCosmetics.avatar.includes("fireavatarF"));
  assert.ok(result.profile.ownedCosmetics.avatar.includes("wateravatarF"));

  const ledger = await state.storePurchaseLedger.getByTransactionId("pack-full-transaction-1");
  assert.equal(ledger.purchaseKind, "collection_pack");
  assert.equal(ledger.packId, "classic_avatar_pack");
  assert.deepEqual(ledger.grantedCosmeticIds, ["fireavatarF", "wateravatarF"]);
  assert.equal(ledger.price, finalPrice);
});

test("collection packs: coordinator purchase charges and grants only unowned remaining items", async (t) => {
  const state = await createCoordinator(t);
  await state.collectionPackStore.upsertPack(activePack());
  await seedProfile(state, "PartialPackBuyer", {
    tokens: 1000,
    ownedCosmetics: {
      avatar: ["default_avatar", "fireavatarF"]
    }
  });

  const result = await state.completeCollectionPackPurchase({
    username: "PartialPackBuyer",
    packId: "classic_avatar_pack",
    transactionId: "pack-partial-transaction-1"
  });
  const remainingValue = priceOf("wateravatarF");
  const savings = Math.floor(remainingValue * 0.15);

  assert.deepEqual(result.purchase.grantedCosmeticIds, ["wateravatarF"]);
  assert.equal(result.purchase.price, remainingValue - savings);
  assert.equal(
    result.profile.ownedCosmetics.avatar.filter((id) => id === "fireavatarF").length,
    1
  );
  assert.equal(
    result.profile.ownedCosmetics.avatar.filter((id) => id === "wateravatarF").length,
    1
  );
});

test("collection packs: coordinator settlement recalculates ownership inside profile mutation", async (t) => {
  const state = await createCoordinator(t);
  await state.collectionPackStore.upsertPack(activePack());
  await seedProfile(state, "SnapshotBuyer", { tokens: 1000 });

  const originalUpdateProfile = state.profiles.updateProfile.bind(state.profiles);
  let injectedOwnership = false;
  state.profiles.updateProfile = async (username, updater) =>
    originalUpdateProfile(username, (current) => {
      if (username !== "SnapshotBuyer" || injectedOwnership) {
        return updater(current);
      }
      injectedOwnership = true;
      return updater({
        ...current,
        ownedCosmetics: {
          ...current.ownedCosmetics,
          avatar: [...current.ownedCosmetics.avatar, "fireavatarF"]
        }
      });
    });

  const result = await state.completeCollectionPackPurchase({
    username: "SnapshotBuyer",
    packId: "classic_avatar_pack",
    transactionId: "pack-snapshot-transaction-1"
  });
  state.profiles.updateProfile = originalUpdateProfile;

  const remainingValue = priceOf("wateravatarF");
  const savings = Math.floor(remainingValue * 0.15);
  const finalPrice = remainingValue - savings;
  const ledger = await state.storePurchaseLedger.getByTransactionId("pack-snapshot-transaction-1");

  assert.deepEqual(result.purchase.grantedCosmeticIds, ["wateravatarF"]);
  assert.equal(result.purchase.remainingNormalValue, remainingValue);
  assert.equal(result.purchase.savings, savings);
  assert.equal(result.purchase.price, finalPrice);
  assert.equal(result.profile.tokens, 1000 - finalPrice);
  assert.equal(result.profile.ownedCosmetics.avatar.filter((id) => id === "fireavatarF").length, 1);
  assert.equal(result.profile.ownedCosmetics.avatar.filter((id) => id === "wateravatarF").length, 1);
  assert.deepEqual(ledger.grantedCosmeticIds, ["wateravatarF"]);
  assert.equal(ledger.remainingNormalValue, remainingValue);
  assert.equal(ledger.savings, savings);
  assert.equal(ledger.price, finalPrice);
});

test("collection packs: complete and insufficient-token purchases reject without mutation", async (t) => {
  const completeState = await createCoordinator(t);
  await completeState.collectionPackStore.upsertPack(activePack());
  const completeBefore = await seedProfile(completeState, "CompleteBuyer", {
    tokens: 1000,
    ownedCosmetics: {
      avatar: ["default_avatar", "fireavatarF", "wateravatarF"]
    }
  });
  await assert.rejects(
    () =>
      completeState.completeCollectionPackPurchase({
        username: "CompleteBuyer",
        packId: "classic_avatar_pack",
        transactionId: "pack-complete-transaction-1"
      }),
    /already complete/
  );
  assert.deepEqual(await completeState.profiles.getProfile("CompleteBuyer"), completeBefore);

  const poorState = await createCoordinator(t);
  await poorState.collectionPackStore.upsertPack(activePack());
  const poorBefore = await seedProfile(poorState, "PoorBuyer", { tokens: 1 });
  await assert.rejects(
    () =>
      poorState.completeCollectionPackPurchase({
        username: "PoorBuyer",
        packId: "classic_avatar_pack",
        transactionId: "pack-poor-transaction-1"
      }),
    /Insufficient tokens/
  );
  assert.deepEqual(await poorState.profiles.getProfile("PoorBuyer"), poorBefore);
});

test("collection packs: inactive invisible scheduled expired and sold-out packs reject", async (t) => {
  const cases = [
    ["inactive_pack", activePack({ packId: "inactive_pack", active: false }), /inactive/],
    ["invisible_pack", activePack({ packId: "invisible_pack", visible: false }), /not visible/],
    [
      "future_pack",
      activePack({ packId: "future_pack", startsAt: "2026-06-24T12:00:00.000Z" }),
      /not available yet/
    ],
    [
      "expired_pack",
      activePack({ packId: "expired_pack", endsAt: "2026-06-22T12:00:00.000Z" }),
      /expired/
    ],
    [
      "sold_out_pack",
      activePack({
        packId: "sold_out_pack",
        saleLimitMode: "limited",
        saleLimitTotal: 1,
        soldCount: 1
      }),
      /Sold Out/
    ]
  ];

  for (const [packId, pack, expected] of cases) {
    const state = await createCoordinator(t);
    await state.collectionPackStore.upsertPack(pack);
    const before = await seedProfile(state, `Buyer-${packId}`, { tokens: 1000 });
    await assert.rejects(
      () =>
        state.completeCollectionPackPurchase({
          username: `Buyer-${packId}`,
          packId,
          transactionId: `pack-${packId}-transaction-1`
        }),
      expected
    );
    assert.deepEqual(await state.profiles.getProfile(`Buyer-${packId}`), before);
  }
});

test("collection packs: limited purchase increments sold count once and duplicate transaction is idempotent", async (t) => {
  const state = await createCoordinator(t);
  await state.collectionPackStore.upsertPack(
    activePack({ saleLimitMode: "limited", saleLimitTotal: 2 })
  );
  await seedProfile(state, "LimitedBuyer", { tokens: 1000 });

  const first = await state.completeCollectionPackPurchase({
    username: "LimitedBuyer",
    packId: "classic_avatar_pack",
    transactionId: "pack-limited-transaction-1"
  });
  const afterFirst = await state.collectionPackStore.getPack("classic_avatar_pack");
  const profileAfterFirst = await state.profiles.getProfile("LimitedBuyer");

  const duplicate = await state.completeCollectionPackPurchase({
    username: "LimitedBuyer",
    packId: "classic_avatar_pack",
    transactionId: "pack-limited-transaction-1"
  });
  const afterDuplicate = await state.collectionPackStore.getPack("classic_avatar_pack");
  const profileAfterDuplicate = await state.profiles.getProfile("LimitedBuyer");

  assert.equal(afterFirst.soldCount, 1);
  assert.equal(afterDuplicate.soldCount, 1);
  assert.equal(first.transaction.duplicate, false);
  assert.equal(duplicate.transaction.duplicate, true);
  assert.deepEqual(profileAfterDuplicate, profileAfterFirst);
});

test("collection packs: failed profile settlement rolls back limited sale reservation", async (t) => {
  const state = await createCoordinator(t);
  await state.collectionPackStore.upsertPack(
    activePack({ saleLimitMode: "limited", saleLimitTotal: 1 })
  );
  await seedProfile(state, "RollbackBuyer", { tokens: 1000 });
  const originalUpdateProfile = state.profiles.updateProfile.bind(state.profiles);
  state.profiles.updateProfile = async () => {
    throw new Error("forced profile write failure");
  };

  await assert.rejects(
    () =>
      state.completeCollectionPackPurchase({
        username: "RollbackBuyer",
        packId: "classic_avatar_pack",
        transactionId: "pack-rollback-transaction-1"
      }),
    /forced profile write failure/
  );
  state.profiles.updateProfile = originalUpdateProfile;

  const pack = await state.collectionPackStore.getPack("classic_avatar_pack");
  const ledger = await state.storePurchaseLedger.getByTransactionId("pack-rollback-transaction-1");
  assert.equal(pack.soldCount, 0);
  assert.equal(ledger.status, "rejected");
});
