import { getAssetPath } from "../../utils/dom.js";
import { buildThemedSurfaceClassName } from "../shared/themedSurfaceShared.js";

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
          <span class="featured-rival-card__detail">Daily First Win Bonus: +10 XP / +10 Tokens</span>
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

function renderTrainingModeOption({ name, id, checked }) {
  return `
    <label class="settings-radio-option settings-radio-option-featured-rival" for="${id}">
      <span class="settings-radio-main">
        <input id="${id}" name="${name}" type="radio" value="training_mode" ${checked ? "checked" : ""} />
        <strong>Training Mode (Easy)</strong>
      </span>
      <span class="featured-rival-card">
        <img
          class="featured-rival-card__art"
          src="${getAssetPath("menu_tiles/tile_training_mode.png")}"
          alt="Training Mode"
        />
        <span class="featured-rival-card__body">
          <span class="featured-rival-card__eyebrow">Training Mode / Easy</span>
          <strong class="featured-rival-card__name">Training Mode (Easy)</strong>
          <span class="featured-rival-card__detail">Practice normal PvE rules without timers or progression.</span>
          <span class="featured-rival-card__detail">Coach panel placeholder included.</span>
        </span>
      </span>
    </label>
  `;
}

function renderBloodMatchOption({ name, id, checked }) {
  return `
    <label class="settings-radio-option settings-radio-option-featured-rival settings-radio-option-blood-match" for="${id}">
      <span class="settings-radio-main">
        <input id="${id}" name="${name}" type="radio" value="blood_match" ${checked ? "checked" : ""} />
        <strong>Blood Match</strong>
      </span>
      <span class="featured-rival-card">
        <img
          class="featured-rival-card__art"
          src="${getAssetPath("menu_tiles/tile_blood_match_mode.png")}"
          alt="Blood Match"
        />
        <span class="featured-rival-card__body">
          <span class="featured-rival-card__eyebrow">Three-Combatant Challenge</span>
          <strong class="featured-rival-card__name">Blood Match</strong>
          <span class="featured-rival-card__title">Player vs Countess Veyra vs Ravena Moonfang</span>
          <span class="featured-rival-card__detail">Eliminate both rivals.</span>
          <span class="featured-rival-card__detail">Or lead both surviving rivals when time expires.</span>
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
      context.selectedTrainingMode
        ? "training_mode"
        : context.selectedBloodMatch
        ? "blood_match"
        : context.selectedGauntletMode
        ? "gauntlet_mode"
        : String(context.selectedFeaturedRivalId ?? "").trim().toLowerCase() === "crownfire_duelist"
          ? "featured_rival_crownfire"
          : selectedDifficulty;

    return `
      <section class="screen screen-ai-difficulty">
        <section class="${buildThemedSurfaceClassName({ backgroundImage: context.backgroundImage ?? "" })}" style="background-image: url('${context.backgroundImage ?? ""}')">
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
                ${renderTrainingModeOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-training",
                  checked: selectedOption === "training_mode"
                })}
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
                ${renderBloodMatchOption({
                  name: "pveOpponentChoice",
                  id: "ai-difficulty-select-blood-match",
                  checked: selectedOption === "blood_match"
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
      if (pveOpponentChoice === "training_mode") {
        await context.actions.start({ aiDifficulty: "easy", trainingMode: true });
        return;
      }
      if (pveOpponentChoice === "gauntlet_mode") {
        await context.actions.start({ gauntletMode: true });
        return;
      }
      if (pveOpponentChoice === "blood_match") {
        await context.actions.start({ bloodMatch: true });
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
