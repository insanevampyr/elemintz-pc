import { ASSET_CATALOG, escapeHtml, getCardImage, formatElement } from "../../utils/index.js";
import { getAssetPath } from "../../utils/dom.js";
import { COSMETIC_CATALOG, getCosmeticDefinition, getCosmeticHoverMetadata } from "../../../state/cosmeticSystem.js";
import { buildHoverPreviewAttributes, hasRenderablePreviewSource } from "./cosmeticHoverPreview.js";

export const ELEMENT_ORDER = ["fire", "earth", "wind", "water"];
export const MATCH_TAUNT_PRESETS = Object.freeze([
  "Your move.",
  "Bold choice.",
  "Interesting.",
  "You got lucky.",
  "Well played.",
  "This isn't over.",
  "I saw that coming.",
  "Let's finish this.",
  "A risky play.",
  "Not bad."
]);
const SUPPORTED_RARITIES = new Set(["Common", "Rare", "Epic", "Legendary"]);

export function normalizeCosmeticRarity(rarity) {
  return SUPPORTED_RARITIES.has(rarity) ? rarity : "Common";
}

export function rarityClassName(rarity) {
  return `rarity-${normalizeCosmeticRarity(rarity).toLowerCase()}`;
}

export function getCardElement(card) {
  if (typeof card === "string") {
    return card.toLowerCase();
  }

  if (card && typeof card === "object") {
    const raw = card.element ?? card.type ?? card.name ?? null;
    return typeof raw === "string" ? raw.toLowerCase() : null;
  }

  return null;
}

function resolveCosmeticDefinitionFromIdentity(type, { id = null, name = null, image = null } = {}) {
  const definitionById = id ? getCosmeticDefinition(type, id) : null;
  if (definitionById) {
    return definitionById;
  }

  const catalog = Array.isArray(COSMETIC_CATALOG[type]) ? COSMETIC_CATALOG[type] : [];
  const normalizedName = typeof name === "string" ? name.trim().toLowerCase() : "";
  const normalizedImage = typeof image === "string" ? image.trim().toLowerCase() : "";

  return (
    catalog.find((item) => {
      const itemName = String(item?.name ?? "").trim().toLowerCase();
      const itemId = String(item?.id ?? "").trim().toLowerCase();
      const itemImage = item?.image ? getAssetPath(item.image).trim().toLowerCase() : "";

      return (
        (normalizedName && (itemName === normalizedName || itemId === normalizedName)) ||
        (normalizedImage && itemImage === normalizedImage)
      );
    }) ?? null
  );
}

function getElementCounts(cardsOrCounts) {
  if (Array.isArray(cardsOrCounts)) {
    const normalizedCards = cardsOrCounts.map((card) => getCardElement(card));
    const counts = Object.fromEntries(
      ELEMENT_ORDER.map((element) => [
        element,
        normalizedCards.reduce((sum, card) => sum + (card === element ? 1 : 0), 0)
      ])
    );

    return {
      normalizedCards,
      counts
    };
  }

  return {
    normalizedCards: [],
    counts: Object.fromEntries(
      ELEMENT_ORDER.map((element) => [element, Math.max(0, Number(cardsOrCounts?.[element] ?? 0))])
    )
  };
}

