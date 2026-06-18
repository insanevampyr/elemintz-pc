import { escapeHtml, formatElement } from "../../utils/index.js";

const ELEMENT_ORDER = Object.freeze(["fire", "earth", "wind", "water"]);

export function renderWarPileSummaryPresentation({
  label = "",
  helperText = "",
  elementCounts = {},
  cardImages = {},
  emphasized = false
} = {}) {
  return `
    <div class="war-summary-shell">
      <p class="war-summary-label">${escapeHtml(label)}</p>
      <div class="war-summary-grid ${emphasized ? "is-emphasized" : ""}">
        ${ELEMENT_ORDER.map((element) => {
          const count = Math.max(0, Number(elementCounts?.[element]) || 0);
          const classes = ["war-slot", `war-slot-${element}`];

          if (count === 0) {
            classes.push("is-empty");
          }

          return `
            <div class="${classes.join(" ")}" aria-label="WAR ${formatElement(element)} x${count}">
              <span class="card-art war-slot-art" style="background-image: url('${cardImages?.[element] ?? ""}')"></span>
              <span class="war-slot-count-badge">x${count}</span>
              <span class="war-slot-name">${formatElement(element)}</span>
            </div>
          `;
        }).join("")}
      </div>
      <p class="war-summary-helper">${escapeHtml(helperText)}</p>
    </div>
  `;
}
