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

export function createDefaultCategoryViewState() {
  return {
    categories: new Set(FILTERABLE_CATEGORIES.map(([type]) => type))
  };
}

export function normalizeCategoryViewState(viewState) {
  const defaults = createDefaultCategoryViewState();
  return {
    categories:
      viewState?.categories instanceof Set
        ? viewState.categories
        : new Set(viewState?.categories ?? defaults.categories)
  };
}
