import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { COSMETIC_CATALOG } from "../../src/state/cosmeticSystem.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";
import { DEFAULT_STARTING_TOKENS } from "../../src/state/storeSystem.js";

const PERSONALITY_DROP_TITLE_EXPECTATIONS = Object.freeze([
  ["title_chaos_gremlin", "Common", 150],
  ["title_soft_doom", "Common", 150],
  ["title_pretty_problem", "Common", 150],
  ["title_silent_menace", "Rare", 350],
  ["title_drama_magnet", "Rare", 350],
  ["title_neon_rebel", "Rare", 350],
  ["title_velvet_villain", "Epic", 700],
  ["title_void_doll", "Epic", 700],
  ["title_glitch_royalty", "Epic", 700],
  ["title_crownless_king", "Legendary", 1100],
  ["title_divine_menace", "Legendary", 1100],
  ["title_cataclysm_icon", "Legendary", 1100]
]);

const PERSONALITY_DROP_AVATAR_EXPECTATIONS = Object.freeze([
  ["avatar_smirk_ember", "Common", 200],
  ["avatar_bubble_brat", "Common", 200],
  ["avatar_moss_mood", "Common", 200],
  ["avatar_neon_puff", "Common", 200],
  ["avatar_stone_cold_cutie", "Rare", 400],
  ["avatar_storm_brat", "Rare", 400],
  ["avatar_tidal_diva", "Rare", 400],
  ["avatar_ashen_trickster", "Rare", 400],
  ["avatar_corrupt_cherub", "Epic", 800],
  ["avatar_void_glam", "Epic", 800],
  ["avatar_riot_halo", "Epic", 800],
  ["avatar_golden_menace", "Legendary", 1200],
  ["avatar_chaos_monarch", "Legendary", 1200],
  ["avatar_rose_riot", "Legendary", 1200]
]);

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-store-"));
}

async function createConfiguredUniqueState({
  username = "UniqueBuyer",
  tokens = 1000,
  config = {},
  royalty = {
    enabled: true,
    recipientUsername: "RoyaltyRecipient",
    tokenPercent: 10
  },
  createRoyaltyRecipient = true
} = {}) {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const fixture = COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF");
  const originalRarity = fixture.rarity;
  fixture.rarity = "Unique";
  await state.specialCosmeticRegistry.upsertConfig({
    cosmeticId: fixture.id,
    status: "assigned",
    assignmentStatus: "assigned",
    createdForUsername: "CopyCell",
    royalty,
    adminNotes: "private admin note"
  });
  await state.specialCosmeticRegistry.updateShopConfig({
    cosmeticId: fixture.id,
    config: {
      grantOnly: false,
      shopEligible: true,
      shopListed: true,
      storeHidden: false,
      rotationOnly: false,
      price: 250,
      saleLimitMode: "unlimited",
      saleLimitTotal: null,
      ...config
    }
  });
  await state.profiles.updateProfile(username, { tokens });
  if (createRoyaltyRecipient && royalty?.enabled && royalty?.recipientUsername) {
    await state.profiles.ensureProfile(royalty.recipientUsername);
  }

  return {
    dataDir,
    state,
    fixture,
    username,
    restore: () => {
      fixture.rarity = originalRarity;
    }
  };
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

test("store: inactive Lycan Anubis Unique avatar is not publicly listed", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const cosmetic = COSMETIC_CATALOG.avatar.find(
    (item) => item.id === "avatar_lycan_anubis"
  );

  assert.ok(cosmetic);
  assert.equal(cosmetic.purchasable, false);
  assert.equal(cosmetic.grantOnly, true);
  assert.equal(cosmetic.shopEligible, false);
  assert.equal(cosmetic.shopListed, false);
  assert.equal(cosmetic.storeHidden, true);
  assert.equal(cosmetic.price, undefined);
  assert.equal(cosmetic.collection, undefined);

  const store = await state.getStore("LycanCatalogViewer");
  assert.equal(
    store.catalog.avatar.some((item) => item.id === cosmetic.id),
    false
  );

  const cosmetics = await state.getCosmetics("LycanCatalogViewer");
  const catalogItem = cosmetics.catalog.avatar.find((item) => item.id === cosmetic.id);
  assert.equal(catalogItem?.owned, false);
  assert.equal(catalogItem?.rarity, "Unique");
});

