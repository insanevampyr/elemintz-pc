import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  calculateCollectionPackPriceForOwnedCosmetics,
  CollectionPackStore,
  DEFAULT_COLLECTION_PACK_DISCOUNT_PERCENT,
  resolveCollectionPackCosmetic,
  validateCollectionPackDraft
} from "../../src/state/collectionPackStore.js";

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

test("collection packs: valid normal pack definition passes with default discount", () => {
  const normalized = validateCollectionPackDraft(basePack());

  assert.equal(normalized.packId, "classic_avatar_pack");
  assert.equal(normalized.discountPercent, DEFAULT_COLLECTION_PACK_DISCOUNT_PERCENT);
  assert.equal(normalized.saleLimitMode, "unlimited");
  assert.equal(normalized.saleLimitTotal, null);
  assert.equal(normalized.soldCount, 0);
  assert.deepEqual(normalized.cosmeticIds, ["fireavatarF", "wateravatarF"]);
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
