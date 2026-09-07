import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import Skeleton from "../components/Skeleton";
import Alert from "../components/Alert";
import SkipLink from "../components/SkipLink";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { api, ensureAuthBootstrapped } from "../lib/api";
import { safeInternalPath } from "../lib/authRedirect";

export default function LinkDesktopPage() {
  useDocumentTitle("Connect desktop app");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pairingId = searchParams.get("pairing")?.trim() || "";
  const loginNext = `/link-desktop?pairing=${encodeURIComponent(pairingId)}`;

  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"allowed" | "denied" | null>(null);

  useEffect(() => {
    if (!pairingId || !safeInternalPath(`/link-desktop?pairing=${pairingId}`)) {
      setError("This desktop login link is invalid.");
      setLoading(false);
      return;
    }
    void ensureAuthBootstrapped().then((ok) => {
      if (!ok) {
        navigate(`/login?next=${encodeURIComponent(loginNext)}`, { replace: true });
        return;
      }
      void api
        .me()
        .then((user) => {
          setUsername(user.username);
          setLoading(false);
        })
        .catch(() => {
          navigate(`/login?next=${encodeURIComponent(loginNext)}`, { replace: true });
        });
    });
  }, [pairingId, loginNext, navigate]);

  async function allow() {
    setError("");
    setBusy(true);
    try {
      await api.approveDesktopLink(pairingId);
      setDone("allowed");
      const wake = document.createElement("a");
      wake.href = "screenping://linked";
      wake.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect the desktop app.");
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    setError("");
    setBusy(true);
    try {
      await api.denyDesktopLink(pairingId);
      setDone("denied");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-bg app-bg-scroll flex min-h-full flex-col items-center px-4 py-8">
      <SkipLink />
      <main id="main-content" className="panel w-full max-w-md space-y-4 p-6">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={28} height={28} className="h-7 w-7" draggable={false} />
          <h1 className="font-display text-xl font-extrabold">Screen Ping</h1>
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="Checking your session">
            <span className="sr-only" role="status">
              Checking your session…
            </span>
            <Skeleton className="h-6 w-56" rounded="md" />
            <Skeleton className="mt-6 h-10 w-full" rounded="lg" />
          </div>
        ) : done === "allowed" ? (
          <>
            <h2 className="text-lg font-semibold text-white">Desktop app connected</h2>
            <p className="text-sm text-slate-300">
              You can go back to Screen Ping on this PC. It should finish signing in on its own.
            </p>
            <Link to="/" className="btn-primary block w-full text-center">
              Back to the website
            </Link>
          </>
        ) : done === "denied" ? (
          <>
            <h2 className="text-lg font-semibold text-white">Request cancelled</h2>
            <p className="text-sm text-slate-300">The desktop app was not signed in.</p>
            <Link to="/" className="btn-primary block w-full text-center">
              Back to the website
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-white">Connect the desktop app?</h2>
            <p className="text-sm text-slate-300">
              Screen Ping on this computer wants to sign in
              {username ? (
                <>
                  {" "}
                  as <strong className="text-white">{username}</strong>
                </>
              ) : null}
              . Allow this only if you just clicked a button in the desktop app.
            </p>
            {error && <Alert variant="error">{error}</Alert>}
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void allow()}>
              {busy ? "Please wait…" : "Allow this PC"}
            </button>
            <button
              type="button"
              className="w-full cursor-pointer text-sm text-slate-400 transition duration-200 hover:text-white"
              disabled={busy}
              onClick={() => void deny()}
            >
              Deny
            </button>
          </>
        )}
      </main>
    </div>
  );
}
