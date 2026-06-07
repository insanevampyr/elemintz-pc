import { escapeHtml, getAssetPath } from "../../utils/dom.js";

export const DAILY_ELEMENT_CHEST_EXPECTED_ICON_PATHS = Object.freeze({
  closed: "icons/daily_chest.png",
  open: "icons/daily_chest_open.png"
});

const DAILY_ELEMENT_CHEST_FALLBACK_ICON_PATHS = Object.freeze({
  closed: "icons/loot_chest.png",
  open: "icons/loot_chest_open.png"
});

function getDailyElementChestImagePath(open) {
  return getAssetPath(
    open ? DAILY_ELEMENT_CHEST_EXPECTED_ICON_PATHS.open : DAILY_ELEMENT_CHEST_EXPECTED_ICON_PATHS.closed
  );
}

function getDailyElementChestFallbackImagePath(open) {
  return getAssetPath(
    open ? DAILY_ELEMENT_CHEST_FALLBACK_ICON_PATHS.open : DAILY_ELEMENT_CHEST_FALLBACK_ICON_PATHS.closed
  );
}

function buildDailyElementChestImageFallback(open) {
  const fallbackSrc = escapeHtml(getDailyElementChestFallbackImagePath(open));
  return `this.onerror=null;this.src='${fallbackSrc}';`;
}

function formatOddsPercent(value) {
  return `${Math.round(Math.max(0, Number(value ?? 0)) * 100)}%`;
}

function getDailyChestRarityClass(rarity) {
  const safeRarity = String(rarity ?? "").trim().toLowerCase();
  return ["common", "rare", "epic", "legendary"].includes(safeRarity) ? safeRarity : "common";
}

