import { getAssetPath } from "../../utils/dom.js";
import {
  CATEGORY_ORDER as COSMETIC_SECTIONS,
  FILTERABLE_CATEGORIES,
  FILTERABLE_RARITIES,
  RARITY_SORT_ORDER,
  normalizeCategoryViewState
} from "../shared/cosmeticCategoryShared.js";
import { bindCosmeticHoverPreview, hasRenderablePreviewSource } from "../shared/cosmeticHoverPreview.js";

const RANDOMIZE_AFTER_MATCH_OPTIONS = Object.freeze([
  ["avatar", "Avatar"],
  ["title", "Title"],
  ["badge", "Badge"],
  ["elementCardVariant", "Card Variant"],
  ["cardBack", "Card Back"],
  ["background", "Background"]
]);

function normalizeRarity(rarity) {
  return FILTERABLE_RARITIES.includes(rarity) ? rarity : "Common";
}

function rarityClassName(rarity) {
  return `rarity-${normalizeRarity(rarity).toLowerCase()}`;
}

function isFramedCosmeticType(type) {
  return type === "avatar" || type === "cardBack" || type === "elementCardVariant";
}

function previewTypeClass(type) {
  if (type === "avatar") {
    return "is-avatar";
  }

  if (type === "cardBack" || type === "elementCardVariant") {
    return "is-card";
  }

  return "is-default";
}

function preview(type, item) {
  if (!item.image) {
    return `<div class="cosmetic-preview missing">No Preview</div>`;
  }

  const src = getAssetPath(item.image);
  const hasRenderableImage = hasRenderablePreviewSource(src, { previewName: item.name });
  if (!hasRenderableImage) {
    return `<div class="cosmetic-preview missing">No Preview</div>`;
  }
  const framed = isFramedCosmeticType(type);
  return `
    <div
      class="cosmetic-preview-wrap ${previewTypeClass(type)} ${framed ? "is-framed" : ""}"
      ${framed ? `data-hover-preview="true" data-preview-type="${type}" data-preview-rarity="${normalizeRarity(item.rarity)}" data-preview-src="${escapeAttribute(src)}" data-preview-name="${escapeAttribute(item.name)}"` : ""}
    >
      <img class="cosmetic-preview ${previewTypeClass(type)} ${framed ? "is-framed" : ""}" src="${src}" alt="${item.name}" />
    </div>
  `;
}

function renderItem(type, item) {
  const framed = isFramedCosmeticType(type);
  const variantHint =
    type === "elementCardVariant" && item.element
      ? `<p>Applies to: ${item.element[0].toUpperCase()}${item.element.slice(1)} cards only</p>`
      : "";

  return `
    <article class="cosmetic-item cosmetic-item-${type} ${framed ? "cosmetic-item-framed" : ""} ${framed ? rarityClassName(item.rarity) : ""} owned" data-cosmetic-rarity="${normalizeRarity(item.rarity)}">
      ${preview(type, item)}
      <div class="cosmetic-meta">
        <p><strong>${item.name}</strong></p>
        <p>Rarity: <span class="cosmetic-rarity-label ${framed ? rarityClassName(item.rarity) : ""}">${normalizeRarity(item.rarity)}</span></p>
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
    const cosmetics = context.cosmetics;
    const loadouts = Array.isArray(cosmetics.loadouts) ? cosmetics.loadouts : [];
    const viewState = normalizeCategoryViewState(context.viewState);
    if (context.viewState) {
      context.viewState.categories = viewState.categories;
      context.viewState.rarities = viewState.rarities;
    }

    return `
      <section class="screen screen-cosmetics">
        <div class="panel">
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
            </div>
          </section>

          ${renderRandomizePanel(cosmetics)}

          <div class="grid cosmetics-sections">
            ${COSMETIC_SECTIONS.map(([type, title]) => {
              const owned = sortOwnedItems((cosmetics.catalog[type] ?? []).filter((item) => item.owned));
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
    `;
  },
  bind(context) {
    const root = document.querySelector(".screen-cosmetics");
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    bindCosmeticHoverPreview({ root: scope, documentRef: document });
    const viewState = normalizeCategoryViewState(context.viewState);
    if (context.viewState) {
      context.viewState.categories = viewState.categories;
      context.viewState.rarities = viewState.rarities;
    }

    const applyFilters = () => {
      const sections = Array.from(scope.querySelectorAll("[data-cosmetic-section]"));
      const categoriesEnabled = viewState.categories.size > 0;
      const raritiesEnabled = viewState.rarities.size > 0;
      let anyVisible = false;

      for (const section of sections) {
        const type = section.getAttribute("data-cosmetic-section");
        const items = Array.from(section.querySelectorAll(".cosmetic-item"));
        const categoryVisible = categoriesEnabled && viewState.categories.has(type);
        let hasVisibleItem = false;

        for (const item of items) {
          const rarity = item.getAttribute("data-cosmetic-rarity") ?? "Common";
          const itemVisible = categoryVisible && raritiesEnabled && viewState.rarities.has(rarity);
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

