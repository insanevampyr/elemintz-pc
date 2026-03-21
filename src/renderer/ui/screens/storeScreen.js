import { getAssetPath } from "../../utils/dom.js";
import { CATEGORY_ORDER as BASE_CATEGORY_ORDER, FILTERABLE_CATEGORIES } from "../shared/cosmeticCategoryShared.js";
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
    rarities: new Set(FILTERABLE_RARITIES)
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
        : new Set(viewState?.rarities ?? defaults.rarities)
  };
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

function renderPreview(item) {
  if (!item.image) {
    return `<div class="cosmetic-preview missing">No Preview</div>`;
  }

  const src = getAssetPath(item.image);
  return `
    <div class="cosmetic-preview-wrap">
      <img
        class="cosmetic-preview"
        src="${src}"
        alt="${item.name}"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="cosmetic-preview missing" style="display:none;">No Preview</div>
    </div>
  `;
}

function renderActions(type, item) {
  const equipButton = item.owned
    ? `<button class="btn" data-equip-type="${type}" data-equip-id="${item.id}" ${item.equipped ? "disabled" : ""}>${item.equipped ? "Equipped" : "Equip"}</button>`
    : "";

  const buyButton =
    !item.owned && item.purchasable
      ? `<button class="btn btn-primary" data-buy-type="${type}" data-buy-id="${item.id}">Buy</button>`
      : "";

  return `${equipButton}${buyButton}`;
}

function renderStoreItem(type, item) {
  const variantHint =
    type === "elementCardVariant" && item.element
      ? `<p>Applies to: ${item.element[0].toUpperCase()}${item.element.slice(1)} cards only</p>`
      : "";

  return `
    <article
      class="cosmetic-item ${item.owned ? "owned" : "locked"}"
      data-store-item
      data-store-type="${type}"
      data-store-rarity="${item.rarity ?? "Common"}"
      data-store-name="${normalizeFilterText(item.name)}"
    >
      ${renderPreview(item)}
      <div class="cosmetic-meta">
        <p><strong>${item.name}</strong></p>
        <p>Status: ${item.owned ? "Owned" : "Not Owned"}</p>
        <p>Rarity: ${item.rarity ?? "Common"}</p>
        <p>Price: ${item.purchasable ? `${item.price} Tokens` : "Not Purchasable"}</p>
        <p>Unlock: ${unlockText(item)}</p>
        ${variantHint}
      </div>
      <div class="store-actions">${renderActions(type, item)}</div>
    </article>
  `;
}

export const storeScreen = {
  render(context) {
    const store = context.store;
    const viewState = normalizeViewState(context.viewState);

    return `
      <section class="screen screen-store">
        <div class="panel">
          <div class="screen-topbar">
            <h2 class="view-title">Store</h2>
            <button id="store-back-btn" class="btn screen-back-btn">Back to Menu</button>
          </div>
          <p>Tokens: <strong>${store.tokens}</strong></p>
          <p>Founder / Supporter: <strong>${store.supporterPass ? "Active" : "Not Active"}</strong></p>
          <p>Badges are gameplay/achievement rewards and cannot be purchased.</p>
          ${
            store.supporterPass
              ? ""
              : '<button id="activate-supporter-btn" class="btn">Activate Founder Pass (Local)</button>'
          }
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
            </div>
          </section>
          <div class="grid cosmetics-sections">
            ${CATEGORY_ORDER.map(
              ([type, label]) => `
                <section class="cosmetic-section" data-store-section="${type}">
                  <h3 class="section-title">${label}</h3>
                  <div class="cosmetic-grid">
                    ${(store.catalog[type] ?? []).map((item) => renderStoreItem(type, item)).join("")}
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
    const viewState = normalizeViewState(context.viewState);
    if (context.viewState) {
      context.viewState.searchText = viewState.searchText;
      context.viewState.categories = viewState.categories;
      context.viewState.rarities = viewState.rarities;
    }

    const applyFilters = () => {
      const items = Array.from(root.querySelectorAll("[data-store-item]"));
      const sections = Array.from(root.querySelectorAll("[data-store-section]"));
      const categoriesEnabled = viewState.categories.size > 0;
      const raritiesEnabled = viewState.rarities.size > 0;
      const normalizedSearchText = normalizeFilterText(viewState.searchText);

      for (const item of items) {
        const name = normalizeFilterText(item.getAttribute("data-store-name"));
        const type = item.getAttribute("data-store-type");
        const rarity = item.getAttribute("data-store-rarity") ?? "Common";
        const matchesSearch = !normalizedSearchText || name.includes(normalizedSearchText);
        const matchesCategory = categoriesEnabled && viewState.categories.has(type);
        const matchesRarity = raritiesEnabled && viewState.rarities.has(rarity);
        const isVisible = matchesSearch && matchesCategory && matchesRarity;
        item.hidden = !isVisible;
        item.classList?.toggle("is-filtered-out", !isVisible);
        if (item.style) {
          item.style.display = isVisible ? "" : "none";
        }
      }

      let anyVisible = false;
      for (const section of sections) {
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
      button.addEventListener("click", async () => {
        const type = button.getAttribute("data-buy-type");
        const cosmeticId = button.getAttribute("data-buy-id");
        await context.actions.buy(type, cosmeticId);
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

    applyFilters();
  }
};



