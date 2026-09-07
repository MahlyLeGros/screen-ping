import { app } from "electron";
import fs from "fs";
import path from "path";

/** Stable AppData folder — never derived from EXE ProductName / app.setName(). */
const STABLE_DIR_NAME = "screen-ping-desktop";
const CONFIG_FILE = "config.json";
const SENTINEL = ".config-migrated";

function readJson(file: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data && typeof data === "object") return data as Record<string, unknown>;
  } catch {
    /* missing or invalid */
  }
  return null;
}

function hasSession(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return Boolean(data.accessToken || data.refreshToken || data.savedUsername);
}

function looksLikeScreenPing(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  if (hasSession(data)) return true;
  const serverUrl = String(data.serverUrl ?? "").toLowerCase();
  if (serverUrl.includes("screenping")) return true;
  return "overlayDisplayId" in data || "launchAtLoginDefaulted" in data || "savedPasswordEnc" in data;
}

function scoreConfig(data: Record<string, unknown> | null): number {
  if (!data || !looksLikeScreenPing(data)) return 0;
  let score = 1;
  if (data.refreshToken) score += 4;
  if (data.accessToken) score += 2;
  if (data.savedUsername && data.savedPasswordEnc) score += 3;
  return score;
}

/**
 * Pin userData before electron-store opens, and copy config.json from older
 * folders created when the EXE ProductName was "Electron" or "Screen Ping".
 */
export function pinStableUserData(): void {
  const appData = app.getPath("appData");
  const canonical = path.join(appData, STABLE_DIR_NAME);
  fs.mkdirSync(canonical, { recursive: true });

  const destConfig = path.join(canonical, CONFIG_FILE);
  const sentinel = path.join(canonical, SENTINEL);

  if (!fs.existsSync(sentinel)) {
    const destData = readJson(destConfig);
    if (!hasSession(destData)) {
      const candidates = [path.join(appData, "Screen Ping"), path.join(appData, "Electron")];
      let bestFile: string | null = null;
      let bestScore = 0;
      for (const dir of candidates) {
        if (path.resolve(dir) === path.resolve(canonical)) continue;
        const file = path.join(dir, CONFIG_FILE);
        const score = scoreConfig(readJson(file));
        if (score > bestScore) {
          bestScore = score;
          bestFile = file;
        }
      }
      if (bestFile && bestScore > 0) {
        try {
          fs.copyFileSync(bestFile, destConfig);
        } catch {
          /* empty store is preferable to crashing on boot */
        }
      }
    }
    try {
      fs.writeFileSync(sentinel, "1");
    } catch {
      /* ignore */
    }
  }

  app.setPath("userData", canonical);
  try {
    app.setPath("sessionData", canonical);
  } catch {
    /* sessionData exists on current Electron */
  }
}
