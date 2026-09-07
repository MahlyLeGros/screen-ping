import { safeStorage, shell } from "electron";

import { DEFAULT_SERVER_URL, normalizeServerUrl } from "./serverUrl";
import store, { clearSavedCredentials, clearSessionTokens, setStoredValue } from "./store";
import { refreshAccessToken, type RefreshResult } from "./windows";

let browserLoginAbort: AbortController | null = null;

function apiBase() {
  const base = normalizeServerUrl(store.get("serverUrl") || DEFAULT_SERVER_URL);
  store.set("serverUrl", base);
  return base;
}

async function readErrorMessage(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({ detail: fallback }));
  const detail = err.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
  return fallback;
}

const DESKTOP_CLIENT_HEADERS = {
  "Content-Type": "application/json",
  "X-ScreenPing-Client": "desktop",
} as const;

async function loginWithCredentials(username: string, password: string): Promise<void> {
  const base = apiBase();

  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: DESKTOP_CLIENT_HEADERS,
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Login failed"));
  }

  const data = await res.json();
  if (!data?.access_token) throw new Error("Login failed");
  applySessionTokens(data.access_token, data.refresh_token, true);
}

export function saveLoginCredentials(username: string, password: string, remember = true) {
  store.set("rememberLogin", remember);
  if (!remember) {
    clearSavedCredentials();
    return;
  }

  store.set("savedUsername", username);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password);
    store.set("savedPasswordEnc", Buffer.from(encrypted).toString("base64"));
    return;
  }

  store.set("savedPasswordEnc", Buffer.from(password, "utf8").toString("base64"));
}

export function clearLoginCredentials() {
  clearSavedCredentials();
  store.set("rememberLogin", false);
}

export function getSavedLoginForm() {
  const username = store.get("savedUsername") ?? "";
  const remember = store.get("rememberLogin") ?? true;
  if (!remember || !username) {
    return { username: "", password: "", remember: true };
  }

  const enc = store.get("savedPasswordEnc");
  if (!enc) {
    return { username, password: "", remember: true };
  }

  try {
    const password = decryptSavedPassword(enc);
    return { username, password, remember: true };
  } catch {
    return { username, password: "", remember: true };
  }
}

const RESTORE_RETRY_DELAYS_MS = [400, 800, 1500, 2500, 4000, 6000, 8000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAccessTokenWithRetry(): Promise<RefreshResult> {
  let last = await refreshAccessToken();
  if (last.ok || last.reason !== "network") return last;
  for (const delay of RESTORE_RETRY_DELAYS_MS) {
    await sleep(delay);
    last = await refreshAccessToken();
    if (last.ok || last.reason !== "network") return last;
  }
  return last;
}

function decryptSavedPassword(enc: string): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(enc, "base64"))
    : Buffer.from(enc, "base64").toString("utf8");
}

async function loginWithSavedCredentials(): Promise<boolean> {
  if (store.get("rememberLogin") === false) return false;
  const username = store.get("savedUsername");
  const enc = store.get("savedPasswordEnc");
  if (!username || !enc) return false;

  try {
    const password = decryptSavedPassword(enc);
    if (!password) return false;
    await loginWithCredentials(username, password);
    return true;
  } catch {
    return false;
  }
}

export async function tryRestoreSession(): Promise<boolean> {
  if (store.get("accessToken") || store.get("refreshToken")) {
    const refreshed = await refreshAccessTokenWithRetry();
    if (refreshed.ok) return true;
    if (refreshed.reason === "network" && store.get("accessToken")) {
      return true;
    }
  }

  return loginWithSavedCredentials();
}

export async function loginAndRemember(username: string, password: string, remember: boolean) {
  await loginWithCredentials(username, password);
  saveLoginCredentials(username, password, remember);
}

export function applySessionTokens(access: string, refresh?: string | null, remember = true) {
  if (!access) throw new Error("Login failed");
  store.set("accessToken", access);
  if (refresh) setStoredValue("refreshToken", refresh);
  store.set("rememberLogin", remember);
  if (!remember) clearSavedCredentials();
}

export function cancelBrowserLogin() {
  browserLoginAbort?.abort();
}

export async function loginViaBrowser(mode: "google" | "web", remember: boolean) {
  browserLoginAbort?.abort();
  const abort = new AbortController();
  browserLoginAbort = abort;

  const base = apiBase();
  const started = await fetch(`${base}/api/auth/desktop-link/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abort.signal,
  });
  if (!started.ok) {
    throw new Error(await readErrorMessage(started, "Could not start website login"));
  }
  const session = (await started.json()) as {
    pairing_id: string;
    poll_secret: string;
    expires_in: number;
  };

  const pairingQuery = `pairing=${encodeURIComponent(session.pairing_id)}`;
  const linkPath = `/link-desktop?${pairingQuery}`;
  const url =
    mode === "google"
      ? `${base}/login?next=${encodeURIComponent(linkPath)}`
      : `${base}${linkPath}`;

  await shell.openExternal(url);

  const deadline = Date.now() + Math.max(30, session.expires_in || 300) * 1000;
  try {
    while (!abort.signal.aborted) {
      if (Date.now() > deadline) {
        throw new Error("Website login timed out. Try again.");
      }
      await new Promise<void>((resolve, reject) => {
        if (abort.signal.aborted) {
          reject(new Error("Cancelled"));
          return;
        }
        const timer = setTimeout(() => {
          abort.signal.removeEventListener("abort", onAbort);
          resolve();
        }, 1500);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("Cancelled"));
        };
        abort.signal.addEventListener("abort", onAbort, { once: true });
      });

      const polled = await fetch(`${base}/api/auth/desktop-link/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_id: session.pairing_id, poll_secret: session.poll_secret }),
        signal: abort.signal,
      });
      if (!polled.ok) {
        throw new Error(await readErrorMessage(polled, "Website login failed"));
      }
      const result = (await polled.json()) as {
        status: string;
        access_token?: string | null;
        refresh_token?: string | null;
      };
      if (result.status === "pending") continue;
      if (result.status === "denied") throw new Error("Website login was denied.");
      if (result.status === "expired") throw new Error("Website login expired. Try again.");
      if (result.status === "ready" && result.access_token && result.refresh_token) {
        applySessionTokens(result.access_token, result.refresh_token, remember);
        return;
      }
      throw new Error("Website login failed");
    }
    throw new Error("Cancelled");
  } catch (err) {
    if (abort.signal.aborted) throw new Error("Cancelled");
    throw err;
  } finally {
    if (browserLoginAbort === abort) browserLoginAbort = null;
  }
}

export function persistLoginForUpdate() {
  store.set("online", true);
  if (store.get("savedUsername") && store.get("savedPasswordEnc")) {
    store.set("rememberLogin", true);
  }
}
