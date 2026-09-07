import { FormEvent, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import SkipLink from "../components/SkipLink";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { api, establishSession } from "../lib/api";
import Alert from "../components/Alert";
import LegalLinks from "../components/LegalLinks";

export default function ResetPasswordPage() {
  useDocumentTitle("Reset password");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailId = useId();
  const codeId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tokens = await api.resetPassword(email, code, password);
      establishSession(tokens.access_token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-bg app-bg-scroll flex min-h-full flex-col items-center px-3 py-8">
      <SkipLink />
      <main id="main-content" className="panel w-full max-w-sm space-y-4 p-5 sm:p-6">
        <div className="flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="Screen Ping"
            width={56}
            height={56}
            className="mb-2 h-14 w-14 select-none"
            draggable={false}
          />
          <h1 className="text-xl font-bold text-brand-400">Reset password</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter the 6-digit code from your email and choose a new password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div>
            <label htmlFor={emailId} className="field-label">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              className="field-input"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
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
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <div>
            <label htmlFor={passwordId} className="field-label">
              New password
            </label>
            <input
              id={passwordId}
              type="password"
              className="field-input"
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <Alert variant="error">{error}</Alert>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Updating…" : "Set new password"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400">
          Need a code?{" "}
          <Link to="/forgot-password" className="text-brand-400 hover:underline">
            Request one
          </Link>
        </p>
        <p className="text-center text-sm">
          <Link to="/login" className="text-slate-400 hover:text-white">
            Back to log in
          </Link>
        </p>
        <LegalLinks />
      </main>
    </div>
  );
}
