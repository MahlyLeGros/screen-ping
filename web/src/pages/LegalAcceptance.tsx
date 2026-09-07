import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import Alert from "../components/Alert";
import { api } from "../lib/api";
import { LEGAL_CONTACT } from "../content/legal";

export default function LegalAcceptancePage() {
  useDocumentTitle("Accept terms");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      await api.acceptLegal();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the terms.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Alert variant="warning" title="You need to accept the terms">
        Before you keep using Screen Ping, you must accept the Terms of Use and read the Privacy Policy.
      </Alert>

      <div className="panel space-y-4 p-5">
        <p className="text-sm text-slate-300">
          By continuing, you confirm that you will not use Screen Ping to harass, spam, or send illegal or
          non-consensual content.
        </p>
        <p className="text-xs text-slate-500">Current Terms version: {LEGAL_CONTACT.lastUpdated}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link to="/cgu" className="text-brand-300 underline">
            Read the Terms
          </Link>
          <Link to="/privacy" className="text-brand-300 underline">
            Read the Privacy Policy
          </Link>
          <Link to="/mentions-legales" className="text-brand-300 underline">
            Legal notice
          </Link>
        </div>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void accept()}>
            {busy ? "Saving…" : "I accept and continue"}
          </button>
          <Link to="/login" className="btn-secondary">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
