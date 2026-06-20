import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MultiplayerProfileAuthority } from "../../src/multiplayer/profileAuthority.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

const LYCAN_KEY = "avatar:avatar_lycan_anubis";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-unique-acquisition-"));
}

async function configureLycanForPurchase(state) {
  await state.specialCosmeticRegistry.upsertConfig({
    cosmeticId: "avatar_lycan_anubis",
    status: "approved"
  });
  await state.specialCosmeticRegistry.updateShopConfig({
    cosmeticId: "avatar_lycan_anubis",
    config: {
      grantOnly: false,
      shopEligible: true,
      shopListed: true,
      storeHidden: false,
      rotationOnly: false,
      price: 1500,
      saleLimitMode: "unlimited",
      saleLimitTotal: null
    }
  });
}

async function giveLycanOwnership(state, username) {
  await state.profiles.updateProfile(username, (profile) => ({
    ...profile,
    ownedCosmetics: {
      ...profile.ownedCosmetics,
      avatar: [...profile.ownedCosmetics.avatar, "avatar_lycan_anubis"]
    }
  }));
}

test("Unique acquisition: successful purchase persists store_purchase and duplicate grant preserves it", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  await configureLycanForPurchase(state);
  await state.profiles.updateProfile("PurchaseOwner", { tokens: 2000 });

  await state.buyStoreItem({
    username: "PurchaseOwner",
    type: "avatar",
    cosmeticId: "avatar_lycan_anubis",
    transactionId: "unique-acquisition-purchase-1"
  });

  let profile = await state.profiles.getProfile("PurchaseOwner");
  assert.deepEqual(profile.uniqueCosmeticAcquisitions[LYCAN_KEY], {
    source: "store_purchase"
  });
  const cosmetics = await state.getCosmetics("PurchaseOwner");
  const lycan = cosmetics.catalog.avatar.find((item) => item.id === "avatar_lycan_anubis");
  assert.equal(lycan?.acquisitionLabel, "Store Purchase");

  const duplicateGrant = await state.grantSpecialCosmetic({
    username: "PurchaseOwner",
    type: "avatar",
    cosmeticId: "avatar_lycan_anubis"
  });
  assert.equal(duplicateGrant.cosmeticGrant.status, "already_owned");
  profile = await state.profiles.getProfile("PurchaseOwner");
  assert.equal(profile.uniqueCosmeticAcquisitions[LYCAN_KEY].source, "store_purchase");
});

test("Unique acquisition: successful grant persists granted and failed purchase does not overwrite it", async () => {
  const dataDir = await createTempDataDir();
  const state = new StateCoordinator({ dataDir });
  await state.profiles.ensureProfile("GrantOwner");

  const grant = await state.grantSpecialCosmetic({
    username: "GrantOwner",
    type: "avatar",
    cosmeticId: "avatar_lycan_anubis"
  });
  assert.equal(grant.cosmeticGrant.status, "granted");

  let profile = await state.profiles.getProfile("GrantOwner");
  assert.deepEqual(profile.uniqueCosmeticAcquisitions[LYCAN_KEY], {
    source: "granted"
  });
  const cosmetics = await state.getCosmetics("GrantOwner");
  const lycan = cosmetics.catalog.avatar.find((item) => item.id === "avatar_lycan_anubis");
  assert.equal(lycan?.acquisitionLabel, "Granted");

  await configureLycanForPurchase(state);
  await state.profiles.updateProfile("GrantOwner", { tokens: 2000 });
  await assert.rejects(
    state.buyStoreItem({
      username: "GrantOwner",
      type: "avatar",
      cosmeticId: "avatar_lycan_anubis",
      transactionId: "unique-acquisition-purchase-2"
    }),
    /Already Owned/
  );
  profile = await state.profiles.getProfile("GrantOwner");
  assert.equal(profile.uniqueCosmeticAcquisitions[LYCAN_KEY].source, "granted");
});

