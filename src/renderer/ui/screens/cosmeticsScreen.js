import { getAssetPath } from "../../utils/dom.js";

const COSMETIC_SECTIONS = [
  ["avatar", "Avatars"],
  ["cardBack", "Card Backs"],
  ["background", "Backgrounds"],
  ["elementCardVariant", "Element Card Variants"],
  ["badge", "Badges"],
  ["title", "Titles"]
];

function preview(item) {
  if (!item.image) {
    return `<div class="cosmetic-preview missing">No Preview</div>`;
  }

  return `<img class="cosmetic-preview" src="${getAssetPath(item.image)}" alt="${item.name}" />`;
}

function renderItem(type, item) {
  const variantHint =
    type === "elementCardVariant" && item.element
      ? `<p>Applies to: ${item.element[0].toUpperCase()}${item.element.slice(1)} cards only</p>`
      : "";

  return `
    <article class="cosmetic-item owned">
      ${preview(item)}
      <div class="cosmetic-meta">
        <p><strong>${item.name}</strong></p>
        <p>Equipped: ${item.equipped ? "Yes" : "No"}</p>
        ${variantHint}
      </div>
      <div>
        <button class="btn" data-equip-type="${type}" data-equip-id="${item.id}" ${item.equipped ? "disabled" : ""}>${item.equipped ? "Equipped" : "Equip"}</button>
      </div>
    </article>
  `;
}

function renderSectionExtras(type, cosmetics) {
  if (type !== "background") {
    return "";
  }

  const enabled = Boolean(cosmetics?.preferences?.randomizeBackgroundEachMatch);
  return `
    <label class="cosmetic-preference-toggle">
      <input
        type="checkbox"
        id="background-randomize-toggle"
        ${enabled ? "checked" : ""}
      />
      <span>
        <strong>Randomize Background Each Match</strong>
        <small>Owned backgrounds only</small>
      </span>
    </label>
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

    return `
      <section class="screen screen-cosmetics">
        <div class="panel">
          <h2 class="view-title">Cosmetics / Rewards</h2>
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

          <div class="grid cosmetics-sections">
            ${COSMETIC_SECTIONS.map(([type, title]) => {
              const owned = (cosmetics.catalog[type] ?? []).filter((item) => item.owned);
              return `
                <section class="cosmetic-section">
                  <h3 class="section-title">${title}</h3>
                  ${renderSectionExtras(type, cosmetics)}
                  <div class="cosmetic-grid">
                    ${owned.length ? owned.map((item) => renderItem(type, item)).join("") : "<p>No owned items in this category yet.</p>"}
                  </div>
                </section>
              `;
            }).join("")}
          </div>

          <button id="cosmetics-back-btn" class="btn screen-back-btn">Back to Menu</button>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("cosmetics-back-btn").addEventListener("click", context.actions.back);

    document.getElementById("background-randomize-toggle")?.addEventListener("change", async (event) => {
      await context.actions.toggleBackgroundRandomization(Boolean(event.currentTarget?.checked));
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
  }
};