test("store: Unique registry config controls display and authoritative purchase", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-store-unique-display-"));
  const state = new StateCoordinator({ dataDir: dir });
  const fixture = COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF");
  const original = {
    rarity: fixture.rarity
  };

  try {
    fixture.rarity = "Unique";
    assert.equal(
      (await state.getStore("UniqueBuyer")).catalog.avatar.some((item) => item.id === fixture.id),
      false
    );
    await state.specialCosmeticRegistry.upsertConfig({
      cosmeticId: fixture.id,
      status: "approved",
      assignmentStatus: "assigned",
      createdForUsername: "CopyCell",
      royalty: {
        enabled: true,
        recipientUsername: "RoyaltyRecipient",
        tokenPercent: 10
      },
      adminNotes: "private admin note"
    });
    await state.specialCosmeticRegistry.updateShopConfig({
      cosmeticId: fixture.id,
      config: {
        grantOnly: false,
        shopEligible: false,
        shopListed: true,
        storeHidden: false,
        rotationOnly: false,
        price: 750,
        saleLimitMode: "limited",
        saleLimitTotal: 10
      }
    });

    assert.equal(
      (await state.getStore("UniqueBuyer")).catalog.avatar.some((item) => item.id === fixture.id),
      false
    );

    await state.specialCosmeticRegistry.updateShopConfig({
      cosmeticId: fixture.id,
      config: {
        grantOnly: false,
        shopEligible: true,
        shopListed: false,
        storeHidden: false,
        rotationOnly: false,
        price: 750,
        saleLimitMode: "limited",
        saleLimitTotal: 10
      }
    });
    assert.equal(
      (await state.getStore("UniqueBuyer")).catalog.avatar.some((item) => item.id === fixture.id),
      false
    );

    await state.specialCosmeticRegistry.updateShopConfig({
      cosmeticId: fixture.id,
      config: {
        grantOnly: false,
        shopEligible: true,
        shopListed: true,
        storeHidden: true,
        rotationOnly: false,
        price: 750,
        saleLimitMode: "limited",
        saleLimitTotal: 10
      }
    });
    assert.equal(
      (await state.getStore("UniqueBuyer")).catalog.avatar.some((item) => item.id === fixture.id),
      false
    );

    const configured = await state.specialCosmeticRegistry.updateShopConfig({
      cosmeticId: fixture.id,
      config: {
        grantOnly: false,
        shopEligible: true,
        shopListed: true,
        storeHidden: false,
        rotationOnly: false,
        price: 750,
        saleLimitMode: "limited",
        saleLimitTotal: 10
      }
    });
    await state.specialCosmeticRegistry.store.write({
      version: 1,
      records: [{ ...configured, saleLimitSold: 7 }]
    });

    const visibleStore = await state.getStore("UniqueBuyer");
    const visibleItem = visibleStore.catalog.avatar.find((item) => item.id === fixture.id);
    assert.equal(visibleItem?.rarity, "Unique");
    assert.equal(visibleItem?.createdForUsername, "CopyCell");
    assert.equal(visibleItem?.price, 750);
    assert.equal(visibleItem?.saleLimitMode, "limited");
    assert.equal(visibleItem?.saleLimitTotal, 10);
    assert.equal(visibleItem?.saleLimitSold, 7);
    assert.equal("adminNotes" in visibleItem, false);
    assert.equal(visibleItem?.royalty?.enabled, false);
    assert.equal(visibleItem?.royalty?.recipientUsername, null);

    const buyerBefore = await state.profiles.updateProfile("UniqueBuyer", { tokens: 1000 });
    const royaltyBefore = await state.profiles.updateProfile("RoyaltyRecipient", {
      tokens: 123
    });
    const createdForBefore = await state.profiles.ensureProfile("CopyCell");
    const result = await state.buyStoreItem({
      username: "UniqueBuyer",
      type: "avatar",
      cosmeticId: fixture.id,
      transactionId: "unique-store-purchase-1"
    });
    const buyerAfter = await state.profiles.ensureProfile("UniqueBuyer");
    const royaltyAfter = await state.profiles.ensureProfile("RoyaltyRecipient");
    const createdForAfter = await state.profiles.ensureProfile("CopyCell");
    const registryAfter = await state.specialCosmeticRegistry.getRecord(fixture.id);

    assert.equal(result.purchase.status, "purchased");
    assert.equal(buyerAfter.tokens, buyerBefore.tokens - 750);
    assert.equal(buyerAfter.ownedCosmetics.avatar.includes(fixture.id), true);
    assert.equal(royaltyAfter.tokens, royaltyBefore.tokens + 75);
    assert.equal(createdForAfter.tokens, createdForBefore.tokens);
    assert.equal(registryAfter.saleLimitSold, 8);

    await state.specialCosmeticRegistry.store.write({
      version: 1,
      records: [{
        ...registryAfter,
        saleLimitSold: 10,
        royalty: {
          enabled: true,
          recipientUsername: "RoyaltyRecipient",
          tokenPercent: 10
        }
      }]
    });
    const soldOutItem = (await state.getStore("AnotherUniqueBuyer")).catalog.avatar.find(
      (item) => item.id === fixture.id
    );
    assert.equal(soldOutItem?.saleLimitSold, 10);
    assert.equal(soldOutItem?.saleLimitTotal, 10);
  } finally {
    Object.assign(fixture, original);
  }
});

