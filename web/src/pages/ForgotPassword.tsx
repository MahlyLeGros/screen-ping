import { FormEvent, useId, useState } from "react";
import { Link } from "react-router-dom";
import SkipLink from "../components/SkipLink";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { api } from "../lib/api";
import Alert from "../components/Alert";
import LegalLinks from "../components/LegalLinks";

export default function ForgotPasswordPage() {
  useDocumentTitle("Forgot password");
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setDevCode(null);
    setLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setMessage(res.message);
      if (res.dev_code) setDevCode(res.dev_code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
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
          <h1 className="text-xl font-bold text-brand-400">Forgot password</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter your account email and we&apos;ll send a 6-digit reset code.
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
          {error && <Alert variant="error">{error}</Alert>}
          {message && (
            <Alert variant="success" title="Check your email">
              {message}
              {devCode && (
                <p className="mt-2 font-mono text-xs text-amber-300">
                  Dev code: <strong>{devCode}</strong>
                </p>
              )}
            </Alert>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Sending…" : "Send reset code"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400">
          Have a code?{" "}
          <Link to={`/reset-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="text-brand-400 hover:underline">
            Reset password
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
