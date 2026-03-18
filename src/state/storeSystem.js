import {
  COSMETIC_CATALOG,
  getCosmeticCatalogForProfile,
  getSupporterRewards,
  normalizeProfileCosmetics
} from "./cosmeticSystem.js";

export const DEFAULT_STARTING_TOKENS = 200;
const PURCHASE_FLAG_BY_TYPE = Object.freeze({
  avatar: "FIRST_AVATAR_PURCHASED",
  cardBack: "FIRST_CARD_BACK_PURCHASED",
  background: "FIRST_BACKGROUND_PURCHASED",
  elementCardVariant: "FIRST_CARD_VARIANT_PURCHASED"
});
const UNLOCK_FLAG_BY_TYPE = Object.freeze({
  title: "FIRST_TITLE_UNLOCKED",
  badge: "FIRST_BADGE_UNLOCKED"
});

function safeTokens(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_STARTING_TOKENS;
  }

  return Math.max(0, Math.floor(numeric));
}

export function createDefaultEconomyState() {
  return {
    tokens: DEFAULT_STARTING_TOKENS,
    supporterPass: false,
    testTokenGrantApplied: false,
    cosmeticUnlockTracking: {
      FIRST_AVATAR_PURCHASED: false,
      FIRST_CARD_BACK_PURCHASED: false,
      FIRST_BACKGROUND_PURCHASED: false,
      FIRST_CARD_VARIANT_PURCHASED: false,
      FIRST_TITLE_UNLOCKED: false,
      FIRST_BADGE_UNLOCKED: false,
      TOTAL_COSMETICS_OWNED: 0
    }
  };
}

function countOwnedCosmetics(ownedCosmetics = {}) {
  return Object.values(ownedCosmetics).reduce((total, values) => {
    return total + (Array.isArray(values) ? values.length : 0);
  }, 0);
}

function hasOwnedPurchasableItem(profile, type) {
  const owned = new Set(profile?.ownedCosmetics?.[type] ?? []);
  return (COSMETIC_CATALOG[type] ?? []).some((item) => item.purchasable && owned.has(item.id));
}

function hasOwnedUnlockedNonDefaultItem(profile, type) {
  const owned = new Set(profile?.ownedCosmetics?.[type] ?? []);
  return (COSMETIC_CATALOG[type] ?? []).some((item) => !item.defaultOwned && owned.has(item.id));
}

function buildCosmeticUnlockTracking(profile) {
  const stored = profile?.cosmeticUnlockTracking ?? {};
  const normalizedProfile = normalizeProfileCosmetics(profile ?? {});

  return {
    FIRST_AVATAR_PURCHASED:
      Boolean(stored.FIRST_AVATAR_PURCHASED) || hasOwnedPurchasableItem(normalizedProfile, "avatar"),
    FIRST_CARD_BACK_PURCHASED:
      Boolean(stored.FIRST_CARD_BACK_PURCHASED) || hasOwnedPurchasableItem(normalizedProfile, "cardBack"),
    FIRST_BACKGROUND_PURCHASED:
      Boolean(stored.FIRST_BACKGROUND_PURCHASED) || hasOwnedPurchasableItem(normalizedProfile, "background"),
    FIRST_CARD_VARIANT_PURCHASED:
      Boolean(stored.FIRST_CARD_VARIANT_PURCHASED) ||
      hasOwnedPurchasableItem(normalizedProfile, "elementCardVariant"),
    FIRST_TITLE_UNLOCKED:
      Boolean(stored.FIRST_TITLE_UNLOCKED) || hasOwnedUnlockedNonDefaultItem(normalizedProfile, "title"),
    FIRST_BADGE_UNLOCKED:
      Boolean(stored.FIRST_BADGE_UNLOCKED) || hasOwnedUnlockedNonDefaultItem(normalizedProfile, "badge"),
    TOTAL_COSMETICS_OWNED: countOwnedCosmetics(normalizedProfile.ownedCosmetics)
  };
}

function getTrackingMilestoneDiff(previous = {}, next = {}) {
  const unlockedMilestones = Object.keys(next).filter((key) => {
    if (key === "TOTAL_COSMETICS_OWNED") {
      return false;
    }
    return !previous[key] && Boolean(next[key]);
  });

  return {
    state: next,
    unlockedMilestones,
    totalOwnedDelta: Number(next.TOTAL_COSMETICS_OWNED ?? 0) - Number(previous.TOTAL_COSMETICS_OWNED ?? 0)
  };
}

