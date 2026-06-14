import { escapeHtml } from "../../utils/dom.js";
import { MATCH_TAUNT_FEED_LIMIT, MATCH_TAUNT_PRESETS } from "./playSurfaceShared.js";

export const GAME_BATTLE_EXPRESSIONS_RAIL_OPTIONS = Object.freeze({
  shellClassName: "match-taunt-shell game-match-taunt-rail",
  shellDataAttributes: `
    data-match-taunt-shell="game"
    data-game-match-taunt-rail="true"
  `,
  headerClassName: "game-match-taunt-rail-header match-taunt-controls-row game-match-taunt-topbar",
  triggerClassName: "btn btn-secondary match-taunts-toggle-btn game-match-taunt-rail-trigger",
  boxClassName: "game-match-taunt-box game-match-taunt-fixed-box",
  bodyClassName: "game-match-taunt-rail-body game-match-taunt-box-scroll",
  headerDataAttributes: `
      data-game-match-taunt-rail-header="true"
      data-game-match-taunt-controls="true"
      data-game-match-taunt-topbar="true"
    `,
  triggerDataAttributes: `
        data-game-match-taunt-rail-trigger="true"
      `,
  boxDataAttributes: `
      data-game-match-taunt-box="true"
      data-game-match-taunt-fixed-box="true"
    `,
  bodyDataAttributes: `
        data-game-match-taunt-rail-body="true"
        data-game-match-taunt-scroll="true"
      `,
  panelDataScope: "game",
  toggleButtonId: "game-taunts-toggle-btn"
});

export function renderBattleExpressionsFeed(messages = []) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-MATCH_TAUNT_FEED_LIMIT) : [];
  return `
          <div class="match-taunt-feed" aria-live="polite" aria-label="Recent expressions">
            ${safeMessages
              .map(
                (message) => `
                  <div
                    class="match-taunt-entry ${message?.isAi ? "is-ai" : message?.isOpponent ? "is-opponent" : "is-player"} ${message?.isFading ? "is-fading" : ""}"
                    data-taunt-message-id="${escapeHtml(message?.id ?? "")}"
                  >
                    <strong>${escapeHtml(message?.speaker ?? "Player")}</strong>
                    <span>${escapeHtml(message?.text ?? "")}</span>
                  </div>
                `
              )
              .join("")}
          </div>
  `;
}

export function renderBattleExpressionsPanel(presetLines = MATCH_TAUNT_PRESETS, options = {}) {
  const {
    canSend = true,
    panelDataScope = "online",
    toggleButtonId = "online-taunts-toggle-btn"
  } = options;
  const safePresetLines = Array.isArray(presetLines) ? presetLines : MATCH_TAUNT_PRESETS;

  return `
                <div id="${escapeHtml(toggleButtonId.replace("-toggle-btn", "-panel"))}" class="match-taunt-panel" data-match-taunt-panel="${escapeHtml(panelDataScope)}" aria-label="Match Expressions">
                  ${safePresetLines
                    .map(
                      (line, index) => `
                        <button
                          type="button"
                          class="match-taunt-option"
                          data-taunt-line="${escapeHtml(line)}"
                          data-taunt-index="${String(index)}"
                          ${canSend ? "" : "disabled"}
                        >
                          ${escapeHtml(line)}
                        </button>
                      `
                    )
                    .join("")}
                </div>
  `;
}

export function renderBattleExpressionsRailContents(taunts = {}, options = {}) {
  const {
    headerClassName = "online-match-taunt-rail-header online-match-taunt-controls-row online-match-taunt-topbar",
    triggerClassName = "btn btn-secondary match-taunts-toggle-btn online-match-taunt-rail-trigger",
    boxClassName = "online-match-taunt-box online-match-taunt-fixed-box",
    bodyClassName = "online-match-taunt-rail-body online-match-taunt-rail-scroll-body online-match-taunt-box-scroll",
    headerDataAttributes = `
        data-online-match-taunt-rail-header="true"
        data-online-match-taunt-controls="true"
        data-online-match-taunt-topbar="true"
      `,
    triggerDataAttributes = `
          data-online-match-taunt-rail-trigger="true"
          data-online-match-taunt-trigger="true"
        `,
    boxDataAttributes = `
        data-online-match-taunt-box="true"
        data-online-match-taunt-fixed-box="true"
      `,
    bodyDataAttributes = `
          data-online-match-taunt-rail-body="true"
          data-online-match-taunt-body-scroll="true"
          data-online-match-taunt-scroll="true"
        `,
    panelDataScope = "online",
    toggleButtonId = "online-taunts-toggle-btn"
  } = options;
  const panelOpen = Boolean(taunts.panelOpen);
  const safePresetLines = Array.isArray(taunts.presetLines) ? taunts.presetLines : MATCH_TAUNT_PRESETS;
  const safeCooldownMs = Math.max(0, Number(taunts.cooldownRemainingMs) || 0);
  const cooldownSeconds = Math.ceil(safeCooldownMs / 1000);
  const cooldownLabel = safeCooldownMs > 0 ? `${cooldownSeconds}s` : "Ready";
  const canSend = taunts.canSend ?? true;

  return `
      <div
        class="${escapeHtml(headerClassName)}"
        ${headerDataAttributes}
      >
        <button
          id="${escapeHtml(toggleButtonId)}"
          type="button"
          class="${escapeHtml(triggerClassName)}"
          ${triggerDataAttributes}
          aria-expanded="${panelOpen ? "true" : "false"}"
        >
          Expressions
        </button>
        <p class="match-taunt-cooldown" data-taunt-cooldown-state="${safeCooldownMs > 0 ? "cooldown" : "ready"}">
          ${escapeHtml(cooldownLabel)}
        </p>
      </div>
      <div
        class="${escapeHtml(boxClassName)}"
        ${boxDataAttributes}
      >
        <div
          class="${escapeHtml(bodyClassName)}"
          ${bodyDataAttributes}
        >
          ${renderBattleExpressionsFeed(taunts.messages)}
          ${
            panelOpen
              ? renderBattleExpressionsPanel(safePresetLines, {
                  canSend,
                  panelDataScope,
                  toggleButtonId
                })
              : ""
          }
        </div>
      </div>
  `;
}

export function renderBattleExpressionsRail(taunts = {}, options = {}) {
  const {
    shellClassName = "match-taunt-shell online-match-taunt-rail",
    shellDataAttributes = `
      data-match-taunt-shell="online"
      data-online-match-taunt-rail="true"
    `
  } = options;
  const panelOpen = Boolean(taunts.panelOpen);

  return `
    <aside
      class="${escapeHtml(`${shellClassName} ${panelOpen ? "is-open" : ""}`.trim())}"
      ${shellDataAttributes}
    >
      ${renderBattleExpressionsRailContents(taunts, options)}
    </aside>
  `;
}