test("store: createdForUsername does not grant Unique ownership", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "elemintz-store-created-for-"));
  const state = new StateCoordinator({ dataDir: dir });
  const fixture = COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF");
  const originalRarity = fixture.rarity;

  try {
    fixture.rarity = "Unique";
    await state.specialCosmeticRegistry.upsertConfig({
      cosmeticId: fixture.id,
      status: "assigned",
      assignmentStatus: "assigned",
      createdForUsername: "CopyCell",
      grantOnly: false,
      shopEligible: true,
      shopListed: true,
      storeHidden: false,
      rotationOnly: false,
      price: 750,
      saleLimitMode: "unlimited",
      saleLimitTotal: null,
      saleLimitSold: 0,
      royalty: {
        enabled: true,
        recipientUsername: "CopyCell",
        tokenPercent: 10
      }
    });

    const store = await state.getStore("CopyCell");
    const item = store.catalog.avatar.find((entry) => entry.id === fixture.id);
    assert.equal(item?.createdForUsername, "CopyCell");
    assert.equal(item?.owned, false);
  } finally {
    fixture.rarity = originalRarity;
  }
});

test("store: Unique purchase ledger is durable and duplicate transactionId is idempotent", async () => {
  const setup = await createConfiguredUniqueState();
  try {
    await setup.state.profiles.updateProfile("RoyaltyRecipient", { tokens: 77 });
    const before = await setup.state.profiles.getProfile(setup.username);
    const first = await setup.state.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId: "unique-idempotent-transaction-1"
    });
    const duplicate = await setup.state.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId: "unique-idempotent-transaction-1"
    });
    const restartedState = new StateCoordinator({ dataDir: setup.dataDir });
    const restartedDuplicate = await restartedState.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId: "unique-idempotent-transaction-1"
    });
    const after = await setup.state.profiles.getProfile(setup.username);
    const royaltyAfter = await setup.state.profiles.getProfile("RoyaltyRecipient");
    const record = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    const ledger = await setup.state.storePurchaseLedger.getByTransactionId(
      "unique-idempotent-transaction-1"
    );

    assert.equal(first.purchase.status, "purchased");
    assert.equal(duplicate.purchase.duplicate, true);
    assert.equal(restartedDuplicate.purchase.duplicate, true);
    assert.equal(after.tokens, before.tokens - 250);
    assert.equal(
      after.ownedCosmetics.avatar.filter((id) => id === setup.fixture.id).length,
      1
    );
    assert.equal(record.saleLimitSold, 0);
    assert.equal(royaltyAfter.tokens, 102);
    assert.equal(ledger.status, "completed");
    assert.equal(ledger.buyerUsername, setup.username);
    assert.equal(ledger.cosmeticId, setup.fixture.id);
    assert.equal(ledger.price, 250);
    assert.equal(ledger.duplicateCount, 2);
    assert.equal(ledger.royaltyEnabled, true);
    assert.equal(ledger.royaltyRecipientUsername, "RoyaltyRecipient");
    assert.equal(ledger.royaltyTokenPercent, 10);
    assert.equal(ledger.royaltyAmount, 25);
    assert.equal(ledger.royaltyStatus, "paid");
    assert.equal(ledger.royaltyNotificationStatus, "queued");
    assert.ok(ledger.royaltyPaidAt);
    const royaltyNotice = await setup.state.adminGrantStore.getByTransactionId(
      "royalty:unique-idempotent-transaction-1"
    );
    assert.equal(royaltyNotice.status, "success");
    assert.equal(royaltyNotice.targetUsername, "RoyaltyRecipient");
    assert.equal(royaltyNotice.payload.tokens, 25);
    assert.match(royaltyNotice.result.noticeMessage, /Unique cosmetic: Fire Avatar/);
  } finally {
    setup.restore();
  }
});

