import { getAssetPath } from "../../utils/dom.js";
import {
  CATEGORY_ORDER as BASE_CATEGORY_ORDER,
  FILTERABLE_CATEGORIES,
  FILTERABLE_ELEMENTS
} from "../shared/cosmeticCategoryShared.js";
import {
  bindCosmeticHoverPreview,
  buildHoverPreviewAttributes,
  hasRenderablePreviewSource
} from "../shared/cosmeticHoverPreview.js";
import { getCosmeticHoverMetadata } from "../../../state/cosmeticSystem.js";
const FILTERABLE_RARITIES = Object.freeze(["Common", "Rare", "Epic", "Legendary"]);
const CATEGORY_ORDER = BASE_CATEGORY_ORDER.map(([type, label]) => [
  type,
  type === "badge" ? "Badges (Achievement Rewards)" : label
]);

function normalizeFilterText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createDefaultViewState() {
  return {
    searchText: "",
    categories: new Set(FILTERABLE_CATEGORIES.map(([type]) => type)),
    rarities: new Set(FILTERABLE_RARITIES),
    elements: new Set(FILTERABLE_ELEMENTS.map(([element]) => element)),
    collections: new Set(),
    showNewFirst: true
  };
}

function normalizeViewState(viewState) {
  const defaults = createDefaultViewState();
  return {
    searchText: String(viewState?.searchText ?? defaults.searchText),
    categories:
      viewState?.categories instanceof Set
        ? viewState.categories
        : new Set(viewState?.categories ?? defaults.categories),
    rarities:
      viewState?.rarities instanceof Set
        ? viewState.rarities
        : new Set(viewState?.rarities ?? defaults.rarities),
    elements:
      viewState?.elements instanceof Set
        ? viewState.elements
        : new Set(viewState?.elements ?? defaults.elements),
    collections:
      viewState?.collections instanceof Set
        ? viewState.collections
        : new Set(viewState?.collections ?? defaults.collections),
    showNewFirst:
      typeof viewState?.showNewFirst === "boolean"
        ? viewState.showNewFirst
        : defaults.showNewFirst
  };
}

function sortSectionItemsByNewness(items, showNewFirst) {
  return [...items].sort((left, right) => {
    if (showNewFirst) {
      const newDelta =
        Number(Boolean(right.getAttribute("data-store-is-new") === "true")) -
        Number(Boolean(left.getAttribute("data-store-is-new") === "true"));
      if (newDelta !== 0) {
        return newDelta;
      }
    }

    return (
      Number(left.getAttribute("data-store-original-index") ?? 0) -
      Number(right.getAttribute("data-store-original-index") ?? 0)
    );
  });
}

function unlockText(item) {
  if (item.owned) {
    return "Owned";
  }

  if (item.unlockSource?.type === "store") {
    return "Store Purchase";
  }

  if (item.unlockSource?.type === "achievement reward") {
    return `Achievement: ${item.unlockSource.achievementId}`;
  }

  if (item.unlockSource?.type === "level reward") {
    return `Level ${item.unlockSource.level}`;
  }

  if (item.unlockSource?.type === "supporter") {
    return "Buy Founder / Supporter to receive";
  }

  if (item.unlockSource?.type === "default") {
    return "Default";
  }

  return "Locked";
}

function normalizeRarity(rarity) {
  return FILTERABLE_RARITIES.includes(rarity) ? rarity : "Common";
}

function rarityClassName(rarity) {
  return `rarity-${normalizeRarity(rarity).toLowerCase()}`;
}

