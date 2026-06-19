import { getAssetPath } from "../../utils/dom.js";
import {
  CATEGORY_ORDER as COSMETIC_SECTIONS,
  FILTERABLE_CATEGORIES,
  FILTERABLE_ELEMENTS,
  FILTERABLE_RARITIES,
  RARITY_SORT_ORDER,
  normalizeCategoryViewState
} from "../shared/cosmeticCategoryShared.js";
import {
  bindCosmeticHoverPreview,
  buildHoverPreviewAttributes,
  hasRenderablePreviewSource
} from "../shared/cosmeticHoverPreview.js";
import { buildThemedSurfaceClassName } from "../shared/themedSurfaceShared.js";
import { getCosmeticDefinition, getCosmeticHoverMetadata } from "../../../state/cosmeticSystem.js";

const RANDOMIZE_AFTER_MATCH_OPTIONS = Object.freeze([
  ["avatar", "Avatar"],
  ["title", "Title"],
  ["badge", "Badge"],
  ["elementCardVariant", "Card Variant"],
  ["cardBack", "Card Back"],
  ["background", "Background"]
]);

function createSafeCosmeticsPayload(cosmetics) {
  const source = cosmetics && typeof cosmetics === "object" ? cosmetics : {};
  return {
    ...source,
    catalog: source.catalog && typeof source.catalog === "object" ? source.catalog : {},
    owned: source.owned && typeof source.owned === "object" ? source.owned : {},
    equipped: source.equipped && typeof source.equipped === "object" ? source.equipped : {},
    loadouts: Array.isArray(source.loadouts) ? source.loadouts : [],
    preferences: source.preferences && typeof source.preferences === "object" ? source.preferences : {}
  };
}

function normalizeRarity(rarity) {
  return FILTERABLE_RARITIES.includes(rarity) ? rarity : "Common";
}

function rarityClassName(rarity) {
  return `rarity-${normalizeRarity(rarity).toLowerCase()}`;
}

function usesRarityFrame(type) {
  return Boolean(type);
}

function renderCollectionChip(collection) {
  if (!collection) {
    return "";
  }

  return `<p><span class="cosmetic-collection-chip">${collection} Collection</span></p>`;
}

function resolveOwnedItemNewStatus(type, item) {
  const definition = item?.id ? getCosmeticDefinition(type, item.id) : null;
  if (typeof definition?.isNew === "boolean") {
    return definition.isNew;
  }

  return Boolean(item?.isNew);
}

function getCosmeticTypeLabel(type, item) {
  if (type === "avatar") {
    return "Avatar";
  }

  if (type === "cardBack") {
    return "Card Back";
  }

  if (type === "background") {
    return "Background";
  }

  if (type === "title") {
    return "Title";
  }

  if (type === "badge") {
    return "Badge";
  }

  if (type === "elementCardVariant") {
    const element = String(item?.element ?? "").trim().toLowerCase();
    if (["fire", "water", "earth", "wind"].includes(element)) {
      return `${element[0].toUpperCase()}${element.slice(1)} Variant`;
    }

    return "Card Variant";
  }

  return "Cosmetic";
}

function normalizeCollectionKey(collection) {
  return String(collection ?? "").trim();
}

function resolveVariantElement(item) {
  const explicitElement = String(item?.element ?? "").trim().toLowerCase();
  if (["fire", "water", "earth", "wind"].includes(explicitElement)) {
    return explicitElement;
  }

  const id = String(item?.id ?? "").trim().toLowerCase();
  for (const [element] of FILTERABLE_ELEMENTS) {
    if (id.startsWith(`${element}_variant_`)) {
      return element;
    }
  }

  return "";
}

function getOwnedCollectionOptions(cosmetics) {
  const seen = new Set();
  const options = [];

  for (const [, items] of Object.entries(cosmetics?.catalog ?? {})) {
    for (const item of items ?? []) {
      if (!item?.owned) {
        continue;
      }
      const collection = normalizeCollectionKey(item?.collection);
      if (!collection || seen.has(collection)) {
        continue;
      }
      seen.add(collection);
      options.push(collection);
    }
  }

  return options.sort((left, right) => left.localeCompare(right));
}

