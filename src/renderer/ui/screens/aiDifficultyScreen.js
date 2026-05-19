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

export const aiDifficultyScreen = {
  render(context) {
    const selectedDifficulty = ["easy", "normal", "hard"].includes(String(context.selectedDifficulty ?? ""))
      ? String(context.selectedDifficulty)
      : "normal";

    return `
      <section class="screen screen-ai-difficulty">
        <div class="panel">
          <div class="screen-topbar">
            <h2 class="view-title">Choose AI Difficulty</h2>
            <button id="ai-difficulty-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          <form id="ai-difficulty-form" class="stack-sm">
            <p class="text-muted">
              Choose your PvE opponent difficulty before starting the match.
            </p>

            <div class="settings-group">
              ${renderRadioOption({
                name: "aiDifficulty",
                id: "ai-difficulty-select-easy",
                value: "easy",
                checked: selectedDifficulty === "easy",
                title: "Easy Practice",
                subtitle: "Practice mode. No stats, quests, achievements, rewards, or chest progress.",
                warning: "Easy AI is practice-only and does not count toward progression."
              })}
              ${renderRadioOption({
                name: "aiDifficulty",
                id: "ai-difficulty-select-normal",
                value: "normal",
                checked: selectedDifficulty === "normal",
                title: "Normal AI",
                subtitle: "Standard rewards and progression."
              })}
              ${renderRadioOption({
                name: "aiDifficulty",
                id: "ai-difficulty-select-hard",
                value: "hard",
                checked: selectedDifficulty === "hard",
                title: "Hard AI",
                subtitle: "Smarter, tougher AI. Win for +5 XP, +5 tokens, and improved chest chance."
              })}
            </div>

            <button type="submit" class="btn btn-primary">Start Match</button>
          </form>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("ai-difficulty-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const aiDifficulty = String(formData.get("aiDifficulty") ?? "normal");
      await context.actions.start({ aiDifficulty });
    });

    document.getElementById("ai-difficulty-back-btn").addEventListener("click", context.actions.back);
  }
};
