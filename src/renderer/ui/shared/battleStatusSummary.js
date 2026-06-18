import { escapeHtml } from "../../utils/dom.js";

const UNKNOWN_VALUE = "—";

function formatNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return UNKNOWN_VALUE;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : UNKNOWN_VALUE;
}

function normalizeDetailLine(line) {
  const key = String(line?.key ?? "").trim();
  const label = String(line?.label ?? "").trim();
  const value = line?.value;

  if (!key || !label || value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  return {
    key,
    label,
    value: String(value),
    lowTime: Boolean(line?.lowTime)
  };
}

function renderDetailLine(line) {
  const isOnlineTurnTimer = line.key === "online-turn-timer";
  const className = isOnlineTurnTimer
    ? `battle-status-line battle-status-detail-line online-turn-timer-shell${line.lowTime ? " is-low-time" : ""}`
    : "battle-status-line battle-status-detail-line";
  const shellAttributes = isOnlineTurnTimer
    ? ' data-online-turn-timer-shell="true" aria-live="polite"'
    : "";
  const valueAttributes = isOnlineTurnTimer
    ? ' class="battle-status-value online-turn-timer-label" data-online-turn-timer-label="true"'
    : ' class="battle-status-value"';

  return `
    <p class="${className}" data-battle-status-detail="${escapeHtml(line.key)}"${shellAttributes}>
      <span class="battle-status-label">${escapeHtml(line.label)}:</span>
      <span${valueAttributes}>${escapeHtml(line.value)}</span>
    </p>
  `;
}

export function renderBattleStatusSummary({
  round,
  primaryCards = null,
  secondaryCards = null,
  warCount,
  detailLines = []
} = {}) {
  const primaryLabel = String(primaryCards?.label ?? "").trim() || "You";
  const secondaryLabel =
    String(secondaryCards?.label ?? "").trim() ||
    (secondaryCards?.role === "rival" ? "Rival" : "Opponent");
  const normalizedDetails = Array.isArray(detailLines)
    ? detailLines.map(normalizeDetailLine).filter(Boolean)
    : [];

  return `
    <div class="battle-status-summary" data-battle-status-summary="true">
      <p class="battle-status-heading"><strong>Status</strong></p>
      <p class="battle-status-line" data-battle-status-line="round">
        <span class="battle-status-label">Round:</span>
        <span class="battle-status-value">${formatNumericValue(round)}</span>
      </p>
      <p class="battle-status-line" data-battle-status-line="cards">
        <span class="battle-status-label">Cards:</span>
        <span class="battle-status-value">${escapeHtml(primaryLabel)} ${formatNumericValue(primaryCards?.count)} · ${escapeHtml(secondaryLabel)} ${formatNumericValue(secondaryCards?.count)}</span>
      </p>
      <p class="battle-status-line" data-battle-status-line="wars">
        <span class="battle-status-label">WARs:</span>
        <span class="battle-status-value">${formatNumericValue(warCount)}</span>
      </p>
      ${normalizedDetails.map(renderDetailLine).join("")}
    </div>
  `;
}
