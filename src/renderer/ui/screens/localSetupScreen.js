export const localSetupScreen = {
  render(context) {
    const defaults = context.defaultNames ?? {};

    return `
      <section class="screen screen-local-setup">
        <div class="panel hero-panel">
          <button id="local-setup-back-btn" class="btn screen-back-btn">Back to Menu</button>
          <h2 class="view-title">Local 2-Player Setup</h2>
          <form id="local-setup-form" class="stack-sm">
            <label for="local-p1-name">Player 1 Name</label>
            <input id="local-p1-name" name="p1Name" type="text" maxlength="24" value="${defaults.p1 ?? ""}" required />

            <label for="local-p2-name">Player 2 Name</label>
            <input id="local-p2-name" name="p2Name" type="text" maxlength="24" value="${defaults.p2 ?? ""}" required />

            <button type="submit" class="btn btn-primary">Start Local Match</button>
          </form>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("local-setup-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const p1Name = String(formData.get("p1Name") ?? "").trim();
      const p2Name = String(formData.get("p2Name") ?? "").trim();

      await context.actions.start(p1Name, p2Name);
    });

    document.getElementById("local-setup-back-btn").addEventListener("click", context.actions.back);
  }
};
