import { FormEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { api, logoutSession, type User } from "../lib/api";
import SettingsSkeleton from "../components/SettingsSkeleton";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import Alert from "../components/Alert";
import Avatar from "../components/Avatar";
import SupportKofi from "../components/SupportKofi";
import { LEGAL_CONTACT } from "../content/legal";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

export default function SettingsPage() {
  useDocumentTitle("Account settings");
  const usernameId = useId();
  const usernameCodeId = useId();
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const passwordCodeId = useId();

  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [username, setUsername] = useState("");
  const [usernameCode, setUsernameCode] = useState("");
  const [usernameMessage, setUsernameMessage] = useState("");
  const [usernameDevCode, setUsernameDevCode] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameCodeSent, setUsernameCodeSent] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordDevCode, setPasswordDevCode] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordCodeSent, setPasswordCodeSent] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setUser(u);
        setUsername(u.username);
      })
      .catch(() => setUser(null))
      .finally(() => setLoadingUser(false));
  }, []);

  async function sendUsernameCode() {
    setUsernameError("");
    setUsernameMessage("");
    setUsernameDevCode(null);
    setUsernameBusy(true);
    try {
      const res = await api.requestVerification("change_username");
      setUsernameCodeSent(true);
      setUsernameMessage(res.message);
      if (res.dev_code) setUsernameDevCode(res.dev_code);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setUsernameBusy(false);
    }
  }

  async function submitUsername(e: FormEvent) {
    e.preventDefault();
    setUsernameError("");
    setUsernameMessage("");
    setUsernameBusy(true);
    try {
      const updated = await api.changeUsername(username, usernameCode);
      setUser(updated);
      setUsername(updated.username);
      setUsernameCode("");
      setUsernameCodeSent(false);
      setUsernameMessage("Username updated.");
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUsernameBusy(false);
    }
  }

  async function sendPasswordCode() {
    setPasswordError("");
    setPasswordMessage("");
    setPasswordDevCode(null);
    setPasswordBusy(true);
    try {
      const res = await api.requestVerification("change_password");
      setPasswordCodeSent(true);
      setPasswordMessage(res.message);
      if (res.dev_code) setPasswordDevCode(res.dev_code);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    setPasswordBusy(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword, passwordCode);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordCode("");
      setPasswordCodeSent(false);
      setPasswordMessage(res.message);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function submitDeleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Permanently delete your Screen Ping account?")) return;
    setDeleteBusy(true);
    setDeleteError("");
    setDeleteMessage("");
    try {
      const res = await api.deleteAccount(deletePassword);
      setDeletePassword("");
      setDeleteMessage(res.message);
      setTimeout(() => {
        void logoutSession().then(() => {
          window.location.href = "/login";
        });
      }, 800);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loadingUser) {
    return <SettingsSkeleton />;
  }

  if (!user) {
    return <Alert variant="error">Could not load your account.</Alert>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Account settings</h2>
        </div>
        <Link to="/" className="btn-secondary text-sm">
          Back
        </Link>
      </div>

      <div className="panel flex items-center gap-3 p-4">
        <Avatar name={user.username} src={user.avatar_url} size="md" />
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{user.username}</p>
          <p className="truncate text-sm text-slate-400">{maskEmail(user.email)}</p>
        </div>
      </div>

      <section className="panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-white">Nickname</h3>
        <p className="mb-3 text-xs text-slate-400">
          Friends see this name. We&apos;ll email a code to confirm the change.
        </p>
        <form onSubmit={submitUsername} className="form-section space-y-3">
          <div>
            <label htmlFor={usernameId} className="field-label">
              Username
            </label>
            <input
              id={usernameId}
              className="field-input"
              autoComplete="username"
              minLength={3}
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          {!usernameCodeSent ? (
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={usernameBusy || username === user.username}
              onClick={() => void sendUsernameCode()}
            >
              {usernameBusy ? "Sending…" : "Email verification code"}
            </button>
          ) : (
            <div>
              <label htmlFor={usernameCodeId} className="field-label">
                Verification code
              </label>
              <input
                id={usernameCodeId}
                className="field-input font-mono tracking-widest"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={usernameCode}
                onChange={(e) => setUsernameCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </div>
          )}
          {usernameMessage && (
            <Alert variant="success">
              {usernameMessage}
              {usernameDevCode && (
                <span className="mt-1 block font-mono text-xs text-amber-300">Dev code: {usernameDevCode}</span>
              )}
            </Alert>
          )}
          {usernameError && <Alert variant="error">{usernameError}</Alert>}
          {usernameCodeSent && (
            <button type="submit" disabled={usernameBusy} className="btn-primary w-full">
              {usernameBusy ? "Saving…" : "Save username"}
            </button>
          )}
        </form>
      </section>

      <section className="panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-white">Password</h3>
        <p className="mb-3 text-xs text-slate-400">
          Enter your current password and a code sent to your email.
        </p>
        <form onSubmit={submitPassword} className="form-section space-y-3">
          <div>
            <label htmlFor={currentPasswordId} className="field-label">
              Current password
            </label>
            <input
              id={currentPasswordId}
              type="password"
              className="field-input"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={newPasswordId} className="field-label">
              New password
            </label>
            <input
              id={newPasswordId}
              type="password"
              className="field-input"
              autoComplete="new-password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          {!passwordCodeSent ? (
            <button type="button" className="btn-secondary w-full" disabled={passwordBusy} onClick={() => void sendPasswordCode()}>
              {passwordBusy ? "Sending…" : "Email verification code"}
            </button>
          ) : (
            <div>
              <label htmlFor={passwordCodeId} className="field-label">
                Verification code
              </label>
              <input
                id={passwordCodeId}
                className="field-input font-mono tracking-widest"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={passwordCode}
                onChange={(e) => setPasswordCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </div>
          )}
          {passwordMessage && (
            <Alert variant="success">
              {passwordMessage}
              {passwordDevCode && (
                <span className="mt-1 block font-mono text-xs text-amber-300">Dev code: {passwordDevCode}</span>
              )}
            </Alert>
          )}
          {passwordError && <Alert variant="error">{passwordError}</Alert>}
          {passwordCodeSent && (
            <button type="submit" disabled={passwordBusy} className="btn-primary w-full">
              {passwordBusy ? "Updating…" : "Change password"}
            </button>
          )}
        </form>
      </section>

      <section className="panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-white">Abuse, privacy, and deletion</h3>
        <p className="mb-3 text-xs text-slate-400">
          Use these links to read the service rules, report abuse, or delete your account.
        </p>
        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          <Link to="/cgu" className="text-brand-300 underline">
            Read the Terms
          </Link>
          <Link to="/privacy" className="text-brand-300 underline">
            Privacy Policy
          </Link>
          <Link to="/abuse" className="text-brand-300 underline">
            Report abuse
          </Link>
          <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.abuseEmail}`}>
            {LEGAL_CONTACT.abuseEmail}
          </a>
        </div>
        <div className="mb-4">
          <SupportKofi />
        </div>

        <form onSubmit={submitDeleteAccount} className="form-section space-y-3">
          <div>
            <label htmlFor="delete-account-password" className="field-label">
              Current password
            </label>
            <input
              id="delete-account-password"
              type="password"
              className="field-input"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              required
            />
          </div>
          {deleteMessage && <Alert variant="success">{deleteMessage}</Alert>}
          {deleteError && <Alert variant="error">{deleteError}</Alert>}
          <button type="submit" className="btn-danger w-full" disabled={deleteBusy || !deletePassword}>
            {deleteBusy ? "Deleting…" : "Delete my account"}
          </button>
        </form>
      </section>
    </div>
  );
}