function reconcileCollectionSelections(viewState, availableCollections = []) {
  const available = new Set(
    Array.isArray(availableCollections)
      ? availableCollections.map((collection) => normalizeCollectionKey(collection)).filter(Boolean)
      : []
  );

  viewState.collections = new Set(
    [...viewState.collections].map((collection) => normalizeCollectionKey(collection)).filter((collection) => {
      return collection && available.has(collection);
    })
  );

  return viewState;
}

function supportsHoverPreview(type, hasRenderableImage) {
  return hasRenderableImage || type === "title" || type === "badge";
}

function previewTypeClass(type) {
  if (type === "avatar") {
    return "is-avatar";
  }

  if (type === "cardBack" || type === "elementCardVariant") {
    return "is-card";
  }

  if (type === "background") {
    return "is-background";
  }

  if (type === "badge") {
    return "is-badge";
  }

  if (type === "title") {
    return "is-title";
  }

  return "is-default";
}

function preview(type, item) {
  if (!item.image) {
    if (type !== "title" && type !== "badge") {
      return `<div class="cosmetic-preview missing">No Preview</div>`;
    }
  }

  const src = item.image ? getAssetPath(item.image) : null;
  const hasRenderableImage = hasRenderablePreviewSource(src, { previewName: item.name });
  if (!hasRenderableImage) {
    if (type !== "title" && type !== "badge") {
      return `<div class="cosmetic-preview missing">No Preview</div>`;
    }
  }
  const hoverMetadata = getCosmeticHoverMetadata(type, item.id, item.name);
  const hoverAttributes = supportsHoverPreview(type, hasRenderableImage)
    ? buildHoverPreviewAttributes({
        previewType: type,
        previewSrc: hasRenderableImage ? src : null,
        previewName: item.name,
        previewDescription: hoverMetadata.description,
        previewVisualText: item.name,
        previewRarity: normalizeRarity(item.rarity)
      })
    : "";
  const framed = usesRarityFrame(type);
  return `
    <div
      class="cosmetic-preview-wrap ${previewTypeClass(type)} ${framed ? "is-framed" : ""}"
      ${hoverAttributes}
    >
      ${
        hasRenderableImage
          ? `<img
        class="cosmetic-preview ${previewTypeClass(type)} ${framed ? "is-framed" : ""}"
        src="${src}"
        alt="${item.name}"
      />`
          : type === "title"
            ? `<div class="cosmetic-preview cosmetic-preview-text-visual cosmetic-preview is-title-fallback ${framed ? "is-framed" : ""}">${item.name}</div>`
            : ""
      }
      <div class="cosmetic-preview missing" style="display:none;">No Preview</div>
    </div>
  `;
}

