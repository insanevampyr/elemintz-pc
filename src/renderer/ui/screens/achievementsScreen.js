import { getAssetPath } from "../../utils/dom.js";

function badgePreview(image, name) {
  if (!image) {
    return `<div class="achievement-badge missing">No Badge</div>`;
  }

  const value = String(image);
  const resolved =
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("../") ||
    value.startsWith("./") ||
    value.includes("/assets/") ||
    value.startsWith("assets/")
      ? value
      : getAssetPath(value);
  return `<img src="${resolved}" alt="${name}" class="achievement-badge" />`;
}

function renderAchievement(item) {
  return `
    <article class="achievement-card ${item.unlocked ? "unlocked" : "locked"}">
      ${badgePreview(item.image, item.name)}
      <div>
        <p><strong>${item.name}</strong></p>
        <p>${item.description}</p>
        <p>Status: ${item.unlocked ? "Unlocked" : "Locked"}</p>
        ${item.repeatable ? `<p>Repeat Count: ${item.count}</p>` : ""}
      </div>
    </article>
  `;
}

export const achievementsScreen = {
  render(context) {
    const entries = context.achievements ?? [];

    return `
      <section class="screen screen-achievements">
        <div class="panel">
          <button id="achievements-back-btn" class="btn screen-back-btn">Back to Menu</button>
          <h2 class="view-title">Achievements</h2>
          <p>Unlocked: ${entries.filter((item) => item.unlocked).length} / ${entries.length}</p>
          <div class="achievement-grid achievement-grid-catalog">
            ${entries.map(renderAchievement).join("")}
          </div>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("achievements-back-btn").addEventListener("click", context.actions.back);
  }
};


