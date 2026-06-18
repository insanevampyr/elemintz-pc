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
    value: String(value)
  };
}

function renderDetailLine(line) {
  return `
    <p class="battle-status-line battle-status-detail-line" data-battle-status-detail="${escapeHtml(line.key)}">
      <span class="battle-status-label">${escapeHtml(line.label)}:</span>
      <span class="battle-status-value">${escapeHtml(line.value)}</span>
    </p>
  `;
}

export function renderBattleStatusSummary({
  round,
  primaryCardsTaken = null,
  secondaryCardsTaken = null,
  warCount,
  detailLines = []
} = {}) {
  const primaryLabel = String(primaryCardsTaken?.label ?? "").trim() || "You";
  const secondaryLabel =
    String(secondaryCardsTaken?.label ?? "").trim() ||
    (secondaryCardsTaken?.role === "rival" ? "Rival" : "Opponent");
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
        <span class="battle-status-label">Cards Taken:</span>
        <span class="battle-status-value">${escapeHtml(primaryLabel)} ${formatNumericValue(primaryCardsTaken?.count)} · ${escapeHtml(secondaryLabel)} ${formatNumericValue(secondaryCardsTaken?.count)}</span>
      </p>
      <p class="battle-status-line" data-battle-status-line="wars">
        <span class="battle-status-label">WARs:</span>
        <span class="battle-status-value">${formatNumericValue(warCount)}</span>
      </p>
      ${normalizedDetails.map(renderDetailLine).join("")}
    </div>
  `;
}