function renderItem(type, item) {
  const resolvedIsNew = resolveOwnedItemNewStatus(type, item);
  const framed = usesRarityFrame(type);
  const variantHint =
    type === "elementCardVariant" && item.element
      ? `<p>Applies to: ${item.element[0].toUpperCase()}${item.element.slice(1)} cards only</p>`
      : "";
  const newBadge = resolvedIsNew ? '<span class="store-item-badge store-item-badge-new">NEW</span>' : "";

  return `
    <article class="cosmetic-item cosmetic-item-${type} ${framed ? "cosmetic-item-framed" : ""} ${framed ? rarityClassName(item.rarity) : ""} owned" data-cosmetic-rarity="${normalizeRarity(item.rarity)}" data-cosmetic-collection="${normalizeCollectionKey(item.collection).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}" data-cosmetic-element="${type === "elementCardVariant" ? resolveVariantElement(item).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") : ""}" data-cosmetic-is-new="${resolvedIsNew ? "true" : "false"}" data-cosmetic-original-index="${item.originalIndex ?? 0}">
      ${newBadge}
      ${preview(type, item)}
      <div class="cosmetic-meta">
        <p><strong>${item.name}</strong></p>
        ${renderCollectionChip(item.collection)}
        <p>Type: ${getCosmeticTypeLabel(type, item)}</p>
        <p>Rarity: <span class="cosmetic-rarity-label ${framed ? rarityClassName(item.rarity) : ""}">${normalizeRarity(item.rarity)}</span></p>
        ${item.rarity === "Unique" ? `<p class="unique-cosmetic-label">Unique Cosmetic</p><p>Owned by You</p>${item.createdForUsername ? `<p>Created For: ${escapeAttribute(item.createdForUsername)}</p>` : ""}` : ""}
        <p>Equipped: ${item.equipped ? "Yes" : "No"}</p>
        ${variantHint}
      </div>
      <div>
        <button class="btn" data-equip-type="${type}" data-equip-id="${item.id}" ${item.equipped ? "disabled" : ""}>${item.equipped ? "Equipped" : "Equip"}</button>
      </div>
    </article>
  `;
}

function sortOwnedItems(items) {
  return [...items].sort((left, right) => {
    const equippedDelta = Number(Boolean(right?.equipped)) - Number(Boolean(left?.equipped));
    if (equippedDelta !== 0) {
      return equippedDelta;
    }
    const leftRarity = RARITY_SORT_ORDER[left?.rarity ?? "Common"] ?? RARITY_SORT_ORDER.Common;
    const rightRarity = RARITY_SORT_ORDER[right?.rarity ?? "Common"] ?? RARITY_SORT_ORDER.Common;
    if (leftRarity !== rightRarity) {
      return leftRarity - rightRarity;
    }
    return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
  });
}

function sortOwnedItemsForDisplay(type, items, showNewFirst) {
  const ordered = sortOwnedItems(items).map((item, index) => ({
    ...item,
    isNew: resolveOwnedItemNewStatus(type, item),
    originalIndex: index
  }));

  if (!showNewFirst) {
    return ordered;
  }

  return [...ordered].sort((left, right) => {
    const newDelta = Number(Boolean(right?.isNew)) - Number(Boolean(left?.isNew));
    if (newDelta !== 0) {
      return newDelta;
    }

    return Number(left?.originalIndex ?? 0) - Number(right?.originalIndex ?? 0);
  });
}

function sortRenderedCosmeticItems(items, showNewFirst) {
  return [...items].sort((left, right) => {
    if (showNewFirst) {
      const newDelta =
        Number(Boolean(right.getAttribute("data-cosmetic-is-new") === "true")) -
        Number(Boolean(left.getAttribute("data-cosmetic-is-new") === "true"));
      if (newDelta !== 0) {
        return newDelta;
      }
    }

    return (
      Number(left.getAttribute("data-cosmetic-original-index") ?? 0) -
      Number(right.getAttribute("data-cosmetic-original-index") ?? 0)
    );
  });
}

function normalizeRandomizePreferences(preferences) {
  const source = preferences?.randomizeAfterEachMatch ?? {};
  return {
    avatar: Boolean(source.avatar),
    title: Boolean(source.title),
    badge: Boolean(source.badge),
    elementCardVariant: Boolean(source.elementCardVariant),
    cardBack: Boolean(source.cardBack),
    background: Boolean(source.background ?? preferences?.randomizeBackgroundEachMatch)
  };
}

