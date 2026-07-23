import { getArenaBackground, getAvatarImage, getBadgeImage, getCardBackImage, getVariantCardImages } from "../../utils/assets.js";
import { getAssetPath } from "../../utils/dom.js";
import { buildAchievementCatalog } from "../../../state/achievementSystem.js";
import {
  getCosmeticDisplayName,
  getCosmeticDefinition,
  getCosmeticHoverMetadata,
  getCosmeticCatalogForProfile,
  normalizeProfileShowcaseSlots,
  normalizeUniqueCosmeticAcquisitionLabel,
  resolveProfileShowcaseSlots
} from "../../../state/cosmeticSystem.js";
import {
  bindCosmeticHoverPreview,
  buildHoverPreviewAttributes,
  hasRenderablePreviewSource
} from "../shared/cosmeticHoverPreview.js";
import { buildThemedSurfaceClassName } from "../shared/themedSurfaceShared.js";
import { getLevelProgress, MAX_LEVEL } from "../../../state/levelRewardsSystem.js";
import { buildCollectionAlbumDetail } from "../../../state/collectionAlbums.js";

const REFERRAL_CODE_PATTERN = /^ELM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const REFERRAL_INVITE_URL = "https://vampyrlee.itch.io/elemintz";

function escapeProfileText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeReferralCodeForDisplay(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : null;
}

function resolveImagePath(image) {
  if (!image) {
    return null;
  }

  const value = String(image);
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("../") ||
    value.startsWith("./") ||
    value.includes("/assets/") ||
    value.startsWith("assets/")
  ) {
    return value;
  }

  return getAssetPath(value);
}

function renderTitleLine(titleText, titleIcon, featuredBadge, options = {}) {
  const icon = resolveImagePath(titleIcon);
  const badge = resolveImagePath(featuredBadge);
  const titleDefinition = options.titleId ? getCosmeticDefinition("title", options.titleId) : null;
  const canonicalTitleImage = titleDefinition?.image ? resolveImagePath(titleDefinition.image) : null;
  const titleDisplaySrc = hasRenderablePreviewSource(icon, {
    previewName: titleText,
    previewVisualText: titleText
  })
    ? icon
    : hasRenderablePreviewSource(canonicalTitleImage, {
        previewName: titleText,
        previewVisualText: titleText
      })
      ? canonicalTitleImage
      : null;
  const titlePreviewSrc = hasRenderablePreviewSource(canonicalTitleImage, {
    previewName: titleText,
    previewVisualText: titleText
  })
    ? canonicalTitleImage
    : null;
  const badgeDisplaySrc = hasRenderablePreviewSource(badge, {
    previewName: "Featured Badge"
  })
    ? badge
    : null;
  const titleHoverMetadata = getCosmeticHoverMetadata("title", options.titleId, titleText);
  const titleHoverAttributes = buildHoverPreviewAttributes({
    previewType: "title",
    previewSrc: titlePreviewSrc,
    previewName: titleHoverMetadata.name ?? titleText,
    previewDescription: titleHoverMetadata.description,
    previewVisualText: titleText,
    previewRarity: titleHoverMetadata.rarity
  });
  const badgeHoverMetadata = badgeDisplaySrc
    ? getCosmeticHoverMetadata("badge", options.badgeId, "Featured Badge")
    : null;
  const badgeHoverAttributes = badgeDisplaySrc
    ? buildHoverPreviewAttributes({
        previewType: "badge",
        previewSrc: badgeDisplaySrc,
        previewName: badgeHoverMetadata?.name ?? "Featured Badge",
        previewDescription: badgeHoverMetadata?.description ?? "",
        previewRarity: badgeHoverMetadata?.rarity ?? "Common"
      })
    : "";

  return `
    <p class="player-title">
      <span class="player-title-preview" ${titleHoverAttributes}>${titleDisplaySrc ? `<img class="title-icon" src="${titleDisplaySrc}" alt="${titleText}" />` : ""}<span>${titleText}</span></span>
      ${badgeDisplaySrc ? `<img class="featured-badge" src="${badgeDisplaySrc}" alt="Featured Badge" ${badgeHoverAttributes} />` : ""}
    </p>
  `;
}

function renderAchievement(achievement) {
  const image = resolveImagePath(achievement.image);

  return `
    <article class="achievement-card unlocked">
      ${image ? `<img src="${image}" alt="${achievement.name}" class="achievement-badge" />` : '<div class="achievement-badge missing">No Badge</div>'}
      <div>
        <p><strong>${achievement.name}</strong></p>
        <p>${achievement.description}</p>
        ${achievement.repeatable ? `<p>Repeat Count: ${achievement.count}</p>` : ""}
      </div>
    </article>
  `;
}

function getTitleCatalogIcon(cosmetics, equippedTitleId) {
  const titleItems = cosmetics?.catalog?.title;
  if (!Array.isArray(titleItems) || !equippedTitleId) {
    return null;
  }

  const titleItem = titleItems.find((item) => item.id === equippedTitleId);
  return titleItem?.image ?? null;
}

function viewedTitleIcon(viewedProfile) {
  const equippedTitleId = viewedProfile?.equippedCosmetics?.title ?? null;
  const titleDefinition = equippedTitleId ? getCosmeticDefinition("title", equippedTitleId) : null;
  if (titleDefinition?.image) {
    return titleDefinition.image;
  }

  const title = getCosmeticDisplayName("title", equippedTitleId, viewedProfile?.title ?? "Initiate");
  const iconMap = {
    "Flame Vanguard": "badges/firstFlame.png",
    "Arena Founder": "badges/earlyTester.png",
    "Token Tycoon": "badges/collector.png",
    "Apprentice": "badges/firstFlame.png",
    "Elementalist": "badges/elementalConqueror.png",
    "War Master": "badges/warMachine.png",
    "Element Sovereign": "badges/elementalMaster.png",
    "Master of EleMintz": "badges/elementalOverlord.png",
    "Storm Breaker": "badges/badge_longest_war_7.png",
    "Last Card Legend": "badges/badge_comeback_win_25.png"
  };

  return iconMap[title] ?? null;
}

function safeStat(value) {
  return Math.max(0, Number(value ?? 0));
}

const FLEX_VARIANT_ORDER = Object.freeze(["fire", "earth", "wind", "water"]);
const TROPHY_SHELF_LIMIT = 3;
const PROFILE_SHOWCASE_SLOT_COUNT = 3;
const TROPHY_RARITY_RANK = Object.freeze({
  Unique: 0,
  Legendary: 1,
  Epic: 2,
  Rare: 3,
  Common: 4
});
const TROPHY_TYPE_LABELS = Object.freeze({
  avatar: "Avatar",
  title: "Title",
  badge: "Badge",
  background: "Background",
  cardBack: "Card Back"
});

function titleCase(value) {
  const safeValue = String(value ?? "").trim().toLowerCase();
  return safeValue ? `${safeValue[0].toUpperCase()}${safeValue.slice(1)}` : "";
}

function defaultVariantName(element) {
  const label = titleCase(element);
  return label ? `Default ${label}` : "Default";
}

function formatLongestMatchMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  switch (mode) {
    case "online_pvp":
      return "Online";
    case "local_pvp":
      return "Local PvP";
    case "featured_rival":
      return "Featured Rival";
    case "gauntlet":
      return "Gauntlet";
    case "blood_match":
      return "Blood Match";
    case "pve":
      return "PvE";
    default:
      return "";
  }
}

function formatLongestMatchResult(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "timer_win":
      return "Timer Win";
    case "timer_loss":
      return "Timer Loss";
    case "timer_draw":
      return "Timer Draw";
    case "local_pvp":
      return "Local PvP";
    default:
      return normalized ? normalized.split("_").map(titleCase).join(" ") : "";
  }
}

