import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./ui/theme.css";
import "./desktopApi";
import { Button, TitleBar } from "./ui/components";
import { IconAlert, IconCheck, IconEye, IconEyeOff, IconLock, IconUser } from "./ui/icons";

function GoogleMark() {
  return (
    <svg className="login__google-mark" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.82-.07-1.64-.23-2.43H12v4.6h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.55-5.17 3.55-8.79Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.94l-3.88-3c-1.08.72-2.47 1.14-4.07 1.14-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.24A7.2 7.2 0 0 1 4.89 12c0-.78.14-1.53.38-2.24V6.67H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.33l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.45-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.67l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

function LoginApp() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingBrowser, setWaitingBrowser] = useState<"google" | "web" | null>(null);

  useEffect(() => {
    void window.electronAPI.getSavedLogin().then((saved) => {
      setUsername(saved.username);
      setPassword(saved.password);
      setRemember(saved.remember);
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await window.electronAPI.login(username, password, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleBrowserLogin(mode: "google" | "web") {
    setError("");
    setLoading(true);
    setWaitingBrowser(mode);
    try {
      await window.electronAPI.browserLogin(mode, remember);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      if (message !== "Cancelled") setError(message);
    } finally {
      setLoading(false);
      setWaitingBrowser(null);
    }
  }

  async function handleCancelBrowser() {
    await window.electronAPI.cancelBrowserLogin();
    setWaitingBrowser(null);
    setLoading(false);
  }

  return (
    <div className="app-shell">
      <TitleBar title="Screen Ping" onClose={() => window.desktopAPI.close()} />

      <div className="login">
        <img className="login__logo" src="./logo.png" alt="" draggable={false} />
        <h1 className="login__title">Welcome back</h1>
        <p className="login__sub">
          {waitingBrowser
            ? "Confirm in your browser, then come back here."
            : "Log in to receive pings on this PC."}
        </p>

        {waitingBrowser ? (
          <div className="login__wait">
            <span className="spinner" />
            <p>
              {waitingBrowser === "google"
                ? "Waiting for Google sign-in in your browser…"
                : "Waiting for website confirmation…"}
            </p>
            <Button type="button" block onClick={() => void handleCancelBrowser()}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <form className="login__form" onSubmit={handleSubmit}>
              <label className="field">
                <span className="field__icon">
                  <IconUser />
                </span>
                <input
                  placeholder="Username or email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                />
              </label>

              <div className="field field--password">
                <span className="field__icon">
                  <IconLock />
                </span>
                <input
                  placeholder="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="field__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </button>
              </div>

              {error && (
                <div className="alert">
                  <IconAlert />
                  <span>{error}</span>
                </div>
              )}

              <div className="login__row">
                <button type="button" className="check" onClick={() => setRemember(!remember)}>
                  <span className={remember ? "check__box check__box--on" : "check__box"}>
                    <IconCheck size={10} />
                  </span>
                  Stay signed in
                </button>
              </div>

              <Button type="submit" variant="primary" block large disabled={loading}>
                {loading ? <span className="spinner" /> : null}
                {loading ? "Connecting…" : "Log in"}
              </Button>
            </form>

            <div className="login__or">
              <span>or</span>
            </div>

            <button
              type="button"
              className="login__google"
              disabled={loading}
              onClick={() => void handleBrowserLogin("google")}
            >
              <GoogleMark />
              Continue with Google
            </button>

            <button
              type="button"
              className="login__web"
              disabled={loading}
              onClick={() => void handleBrowserLogin("web")}
            >
              Already signed in on the website
            </button>
          </>
        )}

        <p className="login__foot">Screen Ping keeps running in the tray after login.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<LoginApp />);
