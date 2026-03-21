export const CATEGORY_ORDER = Object.freeze([
  ["avatar", "Avatars"],
  ["cardBack", "Card Backs"],
  ["background", "Backgrounds"],
  ["elementCardVariant", "Element Card Variants"],
  ["title", "Titles"],
  ["badge", "Badges"]
]);

export const FILTERABLE_CATEGORIES = Object.freeze([
  ["avatar", "Avatars"],
  ["background", "Backgrounds"],
  ["cardBack", "Card Backs"],
  ["elementCardVariant", "Card Variants"],
  ["title", "Titles"],
  ["badge", "Badges"]
]);

export const FILTERABLE_RARITIES = Object.freeze(["Common", "Rare", "Epic", "Legendary"]);

export const RARITY_SORT_ORDER = Object.freeze({
  Legendary: 0,
  Epic: 1,
  Rare: 2,
  Common: 3
});

export function createDefaultCategoryViewState() {
  return {
    categories: new Set(FILTERABLE_CATEGORIES.map(([type]) => type)),
    rarities: new Set(FILTERABLE_RARITIES)
  };
}

export function normalizeCategoryViewState(viewState) {
  const defaults = createDefaultCategoryViewState();
  return {
    categories:
      viewState?.categories instanceof Set
        ? viewState.categories
        : new Set(viewState?.categories ?? defaults.categories),
    rarities:
      viewState?.rarities instanceof Set
        ? viewState.rarities
        : new Set(viewState?.rarities ?? defaults.rarities)
  };
}