export function normalizeProfileStore(profile) {
  const normalizedCosmetics = normalizeProfileCosmetics(profile);
  const defaults = createDefaultEconomyState();

  return {
    ...normalizedCosmetics,
    tokens: safeTokens(normalizedCosmetics.tokens ?? defaults.tokens),
    supporterPass: Boolean(normalizedCosmetics.supporterPass ?? defaults.supporterPass),
    testTokenGrantApplied: Boolean(
      normalizedCosmetics.testTokenGrantApplied ?? defaults.testTokenGrantApplied
    ),
    cosmeticUnlockTracking: buildCosmeticUnlockTracking({
      ...normalizedCosmetics,
      cosmeticUnlockTracking: normalizedCosmetics.cosmeticUnlockTracking ?? defaults.cosmeticUnlockTracking
    })
  };
}

export function buildStoreCatalog(profile) {
  const normalized = normalizeProfileStore(profile);
  const catalog = getCosmeticCatalogForProfile(normalized);
  return Object.fromEntries(
    Object.entries(catalog).map(([type, items]) => [type, items.filter((item) => !item.storeHidden)])
  );
}

export function getStoreViewForProfile(profile) {
  const normalized = normalizeProfileStore(profile);

  return {
    tokens: normalized.tokens,
    supporterPass: normalized.supporterPass,
    catalog: buildStoreCatalog(normalized)
  };
}

export function buyStoreItem(profile, { type, cosmeticId }) {
  const normalized = normalizeProfileStore(profile);
  const previousTracking = normalized.cosmeticUnlockTracking;
  const item = COSMETIC_CATALOG[type]?.find((entry) => entry.id === cosmeticId);

  if (!item) {
    throw new Error(`Store item not found for ${type}:${cosmeticId}.`);
  }

  if (normalized.ownedCosmetics[type]?.includes(cosmeticId)) {
    return {
      profile: normalized,
      purchase: {
        status: "already-owned",
        type,
        cosmeticId,
        price: 0,
        tokensLeft: normalized.tokens
      },
      tracking: getTrackingMilestoneDiff(previousTracking, previousTracking)
    };
  }

  if (!item.purchasable) {
    throw new Error(`Item '${cosmeticId}' is not purchasable.`);
  }

  const price = Number(item.price ?? 0);
  if (normalized.tokens < price) {
    throw new Error(`Insufficient tokens. Need ${price}, have ${normalized.tokens}.`);
  }

  const nextTrackingSeed = {
    ...previousTracking,
    [PURCHASE_FLAG_BY_TYPE[type]]: PURCHASE_FLAG_BY_TYPE[type]
      ? true
      : previousTracking?.[PURCHASE_FLAG_BY_TYPE[type]]
  };

  const updated = normalizeProfileStore({
    ...normalized,
    tokens: normalized.tokens - price,
    cosmeticUnlockTracking: nextTrackingSeed,
    ownedCosmetics: {
      ...normalized.ownedCosmetics,
      [type]: [...normalized.ownedCosmetics[type], cosmeticId]
    }
  });
  const tracking = getTrackingMilestoneDiff(previousTracking, updated.cosmeticUnlockTracking);

  return {
    profile: updated,
    purchase: {
      status: "purchased",
      type,
      cosmeticId,
      price,
      tokensLeft: updated.tokens
    },
    tracking
  };
}

export function grantSupporterPass(profile) {
  let normalized = normalizeProfileStore(profile);
  const granted = [];

  for (const reward of getSupporterRewards()) {
    if (!normalized.ownedCosmetics[reward.type].includes(reward.id)) {
      normalized = normalizeProfileStore({
        ...normalized,
        ownedCosmetics: {
          ...normalized.ownedCosmetics,
          [reward.type]: [...normalized.ownedCosmetics[reward.type], reward.id]
        }
      });

      granted.push(reward);
    }
  }

  normalized = normalizeProfileStore({
    ...normalized,
    supporterPass: true
  });

  return {
    profile: normalized,
    granted
  };
}
