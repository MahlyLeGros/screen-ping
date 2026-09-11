import { app, nativeImage, nativeTheme } from "electron";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export function getAssetPath(...parts: string[]): string {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "assets", ...parts));
    candidates.push(path.join(app.getAppPath(), "assets", ...parts));
  } else {
    candidates.push(path.join(__dirname, "..", "..", "assets", ...parts));
    candidates.push(path.join(process.cwd(), "assets", ...parts));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

export function loadAppIcon(): Electron.NativeImage {
  for (const name of ["icon.ico", "icon-256.png", "icon-32.png"]) {
    const p = getAssetPath(name);
    try {
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    } catch {
      /* ignore */
    }
  }
  return nativeImage.createEmpty();
}

function windowsUsesLightTaskbar(): boolean {
  try {
    if (process.platform !== "win32") return false;
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme',
      { encoding: "utf8" },
    );
    return /SystemUsesLightTheme\s+REG_DWORD\s+0x1/i.test(out);
  } catch {
    try {
      return !nativeTheme.shouldUseDarkColors;
    } catch {
      return false;
    }
  }
}

export function loadTrayIcon(): Electron.NativeImage {
  const lightBar = windowsUsesLightTaskbar();
  const names = lightBar
    ? ["tray-icon-dark.png", "tray-icon-dark@2x.png", "tray-icon.png", "icon-32.png"]
    : ["tray-icon.png", "tray-icon@2x.png", "icon-32.png"];
  for (const name of names) {
    const p = getAssetPath(name);
    try {
      if (!fs.existsSync(p)) continue;
      let img = nativeImage.createFromPath(p);
      if (img.isEmpty()) continue;
      if (img.getSize().width !== 32) {
        img = img.resize({ width: 32, height: 32, quality: "best" });
      }
      return img;
    } catch {
      /* ignore */
    }
  }
  return loadAppIcon();
}
