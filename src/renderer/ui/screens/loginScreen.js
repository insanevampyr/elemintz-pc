function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const loginScreen = {
  render(context = {}) {
    const defaults = context.defaults ?? {};
    const selectedMode = context.mode === "register" ? "register" : "login";
    const errorMessage = String(context.errorMessage ?? "").trim();
    const statusMessage = String(context.statusMessage ?? "").trim();
    return `
      <section class="screen screen-login">
        <div class="panel hero-panel">
          <h2 class="view-title">EleMintz Login</h2>
          <p>Sign in with your EleMintz account to access EleMintz gameplay and profile progression.</p>
          ${statusMessage ? `<p class="auth-status-message" role="status">${statusMessage}</p>` : ""}
          ${errorMessage ? `<p class="auth-inline-error" role="alert">${errorMessage}</p>` : ""}
          <form id="login-form" class="stack-md">
            <div class="login-form-field">
              <label for="username-input">Username</label>
              <input
                id="username-input"
                name="username"
                type="text"
                minlength="2"
                maxlength="24"
                value="${escapeAttribute(defaults.username ?? "")}"
                autocomplete="username"
              />
            </div>
            <div class="login-form-field">
              <label for="email-input">Email</label>
              <input
                id="email-input"
                name="email"
                type="email"
                maxlength="160"
                value="${escapeAttribute(defaults.email ?? "")}"
                autocomplete="email"
              />
            </div>
            <div class="login-form-field">
              <label for="password-input">Password</label>
              <input
                id="password-input"
                name="password"
                type="password"
                minlength="8"
                maxlength="128"
                autocomplete="current-password"
              />
            </div>
            <div class="button-row">
              <button
                id="login-btn"
                type="submit"
                data-auth-submit="login"
                class="btn ${selectedMode === "login" ? "btn-primary" : "btn-secondary"}"
              >Sign In</button>
              <button
                id="register-btn"
                type="submit"
                data-auth-submit="register"
                class="btn ${selectedMode === "register" ? "btn-primary" : "btn-secondary"}"
              >Create Account</button>
            </div>
          </form>
        </div>
      </section>
    `;
  },
  bind(context) {
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("username-input");
    const emailInput = document.getElementById("email-input");
    const passwordInput = document.getElementById("password-input");
    const submitButtons = [...document.querySelectorAll("[data-auth-submit]")];
    let submitMode = context.mode === "register" ? "register" : "login";

    if (!form || !usernameInput || !emailInput || !passwordInput) {
      console.error("Login screen failed to bind form/input.");
      return;
    }

    requestAnimationFrame(() => {
      emailInput.focus();
      emailInput.select();
    });

    for (const button of submitButtons) {
      button.addEventListener("click", () => {
        submitMode = button.dataset.authSubmit === "register" ? "register" : "login";
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = String(usernameInput.value ?? "").trim();
      const email = String(emailInput.value ?? "").trim();
      const password = String(passwordInput.value ?? "");
      console.info("[Renderer] login submit begins", {
        mode: submitMode,
        username,
        emailLength: email.length
      });

      if (submitMode === "register" && username.length < 2) {
        return;
      }

      if (!email || !password) {
        return;
      }

      await context.actions.login({
        mode: submitMode,
        username,
        email,
        password
      });
    });
  }
};