function renderRandomizePanel(cosmetics) {
  const preferences = normalizeRandomizePreferences(cosmetics?.preferences);
  return `
    <section class="panel cosmetic-randomize-panel" data-cosmetic-randomize-panel="true">
      <div class="cosmetic-randomize-panel-copy">
        <h3 class="section-title">Randomize After Each Match</h3>
        <p>Only owned cosmetics are used. Unchecked categories stay equipped as-is.</p>
      </div>
      <div class="store-filter-options cosmetic-randomize-options">
        ${RANDOMIZE_AFTER_MATCH_OPTIONS.map(
          ([type, label]) => `
            <label class="store-filter-option cosmetic-randomize-option">
              <input type="checkbox" data-randomize-after-match="${type}" ${preferences[type] ? "checked" : ""} />
              <span>${label}</span>
            </label>
          `
        ).join("")}
      </div>
      <div class="cosmetic-randomize-actions">
        <button id="cosmetics-randomize-now-btn" class="btn" type="button">Randomize Now</button>
      </div>
    </section>
  `;
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderLoadoutCard(slot) {
  if (!slot.unlocked) {
    return `
      <article class="cosmetic-loadout-card is-locked" data-loadout-slot="${slot.index}">
        <div class="cosmetic-loadout-header">
          <div>
            <p class="cosmetic-loadout-kicker">Locked Slot</p>
            <h4>${slot.name}</h4>
          </div>
          <span class="cosmetic-loadout-pill">Level ${slot.unlockLevel}</span>
        </div>
        <p class="cosmetic-loadout-lock-copy">Unlocks at Level ${slot.unlockLevel}.</p>
      </article>
    `;
  }

  return `
    <article class="cosmetic-loadout-card ${slot.isActive ? "is-active" : ""}" data-loadout-slot="${slot.index}">
      <div class="cosmetic-loadout-header">
        <div>
          <p class="cosmetic-loadout-kicker">Loadout Slot ${slot.slotNumber}</p>
          <h4>${slot.name}</h4>
        </div>
        <span class="cosmetic-loadout-pill">${slot.hasSavedLoadout ? "Saved" : "Empty"}</span>
      </div>
      <label class="cosmetic-loadout-name-field">
        <span>Rename Loadout</span>
        <input
          type="text"
          data-loadout-name-input="${slot.index}"
          value="${escapeAttribute(slot.name)}"
          maxlength="40"
          placeholder="Loadout ${slot.slotNumber}"
        />
      </label>
      <div class="cosmetic-loadout-actions">
        <button class="btn" data-loadout-rename="${slot.index}">Rename</button>
        <button class="btn" data-loadout-save="${slot.index}">Save to Slot</button>
        <button class="btn btn-primary" data-loadout-apply="${slot.index}" ${slot.hasSavedLoadout ? "" : "disabled"}>Load</button>
      </div>
      <p class="cosmetic-loadout-meta">
        ${slot.hasSavedLoadout ? "Stores your saved avatar, title, badge, background, card back, and element variants." : "Save your current equipped cosmetics into this slot."}
      </p>
    </article>
  `;
}

export const cosmeticsScreen = {
  render(context) {
    const cosmetics = createSafeCosmeticsPayload(context.cosmetics);
    const loadouts = Array.isArray(cosmetics.loadouts) ? cosmetics.loadouts : [];
    const viewState = normalizeCategoryViewState(context.viewState);
    const collectionOptions = getOwnedCollectionOptions(cosmetics);
    reconcileCollectionSelections(viewState, collectionOptions);
    if (context.viewState) {
      context.viewState.categories = viewState.categories;
      context.viewState.rarities = viewState.rarities;
      context.viewState.collections = viewState.collections;
      context.viewState.showNewFirst = viewState.showNewFirst;
    }

    return `
      <section class="screen screen-cosmetics">
        <section class="${buildThemedSurfaceClassName({ backgroundImage: context.backgroundImage ?? "" })}" style="background-image: url('${context.backgroundImage ?? ""}')">
          <div class="panel themed-screen-panel">
          <div class="screen-topbar">
            <h2 class="view-title">Cosmetics / Rewards</h2>
            <button id="cosmetics-back-btn" class="btn screen-back-btn">Back to Menu</button>
          </div>
          <p>Owned cosmetics only. Purchases happen in Store.</p>

          <section class="cosmetic-loadout-section">
            <div class="cosmetic-loadout-intro">
              <h3 class="section-title">Cosmetic Loadouts</h3>
              <p>Equip your cosmetics, then save them to a loadout slot. Load a saved slot anytime to restore that setup.</p>
            </div>
            <div class="cosmetic-loadout-grid">
              ${loadouts.map((slot) => renderLoadoutCard(slot)).join("")}
            </div>
          </section>

          <section class="store-toolbar panel cosmetic-browser-toolbar">
            <div class="store-filter-groups">
              <fieldset class="store-filter-group">
                <legend>Categories</legend>
                <div class="store-filter-options">
                  ${FILTERABLE_CATEGORIES.map(
                    ([type, label]) => `
                      <label class="store-filter-option">
                        <input type="checkbox" data-cosmetic-category-filter="${type}" ${viewState.categories.has(type) ? "checked" : ""} />
                        <span>${label}</span>
                      </label>
                    `
                  ).join("")}
                </div>
              </fieldset>
              <fieldset class="store-filter-group">
                <legend>Rarity</legend>
                <div class="store-filter-options">
                  ${FILTERABLE_RARITIES.map(
                    (rarity) => `
                      <label class="store-filter-option">
                        <input type="checkbox" data-cosmetic-rarity-filter="${rarity}" ${viewState.rarities.has(rarity) ? "checked" : ""} />
                        <span>${rarity}</span>
                      </label>
                    `
                  ).join("")}
                </div>
              </fieldset>
              <fieldset class="store-filter-group">
                <legend>Element</legend>
                <div class="store-filter-options">
                  ${FILTERABLE_ELEMENTS.map(
                    ([element, label]) => `
                      <label class="store-filter-option">
                        <input type="checkbox" data-cosmetic-element-filter="${element}" ${viewState.elements.has(element) ? "checked" : ""} />
                        <span>${label}</span>
                      </label>
                    `
                  ).join("")}
                </div>
              </fieldset>
              ${
                collectionOptions.length
                  ? `<fieldset class="store-filter-group">
                <legend>Collections</legend>
                <div class="store-filter-options store-filter-options--collections">
                  ${collectionOptions
                    .map(
                      (collection) => `
                      <label class="store-filter-option">
                        <input type="checkbox" data-cosmetic-collection-filter="${escapeAttribute(collection)}" ${viewState.collections.has(collection) ? "checked" : ""} />
                        <span>${collection}</span>
                      </label>
                    `
                    )
                    .join("")}
                </div>
              </fieldset>`
                  : ""
              }
              <fieldset class="store-filter-group">
                <legend>Order</legend>
                <div class="store-filter-options">
                  <label class="store-filter-option store-filter-option-toggle">
                    <input type="checkbox" id="cosmetics-show-new-first" ${viewState.showNewFirst ? "checked" : ""} />
                    <span>Show NEW First</span>
                  </label>
                </div>
              </fieldset>
              <div class="store-filter-actions">
                <button id="cosmetics-reset-filters-btn" class="btn" type="button">Reset Filters</button>
              </div>
            </div>
          </section>

          ${renderRandomizePanel(cosmetics)}

          <div class="grid cosmetics-sections">
              ${COSMETIC_SECTIONS.map(([type, title]) => {
                const owned = sortOwnedItemsForDisplay(
                  type,
                  (cosmetics.catalog[type] ?? []).filter((item) => item.owned),
                  viewState.showNewFirst
                );
                return `
                <section class="cosmetic-section" data-cosmetic-section="${type}">
                  <h3 class="section-title">${title}</h3>
                  <div class="cosmetic-grid">
                    ${owned.length ? owned.map((item) => renderItem(type, item)).join("") : "<p>No owned items in this category yet.</p>"}
                  </div>
                </section>
              `;
            }).join("")}
          </div>
          <p id="cosmetics-empty-state" class="store-empty-state" hidden>No owned cosmetics match the current category filter.</p>
          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    const root = document.querySelector(".screen-cosmetics");
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    bindCosmeticHoverPreview({ root: scope, documentRef: document });
    const viewState = normalizeCategoryViewState(context.viewState);
    const availableCollections = Array.from(scope.querySelectorAll("[data-cosmetic-collection-filter]"))
      .map((input) => normalizeCollectionKey(input.getAttribute("data-cosmetic-collection-filter")))
      .filter(Boolean);
    reconcileCollectionSelections(viewState, availableCollections);
    if (context.viewState) {
      context.viewState.categories = viewState.categories;
      context.viewState.rarities = viewState.rarities;
      context.viewState.elements = viewState.elements;
      context.viewState.collections = viewState.collections;
      context.viewState.showNewFirst = viewState.showNewFirst;
    }

    const applyFilters = () => {
      const sections = Array.from(scope.querySelectorAll("[data-cosmetic-section]"));
      const categoriesEnabled = viewState.categories.size > 0;
      const raritiesEnabled = viewState.rarities.size > 0;
      const elementsEnabled = viewState.elements.size > 0;
      const collectionsEnabled = viewState.collections.size > 0;
      let anyVisible = false;

      for (const section of sections) {
        const type = section.getAttribute("data-cosmetic-section");
        const grid = section.querySelector(".cosmetic-grid");
        if (grid) {
          sortRenderedCosmeticItems(
            Array.from(grid.querySelectorAll(".cosmetic-item")),
            viewState.showNewFirst
          ).forEach((item) => {
            grid.appendChild(item);
          });
        }
        const items = Array.from(section.querySelectorAll(".cosmetic-item"));
        const categoryVisible = categoriesEnabled && viewState.categories.has(type);
        let hasVisibleItem = false;

        for (const item of items) {
          const rarity = item.getAttribute("data-cosmetic-rarity") ?? "Common";
          const element = String(item.getAttribute("data-cosmetic-element") ?? "").trim().toLowerCase();
          const collection = normalizeCollectionKey(item.getAttribute("data-cosmetic-collection"));
          const matchesElement =
            type !== "elementCardVariant" || !elementsEnabled || (element && viewState.elements.has(element));
          const matchesCollection =
            !collectionsEnabled || (collection && viewState.collections.has(collection));
          const itemVisible =
            categoryVisible &&
            raritiesEnabled &&
            viewState.rarities.has(rarity) &&
            matchesElement &&
            matchesCollection;
          item.hidden = !itemVisible;
          item.classList?.toggle("is-filtered-out", !itemVisible);
          if (item.style) {
            item.style.display = itemVisible ? "" : "none";
          }
          if (itemVisible) {
            hasVisibleItem = true;
          }
        }

        const isVisible = categoryVisible && hasVisibleItem;
        section.hidden = !isVisible;
        section.classList?.toggle("is-filtered-out", !isVisible);
        if (section.style) {
          section.style.display = isVisible ? "" : "none";
        }
        if (isVisible) {
          anyVisible = true;
        }
      }

      const emptyState = document.getElementById("cosmetics-empty-state");
      if (emptyState) {
        emptyState.hidden = anyVisible;
        emptyState.classList?.toggle("is-active", !anyVisible);
        if (emptyState.style) {
          emptyState.style.display = anyVisible ? "none" : "";
        }
      }
    };

    document.getElementById("cosmetics-back-btn").addEventListener("click", context.actions.back);

    scope.querySelectorAll("[data-randomize-after-match]").forEach((input) => {
      input.addEventListener("change", async () => {
        const type = input.getAttribute("data-randomize-after-match");
        await context.actions.updateRandomizationPreferences({
          [type]: Boolean(input.checked)
        });
      });
    });

    document.getElementById("cosmetics-randomize-now-btn")?.addEventListener("click", async () => {
      const selectedCategories = Array.from(scope.querySelectorAll("[data-randomize-after-match]"))
        .filter((input) => input.checked)
        .map((input) => input.getAttribute("data-randomize-after-match"))
        .filter(Boolean);
      await context.actions.randomizeNow(selectedCategories);
    });

    scope.querySelectorAll("[data-cosmetic-category-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const type = input.getAttribute("data-cosmetic-category-filter");
        if (input.checked) {
          viewState.categories.add(type);
        } else {
          viewState.categories.delete(type);
        }
        applyFilters();
      });
    });

    scope.querySelectorAll("[data-cosmetic-rarity-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const rarity = input.getAttribute("data-cosmetic-rarity-filter");
        if (input.checked) {
          viewState.rarities.add(rarity);
        } else {
          viewState.rarities.delete(rarity);
        }
        applyFilters();
      });
    });

    scope.querySelectorAll("[data-cosmetic-element-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const element = String(input.getAttribute("data-cosmetic-element-filter") ?? "").trim().toLowerCase();
        if (!element) {
          applyFilters();
          return;
        }
        if (input.checked) {
          viewState.elements.add(element);
        } else {
          viewState.elements.delete(element);
        }
        applyFilters();
      });
    });

    scope.querySelectorAll("[data-cosmetic-collection-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const collection = normalizeCollectionKey(input.getAttribute("data-cosmetic-collection-filter"));
        if (!collection) {
          applyFilters();
          return;
        }
        if (input.checked) {
          viewState.collections.add(collection);
        } else {
          viewState.collections.delete(collection);
        }
        applyFilters();
      });
    });

    document.getElementById("cosmetics-show-new-first")?.addEventListener("change", (event) => {
      viewState.showNewFirst = Boolean(event?.target?.checked);
      applyFilters();
    });

    document.getElementById("cosmetics-reset-filters-btn")?.addEventListener("click", () => {
      viewState.categories.clear();
      FILTERABLE_CATEGORIES.forEach(([type]) => viewState.categories.add(type));
      viewState.rarities.clear();
      FILTERABLE_RARITIES.forEach((rarity) => viewState.rarities.add(rarity));
      viewState.elements.clear();
      FILTERABLE_ELEMENTS.forEach(([element]) => viewState.elements.add(element));
      viewState.collections.clear();
      viewState.showNewFirst = true;
      if (context.viewState) {
        context.viewState.showNewFirst = viewState.showNewFirst;
      }

      scope.querySelectorAll("[data-cosmetic-category-filter]").forEach((input) => {
        input.checked = true;
      });
      scope.querySelectorAll("[data-cosmetic-rarity-filter]").forEach((input) => {
        input.checked = true;
      });
      scope.querySelectorAll("[data-cosmetic-element-filter]").forEach((input) => {
        input.checked = true;
      });
      scope.querySelectorAll("[data-cosmetic-collection-filter]").forEach((input) => {
        input.checked = false;
      });
      const showNewFirstInput = document.getElementById("cosmetics-show-new-first");
      if (showNewFirstInput) {
        showNewFirstInput.checked = true;
      }
      applyFilters();
    });

    document.querySelectorAll("[data-equip-type]").forEach((button) => {
      button.addEventListener("click", async () => {
        const type = button.getAttribute("data-equip-type");
        const id = button.getAttribute("data-equip-id");
        await context.actions.equip(type, id);
      });
    });

    document.querySelectorAll("[data-loadout-save]").forEach((button) => {
      button.addEventListener("click", async () => {
        const slotIndex = Number(button.getAttribute("data-loadout-save"));
        await context.actions.saveLoadout(slotIndex);
      });
    });

    document.querySelectorAll("[data-loadout-apply]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.hasAttribute("disabled")) {
          return;
        }

        const slotIndex = Number(button.getAttribute("data-loadout-apply"));
        await context.actions.applyLoadout(slotIndex);
      });
    });

    document.querySelectorAll("[data-loadout-rename]").forEach((button) => {
      button.addEventListener("click", async () => {
        const slotIndex = Number(button.getAttribute("data-loadout-rename"));
        const input = document.querySelector(`[data-loadout-name-input="${slotIndex}"]`);
        await context.actions.renameLoadout(slotIndex, input?.value ?? "");
      });
    });

    applyFilters();
  }
};

