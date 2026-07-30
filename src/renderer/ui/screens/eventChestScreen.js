import { escapeHtml, getAssetPath } from "../../utils/dom.js";

const EVENT_CHEST_FALLBACK_ICON_PATHS = Object.freeze({
  closed: "icons/daily_chest.png",
  open: "icons/daily_chest_open.png",
  reward: "icons/loot_chest_open.png"
});

const RARITY_ORDER = Object.freeze(["common", "rare", "epic", "legendary"]);

function resolveAssetPath(path, fallback) {
  const value = String(path ?? "").trim();
  return getAssetPath(value || fallback);
}

function buildImageFallback(path) {
  return `this.onerror=null;this.src='${escapeHtml(getAssetPath(path))}';`;
}

function formatRarityLabel(value) {
  const rarity = String(value ?? "").trim().toLowerCase();
  return rarity ? rarity.charAt(0).toUpperCase() + rarity.slice(1) : "Unknown";
}

function formatTypeLabel(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Cosmetic";
}

function formatOddsPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "Unavailable";
  }
  return `${Math.round(numeric * 1000) / 10}%`.replace(".0%", "%");
}

function formatEventChestTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function getRarityClass(value) {
  const rarity = String(value ?? "").trim().toLowerCase();
  return RARITY_ORDER.includes(rarity) ? rarity : "common";
}

function renderPityLine(label, state, testId) {
  if (!state?.enabled) {
    return `<p data-event-chest-pity="${testId}">${escapeHtml(label)} guarantee: Disabled</p>`;
  }
  return `<p data-event-chest-pity="${testId}">${escapeHtml(label)} guarantee: ${escapeHtml(state.displayLabel ?? "0 / 0")}</p>`;
}

function renderPoolSection(rarity, entries = []) {
  const label = formatRarityLabel(rarity);
  const safeEntries = Array.isArray(entries) ? entries : [];
  return `
    <section class="daily-element-chest-modal__pool-group" data-event-chest-pool-group="${escapeHtml(rarity)}">
      <h5>${escapeHtml(label)}</h5>
      <ul>
        ${
          safeEntries.length
            ? safeEntries
                .map((entry) => {
                  const owned = entry?.owned === true;
                  const imageSrc = entry?.image
                    ? resolveAssetPath(entry.image, EVENT_CHEST_FALLBACK_ICON_PATHS.reward)
                    : getAssetPath(EVENT_CHEST_FALLBACK_ICON_PATHS.reward);
                  return `
                    <li class="daily-element-chest-modal__pool-item event-chest-modal__pool-item" data-event-chest-owned-state="${owned ? "owned" : "missing"}">
                      <img
                        class="event-chest-modal__pool-image"
                        src="${escapeHtml(imageSrc)}"
                        onerror="${buildImageFallback(EVENT_CHEST_FALLBACK_ICON_PATHS.reward)}"
                        alt="${escapeHtml(entry?.name ?? "Event Chest reward")}"
                      />
                      <span>
                        <strong>${escapeHtml(entry?.name ?? "Unknown Reward")}</strong>
                        <small>${escapeHtml(formatTypeLabel(entry?.type))}${entry?.element ? ` - ${escapeHtml(formatTypeLabel(entry.element))}` : ""}${entry?.collection ? ` - ${escapeHtml(entry.collection)}` : ""}</small>
                      </span>
                      <span
                        class="daily-element-chest-modal__owned-flag daily-element-chest-modal__owned-flag--${owned ? "owned" : "missing"}"
                      >
                        ${owned ? "Owned" : "Missing"}
                      </span>
                    </li>
                  `;
                })
                .join("")
            : `<li class="daily-element-chest-modal__pool-item daily-element-chest-modal__pool-item--empty"><span>No rewards listed.</span></li>`
        }
      </ul>
    </section>
  `;
}

