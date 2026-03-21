import { ASSET_CATALOG, escapeHtml, getCardImage, formatElement } from "../../utils/index.js";

export const ELEMENT_ORDER = ["fire", "earth", "wind", "water"];
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
  const titleIcon = playerDisplay?.titleIcon ?? null;
  const featuredBadge = playerDisplay?.featuredBadge ?? null;

  return `
    <div class="player-header">
      <img class="player-avatar" src="${avatar}" alt="${name}" />
      <div>
        <h3>${name} ${countLabel}</h3>
        <p class="player-title">${titleIcon ? `<img class="title-icon" src="${titleIcon}" alt="${title}" />` : ""}<span>${title}</span>${featuredBadge ? `<img class="featured-badge" src="${featuredBadge}" alt="Featured Badge" />` : ""}</p>
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
