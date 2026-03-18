export const loginScreen = {
  render() {
    return `
      <section class="screen screen-login">
        <div class="panel hero-panel">
          <h2 class="view-title">EleMintz Login</h2>
          <p>Enter your profile name to continue.</p>
          <form id="login-form" class="stack-md">
            <label for="username-input">Username</label>
            <input id="username-input" name="username" type="text" minlength="2" maxlength="24" required />
            <button id="continue-btn" type="submit" class="btn btn-primary">Continue</button>
          </form>
        </div>
      </section>
    `;
  },
  bind(context) {
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("username-input");

    if (!form || !usernameInput) {
      console.error("Login screen failed to bind form/input.");
      return;
    }

    requestAnimationFrame(() => {
      usernameInput.focus();
      usernameInput.select();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = String(usernameInput.value ?? "").trim();
      console.info("[Renderer] login submit begins", {
        username,
        length: username.length
      });

      if (username.length < 2) {
        return;
      }

      await context.actions.login(username);
    });
  }
};