function renderResult(view) {
  const result = view.result ?? null;
  if (!result?.reward) {
    return "";
  }
  const reward = result.reward;
  const cosmetic = reward.cosmetic ?? null;
  const rarityClass = getRarityClass(reward.rarity ?? cosmetic?.rarity);
  const rarityLabel = formatRarityLabel(reward.rarity ?? cosmetic?.rarity);
  const rewardName = cosmetic?.name ?? "Token Reward";
  const imageSrc = cosmetic?.image
    ? resolveAssetPath(cosmetic.image, EVENT_CHEST_FALLBACK_ICON_PATHS.reward)
    : getAssetPath(EVENT_CHEST_FALLBACK_ICON_PATHS.reward);
  const duplicateTokens = Math.max(0, Number(reward.tokenAmount ?? result.duplicateTokensAwarded ?? 0) || 0);
  const guarantee = String(result.pityGuarantee ?? "").trim();
  return `
    <section
      class="daily-element-chest-modal__section daily-element-chest-modal__result daily-element-chest-modal__result--${rarityClass}"
      data-event-chest-result="true"
      data-event-chest-result-rarity="${rarityClass}"
    >
      <div class="daily-element-chest-modal__result-header">
        <h4>Latest Result</h4>
        <span class="daily-element-chest-modal__rarity-badge daily-element-chest-modal__rarity-badge--${rarityClass}">${escapeHtml(rarityLabel)}</span>
      </div>
      <div class="event-chest-modal__result-media">
        <img
          class="event-chest-modal__result-image"
          src="${escapeHtml(imageSrc)}"
          onerror="${buildImageFallback(EVENT_CHEST_FALLBACK_ICON_PATHS.reward)}"
          alt="${escapeHtml(rewardName)}"
        />
      </div>
      ${
        reward.type === "tokens" || reward.duplicateConverted
          ? `
            <p class="daily-element-chest-modal__result-line" data-event-chest-duplicate-result="true">
              <strong>Duplicate Converted</strong>
              <span>+${duplicateTokens} Tokens</span>
            </p>
            ${cosmetic?.name ? `<p class="daily-element-chest-modal__result-line"><strong>Reward</strong><span>${escapeHtml(cosmetic.name)}</span></p>` : ""}
          `
          : `
            <p class="daily-element-chest-modal__result-line" data-event-chest-new-result="true">
              <strong>New Reward</strong>
              <span>${escapeHtml(rewardName)}</span>
            </p>
          `
      }
      ${cosmetic?.type ? `<p class="daily-element-chest-modal__result-line"><strong>Type</strong><span>${escapeHtml(formatTypeLabel(cosmetic.type))}</span></p>` : ""}
      ${cosmetic?.element ? `<p class="daily-element-chest-modal__result-line"><strong>Element</strong><span>${escapeHtml(formatTypeLabel(cosmetic.element))}</span></p>` : ""}
      ${Number(result.costCharged ?? 0) > 0 ? `<p class="daily-element-chest-modal__result-line"><strong>Cost</strong><span>${Number(result.costCharged)} Tokens</span></p>` : ""}
      ${Number.isFinite(Number(result.tokenBalance)) ? `<p class="daily-element-chest-modal__result-line"><strong>Balance</strong><span>${Math.max(0, Number(result.tokenBalance))} Tokens</span></p>` : ""}
      ${
        guarantee === "legendary"
          ? `<p class="daily-element-chest-modal__pity-line" data-event-chest-guarantee-result="legendary">Legendary guarantee activated</p>`
          : guarantee === "epic_plus"
            ? `<p class="daily-element-chest-modal__pity-line" data-event-chest-guarantee-result="epic-plus">Epic+ guarantee activated</p>`
            : ""
      }
    </section>
  `;
}