function renderLongestMatchSummary(profile = {}) {
  const longestMatch = profile?.longestMatch;
  if (!longestMatch || typeof longestMatch !== "object") {
    return `<div class="profile-longest-match-empty" data-profile-longest-match-empty="true">No record yet</div>`;
  }

  const rounds = Math.max(0, Number(longestMatch.rounds ?? 0) || 0);
  if (!rounds) {
    return `<div class="profile-longest-match-empty" data-profile-longest-match-empty="true">No record yet</div>`;
  }

  const details = [];
  const modeLabel = formatLongestMatchMode(longestMatch.mode);
  const opponentName = String(longestMatch.opponentName ?? "").trim();
  const resultLabel = formatLongestMatchResult(longestMatch.result);
  const capturedFor =
    longestMatch.capturedFor == null ? null : Math.max(0, Number(longestMatch.capturedFor ?? 0) || 0);
  const capturedAgainst =
    longestMatch.capturedAgainst == null ? null : Math.max(0, Number(longestMatch.capturedAgainst ?? 0) || 0);

  if (modeLabel) {
    details.push({ label: "Mode", value: modeLabel });
  }
  if (opponentName) {
    details.push({ label: "Opponent", value: opponentName });
  }
  if (resultLabel) {
    details.push({ label: "Result", value: resultLabel });
  }
  if (capturedFor != null && capturedAgainst != null) {
    details.push({ label: "Captured", value: `${capturedFor} - ${capturedAgainst}` });
  }

  return `
    <div class="profile-longest-match" data-profile-longest-match="true">
      <strong class="profile-longest-match-rounds">${rounds} Rounds</strong>
      ${
        details.length > 0
          ? `<div class="profile-longest-match-details">
              ${details
                .map(
                  (item) => `
                    <div class="profile-longest-match-row">
                      <span class="profile-stat-label">${item.label}</span>
                      <strong class="profile-stat-value">${item.value}</strong>
                    </div>
                  `
                )
                .join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

function getTrophyTypeLabel(type, definition = {}) {
  if (type === "elementCardVariant") {
    const elementLabel = titleCase(definition?.element);
    return elementLabel ? `${elementLabel} Variant` : "Variant";
  }

  return TROPHY_TYPE_LABELS[type] ?? "Cosmetic";
}

function getTrophySourceCatalog(profile = {}, catalogOverride = null) {
  if (catalogOverride && typeof catalogOverride === "object") {
    return catalogOverride;
  }

  return getCosmeticCatalogForProfile(profile);
}

export function selectTrophyShelfItems(profile = {}, options = {}) {
  const limit = Math.max(0, Number(options.limit ?? TROPHY_SHELF_LIMIT) || 0);
  if (limit === 0) {
    return [];
  }

  if (Array.isArray(profile?.trophyShelf)) {
    return profile.trophyShelf.slice(0, limit).map((item) => ({
      id: item?.id ?? null,
      type: item?.type ?? "cosmetic",
      name: item?.name ?? item?.id ?? "Cosmetic",
      rarity: titleCase(item?.rarity) || "Common",
      typeLabel: item?.typeLabel ?? getTrophyTypeLabel(item?.type, item),
      image: item?.image ?? null,
      collection: item?.collection ?? null,
      createdForUsername: String(item?.createdForUsername ?? "").trim() || null,
      acquisitionLabel: normalizeUniqueCosmeticAcquisitionLabel(item?.acquisitionLabel),
      equipped: Boolean(item?.equipped)
    }));
  }

  const sourceCatalog = getTrophySourceCatalog(profile, options.catalog ?? null);
  const selected = [];
  const seenKeys = new Set();

  for (const [type, entries] of Object.entries(sourceCatalog ?? {})) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (!entry?.owned || !entry?.id || entry?.defaultOwned) {
        continue;
      }

      const dedupeKey = `${type}:${entry.id}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      const name = entry.name ?? getCosmeticDisplayName(type, entry.id, entry.id);
      const rarity = titleCase(entry.rarity) || "Common";
      const typeLabel = getTrophyTypeLabel(type, entry);

      if (!name && !entry.image) {
        continue;
      }

      selected.push({
        id: entry.id,
        type,
        name: name ?? entry.id,
        rarity,
        rarityRank: TROPHY_RARITY_RANK[rarity] ?? TROPHY_RARITY_RANK.Common,
        typeLabel,
        image: entry.image ?? null,
        collection: entry.collection ?? null,
        createdForUsername: String(entry.createdForUsername ?? "").trim() || null,
        acquisitionLabel: normalizeUniqueCosmeticAcquisitionLabel(entry.acquisitionLabel),
        equipped: Boolean(entry.equipped)
      });
    }
  }

  return selected
    .sort((left, right) => {
      if (left.rarityRank !== right.rarityRank) {
        return left.rarityRank - right.rarityRank;
      }
      if (left.equipped !== right.equipped) {
        return left.equipped ? -1 : 1;
      }

      const nameComparison = left.name.localeCompare(right.name);
      if (nameComparison !== 0) {
        return nameComparison;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);
}

function normalizeProfileEquippedCosmetics(profile = {}) {
  const equipped = profile?.equippedCosmetics ?? {};
  return {
    avatar: equipped?.avatar ?? "default_avatar",
    title: equipped?.title ?? null,
    badge: equipped?.badge ?? "none",
    cardBack: equipped?.cardBack ?? "default_card_back",
    background: equipped?.background ?? "default_background",
    elementCardVariant: equipped?.elementCardVariant ?? {}
  };
}

function resolveTitleImagePath(titleId, fallbackIcon = null) {
  const definition = titleId ? getCosmeticDefinition("title", titleId) : null;
  if (definition?.image) {
    return resolveImagePath(definition.image);
  }

  return resolveImagePath(fallbackIcon);
}

function buildCardStyleHoverAttributes({ type, id, imageSrc, fallbackName, fallbackVisualText = null } = {}) {
  const safeType = String(type ?? "").trim();
  const safeName = String(fallbackName ?? "").trim() || "Preview";
  const resolvedImage = hasRenderablePreviewSource(imageSrc, {
    previewName: safeName,
    previewVisualText: fallbackVisualText ?? safeName
  })
    ? imageSrc
    : null;
  const hoverMetadata = getCosmeticHoverMetadata(safeType, id, safeName);
  return buildHoverPreviewAttributes({
    previewType: safeType,
    previewSrc: resolvedImage,
    previewName: hoverMetadata.name ?? safeName,
    previewDescription: hoverMetadata.description,
    previewVisualText: fallbackVisualText ?? safeName,
    previewRarity: hoverMetadata.rarity
  });
}

function buildTrophyHoverAttributes(item = {}) {
  const safeName = String(item?.name ?? "").trim() || "Cosmetic";
  const imageSrc = resolveImagePath(item?.image);
  const resolvedImage = hasRenderablePreviewSource(imageSrc, {
    previewName: safeName,
    previewVisualText: safeName
  })
    ? imageSrc
    : null;
  const hoverMetadata = getCosmeticHoverMetadata(item.type, item.id, safeName);
  const uniqueHoverDetails =
    item.rarity === "Unique"
      ? [
          item.createdForUsername ? `Created For: ${item.createdForUsername}` : null,
          item.acquisitionLabel ? `Acquired: ${item.acquisitionLabel}` : null
        ].filter(Boolean)
      : [];

  return buildHoverPreviewAttributes({
    previewType: item.type,
    previewSrc: resolvedImage,
    previewName: hoverMetadata.name ?? safeName,
    previewDescription: [hoverMetadata.description, ...uniqueHoverDetails]
      .filter(Boolean)
      .join(" · "),
    previewVisualText: safeName,
    previewRarity: hoverMetadata.rarity ?? item.rarity ?? "Common"
  });
}

function normalizeShowcaseDisplayItem(item = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const type = String(item.type ?? "").trim();
  const id = String(item.id ?? "").trim();
  if (!type || !id) {
    return null;
  }

  const name = String(item.name ?? getCosmeticDisplayName(type, id, id) ?? id).trim();
  const rarity = titleCase(item.rarity) || "Common";
  const element = type === "elementCardVariant" ? titleCase(item.element) : "";

  return {
    id,
    type,
    name: name || id,
    rarity,
    typeLabel: getTrophyTypeLabel(type, item),
    image: item.image ?? null,
    collection: item.collection ?? null,
    element: element || null
  };
}

function selectOwnShowcaseItems(profile = {}, options = {}) {
  const sourceCatalog = options.catalog && typeof options.catalog === "object"
    ? options.catalog
    : getCosmeticCatalogForProfile(profile);
  return resolveProfileShowcaseSlots(profile, { catalog: sourceCatalog }).map((item) =>
    normalizeShowcaseDisplayItem(item)
  );
}

function selectPublicShowcaseItems(profile = {}) {
  const sourceSlots = Array.isArray(profile?.showcaseSlots) ? profile.showcaseSlots : [];
  return Array.from({ length: PROFILE_SHOWCASE_SLOT_COUNT }, (_, index) =>
    normalizeShowcaseDisplayItem(sourceSlots[index])
  );
}

const RECENT_OPPONENTS_UI_LIMIT = 15;

function formatRecentOpponentRelativeTime(lastCompletedAt, nowMs = Date.now()) {
  const completedMs = Date.parse(String(lastCompletedAt ?? "").trim());
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (!Number.isFinite(completedMs)) {
    return "Recently";
  }

  const elapsedMs = Math.max(0, safeNowMs - completedMs);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 1) {
    return "Just now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) {
    return "Yesterday";
  }

  return `${elapsedDays}d ago`;
}

function formatRecentOpponentResult(result) {
  if (result === "win") {
    return "Won";
  }
  if (result === "loss") {
    return "Lost";
  }
  if (result === "draw") {
    return "Draw";
  }
  return "Result unknown";
}

function normalizeRecentOpponentDisplayEntry(entry = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const opponentProfileKey = String(entry.opponentProfileKey ?? "").trim();
  if (!opponentProfileKey) {
    return null;
  }

  const displayName =
    String(entry.displayName ?? entry.opponentUsername ?? "").trim() || "Unknown opponent";
  const avatarId = String(entry.displayCosmetics?.avatar ?? "").trim() || "default_avatar";
  const titleId = String(entry.displayCosmetics?.title ?? "").trim();
  const title = titleId ? getCosmeticDisplayName("title", titleId, titleId) : "No title shown";

  return {
    opponentProfileKey,
    displayName,
    avatarSrc: getAvatarImage(avatarId),
    title,
    latestResult: formatRecentOpponentResult(entry.latestResult),
    lastCompletedAt: entry.lastCompletedAt
  };
}

function getRecentOpponentRows(profile = {}) {
  const entries = Array.isArray(profile?.recentOpponents) ? profile.recentOpponents : [];
  return entries
    .slice(0, RECENT_OPPONENTS_UI_LIMIT)
    .map((entry) => normalizeRecentOpponentDisplayEntry(entry))
    .filter(Boolean);
}

function renderRecentOpponentRows(profile = {}, options = {}) {
  const rows = getRecentOpponentRows(profile);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();

  if (!rows.length) {
    return `<p class="text-muted profile-recent-opponents-empty" data-recent-opponents-empty="true">No recent online opponents yet.</p>`;
  }

  return `
    <div class="profile-recent-opponents-list" data-profile-recent-opponents-list="true">
      ${rows
        .map(
          (row, index) => `
            <button class="profile-recent-opponent-row" type="button" data-recent-opponent-index="${index}">
              <span class="profile-recent-opponent-avatar-wrap">
                ${
                  row.avatarSrc
                    ? `<img class="profile-recent-opponent-avatar" src="${row.avatarSrc}" alt="${escapeProfileText(row.displayName)} avatar" />`
                    : `<span class="profile-recent-opponent-avatar-fallback" aria-hidden="true">${escapeProfileText(row.displayName.slice(0, 1).toUpperCase() || "?")}</span>`
                }
              </span>
              <span class="profile-recent-opponent-copy">
                <strong class="profile-recent-opponent-name">${escapeProfileText(row.displayName)}</strong>
                <span class="profile-recent-opponent-title">${escapeProfileText(row.title)}</span>
              </span>
              <span class="profile-recent-opponent-meta">
                <span class="profile-recent-opponent-result">${escapeProfileText(row.latestResult)}</span>
                <span class="profile-recent-opponent-time">${escapeProfileText(formatRecentOpponentRelativeTime(row.lastCompletedAt, nowMs))}</span>
              </span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRecentOpponentsModalBody(profile = {}, options = {}) {
  return `
    <div class="recent-opponents-modal-content stack-sm" data-recent-opponents-modal="true">
      <p class="text-muted battle-report-modal-intro">Recent Online players you faced</p>
      <section class="profile-summary-card stack-sm profile-recent-opponents-panel" data-profile-recent-opponents="true">
        <h3 class="section-title">Recent Opponents</h3>
        ${renderRecentOpponentRows(profile, options)}
      </section>
    </div>
  `;
}

function formatCollectionAlbumState(summary = {}) {
  const rewardState = String(summary?.rewardState ?? "").trim();
  if (rewardState === "claimable") {
    return "Reward Ready";
  }
  if (rewardState === "claimed") {
    return "Claimed";
  }
  if (summary?.completed) {
    return "Complete";
  }
  if (Number(summary?.ownedCount ?? 0) > 0) {
    return "In Progress";
  }
  return "Not Started";
}

function getCollectionAlbumSummaries(profile = {}) {
  return Array.isArray(profile?.collectionAlbums?.summaries)
    ? profile.collectionAlbums.summaries
    : [];
}

function renderCollectionChipList(items = [], { emptyText = "" } = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    return emptyText ? `<p class="text-muted profile-collection-chip-empty">${escapeProfileText(emptyText)}</p>` : "";
  }
  return `
    <div class="profile-collection-chip-row" data-profile-collection-chip-row="true">
      ${safeItems
        .map((item) => {
          const albumId = String(item?.albumId ?? "").trim();
          const name = String(item?.name ?? albumId).trim();
          return name
            ? `<span class="profile-trophy-chip profile-collection-chip" data-profile-collection-chip="${escapeProfileText(albumId)}">${escapeProfileText(name)}</span>`
            : "";
        })
        .join("")}
    </div>
  `;
}

function renderOwnCollectionCompletedSummary(profile = {}) {
  const summaries = getCollectionAlbumSummaries(profile);
  if (!summaries.length) {
    return "";
  }
  const completed = summaries.filter((summary) => Boolean(summary?.completed));
  return `
    <section class="profile-summary-card stack-sm profile-collection-summary-card" data-profile-collection-summary="own">
      <h3 class="section-title">Collections Completed: ${completed.length} / ${summaries.length}</h3>
      ${renderCollectionChipList(completed)}
    </section>
  `;
}

function renderPublicCollectionCompletedSummary(profile = {}) {
  const collectionAlbums = profile?.collectionAlbums;
  if (!collectionAlbums || typeof collectionAlbums !== "object" || Array.isArray(collectionAlbums)) {
    return "";
  }
  const completed = Array.isArray(collectionAlbums.completed) ? collectionAlbums.completed : [];
  return `
    <section class="profile-summary-card stack-sm profile-collection-summary-card" data-profile-collection-summary="public">
      <h3 class="section-title">Completed Collections</h3>
      ${renderCollectionChipList(completed, { emptyText: "No completed collections yet." })}
    </section>
  `;
}

function renderCollectionAlbumRows(profile = {}) {
  const summaries = getCollectionAlbumSummaries(profile);
  if (!summaries.length) {
    return `<p class="text-muted" data-collection-albums-empty="true">No collection albums available.</p>`;
  }

  return `
    <div class="collection-albums-list" data-collection-albums-list="true">
      ${summaries
        .map((summary) => {
          const ownedCount = Math.max(0, Number(summary?.ownedCount ?? 0) || 0);
          const totalCount = Math.max(0, Number(summary?.totalCount ?? 0) || 0);
          const percentComplete = Math.max(0, Math.min(100, Number(summary?.percentComplete ?? 0) || 0));
          const stateLabel = formatCollectionAlbumState(summary);
          const albumId = String(summary?.albumId ?? "").trim();

          return `
            <article class="collection-album-row" data-collection-album-row="${escapeProfileText(albumId)}">
              <div class="collection-album-row-copy">
                <strong class="collection-album-row-title">${escapeProfileText(summary?.name ?? albumId)}</strong>
                ${summary?.description ? `<p class="text-muted">${escapeProfileText(summary.description)}</p>` : ""}
              </div>
              <div class="collection-album-row-progress">
                <span class="collection-album-count" data-collection-album-count="true">${ownedCount} / ${totalCount}</span>
                <span class="collection-album-percent" data-collection-album-percent="true">${percentComplete}%</span>
                <span class="profile-trophy-chip" data-collection-album-state="true">${escapeProfileText(stateLabel)}</span>
              </div>
              <button
                type="button"
                class="btn btn-secondary"
                data-collection-album-view="${escapeProfileText(albumId)}"
              >View Album</button>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCollectionAlbumDetail(profile = {}, albumId) {
  const detail = buildCollectionAlbumDetail(profile, albumId);
  if (!detail) {
    return `
      <div class="collection-albums-modal-content stack-sm" data-collection-albums-modal="true" data-collection-album-detail="true">
        <button type="button" class="btn btn-secondary" data-collection-albums-back="true">Back</button>
        <p class="text-muted" data-collection-albums-detail-empty="true">Collection album unavailable.</p>
      </div>
    `;
  }
  const rewardPreview = detail.rewardPreview;
  const rewardLabel = rewardPreview?.label ?? null;
  const rewardState = String(detail.rewardState ?? "none");
  const canClaimReward = rewardState === "claimable";
  const rewardClaimed = rewardState === "claimed";

  return `
    <div class="collection-albums-modal-content stack-sm" data-collection-albums-modal="true" data-collection-album-detail="true" data-collection-album-id="${escapeProfileText(detail.albumId)}">
      <div class="battle-report-detail-header">
        <button type="button" class="btn btn-secondary" data-collection-albums-back="true">Back</button>
        <h3 class="section-title">${escapeProfileText(detail.name)}</h3>
      </div>
      ${detail.description ? `<p class="text-muted battle-report-modal-intro">${escapeProfileText(detail.description)}</p>` : ""}
      <section class="profile-summary-card stack-sm">
        <div class="collection-album-detail-summary">
          <strong data-collection-album-detail-count="true">${detail.ownedCount} / ${detail.totalCount} owned</strong>
          <span data-collection-album-detail-percent="true">${detail.percentComplete}% complete</span>
          <span class="profile-trophy-chip" data-collection-album-detail-state="true">${escapeProfileText(formatCollectionAlbumState(detail))}</span>
        </div>
        <div class="collection-album-item-grid" data-collection-album-item-grid="true">
          ${detail.items
            .map((item) => {
              const imageSrc = resolveImagePath(item.image);
              const hasImage = item.owned && hasRenderablePreviewSource(imageSrc, {
                previewName: item.name,
                previewVisualText: item.name
              });
              const hoverAttributes = item.owned
                ? buildTrophyHoverAttributes({
                    ...item,
                    typeLabel: titleCase(item.type)
                  })
                : "";

              return `
                <article
                  class="collection-album-item${item.owned ? " is-owned" : " is-missing"}"
                  data-collection-album-item="${escapeProfileText(item.type)}:${escapeProfileText(item.id)}"
                  data-collection-album-item-state="${item.owned ? "owned" : "missing"}"
                >
                  ${
                    hasImage
                      ? `<img class="collection-album-item-image" src="${imageSrc}" alt="${escapeProfileText(item.name)}" ${hoverAttributes} />`
                      : `<div class="collection-album-item-fallback" data-collection-album-item-fallback="true">${item.owned ? escapeProfileText(item.name) : "Locked"}</div>`
                  }
                  <div class="collection-album-item-copy">
                    <strong>${escapeProfileText(item.name)}</strong>
                    <div class="profile-trophy-chip-row">
                      <span class="cosmetic-rarity-label rarity-${String(item.rarity ?? "Common").toLowerCase()}">${escapeProfileText(item.rarity ?? "Common")}</span>
                      <span class="profile-trophy-chip">${escapeProfileText(titleCase(item.type) || "Cosmetic")}</span>
                      ${item.element ? `<span class="profile-trophy-chip">${escapeProfileText(item.element)}</span>` : ""}
                    </div>
                    <span class="text-muted" data-collection-album-owned-label="true">${item.owned ? "Owned" : "Missing"}</span>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
      <section class="profile-summary-card stack-sm" data-collection-album-reward-static="true">
        <h3 class="section-title">Completion Reward</h3>
        ${
          rewardPreview
            ? `<p class="text-muted" data-collection-album-reward-preview="true">${escapeProfileText(rewardLabel)}</p>
              <button
                type="button"
                class="btn btn-secondary"
                data-collection-album-claim="${escapeProfileText(detail.albumId)}"
                ${canClaimReward ? "" : "disabled"}
              >${rewardClaimed ? "Claimed" : "Claim Reward"}</button>`
            : '<p class="text-muted">Coming in a future update.</p>'
        }
      </section>
    </div>
  `;
}

function renderCollectionAlbumsModalBody(profile = {}, options = {}) {
  const selectedAlbumId = String(options?.selectedAlbumId ?? "").trim();
  if (selectedAlbumId) {
    return renderCollectionAlbumDetail(profile, selectedAlbumId);
  }

  return `
    <div class="collection-albums-modal-content stack-sm" data-collection-albums-modal="true">
      <p class="text-muted battle-report-modal-intro">Track your cosmetic collection progress.</p>
      <section class="profile-summary-card stack-sm">
        <h3 class="section-title">Collection Albums</h3>
        ${renderCollectionAlbumRows(profile)}
      </section>
    </div>
  `;
}

function renderProfileShowcase(profile = {}, options = {}) {
  const items = options.publicView
    ? selectPublicShowcaseItems(profile)
    : selectOwnShowcaseItems(profile, { catalog: options.catalog ?? null });
  const editable = Boolean(options.editable && !options.publicView);
  const manualSlots = editable
    ? normalizeProfileShowcaseSlots(profile, { catalog: options.catalog ?? null })
    : [];

  return `
    <section class="profile-summary-card stack-sm profile-showcase-panel" data-profile-showcase="true">
      <div class="section-heading-row">
        <h3 class="section-title">Showcase</h3>
      </div>
      <div class="profile-showcase-grid">
        ${items
          .map((item, index) => {
            if (!item) {
              return `
                <article class="profile-showcase-slot profile-showcase-slot-empty" data-profile-showcase-slot="${index}" data-profile-showcase-empty="true">
                  <div class="profile-showcase-fallback" data-profile-showcase-fallback="true">Empty Showcase Slot</div>
                  ${
                    editable
                      ? `<div class="profile-showcase-actions">
                          <button class="btn btn-secondary profile-showcase-action" type="button" data-profile-showcase-choose="${index}">Choose</button>
                        </div>`
                      : ""
                  }
                </article>
              `;
            }

            const imageSrc = resolveImagePath(item.image);
            const hoverAttributes = buildTrophyHoverAttributes(item);
            const hasImage = hasRenderablePreviewSource(imageSrc, {
              previewName: item.name,
              previewVisualText: item.name
            });

            return `
              <article class="profile-showcase-slot" data-profile-showcase-slot="${index}" data-profile-showcase-type="${escapeProfileText(item.type)}" data-profile-showcase-id="${escapeProfileText(item.id)}">
                ${
                  hasImage
                    ? `<img class="profile-showcase-image" src="${imageSrc}" alt="${escapeProfileText(item.name)}" ${hoverAttributes} />`
                    : `<div class="profile-showcase-fallback" data-profile-showcase-fallback="true">${escapeProfileText(item.name)}</div>`
                }
                <div class="profile-showcase-copy">
                  <strong class="profile-showcase-name">${escapeProfileText(item.name)}</strong>
                  <div class="profile-trophy-chip-row">
                    <span class="cosmetic-rarity-label rarity-${item.rarity.toLowerCase()}" data-profile-showcase-rarity="true">${escapeProfileText(item.rarity)}</span>
                    <span class="profile-trophy-chip" data-profile-showcase-type-label="true">${escapeProfileText(item.typeLabel || "Cosmetic")}</span>
                    ${item.collection ? `<span class="profile-trophy-chip" data-profile-showcase-collection="true">${escapeProfileText(item.collection)}</span>` : ""}
                    ${item.element ? `<span class="profile-trophy-chip" data-profile-showcase-element="true">${escapeProfileText(item.element)}</span>` : ""}
                  </div>
                </div>
                ${
                  editable
                    ? `<div class="profile-showcase-actions">
                        <button class="btn btn-secondary profile-showcase-action" type="button" data-profile-showcase-choose="${index}">${manualSlots[index] ? "Replace" : "Choose"}</button>
                        ${
                          manualSlots[index]
                            ? `<button class="btn btn-secondary profile-showcase-action" type="button" data-profile-showcase-clear="${index}">Use Automatic</button>`
                            : ""
                        }
                      </div>`
                    : ""
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderProfileShowcasePickerBody(profile = {}, cosmetics = {}, slotIndex = 0) {
  const safeSlotIndex = Math.max(0, Math.min(PROFILE_SHOWCASE_SLOT_COUNT - 1, Number(slotIndex) || 0));
  const catalog = cosmetics?.catalog && typeof cosmetics.catalog === "object"
    ? cosmetics.catalog
    : getCosmeticCatalogForProfile(profile);
  const manualSlots = normalizeProfileShowcaseSlots(profile, { catalog });
  const currentKey = manualSlots[safeSlotIndex]
    ? `${manualSlots[safeSlotIndex].type}:${manualSlots[safeSlotIndex].id}`
    : null;
  const usedElsewhere = new Set(
    manualSlots
      .map((slot, index) => (index !== safeSlotIndex && slot ? `${slot.type}:${slot.id}` : null))
      .filter(Boolean)
  );
  const items = [];

  for (const [type, entries] of Object.entries(catalog ?? {})) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (!entry?.owned || !entry?.id) {
        continue;
      }

      const item = normalizeShowcaseDisplayItem({ ...entry, type });
      if (item) {
        items.push(item);
      }
    }
  }

  items.sort((left, right) => {
    const typeCompare = (left.typeLabel || left.type).localeCompare(right.typeLabel || right.type);
    if (typeCompare !== 0) {
      return typeCompare;
    }
    return left.name.localeCompare(right.name);
  });

  return `
    <div class="profile-showcase-picker stack-sm" data-profile-showcase-picker="true" data-profile-showcase-picker-slot="${safeSlotIndex}">
      <h4 class="profile-showcase-picker-title">Showcase Slot ${safeSlotIndex + 1}</h4>
      <p class="text-muted">Choose an owned cosmetic for Showcase slot ${safeSlotIndex + 1}, or use the automatic default.</p>
      <div class="profile-showcase-picker-grid">
        ${items
          .map((item) => {
            const key = `${item.type}:${item.id}`;
            const imageSrc = resolveImagePath(item.image);
            const hasImage = hasRenderablePreviewSource(imageSrc, {
              previewName: item.name,
              previewVisualText: item.name
            });
            const disabled = usedElsewhere.has(key);
            const selected = currentKey === key;
            const hoverAttributes = buildTrophyHoverAttributes(item);

            return `
              <button
                class="profile-showcase-picker-item${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}"
                type="button"
                data-showcase-picker-select="true"
                data-showcase-picker-type="${escapeProfileText(item.type)}"
                data-showcase-picker-id="${escapeProfileText(item.id)}"
                ${disabled ? 'disabled aria-disabled="true"' : ""}
              >
                ${
                  hasImage
                    ? `<img class="profile-showcase-picker-image" src="${imageSrc}" alt="${escapeProfileText(item.name)}" ${hoverAttributes} />`
                    : `<span class="profile-showcase-picker-fallback">${escapeProfileText(item.name)}</span>`
                }
                <span class="profile-showcase-picker-copy">
                  <strong>${escapeProfileText(item.name)}</strong>
                  <span>${escapeProfileText(item.typeLabel || "Cosmetic")}${item.element ? ` · ${escapeProfileText(item.element)}` : ""}</span>
                  ${selected ? '<span data-showcase-picker-current="true">Current selection</span>' : ""}
                  ${disabled ? '<span data-showcase-picker-disabled-reason="true">Already showcased</span>' : ""}
                </span>
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderProfileOverviewProgress(profile = {}) {
  const levelProgress = getLevelProgress(profile);
  const playerLevel = Math.max(1, Number(levelProgress?.playerLevel ?? 1));
  const playerXp = Math.max(0, Number(levelProgress?.playerXP ?? 0));
  const currentLevelXp = Math.max(0, Number(levelProgress?.currentLevelXp ?? 0));
  const nextLevelXp = Math.max(currentLevelXp, Number(levelProgress?.nextLevelXp ?? currentLevelXp));
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const levelCapReached = Boolean(levelProgress?.levelCapReached || playerLevel >= MAX_LEVEL);
  const displayedCurrentXp = levelCapReached ? span : Math.max(0, Math.min(span, playerXp - currentLevelXp));
  const progressPercent = levelCapReached ? 100 : Math.max(0, Math.min(100, Math.round((displayedCurrentXp / span) * 100)));
  const tokens = Math.max(0, Number(profile.tokens ?? 0));
  const supporterStatus = profile.supporterPass ? "Active" : "Not Active";
  const nextReward = levelProgress?.nextReward ?? null;
  const nextRewardLine = nextReward ? `Lv ${nextReward.level} - ${nextReward.name}` : "Level cap reached";
  const isReadOnlyProfile = !profile?.chests || typeof profile.chests !== "object";
  const chestCounts = {
    basic: Math.max(0, Number(profile?.chests?.basic ?? 0) || 0),
    milestone: Math.max(0, Number(profile?.chests?.milestone ?? 0) || 0),
    epic: Math.max(0, Number(profile?.chests?.epic ?? 0) || 0),
    legendary: Math.max(0, Number(profile?.chests?.legendary ?? 0) || 0)
  };

  return `
    <section class="profile-summary-card stack-sm profile-flex-panel" data-profile-flex-panel="progress">
      <h3 class="section-title">Progress / Account</h3>
      <div class="profile-overview-progress">
        <div class="profile-overview-progress-row">
          <div class="profile-overview-progress-copy">
            <p class="profile-overview-kicker">Level</p>
            <strong class="profile-overview-value" data-profile-overview-level="true">${playerLevel}</strong>
          </div>
          <div class="profile-overview-progress-copy">
            <p class="profile-overview-kicker">Tokens</p>
            <strong class="profile-overview-value" data-profile-overview-tokens="true">${tokens}</strong>
          </div>
        </div>
        <div class="profile-overview-xp-block" data-profile-overview-xp="true">
          <div class="profile-overview-progress-copy">
            <p class="profile-overview-kicker">XP</p>
            <strong class="profile-overview-value" data-profile-overview-xp-value="true">${
              levelCapReached ? "Level cap reached" : `${displayedCurrentXp} / ${span}`
            }</strong>
          </div>
          <div
            class="profile-overview-xp-bar"
            role="progressbar"
            aria-label="XP Progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${progressPercent}"
          >
            <span class="profile-overview-xp-fill" style="width: ${progressPercent}%"></span>
          </div>
          <p class="profile-overview-progress-line">${levelCapReached ? "Level cap reached" : `${playerXp} total XP`}</p>
        </div>
        <div class="profile-overview-supporter-row">
          <span class="profile-stat-label">Next Reward</span>
          <strong class="profile-stat-value" data-profile-overview-next-reward="true">${nextRewardLine}</strong>
        </div>
        ${
          isReadOnlyProfile
            ? ""
            : `<div class="profile-overview-chest-row" data-profile-overview-chests="true">
                <span class="profile-overview-chest-pill" data-profile-overview-chest="basic">Basic: ${chestCounts.basic}</span>
                <span class="profile-overview-chest-pill" data-profile-overview-chest="milestone">Milestone: ${chestCounts.milestone}</span>
                <span class="profile-overview-chest-pill" data-profile-overview-chest="epic">Epic: ${chestCounts.epic}</span>
                <span class="profile-overview-chest-pill" data-profile-overview-chest="legendary">Legendary: ${chestCounts.legendary}</span>
              </div>`
        }
        <div class="profile-overview-supporter-row">
          <span class="profile-stat-label">Founder / Supporter</span>
          <strong class="profile-stat-value" data-profile-overview-supporter="true">${supporterStatus}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderProfileFlexPanels(profile = {}, options = {}) {
  const equipped = normalizeProfileEquippedCosmetics(profile);
  const cardBackName =
    getCosmeticDisplayName("cardBack", equipped.cardBack, "Default Card Back") ?? "Default Card Back";
  const variantImages = getVariantCardImages(equipped.elementCardVariant);
  const featuredRivalWins = safeStat(profile.featuredRivalWins);
  const cardBackImage = getCardBackImage(equipped.cardBack);
  const cardBackHoverAttributes = buildCardStyleHoverAttributes({
    type: "cardBack",
    id: equipped.cardBack,
    imageSrc: cardBackImage,
    fallbackName: cardBackName
  });

  return `
    <section class="profile-flex-grid" data-profile-overview="true" data-profile-flex-grid="true">
      ${renderProfileOverviewProgress(profile)}
      <section class="profile-summary-card stack-sm profile-flex-panel" data-profile-flex-panel="card-style">
        <h3 class="section-title">Card Style Preview</h3>
        <div class="profile-card-style-header">
          <img
            class="profile-card-style-cardback"
            src="${cardBackImage}"
            alt="${cardBackName}"
            data-profile-flex-cardback="true"
            ${cardBackHoverAttributes}
          />
          <div class="profile-card-style-copy">
            <p class="profile-card-style-kicker">Card Back</p>
            <strong class="profile-card-style-title">${cardBackName}</strong>
          </div>
        </div>
        <div class="profile-card-style-variants" data-profile-flex-variants="true">
          ${FLEX_VARIANT_ORDER.map((element) => {
            const variantId = equipped.elementCardVariant?.[element] ?? null;
            const variantName =
              getCosmeticDisplayName("elementCardVariant", variantId, defaultVariantName(element)) ??
              defaultVariantName(element);
            const variantImage = variantImages?.[element] ?? null;
            const variantHoverAttributes = buildCardStyleHoverAttributes({
              type: "elementCardVariant",
              id: variantId,
              imageSrc: variantImage,
              fallbackName: variantName,
              fallbackVisualText: variantName
            });

            return `
              <article class="profile-card-style-variant" data-profile-flex-variant="${element}">
                ${
                  variantImage
                    ? `<img class="profile-card-style-variant-image" src="${variantImage}" alt="${variantName}" ${variantHoverAttributes} />`
                    : `<div class="profile-card-style-variant-fallback">${titleCase(element).slice(0, 1)}</div>`
                }
                <div class="profile-card-style-variant-copy">
                  <span class="profile-card-style-variant-label">${titleCase(element)}</span>
                  <strong class="profile-card-style-variant-name">${variantName}</strong>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
      <section class="profile-summary-card stack-sm profile-flex-panel" data-profile-flex-panel="stats">
        <h3 class="section-title">Flex Stats</h3>
        <div class="stack-sm" data-profile-flex-longest-match="true">
          <div class="profile-stat-row">
            <span class="profile-stat-label">Longest Match</span>
            <span class="profile-stat-value"></span>
          </div>
          ${renderLongestMatchSummary(profile)}
        </div>
        ${renderStatList([
          { label: "Best Gauntlet Streak", value: safeStat(profile.gauntletBestStreak) },
          { label: "Gauntlet Runs", value: safeStat(profile.gauntletRuns) },
          { label: "Gauntlet Wins", value: safeStat(profile.gauntletWins) },
          { label: "Rivals Defeated", value: safeStat(profile.gauntletRivalsDefeated) },
          { label: "Featured Rival Wins", value: featuredRivalWins }
        ])}
      </section>
    </section>
  `;
}

function renderTrophyShelf(profile = {}, options = {}) {
  const items = selectTrophyShelfItems(profile, {
    catalog: options.catalog ?? null
  });

  return `
    <section class="profile-summary-card stack-sm profile-trophy-panel" data-profile-trophy-shelf="true">
      <div class="section-heading-row">
        <h3 class="section-title">Trophy Shelf</h3>
      </div>
      ${
        items.length === 0
          ? '<p class="text-muted profile-trophy-empty">No rare cosmetics yet.</p>'
          : `<div class="profile-trophy-grid">
              ${items
                .map((item, index) => {
                  const imageSrc = resolveImagePath(item.image);
                  const hoverAttributes = buildTrophyHoverAttributes(item);
                  const hasImage = hasRenderablePreviewSource(imageSrc, {
                    previewName: item.name,
                    previewVisualText: item.name
                  });

                  return `
                    <article class="profile-trophy-item" data-profile-trophy-item="${index}">
                      ${
                        hasImage
                          ? `<img class="profile-trophy-image" src="${imageSrc}" alt="${item.name}" ${hoverAttributes} />`
                          : `<div class="profile-trophy-fallback" data-profile-trophy-fallback="true">${item.name}</div>`
                      }
                      <div class="profile-trophy-copy">
                        <strong class="profile-trophy-name">${item.name}</strong>
                        <div class="profile-trophy-chip-row">
                          <span class="cosmetic-rarity-label rarity-${item.rarity.toLowerCase()}" data-profile-trophy-rarity="true">${item.rarity}</span>
                          <span class="profile-trophy-chip" data-profile-trophy-type="true">${item.typeLabel || "Cosmetic"}</span>
                          ${item.collection ? `<span class="profile-trophy-chip" data-profile-trophy-collection="true">${item.collection}</span>` : ""}
                        </div>
                        ${item.rarity === "Unique" && item.createdForUsername ? `<p class="profile-trophy-created-for">Created For: ${escapeProfileText(item.createdForUsername)}</p>` : ""}
                        ${item.rarity === "Unique" && item.acquisitionLabel ? `<p class="profile-trophy-acquired">Acquired: ${escapeProfileText(item.acquisitionLabel)}</p>` : ""}
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>`
      }
    </section>
  `;
}

function renderStatList(items) {
  return `
    <div class="profile-stat-list">
      ${items
        .map(
          (item) => `
            <div class="profile-stat-row">
              <span class="profile-stat-label">${item.label}</span>
              <strong class="profile-stat-value">${item.value}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function formatBattleReportMode(mode) {
  switch (String(mode ?? "").trim()) {
    case "online":
      return "Online";
    case "pve":
      return "PvE";
    case "localHotseat":
      return "Local Hotseat";
    case "gauntlet":
      return "Gauntlet";
    case "featuredRival":
      return "Featured Rival";
    case "bloodMatch":
      return "Blood Match";
    default:
      return "Unknown";
  }
}

function formatBattleReportResult(result) {
  switch (String(result ?? "").trim()) {
    case "win":
      return "Victory";
    case "loss":
      return "Defeat";
    case "draw":
      return "Draw";
    default:
      return "Unknown";
  }
}

function formatBattleReportCompletedAt(completedAt) {
  const parsed = new Date(completedAt);
  if (Number.isNaN(parsed.getTime())) {
    return String(completedAt ?? "").trim() || "Unknown";
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function renderBattleReportIdentityRow(latestBattle = {}) {
  const mode = String(latestBattle?.mode ?? "").trim();
  const canViewOpponent =
    mode === "online" && String(latestBattle?.opponentUsername ?? "").trim().length > 0;
  const isRivalMode = mode === "gauntlet" || mode === "featuredRival" || mode === "bloodMatch";
  const label = isRivalMode ? "Rival" : "Opponent";
  const name =
    isRivalMode
      ? String(latestBattle?.rivalName ?? "").trim()
      : String(latestBattle?.opponentName ?? "").trim();
  const username = String(latestBattle?.opponentUsername ?? "").trim();
  const buttonLabel = name || username;
  const secondaryLabel = canViewOpponent && name && username && name !== username ? ` @${username}` : "";
  const valueMarkup = canViewOpponent
    ? `
        <button
          type="button"
          class="btn btn-secondary"
          data-battle-report-view-profile="${username}"
          data-battle-report-opponent-link="true"
        >${buttonLabel}</button>${secondaryLabel}
      `
    : `<strong class="profile-stat-value">${name || "Unknown"}</strong>`;

  return `
    <div class="profile-stat-row" data-battle-report-identity-row="true">
      <span class="profile-stat-label">${label}</span>
      ${valueMarkup}
    </div>
  `;
}

function getBattleReportEntries(profile = {}) {
  const recentBattles = Array.isArray(profile?.recentBattles) ? profile.recentBattles : [];
  const recentSource =
    recentBattles.length > 0
      ? recentBattles
      : profile?.latestBattle && typeof profile.latestBattle === "object"
        ? [profile.latestBattle]
        : [];

  return recentSource
    .filter((battle) => battle && typeof battle === "object")
    .map((battle, index) => {
      const completedAt = String(battle?.completedAt ?? "").trim();
      const parsedTime = Date.parse(completedAt);
      return {
        ...battle,
        __battleReportOrder: index,
        __battleReportTime: Number.isNaN(parsedTime) ? Number.NEGATIVE_INFINITY : parsedTime
      };
    })
    .sort((left, right) => {
      if (right.__battleReportTime !== left.__battleReportTime) {
        return right.__battleReportTime - left.__battleReportTime;
      }
      return left.__battleReportOrder - right.__battleReportOrder;
    })
    .slice(0, 5);
}

function buildBattleReportRows(battle = {}) {
  const rows = [
    {
      label: "Mode",
      value: formatBattleReportMode(battle.mode)
    },
    {
      label: "Result",
      value: formatBattleReportResult(battle.result)
    },
    {
      label: "Completed",
      value: formatBattleReportCompletedAt(battle.completedAt)
    }
  ];

  if (battle.rounds != null) {
    rows.push({
      label: "Rounds",
      value: Math.max(0, Number(battle.rounds ?? 0) || 0)
    });
  }
  if (battle.warsEntered != null) {
    rows.push({
      label: "WARs Entered",
      value: Math.max(0, Number(battle.warsEntered ?? 0) || 0)
    });
  }
  if (battle.mode === "bloodMatch") {
    if (battle.playerCardsCaptured != null) {
      rows.push({
        label: "Cards Captured",
        value: Math.max(0, Number(battle.playerCardsCaptured ?? 0) || 0)
      });
    }
    if (battle.playerHandAtEnd != null) {
      rows.push({
        label: "Final Hands",
        value: `Player ${Math.max(0, Number(battle.playerHandAtEnd ?? 0) || 0)} / Veyra ${Math.max(0, Number(battle.vampireHandAtEnd ?? 0) || 0)} / Ravena ${Math.max(0, Number(battle.lycanHandAtEnd ?? 0) || 0)}`
      });
    }
    rows.push({
      label: "Two-Way / Three-Way WARs",
      value: `${Math.max(0, Number(battle.twoWayWars ?? 0) || 0)} / ${Math.max(0, Number(battle.threeWayWars ?? 0) || 0)}`
    });
  }

  return rows;
}

function renderBattleReportListEntries(entries = []) {
  return entries
    .map((battle, index) => {
      const opponentLabel =
        battle?.mode === "gauntlet" || battle?.mode === "featuredRival" || battle?.mode === "bloodMatch"
          ? String(battle?.rivalName ?? "").trim() || "Unknown"
          : String(battle?.opponentName ?? "").trim() || String(battle?.opponentUsername ?? "").trim() || "Unknown";
      const roundsLine =
        battle?.rounds != null
          ? `<span class="battle-report-row-meta">Rounds: ${Math.max(0, Number(battle.rounds ?? 0) || 0)}</span>`
          : "";
      const warsLine =
        battle?.warsEntered != null
          ? `<span class="battle-report-row-meta">WARs: ${Math.max(0, Number(battle.warsEntered ?? 0) || 0)}</span>`
          : "";

      return `
        <button
          type="button"
          class="battle-report-row-btn"
          data-battle-report-entry-index="${index}"
        >
          <span class="battle-report-row-topline">
            <strong>${formatBattleReportResult(battle.result)}</strong>
            <span>${formatBattleReportMode(battle.mode)}</span>
          </span>
          <span class="battle-report-row-name">${opponentLabel}</span>
          <span class="battle-report-row-bottomline">
            <span>${formatBattleReportCompletedAt(battle.completedAt)}</span>
            ${roundsLine}
            ${warsLine}
          </span>
        </button>
      `;
    })
    .join("");
}

function renderBattleReportDetailView(battle = {}) {
  return `
    <div class="battle-report-modal-content stack-sm" data-battle-report-modal="true" data-battle-report-detail="true">
      <p class="text-muted battle-report-modal-intro">Recent Battles</p>
      <section class="profile-summary-card stack-sm">
        <div class="battle-report-detail-header">
          <button
            type="button"
            class="btn btn-secondary"
            data-battle-report-back="true"
          >Back</button>
          <h3 class="section-title">Battle Details</h3>
        </div>
        <div class="profile-stat-list">
          ${buildBattleReportRows(battle)
            .map(
              (item) => `
                <div class="profile-stat-row">
                  <span class="profile-stat-label">${item.label}</span>
                  <strong class="profile-stat-value">${item.value}</strong>
                </div>
              `
            )
            .join("")}
          ${renderBattleReportIdentityRow(battle)}
        </div>
      </section>
    </div>
  `;
}

function renderBattleReportModalBody(profile = {}, options = {}) {
  const entries = getBattleReportEntries(profile);
  if (entries.length === 0) {
    return `
      <div class="battle-report-modal-content stack-sm">
        <p class="text-muted" data-battle-report-empty="true">No battles recorded yet.</p>
      </div>
    `;
  }

  const selectedBattleIndex = Number.isInteger(options?.selectedBattleIndex)
    ? options.selectedBattleIndex
    : -1;
  const selectedBattle =
    selectedBattleIndex >= 0 && selectedBattleIndex < entries.length ? entries[selectedBattleIndex] : null;

  if (selectedBattle) {
    return renderBattleReportDetailView(selectedBattle);
  }

  return `
    <div class="battle-report-modal-content stack-sm" data-battle-report-modal="true">
      <p class="text-muted battle-report-modal-intro">Your 5 most recent completed battles</p>
      <section class="profile-summary-card stack-sm">
        <h3 class="section-title">Recent Battles</h3>
        <div class="battle-report-list" data-battle-report-list="true">
          ${renderBattleReportListEntries(entries)}
        </div>
      </section>
    </div>
  `;
}

function renderActivityToolsCard() {
  return `
    <section class="profile-summary-card stack-sm profile-activity-card profile-dashboard-card" data-profile-activity-card="true">
      <h3 class="section-title">Activity</h3>
      <div class="profile-activity-actions">
        <div class="profile-activity-action" data-profile-activity-action="battle-report">
          <strong class="profile-activity-action-title">Battle Report</strong>
          <p class="text-muted">View your 5 most recent completed battles.</p>
          <button
            id="profile-battle-report-btn"
            class="btn btn-secondary"
            type="button"
            data-profile-battle-report-btn="true"
          >Battle Report</button>
        </div>
        <div class="profile-activity-action" data-profile-activity-action="collections">
          <strong class="profile-activity-action-title">Collections</strong>
          <p class="text-muted">Track cosmetic set progress.</p>
          <button
            id="profile-collections-btn"
            class="btn btn-secondary"
            type="button"
            data-profile-collections-btn="true"
          >Collections</button>
        </div>
      </div>
    </section>
  `;
}

function renderProfileIdentityCard({
  username,
  avatarId,
  avatarSrc,
  avatarPublicMetadata,
  title,
  titleId,
  titleIcon,
  badgeId,
  badgeSrc,
  referral = {}
}) {
  return `
    <section class="profile-summary-card profile-dashboard-card profile-identity-card" data-profile-identity-card="true">
      ${renderProfileIdentityHeader({
        username,
        avatarId,
        avatarSrc,
        avatarPublicMetadata,
        title,
        titleId,
        titleIcon,
        badgeId,
        badgeSrc
      })}
      ${renderProfileReferralAction(referral)}
    </section>
  `;
}

function renderModeStatsCard(title, stats = {}) {
  return `
    <section class="profile-mode-card stack-sm">
      <h4 class="section-title">${title}</h4>
      ${renderStatList([
        { label: "Games Played", value: safeStat(stats.gamesPlayed) },
        { label: "Wins / Losses", value: `${safeStat(stats.wins)} / ${safeStat(stats.losses)}` },
        { label: "Cards Captured", value: safeStat(stats.cardsCaptured) },
        { label: "WARs Entered / Won", value: `${safeStat(stats.warsEntered)} / ${safeStat(stats.warsWon)}` },
        { label: "Longest WAR", value: safeStat(stats.longestWar) }
      ])}
    </section>
  `;
}

function renderGauntletStatsCard(profile = {}) {
  return `
    <section class="profile-summary-card stack-sm">
      <h3 class="section-title">Gauntlet</h3>
      ${renderStatList([
        { label: "Best Gauntlet Streak", value: safeStat(profile.gauntletBestStreak) },
        { label: "Gauntlet Runs", value: safeStat(profile.gauntletRuns) },
        { label: "Gauntlet Wins", value: safeStat(profile.gauntletWins) },
        { label: "Gauntlet Losses", value: safeStat(profile.gauntletLosses) },
        { label: "Rivals Defeated", value: safeStat(profile.gauntletRivalsDefeated) }
      ])}
    </section>
  `;
}

function renderBloodMatchStatsCard(profile = {}, { publicView = false } = {}) {
  const matchesPlayed = safeStat(profile.bloodMatchMatchesPlayed);
  const wins = safeStat(profile.bloodMatchWins);
  const losses = safeStat(profile.bloodMatchLosses);
  const winRate = matchesPlayed > 0 ? `${Math.round((wins / matchesPlayed) * 100)}%` : "0%";
  const leftSections = [
    {
      title: "Record",
      rows: [
        { label: "Played", value: matchesPlayed },
        { label: "Wins / Losses", value: `${wins} / ${losses}` },
        { label: "Win Rate", value: winRate },
        { label: "Current Streak", value: safeStat(profile.bloodMatchCurrentWinStreak) },
        { label: "Best Streak", value: safeStat(profile.bloodMatchBestWinStreak) }
      ]
    },
    {
      title: "WAR Performance",
      rows: [
        { label: "Two-Way / Three-Way", value: `${safeStat(profile.bloodMatchTwoWayWars)} / ${safeStat(profile.bloodMatchThreeWayWars)}` },
        { label: "Won / Lost", value: `${safeStat(profile.bloodMatchWarsWon)} / ${safeStat(profile.bloodMatchWarsLost)}` },
        { label: "Three-Way Wins", value: safeStat(profile.bloodMatchThreeWayWarsWon) }
      ]
    }
  ];
  const rightSections = [
    {
      title: "Rival Eliminations",
      rows: [
        { label: "Veyra", value: safeStat(profile.bloodMatchVampireEliminations) },
        { label: "Ravena", value: safeStat(profile.bloodMatchLycanEliminations) },
        { label: "Double Elimination", value: safeStat(profile.bloodMatchDoubleEliminationWins) }
      ]
    },
    {
      title: "Captures / Timeouts",
      rows: [
        { label: "Cards Captured", value: safeStat(profile.bloodMatchCardsCaptured) },
        { label: "Timeout Wins", value: safeStat(profile.bloodMatchTimeoutWins) },
        { label: "Timeout Losses", value: safeStat(profile.bloodMatchTimeoutLosses) }
      ]
    }
  ];
  const renderBloodMatchColumn = (sections) => `
    <div class="profile-blood-match-column">
      ${sections.map((section) => `
        <div class="profile-blood-match-group">
          <h4>${escapeProfileText(section.title)}</h4>
          ${renderStatList(section.rows)}
        </div>
      `).join("")}
    </div>
  `;

  return `
    <section class="profile-summary-card stack-sm profile-blood-match-card" data-profile-blood-match-card="true">
      <h3 class="section-title">Blood Match</h3>
      <div class="profile-blood-match-grid">
        ${renderBloodMatchColumn(leftSections)}
        ${renderBloodMatchColumn(rightSections)}
      </div>
    </section>
  `;
}

function renderXpProgress(profile) {
  const levelProgress = getLevelProgress(profile);
  const level = Math.max(1, Number(levelProgress?.playerLevel ?? 1));
  const currentLevelXp = Math.max(0, Number(levelProgress?.currentLevelXp ?? 0));
  const nextLevelXp = Math.max(currentLevelXp, Number(levelProgress?.nextLevelXp ?? currentLevelXp));
  const range = Math.max(1, nextLevelXp - currentLevelXp);
  const displayedCurrentXp =
    level >= MAX_LEVEL ? range : Math.max(0, Math.min(range, Number(levelProgress?.playerXP ?? 0) - currentLevelXp));
  const displayedRequiredXp = range;
  const progress =
    level >= MAX_LEVEL
      ? 100
      : Math.max(0, Math.min(100, Math.round((displayedCurrentXp / displayedRequiredXp) * 100)));

  const nextReward = levelProgress?.nextReward ?? null;
  const nextRewardLine = nextReward
    ? `<p class="next-reward-line"><strong>Next Reward:</strong> Lv ${nextReward.level} - ${nextReward.name}</p>`
    : '<p class="next-reward-line"><strong>Next Reward:</strong> Level cap reached</p>';

  return `
    <section class="stack-sm xp-panel profile-summary-card">
      <h3 class="section-title">Progress</h3>
      <p><strong>Level ${level}</strong></p>
      <p>XP: ${displayedCurrentXp} / ${displayedRequiredXp}</p>
      ${nextRewardLine}
      <div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <div class="xp-fill" data-target-width="${progress}" style="width: ${progress}%"></div>
      </div>
    </section>
  `;
}

function renderChestPanel(profile, visualState = {}, options = {}) {
  const basicChestCount = Math.max(0, Number(profile?.chests?.basic ?? 0) || 0);
  const milestoneChestCount = Math.max(0, Number(profile?.chests?.milestone ?? 0) || 0);
  const epicChestCount = Math.max(0, Number(profile?.chests?.epic ?? 0) || 0);
  const legendaryChestCount = Math.max(0, Number(profile?.chests?.legendary ?? 0) || 0);
  const openingInFlight = Boolean(options?.openingInFlight);
  const openingLabel = openingInFlight ? "Opening..." : null;
  const basicChestIcon = getAssetPath(
    visualState?.basicOpen ? "icons/basic_chest_open.png" : "icons/basic_chest.png"
  );
  const milestoneChestIcon = getAssetPath(
    visualState?.milestoneOpen ? "icons/loot_chest_open.png" : "icons/loot_chest.png"
  );
  const epicChestIcon = getAssetPath(
    visualState?.epicOpen ? "icons/epic_chest_open.png" : "icons/epic_chest.png"
  );
  const legendaryChestIcon = getAssetPath(
    visualState?.legendaryOpen ? "icons/legendary_chest_open.png" : "icons/legendary_chest.png"
  );
  const commonLabelClass = "cosmetic-rarity-label rarity-common";
  const rareLabelClass = "cosmetic-rarity-label rarity-rare";
  const epicLabelClass = "cosmetic-rarity-label rarity-epic";
  const legendaryLabelClass = "cosmetic-rarity-label rarity-legendary";

  return `
    <section class="stack-sm chest-panel profile-chest-panel">
      <h3 class="section-title">Reward Chests</h3>
      <div class="chest-row profile-chest-row" data-profile-chest-row="true">
        <div class="chest-slot" data-profile-chest-slot="basic">
          <button
            id="open-basic-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${basicChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Basic Chest"
          >
            <span class="chest-count-bubble" aria-label="Basic Chest count">${basicChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${basicChestIcon}" alt="Basic Chest" data-basic-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${commonLabelClass}" data-basic-chest-label="true">${openingLabel ?? (basicChestCount > 0 ? "Basic Chest" : "No Basic Chests available")}</p>
        </div>
        <div class="chest-slot" data-profile-chest-slot="milestone">
          <button
            id="open-milestone-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${milestoneChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Milestone Chest"
          >
            <span class="chest-count-bubble" aria-label="Milestone Chest count">${milestoneChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${milestoneChestIcon}" alt="Milestone Chest" data-milestone-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${rareLabelClass}" data-milestone-chest-label="true">${openingLabel ?? "Milestone Chest"}</p>
        </div>
        <div class="chest-slot" data-profile-chest-slot="epic">
          <button
            id="open-epic-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${epicChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Epic Chest"
          >
            <span class="chest-count-bubble" aria-label="Epic Chest count">${epicChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${epicChestIcon}" alt="Epic Chest" data-epic-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${epicLabelClass}" data-epic-chest-label="true">${openingLabel ?? "Epic Chest"}</p>
        </div>
        <div class="chest-slot" data-profile-chest-slot="legendary">
          <button
            id="open-legendary-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${legendaryChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Legendary Chest"
          >
            <span class="chest-count-bubble" aria-label="Legendary Chest count">${legendaryChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${legendaryChestIcon}" alt="Legendary Chest" data-legendary-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${legendaryLabelClass}" data-legendary-chest-label="true">${openingLabel ?? "Legendary Chest"}</p>
        </div>
      </div>
      <p class="text-muted chest-panel-helper">Click a chest image to open it.</p>
    </section>
  `;
}

function getUniqueAvatarPublicMetadata(source = null) {
  if (!source || source.rarity !== "Unique") {
    return null;
  }

  const createdForUsername = String(source.createdForUsername ?? "").trim() || null;
  const acquisitionLabel = normalizeUniqueCosmeticAcquisitionLabel(source.acquisitionLabel);
  return createdForUsername || acquisitionLabel
    ? { createdForUsername, acquisitionLabel }
    : null;
}

function findOwnEquippedAvatarPublicMetadata(cosmetics, avatarId) {
  const entries = cosmetics?.catalog?.avatar;
  if (!Array.isArray(entries) || !avatarId) {
    return null;
  }
  return getUniqueAvatarPublicMetadata(entries.find((item) => item?.id === avatarId));
}

function findViewedEquippedAvatarPublicMetadata(profile, avatarId) {
  const items = Array.isArray(profile?.trophyShelf) ? profile.trophyShelf : [];
  return getUniqueAvatarPublicMetadata(
    items.find((item) => item?.type === "avatar" && item?.id === avatarId)
  );
}

function renderProfileIdentityHeader({
  username,
  avatarId,
  avatarSrc,
  avatarPublicMetadata = null,
  title,
  titleId,
  titleIcon,
  badgeId,
  badgeSrc
}) {
  const avatarImageSrc = hasRenderablePreviewSource(avatarSrc, { previewName: username }) ? avatarSrc : null;
  const avatarHoverMetadata = getCosmeticHoverMetadata("avatar", avatarId, username);
  const avatarHoverDetails = [
    avatarPublicMetadata?.createdForUsername
      ? `Created For: ${avatarPublicMetadata.createdForUsername}`
      : null,
    avatarPublicMetadata?.acquisitionLabel
      ? `Acquired: ${avatarPublicMetadata.acquisitionLabel}`
      : null
  ].filter(Boolean);
  const avatarHoverAttributes = buildHoverPreviewAttributes({
    previewType: "avatar",
    previewSrc: avatarImageSrc,
    previewName: avatarHoverMetadata.name ?? username,
    previewDescription: [avatarHoverMetadata.description, ...avatarHoverDetails]
      .filter(Boolean)
      .join(" · "),
    previewRarity: avatarHoverMetadata.rarity
  });

  return `
    <div class="player-header">
      ${avatarImageSrc ? `<img class="player-avatar" src="${avatarImageSrc}" alt="${username}" ${avatarHoverAttributes} />` : ""}
      <div>
        <h3>${username}</h3>
        ${renderTitleLine(title, titleIcon, badgeSrc, { titleId, badgeId })}
      </div>
    </div>
  `;
}

function renderProfileReferralAction(referral = {}) {
  if (!referral?.authenticated) {
    return `
      <div class="profile-identity-referral" data-profile-identity-referral="true">
        <strong class="profile-activity-action-title">My Referral Code</strong>
        <p class="text-muted" data-profile-referral-signed-out="true">Sign in to get your referral code.</p>
      </div>
    `;
  }

  const referralCode = normalizeReferralCodeForDisplay(referral.referralCode);
  if (!referralCode) {
    return `
      <div class="profile-identity-referral" data-profile-identity-referral="true">
        <strong class="profile-activity-action-title">My Referral Code</strong>
        <p class="text-muted" data-profile-referral-unavailable="true">Referral code unavailable. Try again later.</p>
      </div>
    `;
  }

  return `
    <div class="profile-identity-referral profile-referral-action" data-profile-identity-referral="true">
      <strong class="profile-activity-action-title">My Referral Code</strong>
      <code class="profile-referral-code" data-profile-referral-code="true">${escapeProfileText(referralCode)}</code>
      <div class="profile-referral-actions">
        <button id="profile-copy-referral-code-btn" class="btn btn-secondary" type="button">Copy Code</button>
        <button id="profile-copy-referral-link-btn" class="btn btn-secondary" type="button">Copy Invite Link</button>
      </div>
      <p class="text-muted profile-referral-status" data-profile-referral-email-status="${referral.emailVerified ? "verified" : "unverified"}">
        ${referral.emailVerified ? "Email verified." : "Email verification is required for future referral rewards."}
      </p>
      <p class="text-muted profile-referral-help">Rewards unlock later after verified email and real play qualification.</p>
    </div>
  `;
}

function renderProfileSocialToolsCard({
  searchQuery = "",
  searchResults = [],
  searchError = ""
} = {}) {
  return `
    <section class="profile-summary-card stack-sm profile-social-card profile-dashboard-card" data-profile-social-card="true">
      <h3 class="section-title">Social</h3>
      <div class="profile-social-actions">
        <div class="profile-social-action profile-search-card" data-profile-social-action="search-player">
          <strong class="profile-activity-action-title">Search Player Profile</strong>
          <form id="profile-search-form" class="stack-sm">
            <label for="profile-search-input">Username</label>
            <input
              id="profile-search-input"
              name="profileSearch"
              type="text"
              value="${searchQuery}"
              placeholder="Enter username"
            />
          </form>
          ${searchError ? `<p class="text-muted">${searchError}</p>` : ""}
          ${
            searchResults.length
              ? `<div class="stack-sm profile-search-results">${searchResults
                  .map((item) => `<button class="btn" data-view-profile="${item.username}">View ${item.username}</button>`)
                  .join("")}</div>`
              : ""
          }
        </div>
        <div class="profile-social-action" data-profile-social-action="recent-opponents">
          <strong class="profile-activity-action-title">Recent Opponents</strong>
          <p class="text-muted">View recent Online players you faced.</p>
          <button
            id="profile-recent-opponents-btn"
            class="btn btn-secondary"
            type="button"
            data-profile-recent-opponents-btn="true"
          >Recent Opponents</button>
        </div>
      </div>
    </section>
  `;
}

function renderReadOnlyProfile(viewedProfile, options = {}) {
  if (!viewedProfile) {
    return "";
  }

  const achievementCatalog = buildAchievementCatalog(viewedProfile);
  const unlockedAchievements = achievementCatalog.filter((item) => item.unlocked);
  const unlockedAchievementCount = unlockedAchievements.length;
  const totalAchievementCount = achievementCatalog.length;
  const achievementsExpanded = Boolean(options.achievementsExpanded);
  const achievementToggleLabel = achievementsExpanded ? "Hide Achievements" : "Show Achievements";
  const avatar = getAvatarImage(viewedProfile.equippedCosmetics?.avatar);
  const title = getCosmeticDisplayName(
    "title",
    viewedProfile.equippedCosmetics?.title,
    viewedProfile.title ?? "Initiate"
  );
  const featuredBadge = getBadgeImage(viewedProfile.equippedCosmetics?.badge ?? "none");
  const wins = Math.max(0, Number(viewedProfile.wins ?? 0));
  const losses = Math.max(0, Number(viewedProfile.losses ?? 0));
  const cardsCaptured = Math.max(0, Number(viewedProfile.cardsCaptured ?? 0));
  const gamesPlayed = Math.max(0, Number(viewedProfile.gamesPlayed ?? 0));
  const warsEntered = Math.max(0, Number(viewedProfile.warsEntered ?? 0));
  const warsWon = Math.max(0, Number(viewedProfile.warsWon ?? 0));
  const longestWar = Math.max(0, Number(viewedProfile.longestWar ?? 0));
  const bestWinStreak = Math.max(0, Number(viewedProfile.bestWinStreak ?? 0));
  const featuredRivalWins = Math.max(0, Number(viewedProfile.featuredRivalWins ?? 0));
  const pveStats = viewedProfile.modeStats?.pve ?? {};
  const localPvpStats = viewedProfile.modeStats?.local_pvp ?? {};
  const onlinePvpStats = viewedProfile.modeStats?.online_pvp ?? {};
  const viewedBackgroundId =
    viewedProfile.equippedCosmetics?.background ??
    viewedProfile.cosmetics?.background ??
    "default_background";
  const viewedBackground = getArenaBackground(viewedBackgroundId);
  const headingText =
    options.headingText === undefined ? `Viewing: ${viewedProfile.username}` : options.headingText;
  const showHeading = options.showHeading !== false;
  const wrapperClassName = String(options.wrapperClassName ?? "").trim();
  const wrapperClassAttribute = wrapperClassName
    ? `panel stack-sm viewed-profile-panel ${wrapperClassName}`
    : "panel stack-sm viewed-profile-panel";

  return `
    <section class="${wrapperClassAttribute}" style="background-image: url('${viewedBackground}')">
      <div class="viewed-profile-content">
        ${showHeading && headingText ? `<h3 class="section-title">${headingText}</h3>` : ""}
        ${renderProfileIdentityHeader({
          username: viewedProfile.username,
          avatarId: viewedProfile.equippedCosmetics?.avatar,
          avatarSrc: avatar,
          avatarPublicMetadata: findViewedEquippedAvatarPublicMetadata(
            viewedProfile,
            viewedProfile.equippedCosmetics?.avatar
          ),
          title,
          titleId: viewedProfile.equippedCosmetics?.title,
          titleIcon: viewedTitleIcon(viewedProfile),
          badgeId: viewedProfile.equippedCosmetics?.badge ?? "none",
          badgeSrc: featuredBadge
        })}
        ${renderProfileFlexPanels(viewedProfile, {
          titleIcon: viewedTitleIcon(viewedProfile)
        })}
        ${renderProfileShowcase(viewedProfile, {
          publicView: true
        })}
        ${renderPublicCollectionCompletedSummary(viewedProfile)}
        <div class="profile-summary-grid profile-summary-grid-viewed">
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Overall Record</h3>
            ${renderStatList([
              { label: "Wins", value: wins },
              { label: "Losses", value: losses },
              { label: "Games Played", value: gamesPlayed },
              { label: "Best Win Streak", value: bestWinStreak }
            ])}
          </section>
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Battle Stats</h3>
            ${renderStatList([
              { label: "Cards Captured", value: cardsCaptured },
              { label: "WARs Entered", value: warsEntered },
              { label: "WARs Won", value: warsWon },
              { label: "Longest WAR", value: longestWar }
            ])}
          </section>
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Featured Rival</h3>
            ${renderStatList([{ label: "Featured Rival Wins", value: featuredRivalWins }])}
          </section>
          ${renderGauntletStatsCard(viewedProfile)}
          ${renderBloodMatchStatsCard(viewedProfile, { publicView: true })}
        </div>
        <section class="profile-summary-card stack-sm">
          <h3 class="section-title">Mode Stats</h3>
          <div class="profile-mode-grid">
            ${renderModeStatsCard("PvE", pveStats)}
            ${renderModeStatsCard("Local PvP", localPvpStats)}
            ${renderModeStatsCard("Online PvP", onlinePvpStats)}
          </div>
        </section>
        <div class="section-heading-row profile-achievements-heading">
          <h3 class="section-title">Achievements (${unlockedAchievementCount}/${totalAchievementCount})</h3>
          <button id="viewed-profile-achievements-toggle-btn" class="btn btn-secondary" type="button">${achievementToggleLabel}</button>
        </div>
        ${
          achievementsExpanded
            ? `<div class="achievement-grid achievement-grid-profile">
                ${
                  unlockedAchievements.length > 0
                    ? unlockedAchievements.map(renderAchievement).join("")
                    : "<p>No unlocked achievements yet.</p>"
                }
              </div>`
            : ""
        }
      </div>
    </section>
  `;
}

function renderViewedProfileModalBody(viewedProfile, options = {}) {
  if (!viewedProfile) {
    return "";
  }

  return `
    <div class="viewed-profile-modal-content stack-sm">
      <p class="text-muted viewed-profile-modal-intro">Read-only player profile</p>
      ${renderReadOnlyProfile(viewedProfile, {
        achievementsExpanded: options.achievementsExpanded,
        showHeading: false,
        wrapperClassName: "viewed-profile-panel-modal"
      })}
    </div>
  `;
}

export const profileScreen = {
  render(context) {
    const profile = context.profile;
    const achievementCatalog = Array.isArray(context.achievementCatalog)
      ? context.achievementCatalog
      : buildAchievementCatalog(profile);
    const unlockedAchievements = achievementCatalog.filter((item) => item.unlocked);
    const unlockedAchievementCount = unlockedAchievements.length;
    const totalAchievementCount = achievementCatalog.length;
    const profileAchievementsExpanded = Boolean(context.profileAchievementsExpanded);
    const searchResults = context.searchResults ?? [];
    const cosmetics = context.cosmetics;
    const onlinePvpStats = profile.modeStats?.online_pvp ?? {};

    const playerAvatar = getAvatarImage(profile.equippedCosmetics?.avatar);
    const profileTitleIcon = getTitleCatalogIcon(cosmetics, profile.equippedCosmetics?.title);
    const equippedTitle = getCosmeticDisplayName(
      "title",
      profile.equippedCosmetics?.title,
      profile.title ?? "Initiate"
    );

    return `
      <section class="screen screen-profile">
        <div class="screen-topbar">
          <h2 class="view-title">Profile</h2>
          <button id="profile-back-btn" class="btn screen-back-btn">Back</button>
        </div>
        <section class="${buildThemedSurfaceClassName({ backgroundImage: context.backgroundImage ?? "" })}" style="background-image: url('${context.backgroundImage}')">
          <div class="panel themed-screen-panel">
          <div class="profile-dashboard-grid" data-profile-dashboard="true">
            ${renderProfileIdentityCard({
              username: profile.username,
              avatarId: profile.equippedCosmetics?.avatar,
              avatarSrc: playerAvatar,
              avatarPublicMetadata: findOwnEquippedAvatarPublicMetadata(
                cosmetics,
                profile.equippedCosmetics?.avatar
              ),
              title: equippedTitle,
              titleId: profile.equippedCosmetics?.title ?? profile.title,
              titleIcon: profileTitleIcon,
              badgeId: profile.equippedCosmetics?.badge ?? "none",
              badgeSrc: getBadgeImage(profile.equippedCosmetics?.badge ?? "none"),
              referral: context.referral ?? {}
            })}
            ${renderProfileSocialToolsCard({
              searchQuery: context.searchQuery ?? "",
              searchError: context.searchError ?? "",
              searchResults
            })}
            ${renderActivityToolsCard()}
          </div>
          ${renderProfileFlexPanels(profile, {
            titleIcon: profileTitleIcon
          })}
          ${renderProfileShowcase(profile, {
            catalog: cosmetics?.catalog ?? null,
            editable: true
          })}
          ${renderOwnCollectionCompletedSummary(profile)}
          ${renderChestPanel(profile, context.basicChestVisualState, {
            openingInFlight: context.profileChestOpenInFlight
          })}
          <div class="profile-summary-grid">
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Overall Record</h3>
              ${renderStatList([
                { label: "Wins", value: profile.wins ?? 0 },
                { label: "Losses", value: profile.losses ?? 0 },
                { label: "Games Played", value: profile.gamesPlayed ?? 0 },
                { label: "Best Win Streak", value: profile.bestWinStreak ?? 0 }
              ])}
            </section>
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Battle Stats</h3>
              ${renderStatList([
                { label: "Cards Captured", value: profile.cardsCaptured ?? 0 },
                { label: "WARs Entered", value: profile.warsEntered ?? 0 },
                { label: "WARs Won", value: profile.warsWon ?? 0 },
                { label: "Longest WAR", value: profile.longestWar ?? 0 }
              ])}
            </section>
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Featured Rival</h3>
              ${renderStatList([
                { label: "Featured Rival Wins", value: profile.featuredRivalWins ?? 0 }
              ])}
            </section>
            ${renderGauntletStatsCard(profile)}
            ${renderBloodMatchStatsCard(profile)}
          </div>

          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Mode Stats</h3>
            <div class="profile-mode-grid">
              ${renderModeStatsCard("PvE", profile.modeStats?.pve ?? {})}
              ${renderModeStatsCard("Local PvP", profile.modeStats?.local_pvp ?? {})}
              ${renderModeStatsCard("Online PvP", onlinePvpStats)}
            </div>
          </section>

          <div class="section-heading-row profile-achievements-heading">
            <h3 class="section-title">Achievements (${unlockedAchievementCount}/${totalAchievementCount})</h3>
            <button id="profile-achievements-toggle-btn" class="btn btn-secondary" type="button">${profileAchievementsExpanded ? "Hide Achievements" : "Show Achievements"}</button>
          </div>
          ${
            profileAchievementsExpanded
              ? `<div class="achievement-grid achievement-grid-profile">
                  ${
                    unlockedAchievements.length > 0
                      ? unlockedAchievements.map(renderAchievement).join("")
                      : "<p>No achievements unlocked yet.</p>"
                  }
                </div>`
              : ""
          }

          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    bindCosmeticHoverPreview({
      root: (typeof document.querySelector === "function" ? document.querySelector(".screen-profile") : null) ?? document,
      documentRef: document
    });

    document.getElementById("profile-back-btn").addEventListener("click", context.actions.back);
    const profileAchievementsToggle = document.getElementById("profile-achievements-toggle-btn");
    if (profileAchievementsToggle && context.actions.toggleProfileAchievements) {
      profileAchievementsToggle.addEventListener("click", context.actions.toggleProfileAchievements);
    }
    document.querySelectorAll("[data-profile-showcase-choose]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotIndex = Number(button.getAttribute("data-profile-showcase-choose"));
        context.actions.openShowcasePicker?.(slotIndex);
      });
    });
    document.querySelectorAll("[data-profile-showcase-clear]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotIndex = Number(button.getAttribute("data-profile-showcase-clear"));
        context.actions.updateShowcaseSlot?.(slotIndex, null);
      });
    });
    const recentOpponentRows = getRecentOpponentRows(context.profile);
    document.querySelectorAll("[data-recent-opponent-index]").forEach((button) => {
      button.addEventListener("click", async () => {
        const index = Number(button.getAttribute("data-recent-opponent-index"));
        const opponentProfileKey = recentOpponentRows[index]?.opponentProfileKey;
        if (!opponentProfileKey || typeof context.actions.viewProfile !== "function") {
          return;
        }
        await context.actions.viewProfile(opponentProfileKey);
      });
    });
    const battleReportButton = document.getElementById("profile-battle-report-btn");
    if (battleReportButton && context.actions.openBattleReport) {
      battleReportButton.addEventListener("click", context.actions.openBattleReport);
    }
    const recentOpponentsButton = document.getElementById("profile-recent-opponents-btn");
    if (recentOpponentsButton && context.actions.openRecentOpponents) {
      recentOpponentsButton.addEventListener("click", context.actions.openRecentOpponents);
    }
    const collectionsButton = document.getElementById("profile-collections-btn");
    if (collectionsButton && context.actions.openCollections) {
      collectionsButton.addEventListener("click", context.actions.openCollections);
    }
    const copyReferralCodeButton = document.getElementById("profile-copy-referral-code-btn");
    if (copyReferralCodeButton && context.actions.copyReferralCode) {
      copyReferralCodeButton.addEventListener("click", () => {
        const referralCode = normalizeReferralCodeForDisplay(context.referral?.referralCode);
        if (referralCode) {
          context.actions.copyReferralCode(referralCode);
        }
      });
    }
    const copyReferralLinkButton = document.getElementById("profile-copy-referral-link-btn");
    if (copyReferralLinkButton && context.actions.copyReferralInviteLink) {
      copyReferralLinkButton.addEventListener("click", () => {
        const referralCode = normalizeReferralCodeForDisplay(context.referral?.referralCode);
        if (referralCode) {
          context.actions.copyReferralInviteLink(
            `${REFERRAL_INVITE_URL}?ref=${encodeURIComponent(referralCode)}`
          );
        }
      });
    }
    const openBasicChestButton = document.getElementById("open-basic-chest-btn");
    if (openBasicChestButton && context.actions.openBasicChest) {
      openBasicChestButton.addEventListener("click", context.actions.openBasicChest);
    }
    const openMilestoneChestButton = document.getElementById("open-milestone-chest-btn");
    if (openMilestoneChestButton && context.actions.openMilestoneChest) {
      openMilestoneChestButton.addEventListener("click", context.actions.openMilestoneChest);
    }
    const openEpicChestButton = document.getElementById("open-epic-chest-btn");
    if (openEpicChestButton && context.actions.openEpicChest) {
      openEpicChestButton.addEventListener("click", context.actions.openEpicChest);
    }
    const openLegendaryChestButton = document.getElementById("open-legendary-chest-btn");
    if (openLegendaryChestButton && context.actions.openLegendaryChest) {
      openLegendaryChestButton.addEventListener("click", context.actions.openLegendaryChest);
    }

    const searchForm = document.getElementById("profile-search-form");
    searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const query = String(formData.get("profileSearch") ?? "").trim();
      await context.actions.searchProfiles(query);
      if (query) {
        await context.actions.viewProfile(query);
      }
    });

    document.querySelectorAll("[data-view-profile]").forEach((button) => {
      button.addEventListener("click", async () => {
        const username = button.getAttribute("data-view-profile");
        await context.actions.viewProfile(username);
      });
    });
  }
};

profileScreen.renderViewedProfileModalBody = renderViewedProfileModalBody;
profileScreen.renderShowcasePickerBody = renderProfileShowcasePickerBody;
profileScreen.renderBattleReportModalBody = renderBattleReportModalBody;
profileScreen.renderRecentOpponentsModalBody = renderRecentOpponentsModalBody;
profileScreen.renderCollectionAlbumsModalBody = renderCollectionAlbumsModalBody;
profileScreen.getRecentOpponentRows = getRecentOpponentRows;
profileScreen.formatRecentOpponentRelativeTime = formatRecentOpponentRelativeTime;