export function renderPlayerHeader(playerDisplay, fallbackName, countLabel) {
  const name = escapeHtml(playerDisplay?.name ?? fallbackName);
  const title = escapeHtml(playerDisplay?.title ?? "Initiate");
  const avatar = playerDisplay?.avatar ?? ASSET_CATALOG.avatars.default_avatar;
  const avatarImageSrc = hasRenderablePreviewSource(avatar, { previewName: playerDisplay?.name ?? fallbackName })
    ? avatar
    : null;
  const titleIcon = playerDisplay?.titleIcon ?? null;
  const titleDefinition = resolveCosmeticDefinitionFromIdentity("title", {
    id: playerDisplay?.titleId ?? null,
    name: playerDisplay?.title ?? null,
    image: titleIcon
  });
  const canonicalTitleImage = titleDefinition?.image ? getAssetPath(titleDefinition.image) : null;
  const titleDisplaySrc = hasRenderablePreviewSource(titleIcon, {
    previewName: playerDisplay?.title ?? "Initiate",
    previewVisualText: playerDisplay?.title ?? "Initiate"
  })
    ? titleIcon
    : hasRenderablePreviewSource(canonicalTitleImage, {
        previewName: playerDisplay?.title ?? "Initiate",
        previewVisualText: playerDisplay?.title ?? "Initiate"
      })
      ? canonicalTitleImage
      : null;
  const titlePreviewSrc = hasRenderablePreviewSource(canonicalTitleImage, {
    previewName: playerDisplay?.title ?? "Initiate",
    previewVisualText: playerDisplay?.title ?? "Initiate"
  })
    ? canonicalTitleImage
    : null;
  const featuredBadge = hasRenderablePreviewSource(playerDisplay?.featuredBadge ?? null, {
    previewName: "Featured Badge"
  })
    ? playerDisplay.featuredBadge
    : null;
  const avatarHoverMetadata = getCosmeticHoverMetadata(
    "avatar",
    playerDisplay?.avatarId,
    playerDisplay?.name ?? fallbackName
  );
  const resolvedTitleId = titleDefinition?.id ?? playerDisplay?.titleId ?? null;
  const badgeDefinition = resolveCosmeticDefinitionFromIdentity("badge", {
    id: playerDisplay?.badgeId ?? null,
    image: featuredBadge
  });
  const resolvedBadgeId = badgeDefinition?.id ?? playerDisplay?.badgeId ?? null;
  const titleHoverMetadata = getCosmeticHoverMetadata(
    "title",
    resolvedTitleId,
    playerDisplay?.title ?? "Initiate"
  );
  const badgeHoverMetadata = resolvedBadgeId
    ? getCosmeticHoverMetadata("badge", resolvedBadgeId, "Featured Badge")
    : null;
  const avatarHoverAttributes = buildHoverPreviewAttributes({
    previewType: "avatar",
    previewSrc: avatarImageSrc,
    previewName: avatarHoverMetadata.name ?? playerDisplay?.name ?? fallbackName,
    previewRarity: avatarHoverMetadata.rarity
  });
  const titleHoverAttributes = buildHoverPreviewAttributes({
    previewType: "title",
    previewSrc: titlePreviewSrc,
    previewName: titleHoverMetadata.name ?? playerDisplay?.title ?? "Initiate",
    previewDescription: titleHoverMetadata.description,
    previewVisualText: playerDisplay?.title ?? "Initiate",
    previewRarity: titleHoverMetadata.rarity
  });
  const badgeHoverAttributes = featuredBadge
    ? buildHoverPreviewAttributes({
        previewType: "badge",
        previewSrc: featuredBadge,
        previewName: badgeHoverMetadata?.name ?? "Featured Badge",
        previewDescription: badgeHoverMetadata?.description ?? "",
        previewRarity: badgeHoverMetadata?.rarity ?? "Common"
      })
    : "";
  const safeCountLabel = countLabel ? ` ${escapeHtml(countLabel)}` : "";

  return `
    <div class="player-header">
      ${avatarImageSrc ? `<img class="player-avatar" src="${avatarImageSrc}" alt="${name}" ${avatarHoverAttributes} />` : ""}
      <div>
        <h3>${name}${safeCountLabel}</h3>
        <p class="player-title"><span class="player-title-preview" ${titleHoverAttributes}>${titleDisplaySrc ? `<img class="title-icon" src="${titleDisplaySrc}" alt="${title}" />` : ""}<span>${title}</span></span>${featuredBadge ? `<img class="featured-badge" src="${featuredBadge}" alt="Featured Badge" ${badgeHoverAttributes} />` : ""}</p>
      </div>
    </div>
  `;
}