export function renderEventChestModalBody(view = {}) {
  const chest = view.chest ?? {};
  const icons = chest.icons ?? {};
  const opening = view.openInFlight === true;
  const opened = Boolean(view.result);
  const imageSrc = resolveAssetPath(
    opening || opened ? icons.open : icons.closed,
    opening || opened ? EVENT_CHEST_FALLBACK_ICON_PATHS.open : EVENT_CHEST_FALLBACK_ICON_PATHS.closed
  );
  const imageFallback = opening || opened
    ? EVENT_CHEST_FALLBACK_ICON_PATHS.open
    : EVENT_CHEST_FALLBACK_ICON_PATHS.closed;
  const methods = chest.methods ?? {};
  const free = methods.free ?? {};
  const paid = methods.paid ?? {};
  const rewardPool = chest.rewardPool ?? {};
  const byRarity = rewardPool.byRarity ?? {};
  const availability = chest.availability ?? {};
  const errorMessage = String(view.errorMessage ?? "").trim();

  return `
    <div
      class="stack-sm daily-element-chest-modal event-chest-modal${opening ? " daily-element-chest-modal--opening" : ""}${opened ? " daily-element-chest-modal--has-result" : ""}"
      data-event-chest-modal="true"
      data-event-chest-modal-chest-id="${escapeHtml(chest.chestId ?? "")}"
      data-event-chest-modal-definition-revision-id="${escapeHtml(chest.definitionRevisionId ?? "")}"
    >
      <div class="daily-element-chest-modal__hero${opening ? " daily-element-chest-modal__hero--opening" : ""}">
        <img
          class="daily-element-chest-modal__image${opening || opened ? " daily-element-chest-modal__image--open" : ""}"
          src="${escapeHtml(imageSrc)}"
          onerror="${buildImageFallback(imageFallback)}"
          alt="${escapeHtml(chest.title ?? "Event Chest")}"
        />
        ${opening ? `<p class="daily-element-chest-modal__opening-copy" data-event-chest-opening="true">Opening...</p>` : ""}
      </div>
      <section class="daily-element-chest-modal__section" data-event-chest-identity="true">
        <h4>${escapeHtml(chest.modalTitle ?? chest.title ?? "Event Chest")}</h4>
        ${chest.subtitle ? `<p>${escapeHtml(chest.subtitle)}</p>` : ""}
        ${chest.description ? `<p class="muted">${escapeHtml(chest.description)}</p>` : ""}
        <p data-event-chest-availability="true">Availability: ${escapeHtml(formatTypeLabel(availability.state ?? (chest.available ? "available" : "unavailable")))}</p>
        ${
          availability.startsAt || availability.endsAt
            ? `<p class="muted">Window: ${escapeHtml(availability.startsAt ?? "Now")} to ${escapeHtml(availability.endsAt ?? "No end")}</p>`
            : `<p class="muted">No schedule limit is configured for this active revision.</p>`
        }
      </section>
      <div class="daily-element-chest-modal__status-grid">
        <div class="daily-element-chest-modal__stat">
          <span class="daily-element-chest-modal__label">Tokens</span>
          <strong data-event-chest-token-balance="true">${Math.max(0, Number(chest.tokenBalance ?? paid.tokenBalance ?? 0) || 0)}</strong>
        </div>
        <div class="daily-element-chest-modal__stat">
          <span class="daily-element-chest-modal__label">Collected</span>
          <strong data-event-chest-collection-summary="true">${Math.max(0, Number(rewardPool.ownedCount ?? 0) || 0)} / ${Math.max(0, Number(rewardPool.totalCount ?? 0) || 0)}</strong>
        </div>
      </div>
      ${errorMessage ? `<p class="daily-element-chest-modal__error" data-event-chest-error="true">${escapeHtml(errorMessage)}</p>` : ""}
      <div class="daily-element-chest-modal__actions">
        ${
          free.enabled
            ? `<button id="event-chest-free-open-btn" class="btn" type="button" ${free.available && !opening ? "" : 'disabled="disabled"'}>${view.pendingMethod === "free" ? "Opening..." : free.available ? "Free Open" : free.claimed ? "Free Open Claimed" : "Free Open Unavailable"}</button>`
            : ""
        }
        ${
          paid.enabled
            ? `<button id="event-chest-paid-open-btn" class="btn btn-secondary" type="button" ${paid.available && !opening ? "" : 'disabled="disabled"'}>${view.pendingMethod === "paid" ? "Opening..." : `Open for ${Number(paid.costTokens ?? 0)} Tokens`}</button>`
            : ""
        }
      </div>
      ${free.enabled && !free.available && free.nextAvailableAt ? `<p class="muted" data-event-chest-next-free="true">Next free: ${escapeHtml(formatEventChestTimestamp(free.nextAvailableAt) || free.nextAvailableAt)}</p>` : ""}
      ${paid.enabled && !paid.canAfford ? `<p class="muted" data-event-chest-paid-affordability="true">Not enough Tokens.</p>` : ""}
      <section class="daily-element-chest-modal__section">
        <h4>Odds</h4>
        <ul class="daily-element-chest-modal__odds-list" data-event-chest-odds="true">
          ${RARITY_ORDER.map((rarity) => `<li>${escapeHtml(formatRarityLabel(rarity))} ${escapeHtml(formatOddsPercent(chest.odds?.[rarity]))}</li>`).join("")}
        </ul>
      </section>
      <section class="daily-element-chest-modal__section">
        <h4>Guarantees</h4>
        ${renderPityLine("Epic+", chest.pity?.epicPlus, "epic-plus")}
        ${renderPityLine("Legendary", chest.pity?.legendary, "legendary")}
      </section>
      <section class="daily-element-chest-modal__section" data-event-chest-collection-progress="true">
        <div class="daily-element-chest-modal__collection-header">
          <h4>Reward Collection</h4>
          <strong>${Math.max(0, Number(rewardPool.ownedCount ?? 0) || 0)} / ${Math.max(0, Number(rewardPool.totalCount ?? 0) || 0)} Collected</strong>
        </div>
        <div class="daily-element-chest-modal__collection-rarity-grid">
          ${RARITY_ORDER.map((rarity) => `<p data-event-chest-rarity-progress="${rarity}">${escapeHtml(formatRarityLabel(rarity))} ${Math.max(0, Number(byRarity[rarity]?.owned ?? 0) || 0)}/${Math.max(0, Number(byRarity[rarity]?.total ?? 0) || 0)}</p>`).join("")}
        </div>
      </section>
      <section class="daily-element-chest-modal__section">
        <h4>Reward Pool</h4>
        <div class="daily-element-chest-modal__pool-grid" data-event-chest-reward-pool="true">
          ${RARITY_ORDER.map((rarity) => renderPoolSection(rarity, rewardPool.items?.[rarity])).join("")}
        </div>
      </section>
      ${renderResult(view)}
    </div>
  `;
}