test("Unique acquisition: ledger backfill resolves purchase, grant, and legacy sources across restart", async () => {
  const dataDir = await createTempDataDir();
  const initial = new StateCoordinator({ dataDir });
  await giveLycanOwnership(initial, "VampyrLee");
  await giveLycanOwnership(initial, "CopyCell");
  await giveLycanOwnership(initial, "LegacyOwner");
  await initial.profiles.updateProfile("LegacyOwner", (profile) => ({
    ...profile,
    ownedCosmetics: {
      ...profile.ownedCosmetics,
      avatar: [...profile.ownedCosmetics.avatar, "fireavatarF"]
    }
  }));

  await initial.storePurchaseLedger.beginTransaction({
    transactionId: "unique-backfill-purchase-1",
    buyerUsername: "VampyrLee",
    cosmeticType: "avatar",
    cosmeticId: "avatar_lycan_anubis",
    price: 1500,
    timestamp: "2026-06-20T19:01:56.923Z"
  });
  await initial.storePurchaseLedger.finalizeTransaction({
    transactionId: "unique-backfill-purchase-1",
    status: "completed"
  });
  await initial.adminGrantStore.beginTransaction({
    transactionId: "unique-backfill-grant-1",
    timestamp: "2026-06-20T18:29:34.595Z",
    adminId: "admin",
    targetUsername: "CopyCell",
    grantType: "special_cosmetic_grant",
    payload: {
      cosmetic: {
        type: "avatar",
        cosmeticId: "avatar_lycan_anubis"
      }
    }
  });
  await initial.adminGrantStore.finalizeTransaction({
    transactionId: "unique-backfill-grant-1",
    status: "success"
  });

  const restarted = new StateCoordinator({ dataDir });
  await restarted.getCosmetics("VampyrLee");
  await restarted.getCosmetics("CopyCell");
  await restarted.getCosmetics("LegacyOwner");

  const vampyrLee = await restarted.profiles.getProfile("VampyrLee");
  const copyCell = await restarted.profiles.getProfile("CopyCell");
  const legacy = await restarted.profiles.getProfile("LegacyOwner");
  assert.equal(vampyrLee.uniqueCosmeticAcquisitions[LYCAN_KEY].source, "store_purchase");
  assert.ok(vampyrLee.uniqueCosmeticAcquisitions[LYCAN_KEY].acquiredAt);
  assert.equal(copyCell.uniqueCosmeticAcquisitions[LYCAN_KEY].source, "granted");
  assert.equal(
    copyCell.uniqueCosmeticAcquisitions[LYCAN_KEY].acquiredAt,
    "2026-06-20T18:29:34.595Z"
  );
  assert.deepEqual(legacy.uniqueCosmeticAcquisitions[LYCAN_KEY], {
    source: "legacy_unknown"
  });
  assert.equal("avatar:fireavatarF" in legacy.uniqueCosmeticAcquisitions, false);
  const legacyCosmetics = await restarted.getCosmetics("LegacyOwner");
  const legacyLycan = legacyCosmetics.catalog.avatar.find(
    (item) => item.id === "avatar_lycan_anubis"
  );
  const normalAvatar = legacyCosmetics.catalog.avatar.find((item) => item.id === "fireavatarF");
  assert.equal(legacyLycan?.acquisitionLabel, "Legacy / Unknown");
  assert.equal("acquisitionLabel" in normalAvatar, false);

  const secondRestart = new StateCoordinator({ dataDir });
  const reloaded = await secondRestart.profiles.getProfile("VampyrLee");
  assert.equal(reloaded.uniqueCosmeticAcquisitions[LYCAN_KEY].source, "store_purchase");

  const authority = new MultiplayerProfileAuthority({
    coordinator: secondRestart,
    logger: { info: () => {} }
  });
  const vampyrLeePublic = await authority.viewProfile("VampyrLee");
  const copyCellPublic = await authority.viewProfile("CopyCell");
  assert.equal(
    vampyrLeePublic.profile.trophyShelf.find((item) => item.id === "avatar_lycan_anubis")
      ?.acquisitionLabel,
    "Store Purchase"
  );
  assert.equal(
    copyCellPublic.profile.trophyShelf.find((item) => item.id === "avatar_lycan_anubis")
      ?.acquisitionLabel,
    "Granted"
  );
});

test("Unique acquisition: public payloads expose only the safe owner-specific label", async () => {
  const dataDir = await createTempDataDir();
  const coordinator = new StateCoordinator({ dataDir });
  await coordinator.profiles.ensureProfile("PrivateAcquisitionOwner");
  await coordinator.grantSpecialCosmetic({
    username: "PrivateAcquisitionOwner",
    type: "avatar",
    cosmeticId: "avatar_lycan_anubis"
  });
  await coordinator.specialCosmeticRegistry.upsertConfig({
    cosmeticId: "avatar_lycan_anubis",
    status: "assigned",
    assignmentStatus: "assigned",
    createdForUsername: "CopyCell",
    royalty: {
      enabled: true,
      recipientUsername: "PrivateRoyaltyRecipient",
      tokenPercent: 10
    },
    adminNotes: "private acquisition note"
  });
  const authority = new MultiplayerProfileAuthority({
    coordinator,
    logger: { info: () => {} }
  });

  const profilePayload = await authority.getProfile("PrivateAcquisitionOwner");
  const cosmeticsPayload = await authority.getCosmetics("PrivateAcquisitionOwner");
  const viewedProfilePayload = await authority.viewProfile("PrivateAcquisitionOwner");
  const storePayload = await authority.getStore("PrivateAcquisitionOwner");
  const grantPayload = await authority.grantSpecialCosmetic({
    username: "PrivateAcquisitionOwner",
    type: "avatar",
    cosmeticId: "avatar_lycan_anubis"
  });

  assert.equal("uniqueCosmeticAcquisitions" in profilePayload.profile, false);
  assert.equal("uniqueCosmeticAcquisitions" in profilePayload.cosmetics, false);
  assert.equal("uniqueCosmeticAcquisitions" in cosmeticsPayload, false);
  assert.equal("uniqueCosmeticAcquisitions" in grantPayload.profile, false);
  const cosmeticsLycan = cosmeticsPayload.catalog.avatar.find(
    (item) => item.id === "avatar_lycan_anubis"
  );
  const publicLycan = viewedProfilePayload.profile.trophyShelf.find(
    (item) => item.id === "avatar_lycan_anubis"
  );
  const storeLycan = storePayload.catalog.avatar.find(
    (item) => item.id === "avatar_lycan_anubis"
  );
  assert.equal(cosmeticsLycan?.acquisitionLabel, "Granted");
  assert.equal(publicLycan?.acquisitionLabel, "Granted");
  assert.equal(publicLycan?.createdForUsername, "CopyCell");
  assert.equal("acquisitionLabel" in (storeLycan ?? {}), false);

  for (const payload of [profilePayload, cosmeticsPayload, viewedProfilePayload, storePayload]) {
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("uniqueCosmeticAcquisitions"), false);
    assert.equal(serialized.includes("acquiredAt"), false);
    assert.equal(serialized.includes("store_purchase"), false);
    assert.equal(serialized.includes("legacy_unknown"), false);
    assert.equal(serialized.includes("PrivateRoyaltyRecipient"), false);
    assert.equal(serialized.includes("private acquisition note"), false);
  }
});
