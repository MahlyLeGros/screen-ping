import Store from "electron-store";

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

export function clearSavedCredentials() {
  store.delete("savedUsername");
  store.delete("savedPasswordEnc");
}

export default store;
