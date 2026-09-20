import Store from "electron-store";
import { safeStorage } from "electron";

import { DEFAULT_SERVER_URL } from "./serverUrl";

export interface AppSettings {
  accessToken: string | null;
  refreshToken: string | null;
  serverUrl: string;
  paused: boolean;
  online: boolean;
  overlayDisplayId: number | null;
  savedUsername: string | null;
  savedPasswordEnc: string | null;
  rememberLogin: boolean;
  launchAtLogin: boolean;
  launchAtLoginDefaulted: boolean;
  alwaysOnTop: boolean;
  compact: boolean;
}

const store = new Store<AppSettings>({
  defaults: {
    accessToken: null,
    refreshToken: null,
    serverUrl: DEFAULT_SERVER_URL,
    paused: false,
    online: true,
    overlayDisplayId: null,
    savedUsername: null,
    savedPasswordEnc: null,
    rememberLogin: true,
    launchAtLogin: true,
    launchAtLoginDefaulted: false,
    alwaysOnTop: false,
    compact: false,
  },
});

/**
 * `defaults` only covers a missing key, so anyone who ran a build where this
 * shipped disabled keeps the old value forever. Flip it once, then never touch
 * it again so a deliberate opt-out still sticks.
 */
export function applyLaunchAtLoginDefault() {
  // Remove passwords saved by older releases; refresh tokens keep sessions
  // persistent without retaining reusable account credentials.
  store.delete("savedPasswordEnc");
  if (store.get("launchAtLoginDefaulted")) return;
  store.set("launchAtLogin", true);
  store.set("launchAtLoginDefaulted", true);
}

/** electron-store throws on `set(key, undefined)` — delete the key instead. */
export function setStoredValue<K extends keyof AppSettings>(key: K, value: AppSettings[K] | null | undefined) {
  if (value === null || value === undefined) {
    store.delete(key);
    return;
  }
  store.set(key, value);
}

export function clearSessionTokens() {
  store.delete("accessToken");
  store.delete("refreshToken");
}

const SECRET_PREFIX = "enc:v1:";

export function setRefreshToken(value: string | null | undefined) {
  if (!value) {
    store.delete("refreshToken");
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable; the session cannot be saved safely.");
  }
  const encrypted = safeStorage.encryptString(value).toString("base64");
  store.set("refreshToken", `${SECRET_PREFIX}${encrypted}`);
}

export function getRefreshToken(): string | null {
  const stored = store.get("refreshToken");
  if (!stored) return null;
  if (!stored.startsWith(SECRET_PREFIX)) {
    // One-time migration from releases that stored the refresh token directly.
    try {
      setRefreshToken(stored);
      return stored;
    } catch {
      store.delete("refreshToken");
      return null;
    }
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(SECRET_PREFIX.length), "base64"));
  } catch {
    store.delete("refreshToken");
    return null;
  }
}

export function clearSavedCredentials() {
  store.delete("savedUsername");
  store.delete("savedPasswordEnc");
}

export default store;
