(() => {
  "use strict";
  const signInView = document.querySelector("#sign-in-view");
  const passwordView = document.querySelector("#password-view");
  const loginForm = document.querySelector("#host-login-form");
  const passwordForm = document.querySelector("#password-form");
  const loginMessage = document.querySelector("#login-message");
  const passwordMessage = document.querySelector("#password-message");
  const forgotButton = document.querySelector("#forgot-password");

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "The request could not be completed.");
    return payload;
  }

  function busy(form, active, label) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = active;
    button.querySelector("span").textContent = active ? label : button.dataset.label;
  }

  for (const form of [loginForm, passwordForm]) {
    const button = form.querySelector('button[type="submit"]');
    button.dataset.label = button.querySelector("span").textContent;
  }

  async function acceptInvite() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    if (!accessToken || !refreshToken) return false;
    history.replaceState(null, "", "/host-login");
    try {
      await api("/api/portal-establish-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, refreshToken }),
      });
      signInView.hidden = true;
      passwordView.hidden = false;
      passwordForm.elements.password.focus();
      return true;
    } catch (error) {
      loginMessage.textContent = error.message;
      return false;
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.textContent = "";
    const values = new FormData(loginForm);
    busy(loginForm, true, "Signing in...");
    try {
      const result = await api("/api/portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.get("email"),
          password: values.get("password"),
          website: values.get("website"),
        }),
      });
      window.location.assign(result.redirect || "/portal");
    } catch (error) {
      loginMessage.textContent = error.message;
      busy(loginForm, false);
    }
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    passwordMessage.textContent = "";
    const values = new FormData(passwordForm);
    const password = String(values.get("password") || "");
    if (password !== String(values.get("confirmPassword") || "")) {
      passwordMessage.textContent = "The two passwords do not match.";
      return;
    }
    busy(passwordForm, true, "Activating...");
    try {
      const result = await api("/api/portal-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      window.location.assign(result.redirect || "/portal");
    } catch (error) {
      passwordMessage.textContent = error.message;
      busy(passwordForm, false);
    }
  });

  forgotButton.addEventListener("click", async () => {
    const email = String(loginForm.elements.email.value || "").trim();
    if (!email) {
      loginMessage.textContent = "Enter your host email address first.";
      loginForm.elements.email.focus();
      return;
    }
    forgotButton.disabled = true;
    loginMessage.textContent = "";
    try {
      await api("/api/portal-recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      loginMessage.classList.add("success");
      loginMessage.textContent = "If this address has active portal access, a secure password link has been sent.";
    } catch (error) {
      loginMessage.textContent = error.message;
    } finally {
      forgotButton.disabled = false;
    }
  });

  (async () => {
    if (await acceptInvite()) return;
    try {
      const session = await api("/api/portal-session");
      if (session.authenticated) window.location.replace("/portal");
    } catch {
      // The sign-in form remains available.
    }
  })();
})();

