import { useEffect, useState } from "react";

import { api } from "../lib/api";

type GoogleOauthClient = {
  requestAccessToken: () => void;
};

type GoogleAccounts = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
      }) => GoogleOauthClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load Google")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
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

export default function GoogleSignInButton({
  disabled,
  onCredential,
  onError,
}: {
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .authProviders()
      .then(async (providers) => {
        const id = providers.google_client_id?.trim() || "";
        if (cancelled) return;
        setClientId(id || null);
        if (!id) return;
        await loadGoogleScript();
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setClientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleClick() {
    if (!clientId) {
      onError("Google sign-in is not configured yet.");
      return;
    }
    const google = window.google;
    if (!ready || !google?.accounts?.oauth2) {
      onError("Google is still loading. Try again in a second.");
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (response) => {
        if (response.error || !response.access_token) {
          onError(response.error_description || "Google sign-in was cancelled.");
          return;
        }
        onCredential(response.access_token);
      },
    });
    client.requestAccessToken();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="btn-google flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleMark />
      Continue with Google
    </button>
  );
}
