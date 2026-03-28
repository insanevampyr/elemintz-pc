function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderAuthModeControls(prefix, selectedMode) {
  const safeMode = selectedMode === "register" ? "register" : "login";
  return `
    <div class="button-row">
      <label>
        <input type="radio" name="${prefix}Mode" value="login" ${safeMode === "login" ? "checked" : ""} />
        Sign In
      </label>
      <label>
        <input type="radio" name="${prefix}Mode" value="register" ${safeMode === "register" ? "checked" : ""} />
        Create Account
      </label>
    </div>
  `;
}

function renderCredentialFields(prefix, defaults = {}, { includeUsername = true, selectedMode = "login" } = {}) {
  const safeMode = selectedMode === "register" ? "register" : "login";
  return `
    ${renderAuthModeControls(prefix, safeMode)}
    <div class="login-form-field auth-form-field" data-auth-username-field="${prefix}" ${safeMode === "register" ? "" : "hidden"}>
      <label for="${prefix}-username">Username</label>
      <input
        id="${prefix}-username"
        name="${prefix}Username"
        type="text"
        maxlength="32"
        value="${escapeAttribute(includeUsername ? defaults.username ?? "" : "")}"
        data-auth-primary-focus="${prefix}"
        ${includeUsername && safeMode === "register" ? "required" : ""}
      />
    </div>
    <div class="login-form-field auth-form-field">
      <label for="${prefix}-email">Email</label>
      <input
        id="${prefix}-email"
        name="${prefix}Email"
        type="email"
        maxlength="160"
        value="${escapeAttribute(defaults.email ?? "")}"
        data-auth-fallback-focus="${prefix}"
        required
      />
    </div>
    <div class="login-form-field auth-form-field">
      <label for="${prefix}-password">Password</label>
      <input
        id="${prefix}-password"
        name="${prefix}Password"
        type="password"
        minlength="8"
        maxlength="128"
        required
      />
    </div>
  `;
}

export const localSetupScreen = {
  render(context) {
    const player1 = context.player1 ?? {};
    const player2 = context.player2 ?? {};

    return `
      <section class="screen screen-local-setup">
        <div class="panel hero-panel">
          <div class="screen-topbar">
            <h2 class="view-title">Local 2-Player Setup</h2>
            <button id="local-setup-back-btn" class="btn screen-back-btn">Back to Menu</button>
          </div>
          <p>Both players must authenticate with EleMintz accounts before a local hotseat match can start.</p>
          ${context.errorMessage ? `<p class="auth-inline-error" role="alert">${context.errorMessage}</p>` : ""}
          <form id="local-setup-form" class="stack-sm">
            <fieldset class="stack-sm">
              <legend>Player 1 Account</legend>
              ${
                player1.authenticated
                  ? `
                    <p><strong>${player1.username ?? "Signed-in Player 1"}</strong></p>
                    <p class="muted">Player 1 will use the currently authenticated account.</p>
                  `
                  : renderCredentialFields("p1", player1.defaults, {
                      includeUsername: true,
                      selectedMode: player1.mode ?? "login"
                    })
              }
            </fieldset>

            <fieldset class="stack-sm">
              <legend>Player 2 Account</legend>
              ${renderCredentialFields("p2", player2.defaults, {
                includeUsername: true,
                selectedMode: player2.mode ?? "login"
              })}
            </fieldset>

            <button type="submit" class="btn btn-primary">Start Local Match</button>
          </form>
        </div>
      </section>
    `;
  },
  bind(context) {
    const form = document.getElementById("local-setup-form");
    const backButton = document.getElementById("local-setup-back-btn");
    const player1Authenticated = Boolean(context.player1?.authenticated);
    const focusPlayerTwoPrimaryField = () => {
      const usernameInput = document.getElementById("p2-username");
      const emailInput = document.getElementById("p2-email");
      const usernameVisible = Boolean(usernameInput && !usernameInput.closest("[hidden]"));
      requestAnimationFrame(() => {
        if (usernameVisible && usernameInput) {
          usernameInput.focus();
          usernameInput.select?.();
          return;
        }

        emailInput?.focus();
        emailInput?.select?.();
      });
    };

    const syncModeField = (prefix) => {
      const modeInput = document.querySelector(`input[name="${prefix}Mode"]:checked`);
      const usernameField = document.querySelector(`[data-auth-username-field="${prefix}"]`);
      const usernameInput = document.getElementById(`${prefix}-username`);
      const registerMode = modeInput?.value === "register";

      if (usernameField) {
        usernameField.hidden = !registerMode;
      }
      if (usernameInput) {
        usernameInput.required = registerMode;
      }
      if (prefix === "p2") {
        focusPlayerTwoPrimaryField();
      }
    };

    document.querySelectorAll('input[name="p2Mode"]').forEach((input) => {
      input.addEventListener("change", () => syncModeField("p2"));
    });
    if (!player1Authenticated) {
      document.querySelectorAll('input[name="p1Mode"]').forEach((input) => {
        input.addEventListener("change", () => syncModeField("p1"));
      });
      syncModeField("p1");
    }
    syncModeField("p2");
    if (!document.querySelector('input[name="p2Mode"]:checked')) {
      focusPlayerTwoPrimaryField();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await context.actions.start({
        p1: player1Authenticated
          ? {
              authenticated: true
            }
          : {
              mode: String(formData.get("p1Mode") ?? "login"),
              username: String(formData.get("p1Username") ?? "").trim(),
              email: String(formData.get("p1Email") ?? "").trim(),
              password: String(formData.get("p1Password") ?? "")
            },
        p2: {
          mode: String(formData.get("p2Mode") ?? "login"),
          username: String(formData.get("p2Username") ?? "").trim(),
          email: String(formData.get("p2Email") ?? "").trim(),
          password: String(formData.get("p2Password") ?? "")
        }
      });
    });

    backButton.addEventListener("click", context.actions.back);
  }
};
