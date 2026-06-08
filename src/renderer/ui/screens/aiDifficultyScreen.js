import { getAssetPath } from "../../utils/dom.js";

function renderRadioOption({ name, id, value, checked, title, subtitle, warning = null }) {
  return `
    <label class="settings-radio-option" for="${id}">
      <span class="settings-radio-main">
        <input id="${id}" name="${name}" type="radio" value="${value}" ${checked ? "checked" : ""} />
        <strong>${title}</strong>
      </span>
      ${subtitle ? `<span class="settings-option-description text-muted">${subtitle}</span>` : ""}
      ${warning ? `<span class="settings-option-warning text-danger">${warning}</span>` : ""}
    </label>
  `;
}

function renderFeaturedRivalOption({ name, id, checked }) {
  return `
    <label class="settings-radio-option settings-radio-option-featured-rival" for="${id}">
      <span class="settings-radio-main">
        <input id="${id}" name="${name}" type="radio" value="featured_rival_crownfire" ${checked ? "checked" : ""} />
        <strong>Featured Rival</strong>
      </span>
      <span class="featured-rival-card">
        <img
          class="featured-rival-card__art"
          src="${getAssetPath("rivals/Crownfire/tile_featured_rival_crownfire.png")}"
          alt="Crownfire Duelist Featured Rival"
        />
        <span class="featured-rival-card__body">
          <span class="featured-rival-card__eyebrow">Featured Rival / Boss Battle</span>
          <strong class="featured-rival-card__name">Crownfire Duelist</strong>
          <span class="featured-rival-card__title">Inferno Regent</span>
          <span class="featured-rival-card__detail">Your Deck: 8 cards</span>
          <span class="featured-rival-card__detail">Rival Deck: 12 cards</span>
          <span class="featured-rival-card__detail">Normal EleMintz rules apply</span>
          <span class="featured-rival-card__detail">Daily First Win Bonus: +30 XP / +15 Tokens</span>
          <span class="featured-rival-card__detail">Warning: Crownfire is intentionally difficult.</span>
        </span>
      </span>
    </label>
  `;
}

function renderGauntletOption({ name, id, checked }) {
  return `
    <label class="settings-radio-option settings-radio-option-featured-rival" for="${id}">
      <span class="settings-radio-main">
        <input id="${id}" name="${name}" type="radio" value="gauntlet_mode" ${checked ? "checked" : ""} />
        <strong>Gauntlet Mode</strong>
      </span>
      <span class="featured-rival-card">
        <img
          class="featured-rival-card__art"
          src="${getAssetPath("menu_tiles/tile_gauntlet_mode.png")}"
          alt="Gauntlet Mode"
        />
        <span class="featured-rival-card__body">
          <span class="featured-rival-card__eyebrow">Special Challenge Mode</span>
          <strong class="featured-rival-card__name">Gauntlet Mode</strong>
          <span class="featured-rival-card__detail">Build a win streak against rival AIs.</span>
        </span>
      </span>
    </label>
  `;
}

export const aiDifficultyScreen = {
  render(context) {
    const selectedDifficulty = ["easy", "normal", "hard"].includes(String(context.selectedDifficulty ?? ""))
      ? String(context.selectedDifficulty)
      : "normal";
    const selectedOption =
      context.selectedGauntletMode
        ? "gauntlet_mode"
        : String(context.selectedFeaturedRivalId ?? "").trim().toLowerCase() === "crownfire_duelist"
          ? "featured_rival_crownfire"
          : selectedDifficulty;

    return `
      <section class="screen screen-ai-difficulty">
        <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage ?? ""}')">
          <div class="panel themed-screen-panel">
            <div class="screen-topbar">
              <h2 class="view-title">Choose AI Challenge</h2>
              <button id="ai-difficulty-back-btn" class="btn screen-back-btn">Back</button>
            </div>
            <form id="ai-difficulty-form" class="stack-sm">
              <p class="text-muted">
                Choose your PvE opponent difficulty before starting the match.
              </p>

              <div class="settings-group">
                ${renderRadioOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-easy",
                  value: "easy",
                  checked: selectedOption === "easy",
                  title: "Easy Practice",
                  subtitle: "Practice mode. No stats, quests, achievements, rewards, or chest progress.",
                  warning: "Easy AI is practice-only and does not count toward progression."
                })}
                ${renderRadioOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-normal",
                  value: "normal",
                  checked: selectedOption === "normal",
                  title: "Normal AI",
                  subtitle: "Standard rewards and progression."
                })}
                ${renderRadioOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-hard",
                  value: "hard",
                  checked: selectedOption === "hard",
                  title: "Hard AI",
                  subtitle: "Smarter, tougher AI. Win for +5 XP, +5 tokens, and improved chest chance."
                })}
                ${renderGauntletOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-gauntlet",
                  checked: selectedOption === "gauntlet_mode"
                })}
                ${renderFeaturedRivalOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-featured-rival",
                  checked: selectedOption === "featured_rival_crownfire"
                })}
              </div>

              <button type="submit" class="btn btn-primary">Start Match</button>
            </form>
          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("ai-difficulty-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const pveOpponentChoice = String(formData.get("pveOpponentChoice") ?? "normal").trim().toLowerCase();
      if (pveOpponentChoice === "gauntlet_mode") {
        await context.actions.start({ gauntletMode: true });
        return;
      }
      if (pveOpponentChoice === "featured_rival_crownfire") {
        await context.actions.start({ featuredRivalId: "crownfire_duelist" });
        return;
      }

      await context.actions.start({ aiDifficulty: pveOpponentChoice || "normal" });
    });

    document.getElementById("ai-difficulty-back-btn").addEventListener("click", context.actions.back);
  }
};
