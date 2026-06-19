import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildPublicSpecialCosmeticRecord,
  normalizeSpecialCosmeticRecord,
  SpecialCosmeticRegistryStore
} from "../../src/state/specialCosmeticRegistryStore.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-special-cosmetic-registry-"));
}

test("special cosmetic registry: missing file initializes safely", async () => {
  const dataDir = await createTempDataDir();
  const store = new SpecialCosmeticRegistryStore({ dataDir });

  assert.deepEqual(await store.listRecords(), []);
  const persisted = JSON.parse(
    await fs.readFile(path.join(dataDir, "special-cosmetic-registry.json"), "utf8")
  );
  assert.deepEqual(persisted, { version: 1, records: [] });
});

test("special cosmetic registry: valid approved config round-trips with stable timestamps", async () => {
  const dataDir = await createTempDataDir();
  const timestamps = [
    "2026-06-19T12:00:00.000Z",
    "2026-06-19T13:00:00.000Z"
  ];
  const store = new SpecialCosmeticRegistryStore({
    dataDir,
    now: () => timestamps.shift() ?? "2026-06-19T13:00:00.000Z"
  });

  const created = await store.upsertConfig({
    cosmeticId: "avatar_unique_fixture",
    status: "approved",
    assignmentStatus: "assigned",
    createdForUsername: " UniqueOwner ",
    grantOnly: true,
    shopEligible: true,
    shopListed: false,
    saleLimitMode: "limited",
    saleLimitTotal: 25,
    royalty: {
      enabled: true,
      recipientUsername: " RoyaltyOwner ",
      tokenPercent: 10
    },
    adminNotes: " private "
  });
  const updated = await store.upsertConfig({
    cosmeticId: "avatar_unique_fixture",
    status: "assigned",
    shopListed: true,
    saleLimitSold: 24
  });

  assert.equal(created.createdAt, "2026-06-19T12:00:00.000Z");
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-06-19T13:00:00.000Z");
  assert.equal(updated.shopListed, true);
  assert.equal(updated.saleLimitSold, 0);
  assert.equal((await store.getRecord("avatar_unique_fixture")).adminNotes, "private");
});

test("special cosmetic registry: new records default safe and malformed fields repair deterministically", () => {
  const normalized = normalizeSpecialCosmeticRecord(
    {
      cosmeticId: "title_unique_fixture",
      status: "invalid_status",
      assignmentStatus: "assigned",
      uniqueOwnerUsername: "",
      shopEligible: "yes",
      shopListed: "yes",
      saleLimitMode: "limited",
      saleLimitTotal: 0,
      saleLimitSold: 7,
      royalty: {
        enabled: true,
        recipientUsername: null,
        tokenPercent: 200
      },
      adminNotes: 42
    },
    { now: "2026-06-19T12:00:00.000Z" }
  );

  assert.equal(normalized.status, "draft");
  assert.equal(normalized.assignmentStatus, "unassigned");
  assert.equal(normalized.createdForUsername, null);
  assert.equal(normalized.grantOnly, true);
  assert.equal(normalized.shopEligible, false);
  assert.equal(normalized.shopListed, false);
  assert.equal(normalized.saleLimitMode, "unlimited");
  assert.equal(normalized.saleLimitTotal, null);
  assert.equal(normalized.saleLimitSold, 7);
  assert.deepEqual(normalized.royalty, {
    enabled: false,
    recipientUsername: null,
    tokenPercent: 0
  });
  assert.equal(normalized.adminNotes, "");
});

test("special cosmetic registry: limited sold count repairs to total and public view strips admin notes", () => {
  const normalized = normalizeSpecialCosmeticRecord(
    {
      cosmeticId: "cardback_unique_fixture",
      saleLimitMode: "limited",
      saleLimitTotal: 5,
      saleLimitSold: 9,
      adminNotes: "server private"
    },
    { now: "2026-06-19T12:00:00.000Z" }
  );
  const publicRecord = buildPublicSpecialCosmeticRecord(normalized);

  assert.equal(normalized.saleLimitSold, 5);
  assert.equal("adminNotes" in publicRecord, false);
});

test("special cosmetic registry: Created For can remain unassigned, assign later, and accepts legacy owner alias", async () => {
  const dataDir = await createTempDataDir();
  const store = new SpecialCosmeticRegistryStore({ dataDir });
  const created = await store.upsertConfig({
    cosmeticId: "avatar_created_for_fixture",
    status: "approved",
    assignmentStatus: "unassigned",
    uniqueOwnerUsername: "LegacyCreator"
  });

  assert.equal(created.createdForUsername, null);
  const assigned = await store.updateAssignment({
    cosmeticId: "avatar_created_for_fixture",
    createdForUsername: "CopyCell"
  });
  assert.equal(assigned.assignmentStatus, "assigned");
  assert.equal(assigned.createdForUsername, "CopyCell");

  const cleared = await store.updateAssignment({
    cosmeticId: "avatar_created_for_fixture",
    createdForUsername: null
  });
  assert.equal(cleared.assignmentStatus, "unassigned");
  assert.equal(cleared.createdForUsername, null);
});

