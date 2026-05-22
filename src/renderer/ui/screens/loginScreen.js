function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeAuthMode(mode) {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (normalized === "login" || normalized === "register") {
    return normalized;
  }

  return "choice";
}

function formatVersionLabel(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.toLowerCase() === "unknown") {
    return "";
  }

  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function renderVersionBadge(versionLabel) {
  return versionLabel
    ? `<span class="login-version-badge" aria-hidden="true">${escapeAttribute(versionLabel)}</span>`
    : "";
}

function renderStatusAndError(statusMessage, errorMessage) {
  return `
    ${statusMessage ? `<p class="auth-status-message" role="status">${escapeAttribute(statusMessage)}</p>` : ""}
    ${errorMessage ? `<p class="auth-inline-error" role="alert">${escapeAttribute(errorMessage)}</p>` : ""}
  `;
}

function renderRememberSessionField(defaults = {}) {
  const rememberSession = defaults.rememberSession !== false;
  return `
    <div class="login-form-field login-form-field-checkbox">
      <label class="login-checkbox-label" for="remember-session-input">
        <input
          id="remember-session-input"
          name="rememberSession"
          type="checkbox"
          ${rememberSession ? "checked" : ""}
        />
        <span>Keep me signed in for 30 days</span>
      </label>
      <p class="login-helper-text">Stay signed in after closing the game. Logging out clears this.</p>
    </div>
  `;
}

function renderSignInForm(defaults) {
  return `
    <form id="login-form" class="stack-md" data-auth-mode="login">
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
      ${renderRememberSessionField(defaults)}
      <div class="button-row">
        <button id="login-submit-btn" type="submit" class="btn btn-primary">Sign In</button>
        <button id="login-back-btn" type="button" class="btn btn-secondary">Back</button>
      </div>
    </form>
  `;
}

function renderCreateAccountForm(defaults) {
  return `
    <form id="login-form" class="stack-md" data-auth-mode="register">
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
          autocomplete="new-password"
        />
      </div>
      ${renderRememberSessionField(defaults)}
      <div class="button-row">
        <button id="register-submit-btn" type="submit" class="btn btn-primary">Create Account</button>
        <button id="register-back-btn" type="button" class="btn btn-secondary">Back</button>
      </div>
    </form>
  `;
}

export const loginScreen = {
  render(context = {}) {
    const defaults = context.defaults ?? {};
    const mode = normalizeAuthMode(context.mode);
    const errorMessage = String(context.errorMessage ?? "").trim();
    const statusMessage = String(context.statusMessage ?? "").trim();
    const versionLabel = formatVersionLabel(context.version);

    if (mode === "choice") {
      return `
        <section class="screen screen-login">
          <div class="panel hero-panel">
            <h2 class="view-title">EleMintz Login</h2>
            <p>Choose how you'd like to access your EleMintz account.</p>
            ${renderStatusAndError(statusMessage, errorMessage)}
            <div class="stack-md">
              <button id="auth-choice-sign-in-btn" type="button" class="btn btn-primary">Sign In</button>
              <button id="auth-choice-create-account-btn" type="button" class="btn btn-secondary">Create Account</button>
            </div>
            ${renderVersionBadge(versionLabel)}
          </div>
        </section>
      `;
    }

    const title = mode === "register" ? "Create Account" : "Sign In";
    const instruction =
      mode === "register"
        ? "Create your EleMintz account with a username, email, and password."
        : "Sign in with your email and password.";
    const formHtml = mode === "register" ? renderCreateAccountForm(defaults) : renderSignInForm(defaults);

    return `
      <section class="screen screen-login">
        <div class="panel hero-panel">
          <h2 class="view-title">${title}</h2>
          <p>${instruction}</p>
          ${renderStatusAndError(statusMessage, errorMessage)}
          ${formHtml}
          ${renderVersionBadge(versionLabel)}
        </div>
      </section>
    `;
  },
  bind(context = {}) {
    const mode = normalizeAuthMode(context.mode);

    if (mode === "choice") {
      const signInButton = document.getElementById("auth-choice-sign-in-btn");
      const createAccountButton = document.getElementById("auth-choice-create-account-btn");
      if (!signInButton || !createAccountButton) {
        console.error("Login choice screen failed to bind buttons.");
        return;
      }

      requestAnimationFrame(() => {
        signInButton.focus?.();
      });

      signInButton.addEventListener("click", () => context.actions.openSignIn());
      createAccountButton.addEventListener("click", () => context.actions.openCreateAccount());
      return;
    }

    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("username-input");
    const emailInput = document.getElementById("email-input");
    const passwordInput = document.getElementById("password-input");
    const rememberSessionInput = document.getElementById("remember-session-input");
    const backButton = document.getElementById(mode === "register" ? "register-back-btn" : "login-back-btn");

    if (!form || !emailInput || !passwordInput || !backButton) {
      console.error("Login screen failed to bind form/input.");
      return;
    }

    requestAnimationFrame(() => {
      const focusTarget = mode === "register" ? usernameInput ?? emailInput : emailInput;
      focusTarget?.focus?.();
      focusTarget?.select?.();
    });

    backButton.addEventListener("click", () => context.actions.back());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = String(usernameInput?.value ?? "").trim();
      const email = String(emailInput.value ?? "").trim();
      const password = String(passwordInput.value ?? "");
      const rememberSession = rememberSessionInput?.checked !== false;

      if (mode === "login") {
        if (!email || !password) {
          context.actions.showMode({
            mode: "login",
            errorMessage: "Email and password are required to sign in.",
            defaults: { email, rememberSession }
          });
          return;
        }
      } else {
        if (!username || !email || !password) {
          context.actions.showMode({
            mode: "register",
            errorMessage: "Username, email, and password are required to create an account.",
            defaults: { username, email, rememberSession }
          });
          return;
        }

        if (username.length < 2) {
          context.actions.showMode({
            mode: "register",
            errorMessage: "Username must be at least 2 characters long.",
            defaults: { username, email, rememberSession }
          });
          return;
        }
      }

      await context.actions.login({
        mode,
        username,
        email,
        password,
        rememberSession
      });
    });
  }
};
