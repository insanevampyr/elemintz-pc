import {
  COSMETIC_CATALOG,
  getCosmeticCollectionName,
  normalizeProfileCosmetics
} from "./cosmeticSystem.js";

export const COLLECTION_ALBUM_COSMETIC_TYPES = Object.freeze([
  "avatar",
  "cardBack",
  "background",
  "elementCardVariant",
  "badge",
  "title"
]);

const DEFAULT_ALBUM_ELIGIBILITY = Object.freeze({
  includeTypes: COLLECTION_ALBUM_COSMETIC_TYPES,
  excludeUnique: true,
  excludeGrantOnly: true,
  excludeStoreHidden: true
});

const ELEMENTAL_STREET_ITEMS = Object.freeze([
  Object.freeze({ type: "avatar", id: "avatar_fire_street_duelist" }),
  Object.freeze({ type: "avatar", id: "avatar_water_street_duelist" }),
  Object.freeze({ type: "avatar", id: "avatar_earth_street_duelist" }),
  Object.freeze({ type: "avatar", id: "avatar_wind_street_duelist" }),
  Object.freeze({ type: "title", id: "title_spark" }),
  Object.freeze({ type: "title", id: "title_drifter" }),
  Object.freeze({ type: "title", id: "title_stonehand" }),
  Object.freeze({ type: "title", id: "title_mistborn" }),
  Object.freeze({ type: "cardBack", id: "cardback_four_element_street_emblem" }),
  Object.freeze({ type: "elementCardVariant", id: "fire_variant_street" }),
  Object.freeze({ type: "elementCardVariant", id: "water_variant_street" }),
  Object.freeze({ type: "elementCardVariant", id: "earth_variant_street" }),
  Object.freeze({ type: "elementCardVariant", id: "wind_variant_street" })
]);

const COLLECTION_ALBUM_REWARD_TOKENS = Object.freeze({
  vampire_elegance: 150,
  lycan_power: 150,
  goldbound_relics: 200,
  frostveil_court: 200,
  neon_arcana: 200,
  crownfire: 250,
  elemental_street: 150,
  celestial: 200,
  cutesy: 150,
  ember: 100,
  gothic_corruption: 100,
  lucky: 100,
  void: 150,
  velvet_rose: 75
});

function createTokenRewardPreview(albumId) {
  const tokens = COLLECTION_ALBUM_REWARD_TOKENS[albumId];
  return tokens > 0
    ? Object.freeze({
        type: "tokens",
        amount: tokens,
        label: `${tokens} Tokens`,
        rewardId: `collection_album_${albumId}_complete_tokens`
      })
    : null;
}