function renderPoolSection(title, entries = []) {
  const hasEntries = Array.isArray(entries) && entries.length > 0;
  return `
    <section class="daily-element-chest-modal__pool-group" data-daily-chest-pool-group="${escapeHtml(title)}">
      <h5>${escapeHtml(title)}</h5>
      <ul>
        ${
          hasEntries
            ? entries
                .map((entry) => {
                  const owned = entry?.owned === true;
                  return `
                    <li class="daily-element-chest-modal__pool-item" data-daily-chest-pool-item="${escapeHtml(entry?.cosmeticId ?? "unknown")}">
                      <span>${escapeHtml(entry?.name ?? entry?.cosmeticId ?? "Unknown Reward")}</span>
                      <span
                        class="daily-element-chest-modal__owned-flag daily-element-chest-modal__owned-flag--${owned ? "owned" : "missing"}"
                        data-daily-chest-owned-state="${owned ? "owned" : "missing"}"
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

export function renderDailyElementChestMiniCard(view = {}) {
  const isReady = view.canOpenFree === true;
  const isLoading = view.loading === true;
  const imageSrc = getDailyElementChestImagePath(false);
  const statusBody = isLoading
    ? `<p class="muted daily-element-chest-card__status">Loading chest status...</p>`
    : isReady
      ? `<p class="daily-element-chest-card__status" data-daily-chest-ready="true">Free Open Ready</p>`
      : `
          <p class="muted daily-element-chest-card__status" data-daily-chest-next-free="true">Next free: ${escapeHtml(view.nextFreeLabel ?? "--")}</p>
          <p class="daily-element-chest-card__cost">Open for ${escapeHtml(String(view.paidOpenCost ?? 100))} Tokens</p>
        `;

  return `
    <button
      id="open-daily-element-chest-btn"
      class="daily-element-chest-card"
      type="button"
      data-daily-element-chest-card="true"
      aria-label="Open Daily EleMintz Chest"
    >
      <div class="daily-element-chest-card__art">
        <img
          class="daily-element-chest-card__image"
          src="${imageSrc}"
          onerror="${buildDailyElementChestImageFallback(false)}"
          alt="Daily EleMintz Chest"
        />
      </div>
      <div class="daily-element-chest-card__content">
        <p class="daily-element-chest-card__eyebrow">Daily EleMintz Chest</p>
        ${statusBody}
      </div>
    </button>
  `;
}

export function renderDailyElementChestModalBody(view = {}) {
  const isOpenVisual = view.openInFlight === true || view.resultVisualActive === true;
  const isOpening = view.openInFlight === true;
  const imageSrc = getDailyElementChestImagePath(isOpenVisual);
  const currentTokens = Math.max(0, Number(view.tokens ?? 0));
  const paidOpenCost = Math.max(0, Number(view.paidOpenCost ?? 100));
  const epicProgress = escapeHtml(String(view.epicProgressLabel ?? "0 / 10"));
  const legendaryProgress = escapeHtml(String(view.legendaryProgressLabel ?? "0 / 30"));
  const errorMessage = escapeHtml(String(view.errorMessage ?? "").trim());
  const rewardName = escapeHtml(String(view.resultDisplayName ?? "").trim());
  const duplicateTokens = Math.max(0, Number(view.result?.duplicateConversion?.tokensGranted ?? 0));
  const rarityClass = getDailyChestRarityClass(view.result?.rarity);
  const rarityLabel = escapeHtml(String(view.result?.rarity ?? "unknown").toUpperCase());
  const hasNewReward = Boolean(rewardName);
  const hasDuplicateConversion = duplicateTokens > 0;
  const showHeroToast = view.resultVisualActive === true && Boolean(view.result);
  const collectionProgress = view.collectionProgress ?? null;
  const totalOwned = Math.max(0, Number(collectionProgress?.totalOwned ?? 0));
  const totalAvailable = Math.max(0, Number(collectionProgress?.totalAvailable ?? 0));
  const hasCollectionProgress = Boolean(collectionProgress && totalAvailable > 0);
  const rarityProgress = collectionProgress?.byRarity ?? {};
  const progressItems = collectionProgress?.items ?? view.poolSummary ?? {};

  return `
    <div
      class="stack-sm daily-element-chest-modal${isOpening ? " daily-element-chest-modal--opening" : ""}${view.result ? " daily-element-chest-modal--has-result" : ""}${showHeroToast ? " daily-element-chest-modal--hero-result-visible" : ""}"
      data-daily-element-chest-modal="true"
    >
      <div class="daily-element-chest-modal__hero${isOpening ? " daily-element-chest-modal__hero--opening" : ""}${showHeroToast ? ` daily-element-chest-modal__hero--${rarityClass}` : ""}">
        <img
          class="daily-element-chest-modal__image${isOpenVisual ? " daily-element-chest-modal__image--open" : ""}"
          src="${imageSrc}"
          onerror="${buildDailyElementChestImageFallback(isOpenVisual)}"
          alt="Daily EleMintz Chest"
        />
        ${
          isOpening
            ? `<p class="daily-element-chest-modal__opening-copy" data-daily-chest-opening="true">Opening...</p>`
            : ""
        }
        ${
          showHeroToast
            ? `
              <div
                class="daily-element-chest-modal__hero-toast daily-element-chest-modal__hero-toast--${rarityClass}"
                data-daily-chest-hero-toast="true"
                data-daily-chest-hero-rarity="${rarityClass}"
              >
                <div class="daily-element-chest-modal__hero-toast-header">
                  <span class="daily-element-chest-modal__rarity-badge daily-element-chest-modal__rarity-badge--${rarityClass}" data-daily-chest-hero-rarity-label="${rarityClass}">${rarityLabel}</span>
                </div>
                ${
                  hasNewReward
                    ? `
                      <p class="daily-element-chest-modal__hero-toast-line" data-daily-chest-hero-result-name="true">
                        <strong>New Reward:</strong>
                        <span>${rewardName}</span>
                      </p>
                    `
                    : ""
                }
                ${
                  hasDuplicateConversion
                    ? `
                      <p class="daily-element-chest-modal__hero-toast-line" data-daily-chest-hero-duplicate-result="true">
                        <strong>Duplicate Converted:</strong>
                        <span>+${duplicateTokens} Tokens</span>
                      </p>
                    `
                    : ""
                }
                ${
                  view.result?.pityApplied?.legendary
                    ? `<p class="daily-element-chest-modal__hero-toast-pity" data-daily-chest-hero-pity-result="legendary">Legendary pity activated!</p>`
                    : view.result?.pityApplied?.epicPlus
                      ? `<p class="daily-element-chest-modal__hero-toast-pity" data-daily-chest-hero-pity-result="epic-plus">Epic+ pity activated!</p>`
                      : ""
                }
              </div>
            `
            : ""
        }
      </div>
      <div class="daily-element-chest-modal__status-grid">
        <div class="daily-element-chest-modal__stat">
          <span class="daily-element-chest-modal__label">Tokens</span>
          <strong data-daily-chest-token-count="true">${currentTokens}</strong>
        </div>
        <div class="daily-element-chest-modal__stat">
          <span class="daily-element-chest-modal__label">Free Open</span>
          <strong data-daily-chest-free-status="true">${view.canOpenFree ? "Ready" : "Used"}</strong>
        </div>
      </div>
      ${
        errorMessage
          ? `<p class="daily-element-chest-modal__error" data-daily-chest-error="true">${errorMessage}</p>`
          : ""
      }
      ${
        view.loading
          ? `<p class="muted" data-daily-chest-loading="true">Loading Daily EleMintz Chest...</p>`
          : `
            <div class="daily-element-chest-modal__actions">
              <button
                id="daily-chest-free-open-btn"
                class="btn"
                type="button"
                ${view.canOpenFree && !view.openInFlight ? "" : 'disabled="disabled"'}
              >
                ${view.openInFlight && view.pendingOpenType === "free" ? "Opening..." : "Free Open"}
              </button>
              <button
                id="daily-chest-paid-open-btn"
                class="btn btn-secondary"
                type="button"
                ${view.openInFlight ? 'disabled="disabled"' : ""}
              >
                ${view.openInFlight && view.pendingOpenType === "paid" ? "Opening..." : `Open for ${paidOpenCost} Tokens`}
              </button>
            </div>
            ${
              view.canOpenFree
                ? `<p class="muted daily-element-chest-modal__reset-copy">Your free Daily Chest open is ready.</p>`
                : `<p class="muted daily-element-chest-modal__reset-copy" data-daily-chest-next-reset="true">Next free: ${escapeHtml(view.nextFreeLabel ?? "--")}</p>`
            }
            <div class="daily-element-chest-modal__section">
              <h4>Odds</h4>
              <ul class="daily-element-chest-modal__odds-list">
                <li>Common ${formatOddsPercent(view.odds?.common)}</li>
                <li>Rare ${formatOddsPercent(view.odds?.rare)}</li>
                <li>Epic ${formatOddsPercent(view.odds?.epic)}</li>
                <li>Legendary ${formatOddsPercent(view.odds?.legendary)}</li>
              </ul>
            </div>
            <div class="daily-element-chest-modal__section">
              <h4>Pity Progress</h4>
              <p data-daily-chest-epic-progress="true">Epic+ guarantee: ${epicProgress}</p>
              <p data-daily-chest-legendary-progress="true">Legendary guarantee: ${legendaryProgress}</p>
            </div>
            ${
              hasCollectionProgress
                ? `
                  <div class="daily-element-chest-modal__section" data-daily-chest-collection-progress="true">
                    <div class="daily-element-chest-modal__collection-header">
                      <h4>Daily Chest Collection</h4>
                      <strong data-daily-chest-collection-summary="true">${totalOwned} / ${totalAvailable} Collected</strong>
                    </div>
                    <div class="daily-element-chest-modal__collection-rarity-grid">
                      <p data-daily-chest-rarity-progress="common">Common ${escapeHtml(String(rarityProgress.common?.owned ?? 0))}/${escapeHtml(String(rarityProgress.common?.total ?? 3))}</p>
                      <p data-daily-chest-rarity-progress="rare">Rare ${escapeHtml(String(rarityProgress.rare?.owned ?? 0))}/${escapeHtml(String(rarityProgress.rare?.total ?? 2))}</p>
                      <p data-daily-chest-rarity-progress="epic">Epic ${escapeHtml(String(rarityProgress.epic?.owned ?? 0))}/${escapeHtml(String(rarityProgress.epic?.total ?? 5))}</p>
                      <p data-daily-chest-rarity-progress="legendary">Legendary ${escapeHtml(String(rarityProgress.legendary?.owned ?? 0))}/${escapeHtml(String(rarityProgress.legendary?.total ?? 2))}</p>
                    </div>
                    ${
                      collectionProgress?.isComplete === true
                        ? `
                          <div class="daily-element-chest-modal__collection-complete" data-daily-chest-collection-complete="true">
                            <strong>Collection Complete</strong>
                            <span>Future rewards convert to tokens.</span>
                          </div>
                        `
                        : ""
                    }
                  </div>
                `
                : ""
            }
            <div class="daily-element-chest-modal__section">
              <h4>Reward Pool</h4>
              <div class="daily-element-chest-modal__pool-grid">
                ${renderPoolSection("Common", progressItems.common)}
                ${renderPoolSection("Rare", progressItems.rare)}
                ${renderPoolSection("Epic", progressItems.epic)}
                ${renderPoolSection("Legendary", progressItems.legendary)}
              </div>
            </div>
            ${
              view.result
                ? `
                  <div
                    class="daily-element-chest-modal__section daily-element-chest-modal__result daily-element-chest-modal__result--${rarityClass}"
                    data-daily-chest-result="true"
                    data-daily-chest-rarity-class="${rarityClass}"
                  >
                    <div class="daily-element-chest-modal__result-header">
                      <h4>Latest Result</h4>
                      <span class="daily-element-chest-modal__rarity-badge daily-element-chest-modal__rarity-badge--${rarityClass}" data-daily-chest-rarity="${rarityClass}">${rarityLabel}</span>
                    </div>
                    ${
                      hasNewReward
                        ? `
                          <p class="daily-element-chest-modal__result-line" data-daily-chest-result-name="true">
                            <strong>New Reward</strong>
                            <span>${rewardName}</span>
                          </p>
                        `
                        : ""
                    }
                    ${
                      hasDuplicateConversion
                        ? `
                          <p class="daily-element-chest-modal__result-line" data-daily-chest-duplicate-result="true">
                            <strong>Duplicate Converted</strong>
                            <span>+${duplicateTokens} Tokens</span>
                          </p>
                        `
                        : ""
                    }
                    ${
                      view.result?.pityApplied?.legendary
                        ? `<p class="daily-element-chest-modal__pity-line" data-daily-chest-pity-result="legendary">Legendary pity activated</p>`
                        : view.result?.pityApplied?.epicPlus
                          ? `<p class="daily-element-chest-modal__pity-line" data-daily-chest-pity-result="epic-plus">Epic+ pity activated</p>`
                          : ""
                    }
                  </div>
                `
                : ""
            }
          `
      }
    </div>
  `;
}
