import { FormEvent, useEffect, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import SkipLink from "../components/SkipLink";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ApiError, api, establishSession, ensureAuthBootstrapped, fetchDesktopLatest } from "../lib/api";
import { safeInternalPath } from "../lib/authRedirect";
import { hasEverConnectedDesktop, openDesktopInstaller, openDesktopUpdateApp } from "../lib/desktopUpdate";
import Alert from "../components/Alert";
import GoogleSignInButton from "../components/GoogleSignInButton";
import LegalLinks from "../components/LegalLinks";
import PasswordInput from "../components/PasswordInput";
import SupportKofi from "../components/SupportKofi";

export default function LoginPage() {
  useDocumentTitle("Log in");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const staySignedInId = useId();
  const codeId = useId();

  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [pendingEmail, setPendingEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [googleCredential, setGoogleCredential] = useState("");
  const [googleUsername, setGoogleUsername] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [desktopDownload, setDesktopDownload] = useState<{ version: string; download_url: string } | null>(null);

  function continueAfterAuth() {
    navigate(safeInternalPath(searchParams.get("next")) || "/");
  }

  useEffect(() => {
    void ensureAuthBootstrapped().then((ok) => {
      if (ok && searchParams.get("next")) continueAfterAuth();
    });
  }, []);

  useEffect(() => {
    void fetchDesktopLatest()
      .then(setDesktopDownload)
      .catch(() => setDesktopDownload(null));
  }, []);

  function showVerifyStep(nextEmail: string, message: string, nextDevCode?: string | null) {
    setPendingEmail(nextEmail);
    setVerifyCode("");
    setVerifyMessage(message);
    setDevCode(nextDevCode ?? null);
    setError("");
  }

  async function finishGoogle(credential: string, nextUsername?: string, nextAcceptTerms?: boolean) {
    const result = await api.googleAuth(credential, nextUsername, nextAcceptTerms, staySignedIn);
    if (result.needs_username) {
      setGoogleCredential(credential);
      setGoogleEmail(result.email || "");
      setGoogleUsername(result.suggested_username || "");
      setError("");
      return;
    }
    if (!result.access_token) {
      throw new Error("Google sign-in failed");
    }
    establishSession(result.access_token, staySignedIn);
    continueAfterAuth();
  }

  async function handleGoogleCredential(credential: string) {
    setError("");
    setLoading(true);
    try {
      await finishGoogle(credential);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleUsername(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await finishGoogle(googleCredential, googleUsername, acceptTerms);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isRegister) {
        const pending = await api.register(username.trim(), email.trim(), password, acceptTerms);
        showVerifyStep(pending.email || email, pending.message, pending.dev_code);
        return;
      }

      const tokens = await api.login(username.trim(), password, staySignedIn);
      establishSession(tokens.access_token, staySignedIn);
      continueAfterAuth();
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_not_verified" && err.email) {
        showVerifyStep(err.email, err.message);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tokens = await api.verifyEmail(pendingEmail, verifyCode, staySignedIn);
      establishSession(tokens.access_token, staySignedIn);
      continueAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    setLoading(true);
    try {
      const pending = await api.resendSignupCode(pendingEmail);
      setVerifyMessage(pending.message);
      setDevCode(pending.dev_code ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    } finally {
      setLoading(false);
    }
  }

  const downloadUrl = desktopDownload?.download_url ?? "https://screenping.xyz/api/desktop/download";
  const hadDesktop = hasEverConnectedDesktop();
  const linkingDesktop = (searchParams.get("next") || "").includes("/link-desktop");
  const verifying = Boolean(pendingEmail);
  const pickingGoogleUsername = Boolean(googleCredential);

  return (
    <div className="app-bg app-bg-scroll flex min-h-full flex-col items-center justify-center px-3 py-8">
      <SkipLink />
      <main id="main-content" className="w-full max-w-sm space-y-4">
        <div className="panel p-5 sm:p-6">
          <div className="mb-5 flex flex-col items-center text-center">
            <img
              src="/logo.png"
              alt="Screen Ping"
              width={72}
              height={72}
              className="mb-3 h-[72px] w-[72px] select-none"
              draggable={false}
            />
            <h1 className="brand-glow font-display text-2xl font-extrabold">Screen Ping</h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              {verifying
                ? `Enter the 6-digit code sent to ${pendingEmail}.`
                : pickingGoogleUsername
                  ? `Choose a Screen Ping username for ${googleEmail}.`
                  : "Send images, videos and sounds to your friends' screens."}
            </p>
          </div>

          {verifying ? (
            <form onSubmit={handleVerify} className="space-y-3" noValidate>
              <div>
                <label htmlFor={codeId} className="field-label">
                  Verification code
                </label>
                <input
                  id={codeId}
                  className="field-input font-mono tracking-widest"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </div>
              {verifyMessage && (
                <Alert variant="success" title="Check your email">
                  {verifyMessage}
                  {devCode && (
                    <p className="mt-2 font-mono text-xs text-amber-300">
                      Dev code: <strong>{devCode}</strong>
                    </p>
                  )}
                </Alert>
              )}
              {error && <Alert variant="error">{error}</Alert>}
              <button type="submit" disabled={loading || verifyCode.length !== 6} className="btn-primary w-full">
                {loading ? "Please wait…" : "Verify email"}
              </button>
              <button
                type="button"
                className="w-full cursor-pointer text-sm text-slate-400 transition duration-200 hover:text-white"
                onClick={() => void handleResend()}
                disabled={loading}
              >
                Resend code
              </button>
              <button
                type="button"
                className="w-full cursor-pointer text-sm text-slate-400 transition duration-200 hover:text-white"
                onClick={() => {
                  setPendingEmail("");
                  setVerifyCode("");
                  setVerifyMessage("");
                  setDevCode(null);
                  setError("");
                }}
              >
                Back
              </button>
            </form>
          ) : pickingGoogleUsername ? (
            <form onSubmit={handleGoogleUsername} className="space-y-3" noValidate>
              <div>
                <label htmlFor={usernameId} className="field-label">
                  Username
                </label>
                <input
                  id={usernameId}
                  className="field-input"
                  placeholder="yourname"
                  autoComplete="username"
                  value={googleUsername}
                  onChange={(e) => setGoogleUsername(e.target.value)}
                  required
                  minLength={3}
                />
              </div>
              <label className="surface flex items-start gap-2 px-3 py-2.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  required
                />
                <span>
                  I accept the{" "}
                  <Link to="/cgu" className="cursor-pointer text-brand-300 underline hover:text-brand-200">
                    Terms
                  </Link>{" "}
                  and I have read the{" "}
                  <Link to="/privacy" className="cursor-pointer text-brand-300 underline hover:text-brand-200">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              {error && <Alert variant="error">{error}</Alert>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Please wait…" : "Create account"}
              </button>
              <button
                type="button"
                className="w-full cursor-pointer text-sm text-slate-400 transition duration-200 hover:text-white"
                onClick={() => {
                  setGoogleCredential("");
                  setGoogleUsername("");
                  setGoogleEmail("");
                  setError("");
                }}
              >
                Back
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3" noValidate>
              <div>
                <label htmlFor={usernameId} className="field-label">
                  {isRegister ? "Username" : "Username or email"}
                </label>
                <input
                  id={usernameId}
                  className="field-input"
                  placeholder={isRegister ? "yourname" : "yourname or you@example.com"}
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              {isRegister && (
                <div>
                  <label htmlFor={emailId} className="field-label">
                    Email
                  </label>
                  <input
                    id={emailId}
                    className="field-input"
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              )}

              {isRegister && (
                <label className="surface flex items-start gap-2 px-3 py-2.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    required
                  />
                  <span>
                    I accept the{" "}
                    <Link to="/cgu" className="cursor-pointer text-brand-300 underline hover:text-brand-200">
                      Terms
                    </Link>{" "}
                    and I have read the{" "}
                    <Link to="/privacy" className="cursor-pointer text-brand-300 underline hover:text-brand-200">
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor={passwordId} className="field-label mb-0">
                    Password
                  </label>
                  {!isRegister && (
                    <Link
                      to="/forgot-password"
                      className="cursor-pointer text-xs text-brand-400 transition duration-200 hover:text-brand-300 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <PasswordInput
                  id={passwordId}
                  placeholder="••••••••"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <label
                htmlFor={staySignedInId}
                className="flex cursor-pointer items-center gap-1.5 text-[11px] leading-none text-slate-500"
                title="Uncheck to sign out when you close the browser"
              >
                <input
                  id={staySignedInId}
                  type="checkbox"
                  className="peer sr-only"
                  checked={staySignedIn}
                  onChange={(e) => setStaySignedIn(e.target.checked)}
                />
                <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border border-slate-600 bg-transparent peer-checked:border-brand-400 peer-checked:bg-brand-500/90 peer-focus-visible:ring-1 peer-focus-visible:ring-brand-400">
                  <svg
                    className={`h-2 w-2 text-white ${staySignedIn ? "opacity-100" : "opacity-0"}`}
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M2.2 6.3 4.6 8.7 9.8 3.3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                Stay signed in
              </label>

              {error && <Alert variant="error">{error}</Alert>}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Please wait…" : isRegister ? "Create account" : "Log in"}
              </button>
            </form>
          )}

          {!verifying && !pickingGoogleUsername && (
            <>
              <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-500">
                <span className="h-px flex-1 bg-white/10" />
                or
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <GoogleSignInButton
                disabled={loading}
                onCredential={(credential) => void handleGoogleCredential(credential)}
                onError={setError}
              />
            </>
          )}

          {!verifying && !pickingGoogleUsername && (
            <button
              type="button"
              className="mt-3 w-full cursor-pointer text-sm text-slate-400 transition duration-200 hover:text-white"
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
            >
              {isRegister ? "Already have an account? Log in" : "Need an account? Register"}
            </button>
          )}
        </div>

        {!linkingDesktop && (
        <button
          type="button"
          onClick={() => openDesktopInstaller(downloadUrl)}
          className="btn-primary hidden w-full items-center justify-center gap-2 text-center sm:flex"
        >
          {desktopDownload ? `Download Screen Ping v${desktopDownload.version}` : "Download Screen Ping (Windows)"}
        </button>
        )}

        {!linkingDesktop && hadDesktop && (
          <button
            type="button"
            onClick={() => openDesktopUpdateApp()}
            className="btn-secondary hidden w-full items-center justify-center gap-2 text-center sm:flex"
          >
            Already installed? Check for updates
          </button>
        )}

        <LegalLinks className="pt-1" />
        <div className="flex justify-center pt-2">
          <SupportKofi />
        </div>
      </main>
    </div>
  );
}