export const COLLECTION_ALBUM_DEFINITIONS = Object.freeze([
  Object.freeze({
    albumId: "vampire_elegance",
    name: "Vampire Elegance",
    description: "Blood-gem card backs and winged elemental variants.",
    collectionKey: "Vampire Elegance",
    rewardPreview: createTokenRewardPreview("vampire_elegance"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "lycan_power",
    name: "Lycan Power",
    description: "Pack-themed avatars, arena art, and elemental wolf variants.",
    collectionKey: "Lycan Power",
    rewardPreview: createTokenRewardPreview("lycan_power"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "goldbound_relics",
    name: "Goldbound Relics",
    description: "Aurelian cosmetics and gilded elemental variants.",
    collectionKey: "Goldbound Relics",
    rewardPreview: createTokenRewardPreview("goldbound_relics"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "frostveil_court",
    name: "Frostveil Court",
    description: "Frostveil court cosmetics and aurora elemental variants.",
    collectionKey: "Frostveil Court",
    rewardPreview: createTokenRewardPreview("frostveil_court"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "neon_arcana",
    name: "Neon Arcana",
    description: "Neon entities, spellwired styling, and arcane variants.",
    collectionKey: "Neon Arcana",
    rewardPreview: createTokenRewardPreview("neon_arcana"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "crownfire",
    name: "Crownfire",
    description: "Featured Rival cosmetics from the Flame King collection.",
    collectionKey: "Flame King",
    rewardPreview: createTokenRewardPreview("crownfire"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "elemental_street",
    name: "Elemental Street",
    description: "Street-duelist cosmetics for all four elements.",
    items: ELEMENTAL_STREET_ITEMS,
    rewardPreview: createTokenRewardPreview("elemental_street"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "celestial",
    name: "Celestial",
    description: "Starbound avatars, titles, and cosmic backdrops.",
    collectionKey: "Celestial",
    rewardPreview: createTokenRewardPreview("celestial"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "cutesy",
    name: "Cutesy",
    description: "Bright, playful cosmetics and cheerful elemental variants.",
    collectionKey: "Cutesy",
    rewardPreview: createTokenRewardPreview("cutesy"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "ember",
    name: "Ember",
    description: "Smoldering fire-themed cosmetics and molten variants.",
    collectionKey: "Ember",
    rewardPreview: createTokenRewardPreview("ember"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "gothic_corruption",
    name: "Gothic Corruption",
    description: "Dark gothic cosmetics with corrupted elemental styling.",
    collectionKey: "Gothic Corruption",
    rewardPreview: createTokenRewardPreview("gothic_corruption"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "lucky",
    name: "Lucky",
    description: "Chance-touched avatars and card backs.",
    collectionKey: "Lucky",
    rewardPreview: createTokenRewardPreview("lucky"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "void",
    name: "Void",
    description: "Abyssal cosmetics from the edge of the elements.",
    collectionKey: "Void",
    rewardPreview: createTokenRewardPreview("void"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  }),
  Object.freeze({
    albumId: "velvet_rose",
    name: "Velvet & Rose",
    description: "Elegant rose-themed profile cosmetics.",
    collectionKey: "Velvet & Rose",
    rewardPreview: createTokenRewardPreview("velvet_rose"),
    eligibility: DEFAULT_ALBUM_ELIGIBILITY
  })
]);

export function normalizeCollectionAlbumRewardClaims(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  for (const [rawAlbumId, rawClaim] of Object.entries(value)) {
    const albumId = String(rawAlbumId ?? "").trim();
    if (!albumId || !rawClaim || typeof rawClaim !== "object" || Array.isArray(rawClaim)) {
      continue;
    }

    const rewardId = String(rawClaim.rewardId ?? "").trim();
    const parsedClaimedAt = Date.parse(String(rawClaim.claimedAt ?? "").trim());
    if (!rewardId || !Number.isFinite(parsedClaimedAt)) {
      continue;
    }

    normalized[albumId] = {
      claimedAt: new Date(parsedClaimedAt).toISOString(),
      rewardId
    };
  }

  return normalized;
}

function cloneAlbumDefinition(definition) {
  return {
    ...definition,
    eligibility: {
      ...DEFAULT_ALBUM_ELIGIBILITY,
      ...(definition?.eligibility ?? {}),
      includeTypes: [
        ...new Set([
          ...((definition?.eligibility?.includeTypes ?? DEFAULT_ALBUM_ELIGIBILITY.includeTypes)
            .map((type) => String(type ?? "").trim())
            .filter(Boolean))
        ])
      ]
    },
    items: Array.isArray(definition?.items)
      ? definition.items.map((item) => ({ type: item.type, id: item.id }))
      : undefined
  };
}

export function getCollectionAlbumDefinitions() {
  return COLLECTION_ALBUM_DEFINITIONS.map(cloneAlbumDefinition);
}

function getCatalogItem(catalog, type, id) {
  if (!COLLECTION_ALBUM_COSMETIC_TYPES.includes(type) || !id) {
    return null;
  }
  const entries = Array.isArray(catalog?.[type]) ? catalog[type] : [];
  return entries.find((item) => item?.id === id) ?? null;
}

function isAlbumItemEligible(type, item, eligibility = DEFAULT_ALBUM_ELIGIBILITY) {
  if (!COLLECTION_ALBUM_COSMETIC_TYPES.includes(type) || !item?.id) {
    return false;
  }
  const includeTypes = Array.isArray(eligibility.includeTypes)
    ? eligibility.includeTypes
    : DEFAULT_ALBUM_ELIGIBILITY.includeTypes;
  if (!includeTypes.includes(type)) {
    return false;
  }
  if (eligibility.excludeUnique !== false && item.rarity === "Unique") {
    return false;
  }
  if (eligibility.excludeGrantOnly !== false && item.grantOnly === true) {
    return false;
  }
  if (eligibility.excludeStoreHidden !== false && item.storeHidden === true) {
    return false;
  }
  return true;
}

function resolveAlbumDefinition(albumId, definitions = COLLECTION_ALBUM_DEFINITIONS) {
  const safeAlbumId = String(albumId ?? "").trim();
  if (!safeAlbumId) {
    return null;
  }
  return definitions.find((definition) => definition?.albumId === safeAlbumId) ?? null;
}

function resolveAlbumCatalogItems(definition, catalog = COSMETIC_CATALOG) {
  if (!definition || typeof definition !== "object") {
    return [];
  }

  const eligibility = {
    ...DEFAULT_ALBUM_ELIGIBILITY,
    ...(definition.eligibility ?? {})
  };
  const seen = new Set();
  const items = [];
  const pushItem = (type, item) => {
    if (!isAlbumItemEligible(type, item, eligibility)) {
      return;
    }
    const key = `${type}:${item.id}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({ type, item });
  };

  if (Array.isArray(definition.items)) {
    for (const reference of definition.items) {
      const type = String(reference?.type ?? "").trim();
      const id = String(reference?.id ?? "").trim();
      const item = getCatalogItem(catalog, type, id);
      pushItem(type, item);
    }
    return items;
  }

  const collectionKey = String(definition.collectionKey ?? "").trim();
  if (!collectionKey) {
    return [];
  }

  for (const type of COLLECTION_ALBUM_COSMETIC_TYPES) {
    const entries = Array.isArray(catalog?.[type]) ? catalog[type] : [];
    for (const item of entries) {
      if (getCosmeticCollectionName(type, item) === collectionKey) {
        pushItem(type, item);
      }
    }
  }

  return items;
}

function buildOwnedLookup(profile, catalog = COSMETIC_CATALOG) {
  if (catalog !== COSMETIC_CATALOG) {
    const ownedCosmetics =
      profile?.ownedCosmetics && typeof profile.ownedCosmetics === "object" && !Array.isArray(profile.ownedCosmetics)
        ? profile.ownedCosmetics
        : {};
    return Object.fromEntries(
      COLLECTION_ALBUM_COSMETIC_TYPES.map((type) => {
        const catalogIds = new Set(
          (Array.isArray(catalog?.[type]) ? catalog[type] : []).map((item) => item?.id).filter(Boolean)
        );
        const ownedIds = Array.isArray(ownedCosmetics[type]) ? ownedCosmetics[type] : [];
        return [type, new Set(ownedIds.filter((id) => catalogIds.has(id)))];
      })
    );
  }

  const normalized = normalizeProfileCosmetics(profile ?? {});
  return Object.fromEntries(
    COLLECTION_ALBUM_COSMETIC_TYPES.map((type) => [
      type,
      new Set(Array.isArray(normalized.ownedCosmetics?.[type]) ? normalized.ownedCosmetics[type] : [])
    ])
  );
}

function getRewardState(definition, completed, profile) {
  if (!definition?.rewardPreview) {
    return "none";
  }
  const claims = normalizeCollectionAlbumRewardClaims(profile?.collectionAlbumRewardClaims);
  if (claims[definition.albumId]) {
    return "claimed";
  }
  return completed ? "claimable" : "locked";
}

export function claimCollectionAlbumReward(profile, albumId, { now = new Date() } = {}) {
  const definition = resolveAlbumDefinition(albumId);
  if (!definition) {
    throw new Error("Unknown Collection Album.");
  }
  if (definition?.rewardPreview?.type !== "tokens" || !(definition.rewardPreview.amount > 0)) {
    throw new Error("This Collection Album has no reward to claim.");
  }

  const detail = buildCollectionAlbumDetail(profile, definition.albumId);
  if (!detail?.completed) {
    throw new Error("Complete this Collection Album before claiming its reward.");
  }
  if (detail.rewardState === "claimed") {
    return {
      profile,
      reward: null,
      duplicate: true,
      album: detail
    };
  }

  const claimedAt = new Date(now).toISOString();
  const rewardId = definition.rewardPreview.rewardId;
  const nextProfile = {
    ...profile,
    tokens: Math.max(0, Number(profile?.tokens ?? 0) || 0) + definition.rewardPreview.amount,
    collectionAlbumRewardClaims: {
      ...normalizeCollectionAlbumRewardClaims(profile?.collectionAlbumRewardClaims),
      [definition.albumId]: {
        claimedAt,
        rewardId
      }
    }
  };

  return {
    profile: nextProfile,
    reward: {
      type: "tokens",
      amount: definition.rewardPreview.amount,
      rewardId,
      claimedAt
    },
    duplicate: false,
    album: buildCollectionAlbumDetail(nextProfile, definition.albumId)
  };
}

function buildAlbumBaseReadModel(definition, profile, { catalog = COSMETIC_CATALOG } = {}) {
  if (!definition || typeof definition !== "object") {
    return null;
  }
  const resolvedItems = resolveAlbumCatalogItems(definition, catalog);
  const ownedLookup = buildOwnedLookup(profile, catalog);
  const totalCount = resolvedItems.length;
  const ownedCount = resolvedItems.reduce(
    (count, { type, item }) => count + (ownedLookup[type]?.has(item.id) ? 1 : 0),
    0
  );
  const percentComplete = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
  const completed = totalCount > 0 && ownedCount === totalCount;
  const rewardPreview = definition.rewardPreview ?? null;
  const rewardState = getRewardState(definition, completed, profile);

  return {
    albumId: definition.albumId,
    name: definition.name,
    description: definition.description ?? "",
    ownedCount,
    totalCount,
    percentComplete,
    completed,
    rewardState,
    rewardPreview,
    resolvedItems,
    ownedLookup
  };
}

export function buildCollectionAlbumSummaries(
  profile,
  { definitions = COLLECTION_ALBUM_DEFINITIONS, catalog = COSMETIC_CATALOG } = {}
) {
  return definitions
    .map((definition) => buildAlbumBaseReadModel(definition, profile, { catalog }))
    .filter(Boolean)
    .map(({ resolvedItems: _resolvedItems, ownedLookup: _ownedLookup, ...summary }) => summary);
}

export function buildOwnCollectionAlbumsView(
  profile,
  { definitions = COLLECTION_ALBUM_DEFINITIONS, catalog = COSMETIC_CATALOG } = {}
) {
  return {
    summaries: buildCollectionAlbumSummaries(profile, { definitions, catalog })
  };
}

export function buildPublicCollectionAlbumsSummary(
  profile,
  { definitions = COLLECTION_ALBUM_DEFINITIONS, catalog = COSMETIC_CATALOG } = {}
) {
  const summaries = buildCollectionAlbumSummaries(profile, { definitions, catalog });
  const completed = summaries
    .filter((summary) => summary.completed)
    .map((summary) => ({
      albumId: summary.albumId,
      name: summary.name,
      completed: true
    }));

  return {
    completedCount: completed.length,
    totalCount: summaries.length,
    completed
  };
}

export function buildCollectionAlbumDetail(
  profile,
  albumId,
  { definitions = COLLECTION_ALBUM_DEFINITIONS, catalog = COSMETIC_CATALOG } = {}
) {
  const definition = resolveAlbumDefinition(albumId, definitions);
  const base = buildAlbumBaseReadModel(definition, profile, { catalog });
  if (!base) {
    return null;
  }

  const items = base.resolvedItems.map(({ type, item }) => {
    const owned = Boolean(base.ownedLookup[type]?.has(item.id));
    return {
      type,
      id: item.id,
      name: item.name ?? item.id,
      rarity: item.rarity ?? "Common",
      collection: getCosmeticCollectionName(type, item) || null,
      image: item.image ?? null,
      ...(item.element ? { element: item.element } : {}),
      owned,
      missing: !owned
    };
  });

  const { resolvedItems: _resolvedItems, ownedLookup: _ownedLookup, ...summary } = base;
  return {
    ...summary,
    items
  };
}
