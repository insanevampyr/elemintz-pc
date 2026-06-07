import {
  COSMETIC_CATALOG,
  getCosmeticDefinition,
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
const FOUNDER_REWARD_BUNDLE = Object.freeze([
  Object.freeze({ type: "title", cosmeticId: "Arena Founder" }),
  Object.freeze({ type: "badge", cosmeticId: "supporter_badge" }),
  Object.freeze({ type: "cardBack", cosmeticId: "founder_deluxe_card_back" })
]);

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
    Object.entries(catalog).map(([type, items]) => [
      type,
      items.filter((item) => !item.storeHidden && !item.rotationOnly && item.shopEligible !== false)
    ])
  );
}

export function buildFeaturedRotationCatalog(profile, { allowLimitedCosmeticIds = [] } = {}) {
  const normalized = normalizeProfileStore(profile);
  const catalog = getCosmeticCatalogForProfile(normalized);
  const allowedLimitedIds = new Set(
    (Array.isArray(allowLimitedCosmeticIds) ? allowLimitedCosmeticIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean)
  );

  return Object.fromEntries(
    Object.entries(catalog).map(([type, items]) => [
      type,
      items.filter(
        (item) =>
          !item.storeHidden &&
          item.shopEligible !== false &&
          (!item.rotationOnly || allowedLimitedIds.has(item.id))
      )
    ])
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

function normalizeStoreLookupInput({ type, cosmeticId, storeKey } = {}) {
  const safeStoreKey = String(storeKey ?? "").trim();
  const compositeSource =
    safeStoreKey ||
    (typeof type === "string" && type.includes(":") && !String(cosmeticId ?? "").trim()
      ? String(type).trim()
      : "");

  if (compositeSource) {
    const separatorIndex = compositeSource.indexOf(":");
    if (separatorIndex > 0 && separatorIndex < compositeSource.length - 1) {
      return {
        type: compositeSource.slice(0, separatorIndex).trim(),
        cosmeticId: compositeSource.slice(separatorIndex + 1).trim()
      };
    }
  }

  return {
    type: String(type ?? "").trim(),
    cosmeticId: String(cosmeticId ?? "").trim()
  };
}

export function buyStoreItem(profile, { type, cosmeticId }) {
  const normalized = normalizeProfileStore(profile);
  const previousTracking = normalized.cosmeticUnlockTracking;
  const { type: safeType, cosmeticId: safeCosmeticId } = normalizeStoreLookupInput({
    type,
    cosmeticId
  });
  const item = COSMETIC_CATALOG[safeType]?.find((entry) => entry.id === safeCosmeticId) ?? null;

  if (!item) {
    throw new Error(`Store item not found for ${safeType}:${safeCosmeticId}.`);
  }

  if (normalized.ownedCosmetics[safeType]?.includes(safeCosmeticId)) {
    return {
      profile: normalized,
      purchase: {
        status: "already-owned",
        type: safeType,
        cosmeticId: safeCosmeticId,
        price: 0,
        tokensLeft: normalized.tokens
      },
      tracking: getTrackingMilestoneDiff(previousTracking, previousTracking)
    };
  }

  if (!item.purchasable) {
    throw new Error(`Item '${cosmeticId}' is not purchasable.`);
  }

  if (item.storeHidden || item.rotationOnly) {
    throw new Error(`Store item not found for ${safeType}:${safeCosmeticId}.`);
  }

  const price = Number(item.price ?? 0);
  if (normalized.tokens < price) {
    throw new Error(`Insufficient tokens. Need ${price}, have ${normalized.tokens}.`);
  }

  const nextTrackingSeed = {
    ...previousTracking,
    [PURCHASE_FLAG_BY_TYPE[safeType]]: PURCHASE_FLAG_BY_TYPE[safeType]
      ? true
      : previousTracking?.[PURCHASE_FLAG_BY_TYPE[safeType]]
  };

  const updated = normalizeProfileStore({
    ...normalized,
    tokens: normalized.tokens - price,
    cosmeticUnlockTracking: nextTrackingSeed,
    ownedCosmetics: {
      ...normalized.ownedCosmetics,
      [safeType]: [...normalized.ownedCosmetics[safeType], safeCosmeticId]
    }
  });
  const tracking = getTrackingMilestoneDiff(previousTracking, updated.cosmeticUnlockTracking);

  return {
    profile: updated,
    purchase: {
      status: "purchased",
      type: safeType,
      cosmeticId: safeCosmeticId,
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

export function getFounderRewardBundle() {
  return FOUNDER_REWARD_BUNDLE.map((entry) => {
    const definition = getCosmeticDefinition(entry.type, entry.cosmeticId);
    return {
      type: entry.type,
      cosmeticId: entry.cosmeticId,
      displayName: definition?.name ?? `${entry.type}:${entry.cosmeticId}`
    };
  });
}

export function grantFounderStatus(profile) {
  let normalized = normalizeProfileStore(profile);
  const supporterPassWasActive = Boolean(normalized.supporterPass);
  const granted = [];
  const skipped = [];

  for (const reward of getFounderRewardBundle()) {
    const alreadyOwned = normalized.ownedCosmetics?.[reward.type]?.includes(reward.cosmeticId);
    if (alreadyOwned) {
      skipped.push(reward);
      continue;
    }

    normalized = normalizeProfileStore({
      ...normalized,
      ownedCosmetics: {
        ...normalized.ownedCosmetics,
        [reward.type]: [...normalized.ownedCosmetics[reward.type], reward.cosmeticId]
      }
    });
    granted.push(reward);
  }

  normalized = normalizeProfileStore({
    ...normalized,
    supporterPass: true
  });

  return {
    profile: normalized,
    founderStatusActive: Boolean(normalized.supporterPass),
    supporterPassActivated: !supporterPassWasActive && Boolean(normalized.supporterPass),
    granted,
    skipped
  };
}

export function grantCosmeticItem(profile, { type, cosmeticId }) {
  const normalized = normalizeProfileStore(profile);
  const previousTracking = normalized.cosmeticUnlockTracking;
  const item = COSMETIC_CATALOG[type]?.find((entry) => entry.id === cosmeticId);

  if (!item) {
    throw new Error(`Cosmetic item not found for ${type}:${cosmeticId}.`);
  }

  if (normalized.ownedCosmetics[type]?.includes(cosmeticId)) {
    throw new Error(`Cosmetic '${cosmeticId}' is already owned.`);
  }

  const updated = normalizeProfileStore({
    ...normalized,
    ownedCosmetics: {
      ...normalized.ownedCosmetics,
      [type]: [...normalized.ownedCosmetics[type], cosmeticId]
    }
  });
  const tracking = getTrackingMilestoneDiff(previousTracking, updated.cosmeticUnlockTracking);

  return {
    profile: updated,
    grant: {
      status: "granted",
      type,
      cosmeticId
    },
    tracking
  };
}