test("special cosmetic registry: shop config validates and preserves server-owned sold count and private fields", async () => {
  const dataDir = await createTempDataDir();
  const store = new SpecialCosmeticRegistryStore({ dataDir });
  const seeded = await store.upsertConfig({
    cosmeticId: "avatar_shop_config_fixture",
    status: "approved",
    assignmentStatus: "assigned",
    createdForUsername: "CopyCell",
    saleLimitMode: "limited",
    saleLimitTotal: 10,
    saleLimitSold: 4,
    royalty: {
      enabled: true,
      recipientUsername: "Creator",
      tokenPercent: 10
    },
    adminNotes: "private"
  });
  await store.store.write({
    version: 1,
    records: [{ ...seeded, saleLimitSold: 4 }]
  });

  const configured = await store.updateShopConfig({
    cosmeticId: "avatar_shop_config_fixture",
    config: {
      grantOnly: false,
      shopEligible: true,
      shopListed: true,
      storeHidden: true,
      rotationOnly: true,
      price: 750,
      saleLimitMode: "limited",
      saleLimitTotal: 8
    }
  });

  assert.equal(configured.price, 750);
  assert.equal(configured.saleLimitSold, 4);
  assert.equal(configured.saleLimitTotal, 8);
  assert.equal(configured.createdForUsername, "CopyCell");
  assert.equal(configured.adminNotes, "private");
  assert.equal(configured.royalty.recipientUsername, "Creator");

  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "avatar_shop_config_fixture",
      config: {
        grantOnly: false,
        shopEligible: true,
        shopListed: true,
        storeHidden: false,
        rotationOnly: false,
        price: 500,
        saleLimitMode: "limited",
        saleLimitTotal: 3
      }
    }),
    /cannot be lower than existing saleLimitSold/
  );
  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "avatar_shop_config_fixture",
      config: {
        grantOnly: false,
        shopEligible: true,
        shopListed: true,
        storeHidden: false,
        rotationOnly: false,
        price: 500,
        saleLimitMode: "limited",
        saleLimitTotal: 8,
        saleLimitSold: 0
      }
    }),
    /saleLimitSold is server-owned/
  );
});

test("special cosmetic registry: shop config rejects invalid modes, totals, booleans, and prices", async () => {
  const dataDir = await createTempDataDir();
  const store = new SpecialCosmeticRegistryStore({ dataDir });
  await store.upsertConfig({
    cosmeticId: "title_shop_config_fixture",
    status: "approved"
  });
  const validBase = {
    grantOnly: true,
    shopEligible: false,
    shopListed: false,
    storeHidden: false,
    rotationOnly: false,
    price: null,
    saleLimitMode: "unlimited",
    saleLimitTotal: null
  };

  const unlimited = await store.updateShopConfig({
    cosmeticId: "title_shop_config_fixture",
    config: validBase
  });
  assert.equal(unlimited.saleLimitTotal, null);
  assert.equal(unlimited.price, null);

  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "title_shop_config_fixture",
      config: { ...validBase, saleLimitMode: "daily" }
    }),
    /Invalid saleLimitMode/
  );
  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "title_shop_config_fixture",
      config: { ...validBase, saleLimitMode: "limited", saleLimitTotal: 0 }
    }),
    /positive integer/
  );
  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "title_shop_config_fixture",
      config: { ...validBase, saleLimitTotal: 5 }
    }),
    /must be null/
  );
  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "title_shop_config_fixture",
      config: { ...validBase, shopListed: "true" }
    }),
    /shopListed must be a boolean/
  );
  await assert.rejects(
    store.updateShopConfig({
      cosmeticId: "title_shop_config_fixture",
      config: { ...validBase, price: 12.5 }
    }),
    /non-negative integer/
  );
});

test("special cosmetic registry: persistence does not enforce shop listing or trigger grants", async () => {
  const dataDir = await createTempDataDir();
  const registry = new SpecialCosmeticRegistryStore({ dataDir });
  const state = new StateCoordinator({ dataDir });

  await registry.upsertConfig({
    cosmeticId: "fireavatarF",
    status: "approved",
    grantOnly: true,
    shopEligible: false,
    shopListed: false,
    saleLimitMode: "limited",
    saleLimitTotal: 1,
    royalty: {
      enabled: true,
      recipientUsername: "RoyaltyOwner",
      tokenPercent: 10
    }
  });
  const purchase = await state.buyStoreItem({
    username: "RegistryCompatibilityBuyer",
    type: "avatar",
    cosmeticId: "fireavatarF"
  });

  assert.equal(purchase.purchase.status, "purchased");
  assert.ok(purchase.profile.ownedCosmetics.avatar.includes("fireavatarF"));
  assert.equal((await registry.getRecord("fireavatarF")).saleLimitSold, 0);
  assert.equal((await state.profiles.ensureProfile("RoyaltyOwner")).tokens, 400);
});

test("special cosmetic registry: token purchase reservation is serialized and rollback-safe", async () => {
  const dataDir = await createTempDataDir();
  const registry = new SpecialCosmeticRegistryStore({ dataDir });
  await registry.upsertConfig({
    cosmeticId: "unique_inventory_fixture",
    status: "approved"
  });
  await registry.updateShopConfig({
    cosmeticId: "unique_inventory_fixture",
    config: {
      grantOnly: false,
      shopEligible: true,
      shopListed: true,
      storeHidden: false,
      rotationOnly: false,
      price: 300,
      saleLimitMode: "limited",
      saleLimitTotal: 1
    }
  });

  const reservation = await registry.reserveTokenPurchase("unique_inventory_fixture");
  assert.equal(reservation.saleLimitSoldBefore, 0);
  assert.equal(reservation.saleLimitSoldAfter, 1);
  assert.equal((await registry.getRecord("unique_inventory_fixture")).saleLimitSold, 1);
  await assert.rejects(
    registry.reserveTokenPurchase("unique_inventory_fixture"),
    /Sold Out/
  );

  await registry.rollbackTokenPurchaseReservation({
    cosmeticId: "unique_inventory_fixture",
    saleLimitSoldBefore: 0,
    saleLimitSoldAfter: 1
  });
  assert.equal((await registry.getRecord("unique_inventory_fixture")).saleLimitSold, 0);
});
