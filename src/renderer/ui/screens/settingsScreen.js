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

export const settingsScreen = {
  render(context) {
    const settings = context.settings;
    const aiDifficulty = settings.aiDifficulty ?? "normal";
    const aiOpponentStyle = settings.aiOpponentStyle ?? "default";

    return `
      <section class="screen screen-settings">
        <div class="panel">
          <div class="screen-topbar">
            <h2 class="view-title">Settings</h2>
            <button id="settings-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          <form id="settings-form" class="stack-sm">
            <div class="settings-group">
              <label for="timer-seconds">Round Timer (seconds)</label>
              <input id="timer-seconds" name="timerSeconds" type="number" min="5" max="120" value="${settings.gameplay.timerSeconds}" />
            </div>

            <div class="settings-group">
              <span class="settings-group-title"><strong>AI Difficulty</strong></span>
              ${renderRadioOption({
                name: "aiDifficulty",
                id: "ai-difficulty-easy",
                value: "easy",
                checked: aiDifficulty === "easy",
                title: "Easy",
                subtitle: "Random AI card selection",
                warning: "Achievements disabled on Easy difficulty"
              })}
              ${renderRadioOption({
                name: "aiDifficulty",
                id: "ai-difficulty-normal",
                value: "normal",
                checked: aiDifficulty === "normal",
                title: "Normal",
                subtitle: "Fair light heuristic using public match state only"
              })}
              ${renderRadioOption({
                name: "aiDifficulty",
                id: "ai-difficulty-hard",
                value: "hard",
                checked: aiDifficulty === "hard",
                title: "Hard",
                subtitle: "Advanced AI with smarter risk and WAR management"
              })}
            </div>

            <div class="settings-group">
              <span class="settings-group-title"><strong>AI Opponent Style</strong></span>
              ${renderRadioOption({
                name: "aiOpponentStyle",
                id: "ai-style-default",
                value: "default",
                checked: aiOpponentStyle === "default",
                title: "Default",
                subtitle: "Use the standard Elemental AI presentation"
              })}
              ${renderRadioOption({
                name: "aiOpponentStyle",
                id: "ai-style-random",
                value: "random",
                checked: aiOpponentStyle === "random",
                title: "Random",
                subtitle: "Randomize AI avatar, title, and card back from the global cosmetic pool each PvE match"
              })}
            </div>

            <div class="settings-group">
              <label class="toggle-row" for="reduced-motion">
                <input id="reduced-motion" name="reducedMotion" type="checkbox" ${settings.ui.reducedMotion ? "checked" : ""} />
                Reduced Motion
              </label>

              <label class="toggle-row" for="sound-enabled">
                <input id="sound-enabled" name="soundEnabled" type="checkbox" ${settings.audio?.enabled !== false ? "checked" : ""} />
                Sound Effects
              </label>
            </div>

            <button type="submit" class="btn btn-primary">Save Settings</button>
          </form>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const timerSeconds = Number(formData.get("timerSeconds") ?? 30);
      const reducedMotion = formData.get("reducedMotion") === "on";
      const soundEnabled = formData.get("soundEnabled") === "on";
      const aiDifficulty = String(formData.get("aiDifficulty") ?? "normal");
      const aiOpponentStyle = String(formData.get("aiOpponentStyle") ?? "default");

      await context.actions.save({
        gameplay: { timerSeconds },
        aiDifficulty,
        aiOpponentStyle,
        ui: { reducedMotion },
        audio: { enabled: soundEnabled }
      });
    });

    document.getElementById("settings-back-btn").addEventListener("click", context.actions.back);
  }
};
