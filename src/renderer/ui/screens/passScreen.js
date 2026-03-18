export const passScreen = {
  render(context) {
    return `
      <section class="screen screen-pass">
        <div class="panel hero-panel pass-panel">
          <p class="pass-message">${context.message ?? "Click when ready"}</p>
          ${context.summary ? `<p class="pass-summary">${context.summary}</p>` : ""}
          <p id="pass-timer-label" class="pass-timer">Time Remaining: ${context.secondsLeft ?? 30}s</p>
          ${context.showContinueButton === false ? "" : '<button id="pass-continue-btn" class="btn btn-primary">OK</button>'}
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("pass-continue-btn")?.addEventListener("click", context.actions.continue);
  }
};