export function renderElementHandSummary(cardsOrCounts, owner, options = {}) {
  const selectable = Boolean(options.selectable);
  const selectedCardIndex = Number.isInteger(options.selectedCardIndex) ? options.selectedCardIndex : null;
  const phase = options.phase ?? "idle";
  const variantMap = options.variantMap ?? null;
  const rarityMap = options.rarityMap ?? null;
  const selectableClass = options.selectableClass ?? null;
  const buttonAttributes = options.buttonAttributes ?? null;
  const isDisabled =
    typeof options.isDisabled === "function"
      ? options.isDisabled
      : ({ isAvailable }) => !(selectable && isAvailable);

  const { normalizedCards, counts } = getElementCounts(cardsOrCounts);

  return ELEMENT_ORDER.map((element) => {
    const firstIndex = normalizedCards.findIndex((card) => card === element);
    const count = Math.max(0, Number(counts[element] ?? 0));
    const isAvailable = count > 0;
    const isSelected = isAvailable && selectedCardIndex === firstIndex;
    const classes = ["hand-slot", `hand-slot-${element}`];
    const rarity = rarityMap?.[element] ?? "Common";

    classes.push(rarityClassName(rarity));

    if (selectable && isAvailable) {
      classes.push("is-selectable");
      if (selectableClass) {
        classes.push(selectableClass);
      }
    }

    if (!isAvailable) {
      classes.push("is-empty");
    }

    if (isSelected && phase === "play") {
      classes.push("is-playing");
    }

    const attrs =
      typeof buttonAttributes === "function"
        ? buttonAttributes({ element, count, isAvailable, firstIndex, owner })
        : [
            `data-card-index="${isAvailable ? firstIndex : -1}"`,
            `data-card-owner="${owner}"`,
            `data-element="${element}"`
          ].join(" ");

    return `
      <button
        type="button"
        class="${classes.join(" ")}"
        data-cosmetic-rarity="${normalizeCosmeticRarity(rarity)}"
        ${attrs}
        ${isDisabled({ element, count, isAvailable, firstIndex, owner }) ? "disabled" : ""}
      >
        <span class="card-art hand-slot-art" style="background-image: url('${getCardImage(element, variantMap)}')"></span>
        <span class="hand-slot-count-badge" aria-label="${formatElement(element)} count x${count}">x${count}</span>
      </button>
    `;
  }).join("");
}

export function renderHiddenHandSummary(count, backImage = ASSET_CATALOG.cards.back, rarity = "Common") {
  const safeCount = Math.max(0, Number(count) || 0);
  const previewCount = Math.min(3, Math.max(1, safeCount));
  const stack = Array.from({ length: previewCount }, (_, index) => `
    <span
      class="hidden-hand-card hidden-hand-card-${index} ${rarityClassName(rarity)}"
      style="background-image: url('${backImage}')"
      aria-hidden="true"
    ></span>
  `).join("");

  return `
    <div class="hidden-hand-summary ${rarityClassName(rarity)}" data-cosmetic-rarity="${normalizeCosmeticRarity(rarity)}" aria-label="Hidden opponent hand: ${safeCount} cards">
      <div class="hidden-hand-stack">
        ${stack}
      </div>
      <div class="hidden-hand-count">x${safeCount}</div>
    </div>
  `;
}

function getTauntSpeakerClass(message) {
  const kind = String(message?.kind ?? "").trim().toLowerCase();
  if (kind === "ai") {
    return "is-ai";
  }

  if (kind === "opponent") {
    return "is-opponent";
  }

  return "is-player";
}

export function renderMatchTauntHud({
  idPrefix = "match",
  panelOpen = false,
  messages = [],
  presetLines = MATCH_TAUNT_PRESETS
} = {}) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-4) : [];
  const safePresetLines = Array.isArray(presetLines) ? presetLines : MATCH_TAUNT_PRESETS;

  return `
    <aside class="match-taunt-shell ${panelOpen ? "is-open" : ""}" data-match-taunt-shell="${escapeHtml(idPrefix)}">
      <div class="match-taunt-feed" aria-live="polite" aria-label="Recent taunts">
        ${safeMessages
          .map(
            (message) => `
              <div class="match-taunt-entry ${getTauntSpeakerClass(message)}">
                <strong>${escapeHtml(message?.speaker ?? "Player")}</strong>
                <span>${escapeHtml(message?.text ?? "")}</span>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="match-taunt-controls">
        <button id="${escapeHtml(idPrefix)}-taunts-toggle-btn" type="button" class="btn btn-secondary match-taunts-toggle-btn" aria-expanded="${panelOpen ? "true" : "false"}">
          Taunts
        </button>
        ${
          panelOpen
            ? `
              <div id="${escapeHtml(idPrefix)}-taunts-panel" class="match-taunt-panel" data-match-taunt-panel="${escapeHtml(idPrefix)}">
                ${safePresetLines
                  .map(
                    (line, index) => `
                      <button type="button" class="match-taunt-option" data-taunt-line="${escapeHtml(line)}" data-taunt-index="${String(index)}">
                        ${escapeHtml(line)}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </div>
    </aside>
  `;
}