test("store: disabled and zero-rounded Unique royalties skip payout safely", async () => {
  const disabled = await createConfiguredUniqueState({
    username: "DisabledRoyaltyBuyer",
    royalty: {
      enabled: false,
      recipientUsername: null,
      tokenPercent: 0
    }
  });
  try {
    const result = await disabled.state.buyStoreItem({
      username: disabled.username,
      type: "avatar",
      cosmeticId: disabled.fixture.id,
      transactionId: "unique-disabled-royalty-transaction"
    });
    const ledger = await disabled.state.storePurchaseLedger.getByTransactionId(
      "unique-disabled-royalty-transaction"
    );
    assert.equal(result.royalty.status, "none");
    assert.equal(ledger.royaltyAmount, 0);
    assert.equal(ledger.royaltyStatus, "none");
    assert.equal(
      await disabled.state.adminGrantStore.getByTransactionId(
        "royalty:unique-disabled-royalty-transaction"
      ),
      null
    );
  } finally {
    disabled.restore();
  }

  const rounded = await createConfiguredUniqueState({
    username: "RoundedRoyaltyBuyer",
    config: { price: 1 }
  });
  try {
    const recipientBefore = await rounded.state.profiles.getProfile("RoyaltyRecipient");
    const result = await rounded.state.buyStoreItem({
      username: rounded.username,
      type: "avatar",
      cosmeticId: rounded.fixture.id,
      transactionId: "unique-rounded-royalty-transaction"
    });
    const recipientAfter = await rounded.state.profiles.getProfile("RoyaltyRecipient");
    const ledger = await rounded.state.storePurchaseLedger.getByTransactionId(
      "unique-rounded-royalty-transaction"
    );
    assert.equal(result.royalty.amount, 0);
    assert.equal(result.royalty.status, "skipped");
    assert.equal(recipientAfter.tokens, recipientBefore.tokens);
    assert.equal(ledger.royaltyStatus, "skipped");
  } finally {
    rounded.restore();
  }
});

test("store: processing transaction recovery does not double-pay royalty or duplicate notice", async () => {
  const setup = await createConfiguredUniqueState({
    username: "RoyaltyRecoveryBuyer"
  });
  try {
    const transactionId = "unique-royalty-recovery-transaction";
    await setup.state.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId
    });
    const recipientAfterPurchase = await setup.state.profiles.getProfile("RoyaltyRecipient");
    const entry = await setup.state.storePurchaseLedger.getByTransactionId(transactionId);
    await setup.state.storePurchaseLedger.store.write([
      {
        ...entry,
        status: "processing",
        result: null,
        completedAt: null,
        royaltyStatus: "pending",
        royaltyNotificationStatus: "pending"
      }
    ]);
    await setup.state.adminGrantStore.store.write([]);

    const restarted = new StateCoordinator({ dataDir: setup.dataDir });
    const recovered = await restarted.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId
    });
    const recipientAfterRecovery = await restarted.profiles.getProfile("RoyaltyRecipient");
    const recoveredLedger = await restarted.storePurchaseLedger.getByTransactionId(transactionId);
    const notices = await restarted.adminGrantStore.listEntries();

    assert.equal(recovered.purchase.duplicate, true);
    assert.equal(recipientAfterRecovery.tokens, recipientAfterPurchase.tokens);
    assert.equal(recoveredLedger.status, "completed");
    assert.equal(recoveredLedger.royaltyStatus, "paid");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].transactionId, `royalty:${transactionId}`);
  } finally {
    setup.restore();
  }
});

test("store: invalid royalty recipient blocks purchase before buyer or inventory mutation", async () => {
  const setup = await createConfiguredUniqueState({
    username: "InvalidRoyaltyBuyer",
    royalty: {
      enabled: true,
      recipientUsername: "MissingRoyaltyRecipient",
      tokenPercent: 10
    },
    createRoyaltyRecipient: false,
    config: {
      saleLimitMode: "limited",
      saleLimitTotal: 2
    }
  });
  try {
    const buyerBefore = await setup.state.profiles.getProfile(setup.username);
    const inventoryBefore = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    await assert.rejects(
      setup.state.buyStoreItem({
        username: setup.username,
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "unique-invalid-royalty-recipient"
      }),
      /royalty recipient is invalid/
    );
    const buyerAfter = await setup.state.profiles.getProfile(setup.username);
    const inventoryAfter = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    assert.equal(buyerAfter.tokens, buyerBefore.tokens);
    assert.equal(buyerAfter.ownedCosmetics.avatar.includes(setup.fixture.id), false);
    assert.equal(inventoryAfter.saleLimitSold, inventoryBefore.saleLimitSold);
  } finally {
    setup.restore();
  }
});

test("store: self-royalty is paid once and remains a positive net token cost", async () => {
  const setup = await createConfiguredUniqueState({
    username: "SelfRoyaltyBuyer",
    royalty: {
      enabled: true,
      recipientUsername: "SelfRoyaltyBuyer",
      tokenPercent: 50
    }
  });
  try {
    const before = await setup.state.profiles.getProfile(setup.username);
    const first = await setup.state.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId: "unique-self-royalty-transaction"
    });
    await setup.state.buyStoreItem({
      username: setup.username,
      type: "avatar",
      cosmeticId: setup.fixture.id,
      transactionId: "unique-self-royalty-transaction"
    });
    const after = await setup.state.profiles.getProfile(setup.username);

    assert.equal(first.royalty.amount, 125);
    assert.equal(after.tokens, before.tokens - 125);
    assert.equal(
      after.storeRoyaltyPayouts.appliedTransactionIds.filter(
        (id) => id === "unique-self-royalty-transaction"
      ).length,
      1
    );
  } finally {
    setup.restore();
  }
});