function renderCollectionChip(collection) {
  if (!collection) {
    return "";
  }

  return `<p><span class="cosmetic-collection-chip">${collection} Collection</span></p>`;
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

function formatFeaturedRotationEndsAt(endsAt) {
  if (!endsAt) {
    return "";
  }

  const parsed = new Date(endsAt);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
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

function getStoreCollectionOptions(store) {
  const seen = new Set();
  const options = [];

  for (const [, items] of Object.entries(store?.catalog ?? {})) {
    for (const item of items ?? []) {
      if (item?.owned) {
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

function usesRarityFrame(type) {
  return Boolean(type);
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

function renderPreview(type, item) {
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
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />`
          : type === "title"
            ? `<div class="cosmetic-preview cosmetic-preview-text-visual cosmetic-preview is-title-fallback ${framed ? "is-framed" : ""}">${item.name}</div>`
            : ""
      }
      <div class="cosmetic-preview missing" style="display:none;">No Preview</div>
    </div>
  `;
}

function buildStorePurchaseKey(type, cosmeticId) {
  const safeType = String(type ?? "").trim();
  const safeCosmeticId = String(cosmeticId ?? "").trim();
  return safeType && safeCosmeticId ? `${safeType}:${safeCosmeticId}` : "";
}

function renderActions(type, item) {
  const equipButton = item.owned
    ? `<button class="btn" data-equip-type="${type}" data-equip-id="${item.id}" ${item.equipped ? "disabled" : ""}>${item.equipped ? "Equipped" : "Equip"}</button>`
    : "";

  const buyButton =
    !item.owned && item.purchasable
      ? `<button class="btn btn-primary" data-buy-type="${type}" data-buy-id="${item.id}" data-buy-default-label="Buy">Buy</button>`
      : "";

  return `${equipButton}${buyButton}`;
}

function renderStoreItem(type, item, originalIndex) {
  const framed = usesRarityFrame(type);
  const variantHint =
    type === "elementCardVariant" && item.element
      ? `<p>Applies to: ${item.element[0].toUpperCase()}${item.element.slice(1)} cards only</p>`
      : "";
  const newBadge = item.isNew ? '<span class="store-item-badge store-item-badge-new">NEW</span>' : "";

  return `
    <article
      class="cosmetic-item cosmetic-item-${type} ${framed ? "cosmetic-item-framed" : ""} ${framed ? rarityClassName(item.rarity) : ""} ${item.owned ? "owned" : "locked"}"
      data-store-item
      data-store-type="${type}"
      data-store-rarity="${normalizeRarity(item.rarity)}"
      data-store-name="${normalizeFilterText(item.name)}"
      data-store-collection="${escapeAttribute(normalizeCollectionKey(item.collection))}"
      data-store-element="${escapeAttribute(type === "elementCardVariant" ? resolveVariantElement(item) : "")}"
      data-store-is-new="${item.isNew ? "true" : "false"}"
      data-store-original-index="${originalIndex}"
    >
      ${newBadge}
      ${renderPreview(type, item)}
      <div class="cosmetic-meta">
        <p><strong>${item.name}</strong></p>
        ${renderCollectionChip(item.collection)}
        <p>Type: ${getCosmeticTypeLabel(type, item)}</p>
        <p>Status: ${item.owned ? "Owned" : "Not Owned"}</p>
        <p>Rarity: <span class="cosmetic-rarity-label ${framed ? rarityClassName(item.rarity) : ""}">${normalizeRarity(item.rarity)}</span></p>
        <p>Price: ${item.purchasable ? `${item.price} Tokens` : "Not Purchasable"}</p>
        <p>Unlock: ${unlockText(item)}</p>
        ${variantHint}
      </div>
      <div class="store-actions">${renderActions(type, item)}</div>
    </article>
  `;
}

function renderFeaturedRotationSection(featuredRotation) {
  if (!featuredRotation?.featuredItems?.length) {
    return "";
  }

  const endsAtLabel = formatFeaturedRotationEndsAt(featuredRotation.endsAt);
  return `
    <section class="store-featured-rotation panel" data-store-featured-section>
      <div class="store-featured-rotation-header">
        <div>
          <p class="store-featured-rotation-eyebrow">Featured Rotation</p>
          <h3 class="store-featured-rotation-title">${featuredRotation.title}</h3>
          ${
            featuredRotation.message
              ? `<p class="store-featured-rotation-copy">${featuredRotation.message}</p>`
              : ""
          }
          ${
            endsAtLabel
              ? `<p class="store-featured-rotation-timing">Ends: ${endsAtLabel}</p>`
              : ""
          }
        </div>
      </div>
      <div class="cosmetic-grid cosmetic-grid-featured">
        ${featuredRotation.featuredItems
          .map(({ type, item }, index) => renderStoreItem(type, item, index))
          .join("")}
      </div>
    </section>
  `;
}

function getRenderableStoreItems(store, type) {
  return (store?.catalog?.[type] ?? []).filter((item) => !item?.owned);
}

export const storeScreen = {
  render(context) {
    const store = context.store;
    const viewState = normalizeViewState(context.viewState);
    const collectionOptions = getStoreCollectionOptions(store);
    reconcileCollectionSelections(viewState, collectionOptions);
    if (context.viewState) {
      context.viewState.collections = viewState.collections;
    }

    return `
      <section class="screen screen-store">
        <div class="panel">
          <div class="screen-topbar store-topbar">
            <div class="store-topbar-heading">
              <h2 class="view-title">Store</h2>
            </div>
            <div class="store-topbar-controls">
              <div class="store-banner-balance" data-store-banner-balance="true" aria-label="Token balance">
                <span class="store-banner-balance-label">Tokens</span>
                <strong id="store-token-balance" class="store-banner-balance-value">${store.tokens}</strong>
              </div>
              <button id="store-back-btn" class="btn screen-back-btn">Back to Menu</button>
            </div>
          </div>
          <section class="store-feature-banner" aria-label="Featured cosmetics update">
            <p class="store-feature-banner-eyebrow">Featured Update</p>
            <h3 class="store-feature-banner-title">New Collections in the Store</h3>
            <p class="store-feature-banner-copy">
              Explore Neon Arcana, Goldbound Relics, and Frostveil Court cosmetics now available in EleMintz.
            </p>
          </section>
          <p>Founder / Supporter: <strong>${store.supporterPass ? "Active" : "Not Active"}</strong></p>
          <p>Badges are gameplay/achievement rewards and cannot be purchased.</p>
          ${renderFeaturedRotationSection(context.featuredRotation)}
          <section class="store-toolbar panel">
            <div class="store-search-group">
              <label class="store-search-label" for="store-search-input">Search Cosmetics</label>
              <input
                id="store-search-input"
                class="store-search-input"
                type="search"
                placeholder="Search by cosmetic name"
                value="${escapeAttribute(viewState.searchText)}"
                autocomplete="off"
              />
            </div>
            <div class="store-filter-groups">
              <fieldset class="store-filter-group">
                <legend>Categories</legend>
                <div class="store-filter-options">
                  ${FILTERABLE_CATEGORIES.map(
                    ([type, label]) => `
                      <label class="store-filter-option">
                        <input type="checkbox" data-store-category-filter="${type}" ${viewState.categories.has(type) ? "checked" : ""} />
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
                        <input type="checkbox" data-store-rarity-filter="${rarity}" ${viewState.rarities.has(rarity) ? "checked" : ""} />
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
                        <input type="checkbox" data-store-element-filter="${element}" ${viewState.elements.has(element) ? "checked" : ""} />
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
                <div class="store-filter-options">
                  ${collectionOptions
                    .map(
                      (collection) => `
                      <label class="store-filter-option">
                        <input type="checkbox" data-store-collection-filter="${escapeAttribute(collection)}" ${viewState.collections.has(collection) ? "checked" : ""} />
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
                    <input type="checkbox" id="store-show-new-first" ${viewState.showNewFirst ? "checked" : ""} />
                    <span>Show NEW First</span>
                  </label>
                </div>
              </fieldset>
            </div>
          </section>
          <div class="grid cosmetics-sections">
            ${CATEGORY_ORDER.map(
              ([type, label]) => `
                <section class="cosmetic-section" data-store-section="${type}">
                  <h3 class="section-title">${label}</h3>
                  <div class="cosmetic-grid">
                    ${getRenderableStoreItems(store, type).map((item, index) => renderStoreItem(type, item, index)).join("")}
                  </div>
                </section>
              `
            ).join("")}
          </div>
          <p id="store-empty-state" class="store-empty-state" hidden>No cosmetics match the current search and filters.</p>
        </div>
      </section>
    `;
  },
  bind(context) {
    const root = document.querySelector(".screen-store") ?? document;
    bindCosmeticHoverPreview({ root, documentRef: document });
    const viewState = normalizeViewState(context.viewState);
    const availableCollections = Array.from(root.querySelectorAll("[data-store-collection-filter]"))
      .map((input) => normalizeCollectionKey(input.getAttribute("data-store-collection-filter")))
      .filter(Boolean);
    reconcileCollectionSelections(viewState, availableCollections);
    if (context.viewState) {
      context.viewState.searchText = viewState.searchText;
      context.viewState.categories = viewState.categories;
      context.viewState.rarities = viewState.rarities;
      context.viewState.elements = viewState.elements;
      context.viewState.collections = viewState.collections;
      context.viewState.showNewFirst = viewState.showNewFirst;
    }

    const applyFilters = () => {
      const items = Array.from(root.querySelectorAll("[data-store-item]"));
      const sections = Array.from(root.querySelectorAll("[data-store-section]"));
      const featuredSection = root.querySelector?.("[data-store-featured-section]") ?? null;
      const categoriesEnabled = viewState.categories.size > 0;
      const raritiesEnabled = viewState.rarities.size > 0;
      const elementsEnabled = viewState.elements.size > 0;
      const collectionsEnabled = viewState.collections.size > 0;
      const normalizedSearchText = normalizeFilterText(viewState.searchText);

      for (const item of items) {
        const name = normalizeFilterText(item.getAttribute("data-store-name"));
        const type = item.getAttribute("data-store-type");
        const rarity = item.getAttribute("data-store-rarity") ?? "Common";
        const element = String(item.getAttribute("data-store-element") ?? "").trim().toLowerCase();
        const collection = normalizeCollectionKey(item.getAttribute("data-store-collection"));
        const matchesSearch = !normalizedSearchText || name.includes(normalizedSearchText);
        const matchesCategory = categoriesEnabled && viewState.categories.has(type);
        const matchesRarity = raritiesEnabled && viewState.rarities.has(rarity);
        const matchesElement =
          type !== "elementCardVariant" || !elementsEnabled || (element && viewState.elements.has(element));
        const matchesCollection =
          !collectionsEnabled || (collection && viewState.collections.has(collection));
        const isVisible =
          matchesSearch && matchesCategory && matchesRarity && matchesElement && matchesCollection;
        item.hidden = !isVisible;
        item.classList?.toggle("is-filtered-out", !isVisible);
        if (item.style) {
          item.style.display = isVisible ? "" : "none";
        }
      }

      let anyVisible = false;
      for (const section of sections) {
        const grid = section.querySelector(".cosmetic-grid");
        if (grid) {
          sortSectionItemsByNewness(
            Array.from(grid.querySelectorAll("[data-store-item]")),
            viewState.showNewFirst
          ).forEach((item) => {
            grid.appendChild(item);
          });
        }
        const visibleItems = Array.from(section.querySelectorAll("[data-store-item]")).filter((item) => !item.hidden);
        const isVisible = visibleItems.length > 0;
        section.hidden = !isVisible;
        section.classList?.toggle("is-filtered-out", !isVisible);
        if (section.style) {
          section.style.display = isVisible ? "" : "none";
        }
        if (visibleItems.length > 0) {
          anyVisible = true;
        }
      }

      if (featuredSection) {
        const grid = featuredSection.querySelector?.(".cosmetic-grid");
        if (grid) {
          sortSectionItemsByNewness(
            Array.from(grid.querySelectorAll("[data-store-item]")),
            viewState.showNewFirst
          ).forEach((item) => {
            grid.appendChild(item);
          });
        }

        const visibleFeaturedItems = Array.from(
          featuredSection.querySelectorAll?.("[data-store-item]") ?? []
        ).filter((item) => !item.hidden);
        const isFeaturedVisible = visibleFeaturedItems.length > 0;
        featuredSection.hidden = !isFeaturedVisible;
        featuredSection.classList?.toggle("is-filtered-out", !isFeaturedVisible);
        if (featuredSection.style) {
          featuredSection.style.display = isFeaturedVisible ? "" : "none";
        }
        if (isFeaturedVisible) {
          anyVisible = true;
        }
      }

      const emptyState = document.getElementById("store-empty-state");
      if (emptyState) {
        emptyState.hidden = anyVisible;
        emptyState.classList?.toggle("is-active", !anyVisible);
        if (emptyState.style) {
          emptyState.style.display = anyVisible ? "none" : "";
        }
      }
    };

    document.getElementById("store-back-btn").addEventListener("click", context.actions.back);

    const supporterButton = document.getElementById("activate-supporter-btn");
    if (supporterButton) {
      supporterButton.addEventListener("click", context.actions.activateSupporter);
    }

    root.querySelectorAll("[data-buy-type]").forEach((button) => {
      button.disabled = false;
      const defaultLabel = button.getAttribute("data-buy-default-label") || button.textContent || "Buy";
      button.textContent = defaultLabel;
    });

    let purchasePending = false;
    let activePurchaseKey = "";
    const setPurchaseButtonsPendingState = (pending, activeKey = "") => {
      purchasePending = Boolean(pending);
      activePurchaseKey = activeKey;
      root.querySelectorAll("[data-buy-type]").forEach((button) => {
        const buttonType = button.getAttribute("data-buy-type");
        const buttonId = button.getAttribute("data-buy-id");
        const buttonKey = buildStorePurchaseKey(buttonType, buttonId);
        const defaultLabel = button.getAttribute("data-buy-default-label") || "Buy";
        button.disabled = purchasePending;
        button.textContent =
          purchasePending && buttonKey === activePurchaseKey ? "Purchasing..." : defaultLabel;
      });
    };

    root.querySelectorAll("[data-buy-type]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (purchasePending || button.disabled) {
          return;
        }

        const type = button.getAttribute("data-buy-type");
        const cosmeticId = button.getAttribute("data-buy-id");
        const purchaseKey = buildStorePurchaseKey(type, cosmeticId);
        setPurchaseButtonsPendingState(true, purchaseKey);
        try {
          await context.actions.buy(type, cosmeticId);
        } finally {
          setPurchaseButtonsPendingState(false);
        }
      });
    });

    root.querySelectorAll("[data-equip-type]").forEach((button) => {
      button.addEventListener("click", async () => {
        const type = button.getAttribute("data-equip-type");
        const cosmeticId = button.getAttribute("data-equip-id");
        await context.actions.equip(type, cosmeticId);
      });
    });

    const searchInput = document.getElementById("store-search-input");
    if (searchInput) {
      searchInput.value = viewState.searchText;
      searchInput.addEventListener("input", () => {
        viewState.searchText = String(searchInput.value ?? "");
        applyFilters();
      });
    }

    root.querySelectorAll("[data-store-category-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const type = input.getAttribute("data-store-category-filter");
        if (input.checked) {
          viewState.categories.add(type);
        } else {
          viewState.categories.delete(type);
        }
        applyFilters();
      });
    });

    root.querySelectorAll("[data-store-rarity-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const rarity = input.getAttribute("data-store-rarity-filter");
        if (input.checked) {
          viewState.rarities.add(rarity);
        } else {
          viewState.rarities.delete(rarity);
        }
        applyFilters();
      });
    });

    root.querySelectorAll("[data-store-element-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const element = String(input.getAttribute("data-store-element-filter") ?? "").trim().toLowerCase();
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

    root.querySelectorAll("[data-store-collection-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const collection = normalizeCollectionKey(input.getAttribute("data-store-collection-filter"));
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

    const showNewFirstInput = document.getElementById("store-show-new-first");
    if (showNewFirstInput) {
      showNewFirstInput.checked = viewState.showNewFirst;
      showNewFirstInput.addEventListener("change", () => {
        viewState.showNewFirst = Boolean(showNewFirstInput.checked);
        applyFilters();
      });
    }

    applyFilters();
  }
};



