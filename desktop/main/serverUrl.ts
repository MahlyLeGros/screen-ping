import fs from "fs";
import path from "path";
import { app } from "electron";

/** Production server — used when not in local-hosting mode. */
export const PRODUCTION_SERVER_URL = "https://screenping.xyz";

/** Local hosting (PC only, no VPS). */
export const LOCAL_SERVER_URL = "http://localhost:8000";

function projectRootFromMain(): string {
  // dist/main -> desktop -> screen-ping
  return path.join(__dirname, "..", "..", "..");
}

function packagedApp(): boolean {
  try {
    return app.isPackaged;
  } catch {
    return false;
  }
}

/** True when start-local / test-logo created a USE_LOCAL_SERVER flag. Packaged builds always hit production. */
export function isLocalServerMode(): boolean {
  if (packagedApp()) return false;
  const candidates = [
    path.join(projectRootFromMain(), "desktop", "USE_LOCAL_SERVER"),
    path.join(process.cwd(), "USE_LOCAL_SERVER"),
    path.join(process.cwd(), "desktop", "USE_LOCAL_SERVER"),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

export const DEFAULT_SERVER_URL = isLocalServerMode() ? LOCAL_SERVER_URL : PRODUCTION_SERVER_URL;

/** Strip trailing slashes so `${url}/api/...` does not become `//api/...` (405). */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Packaged / normal boots always use production. Local flag is only for unpackaged `start-local`. */
export function applyServerUrlPreference(store: { get: (k: "serverUrl") => string; set: (k: "serverUrl", v: string) => void }) {
  if (isLocalServerMode()) {
    store.set("serverUrl", LOCAL_SERVER_URL);
    return;
  }
  store.set("serverUrl", PRODUCTION_SERVER_URL);
}