test("store: concurrent limited Unique purchases cannot oversell the final item", async () => {
  const setup = await createConfiguredUniqueState({
    username: "RaceBuyerOne",
    config: {
      saleLimitMode: "limited",
      saleLimitTotal: 1
    }
  });
  try {
    await setup.state.profiles.updateProfile("RaceBuyerTwo", { tokens: 1000 });
    const results = await Promise.allSettled([
      setup.state.buyStoreItem({
        username: "RaceBuyerOne",
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "unique-race-transaction-one"
      }),
      setup.state.buyStoreItem({
        username: "RaceBuyerTwo",
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "unique-race-transaction-two"
      })
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    const record = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    const buyerOne = await setup.state.profiles.getProfile("RaceBuyerOne");
    const buyerTwo = await setup.state.profiles.getProfile("RaceBuyerTwo");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason.message, /Sold Out/);
    assert.equal(record.saleLimitSold, 1);
    assert.equal(
      Number(buyerOne.ownedCosmetics.avatar.includes(setup.fixture.id)) +
        Number(buyerTwo.ownedCosmetics.avatar.includes(setup.fixture.id)),
      1
    );
    assert.equal(
      Number(buyerOne.tokens === 750) + Number(buyerTwo.tokens === 750),
      1
    );
  } finally {
    setup.restore();
  }
});

test("store: failed Unique purchases do not mutate tokens, ownership, or inventory", async () => {
  const cases = [
    {
      name: "shopEligible false",
      config: { shopEligible: false },
      message: /not available/
    },
    {
      name: "shopListed false",
      config: { shopListed: false },
      message: /not available/
    },
    {
      name: "storeHidden true",
      config: { storeHidden: true },
      message: /not available/
    },
    {
      name: "grantOnly true",
      config: { grantOnly: true },
      message: /grant-only/
    },
    {
      name: "missing price",
      config: { price: null },
      message: /price is missing or invalid/
    },
    {
      name: "not enough tokens",
      tokens: 100,
      message: /Not enough tokens/
    }
  ];

  for (const [index, testCase] of cases.entries()) {
    const setup = await createConfiguredUniqueState({
      username: `RejectedUniqueBuyer${index}`,
      tokens: testCase.tokens ?? 1000,
      config: testCase.config ?? {}
    });
    try {
      const before = await setup.state.profiles.getProfile(setup.username);
      const recordBefore = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
      const recipientBefore = await setup.state.profiles.getProfile("RoyaltyRecipient");
      await assert.rejects(
        setup.state.buyStoreItem({
          username: setup.username,
          type: "avatar",
          cosmeticId: setup.fixture.id,
          transactionId: `unique-rejected-transaction-${index}`
        }),
        testCase.message,
        testCase.name
      );
      const after = await setup.state.profiles.getProfile(setup.username);
      const recordAfter = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
      const recipientAfter = await setup.state.profiles.getProfile("RoyaltyRecipient");
      const ledger = await setup.state.storePurchaseLedger.getByTransactionId(
        `unique-rejected-transaction-${index}`
      );
      assert.equal(after.tokens, before.tokens, testCase.name);
      assert.equal(after.ownedCosmetics.avatar.includes(setup.fixture.id), false, testCase.name);
      assert.equal(recordAfter.saleLimitSold, recordBefore.saleLimitSold, testCase.name);
      assert.equal(recipientAfter.tokens, recipientBefore.tokens, testCase.name);
      assert.equal(ledger.status, "rejected", testCase.name);
      assert.equal(
        await setup.state.adminGrantStore.getByTransactionId(
          `royalty:unique-rejected-transaction-${index}`
        ),
        null,
        testCase.name
      );
    } finally {
      setup.restore();
    }
  }
});

test("store: Unique purchase requires transactionId and existing buyer profile", async () => {
  const setup = await createConfiguredUniqueState();
  try {
    await assert.rejects(
      setup.state.buyStoreItem({
        username: setup.username,
        type: "avatar",
        cosmeticId: setup.fixture.id
      }),
      /valid transactionId/
    );
    await assert.rejects(
      setup.state.buyStoreItem({
        username: setup.username,
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "bad"
      }),
      /valid transactionId/
    );
    await assert.rejects(
      setup.state.buyStoreItem({
        username: "MissingUniqueBuyer",
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "unique-missing-buyer-transaction"
      }),
      /Buyer profile is missing/
    );
  } finally {
    setup.restore();
  }
});

test("store: malformed Unique inventory mode is rejected without mutation", async () => {
  const setup = await createConfiguredUniqueState({
    config: {
      saleLimitMode: "limited",
      saleLimitTotal: 2
    }
  });
  try {
    const profileBefore = await setup.state.profiles.getProfile(setup.username);
    const record = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    await setup.state.specialCosmeticRegistry.store.write({
      version: 1,
      records: [{ ...record, saleLimitMode: "daily" }]
    });

    await assert.rejects(
      setup.state.buyStoreItem({
        username: setup.username,
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "unique-invalid-mode-transaction"
      }),
      /sale limit mode is invalid/
    );
    const profileAfter = await setup.state.profiles.getProfile(setup.username);
    assert.equal(profileAfter.tokens, profileBefore.tokens);
    assert.equal(profileAfter.ownedCosmetics.avatar.includes(setup.fixture.id), false);
  } finally {
    setup.restore();
  }
});

test("store: direct Unique grants do not increment limited sale inventory", async () => {
  const setup = await createConfiguredUniqueState({
    username: "UniqueGrantRecipient",
    config: {
      saleLimitMode: "limited",
      saleLimitTotal: 3
    }
  });
  try {
    const before = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    const recipientBefore = await setup.state.profiles.getProfile("RoyaltyRecipient");
    const grant = await setup.state.grantSpecialCosmetic({
      username: "UniqueGrantRecipient",
      type: "avatar",
      cosmeticId: setup.fixture.id
    });
    await assert.rejects(
      setup.state.buyStoreItem({
        username: "UniqueGrantRecipient",
        type: "avatar",
        cosmeticId: setup.fixture.id,
        transactionId: "unique-already-owned-transaction"
      }),
      /Already Owned/
    );
    const after = await setup.state.specialCosmeticRegistry.getRecord(setup.fixture.id);
    const recipientAfter = await setup.state.profiles.getProfile("RoyaltyRecipient");

    assert.equal(grant.cosmeticGrant.status, "granted");
    assert.equal(after.saleLimitSold, before.saleLimitSold);
    assert.equal(recipientAfter.tokens, recipientBefore.tokens);
    assert.equal(
      await setup.state.adminGrantStore.getByTransactionId(
        "royalty:unique-already-owned-transaction"
      ),
      null
    );
  } finally {
    setup.restore();
  }
});

test("store: chest and reward paths do not trigger configured Unique royalties", async () => {
  const setup = await createConfiguredUniqueState({
    username: "NonPurchaseRewardUser"
  });
  try {
    const recipientBefore = await setup.state.profiles.getProfile("RoyaltyRecipient");
    await setup.state.grantChest({
      username: setup.username,
      chestType: "basic",
      amount: 1
    });
    await setup.state.grantOnlineMatchRewards({
      username: setup.username,
      tokens: 10,
      xp: 5,
      basicChests: 0
    });
    const recipientAfter = await setup.state.profiles.getProfile("RoyaltyRecipient");
    const notices = await setup.state.adminGrantStore.listEntries();

    assert.equal(recipientAfter.tokens, recipientBefore.tokens);
    assert.equal(notices.length, 0);
  } finally {
    setup.restore();
  }
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
  assert.equal(purchase.store.tokens, before.tokens - 200);

  const stateB = new StateCoordinator({ dataDir });
  const afterRestart = await stateB.getStore("PersistBuyer");

  assert.equal(afterRestart.tokens, before.tokens - 200);
  assert.ok(afterRestart.catalog.avatar.find((item) => item.id === "fireavatarF")?.owned);
});

test("store: username-specific test token grant is not applied through store access", async () => {
  const dataDir = await createTempDataDir();
  const stateA = new StateCoordinator({ dataDir });

  const first = await stateA.getStore("VampyrLee");
  assert.equal(first.tokens, DEFAULT_STARTING_TOKENS);

  await stateA.buyStoreItem({
    username: "VampyrLee",
    type: "avatar",
    cosmeticId: "fireavatarF"
  });

  const stateB = new StateCoordinator({ dataDir });
  const afterRestart = await stateB.getStore("VampyrLee");
  assert.equal(afterRestart.tokens, DEFAULT_STARTING_TOKENS - 200);
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
  assert.equal(purchased.store.tokens, before.tokens - 400);

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
  assert.equal(avatars.get("fire_avatar_m")?.price, 400);
  assert.equal(avatars.get("wateravatarF")?.rarity, "Common");
  assert.equal(avatars.get("wateravatarF")?.price, 200);
  assert.equal(avatars.get("earthavatarM")?.rarity, "Common");
  assert.equal(avatars.get("earthavatarM")?.price, 200);
  assert.equal(avatars.get("wind_avatar_f")?.rarity, "Rare");
  assert.equal(avatars.get("wind_avatar_f")?.price, 400);
  assert.equal(avatars.get("avatar_flame_spirit_f")?.rarity, "Epic");
  assert.equal(avatars.get("avatar_flame_spirit_f")?.price, 800);
  assert.equal(avatars.get("avatar_tidal_warden_m")?.rarity, "Epic");
  assert.equal(avatars.get("avatar_tidal_warden_m")?.price, 800);
  assert.equal(avatars.get("avatar_veteran_champion")?.price, 600);

  assert.equal(backs.get("ember_card_back")?.rarity, "Rare");
  assert.equal(backs.get("ember_card_back")?.price, 350);
  assert.equal(backs.get("crystal_card_back")?.rarity, "Rare");
  assert.equal(backs.get("crystal_card_back")?.price, 350);
  assert.equal(backs.get("storm_sigil_card_back")?.rarity, "Common");
  assert.equal(backs.get("storm_sigil_card_back")?.price, 175);
  assert.ok(!backs.has("void_card_back"));
  assert.equal(backs.get("cardback_lava_core")?.rarity, "Epic");
  assert.equal(backs.get("cardback_lava_core")?.price, 700);
  assert.equal(backs.get("cardback_obsidian_halo")?.rarity, "Rare");
  assert.equal(backs.get("cardback_obsidian_halo")?.price, 350);
  assert.equal(backs.get("founder_deluxe_card_back")?.rarity, "Legendary");
  assert.equal(backs.get("founder_deluxe_card_back")?.price, 800);
  assert.equal(backs.get("founder_deluxe_card_back")?.purchasable, false);
  assert.equal(backs.get("founder_deluxe_card_back")?.unlockSource?.type, "supporter");
  assert.ok(!backs.has("supporter_card_back"));
  assert.equal(backs.get("default_card_back")?.image, "card_backs/default_back.jpg");

  assert.ok(!backgrounds.has("lava_throne_background"));
  assert.equal(cosmeticBackgrounds.get("lava_throne_background")?.rarity, "Epic");
  assert.equal(cosmeticBackgrounds.get("lava_throne_background")?.price, 900);
  assert.equal(backgrounds.get("frozen_temple_background")?.rarity, "Rare");
  assert.equal(backgrounds.get("frozen_temple_background")?.price, 500);
  assert.equal(backgrounds.get("ruin_arena_background")?.rarity, "Common");
  assert.equal(backgrounds.get("ruin_arena_background")?.price, 150);
  assert.ok(!backgrounds.has("void_altar_background"));
  assert.equal(cosmeticBackgrounds.get("void_altar_background")?.rarity, "Legendary");
  assert.equal(cosmeticBackgrounds.get("void_altar_background")?.price, 1300);

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
  assert.equal(variants.get("arcane_fire_card")?.price, 350);
  assert.equal(variants.get("arcane_blue_flame_card")?.rarity, "Rare");
  assert.equal(variants.get("arcane_blue_flame_card")?.price, 350);
  assert.equal(variants.get("blue_fire_card")?.rarity, "Common");
  assert.equal(variants.get("blue_fire_card")?.price, 175);
  assert.equal(variants.get("wave_water_card")?.rarity, "Rare");
  assert.equal(variants.get("wave_water_card")?.price, 350);
  assert.equal(variants.get("arcane_water_card")?.rarity, "Rare");
  assert.equal(variants.get("arcane_water_card")?.price, 350);
  assert.equal(variants.get("bold_earth_card")?.rarity, "Rare");
  assert.equal(variants.get("bold_earth_card")?.price, 350);
  assert.equal(variants.get("rock_storm_card")?.rarity, "Epic");
  assert.equal(variants.get("rock_storm_card")?.price, 650);
  assert.equal(variants.get("smokey_wind_card")?.rarity, "Rare");
  assert.equal(variants.get("smokey_wind_card")?.price, 350);
  assert.equal(variants.get("water_variant_crystal")?.rarity, "Rare");
  assert.equal(variants.get("water_variant_crystal")?.price, 250);
  assert.equal(variants.get("earth_variant_titan")?.rarity, "Epic");
  assert.equal(variants.get("earth_variant_titan")?.price, 450);
  assert.equal(variants.get("fire_variant_blue_inferno")?.rarity, "Epic");
  assert.equal(variants.get("fire_variant_blue_inferno")?.price, 650);
  assert.ok(!variants.has("fire_variant_crownfire"));
  assert.equal(cosmeticVariants.get("fire_variant_crownfire")?.rarity, "Legendary");
  assert.equal(cosmeticVariants.get("fire_variant_crownfire")?.price, 950);
  assert.equal(variants.get("fire_variant_ember_core")?.rarity, "Epic");
  assert.equal(variants.get("fire_variant_ember_core")?.price, 650);
  assert.equal(variants.get("fire_variant_transparent_flame")?.rarity, "Legendary");
  assert.equal(variants.get("fire_variant_transparent_flame")?.price, 950);
  assert.equal(variants.get("water_variant_transparent_wave")?.rarity, "Legendary");
  assert.equal(variants.get("water_variant_transparent_wave")?.price, 950);
  assert.equal(variants.get("earth_variant_transparent_crystal")?.rarity, "Legendary");
  assert.equal(variants.get("earth_variant_transparent_crystal")?.price, 950);
  assert.equal(variants.get("wind_variant_transparent_vortex")?.rarity, "Legendary");
  assert.equal(variants.get("wind_variant_transparent_vortex")?.price, 950);

  assert.equal(titles.get("Arena Founder")?.rarity, "Legendary");
  assert.equal(titles.get("Arena Founder")?.price, 500);
  assert.equal(titles.get("title_war_master")?.rarity, "Rare");
  assert.equal(titles.get("title_war_master")?.price, 200);
  assert.equal(titles.get("title_element_sovereign")?.rarity, "Epic");
  assert.equal(titles.get("title_element_sovereign")?.price, 350);
  assert.equal(titles.get("title_master_elemintz")?.rarity, "Legendary");
  assert.equal(titles.get("title_master_elemintz")?.price, 500);
  assert.equal(titles.get("Token Tycoon")?.rarity, "Common");
  assert.equal(titles.get("Token Tycoon")?.price, 150);

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

test("store: Personality Drop avatar and title cosmetics remain purchasable and visible but are no longer marked new", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const store = await state.getStore("NewCosmeticsStoreUser");
  const cosmetics = await state.getCosmetics("NewCosmeticsStoreUser");

  const titles = new Map((store.catalog.title ?? []).map((item) => [item.id, item]));
  const avatars = new Map((store.catalog.avatar ?? []).map((item) => [item.id, item]));
  const cosmeticAvatars = new Map((cosmetics.catalog.avatar ?? []).map((item) => [item.id, item]));

  for (const [id, rarity, price] of PERSONALITY_DROP_TITLE_EXPECTATIONS) {
    const item = titles.get(id);
    assert.ok(item, `missing store title ${id}`);
    assert.equal(item.purchasable, true);
    assert.equal(item.owned, false);
    assert.equal(item.rarity, rarity);
    assert.equal(item.price, price);
    assert.equal(item.releaseTag, "v0.1.6");
    assert.equal(item.isNew, false);
  }

  for (const [id, rarity, price] of PERSONALITY_DROP_AVATAR_EXPECTATIONS) {
    const visibleStoreItem = avatars.get(id);
    const catalogItem = cosmeticAvatars.get(id);
    assert.ok(catalogItem, `missing cosmetic catalog avatar ${id}`);
    assert.equal(catalogItem.purchasable, true);
    assert.equal(catalogItem.owned, false);
    assert.equal(catalogItem.rarity, rarity);
    assert.equal(catalogItem.price, price);
    assert.equal(catalogItem.releaseTag, "v0.1.6");
    assert.equal(catalogItem.isNew, false);

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

test("store: Neon Arcana card back and element variants remain visible and purchasable after NEW retirement", async () => {
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
  assert.equal(cardBack.price, 1050);
  assert.equal(cardBack.purchasable, true);
  assert.equal(cardBack.releaseTag, "neon_arcana_01");
  assert.equal(cardBack.isNew, false);
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
    assert.equal(item.price, 350);
    assert.equal(item.purchasable, true);
    assert.equal(item.releaseTag, "neon_arcana_01");
    assert.equal(item.isNew, false);
    assert.equal(item.collection, "Neon Arcana");
    assert.equal(item.element, element);
    assert.match(item.image, /^cards\//);
    assert.equal(item.rotationOnly ?? false, false);
    assert.equal(item.storeHidden ?? false, false);
  }
});

test("store: Neon Arcana and older Personality Drop cosmetics remain visible without NEW badges", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  const store = await state.getStore("NeonArcanaSortUser");

  const avatars = new Map((store.catalog.avatar ?? []).map((item) => [item.id, item]));
  const titles = new Map((store.catalog.title ?? []).map((item) => [item.id, item]));

  assert.equal(avatars.get("avatar_neon_pyre_entity")?.isNew, false);
  assert.equal(avatars.get("avatar_smirk_ember")?.isNew, false);
  assert.equal(titles.get("title_spellwired")?.isNew, false);
  assert.equal(titles.get("title_chaos_gremlin")?.isNew, false);
});
