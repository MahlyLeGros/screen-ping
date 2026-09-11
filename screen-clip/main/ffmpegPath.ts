import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { VideoEncoderId } from "./store";

const execFileAsync = promisify(execFile);

export const KNOWN_ENCODERS: VideoEncoderId[] = [
  "libx264",
  "h264_nvenc",
  "hevc_nvenc",
  "h264_amf",
  "h264_qsv",
  "libvpx-vp9",
];

function fileExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Candidate locations for the bundled FFmpeg binary (absolute paths). */
export function ffmpegCandidatePaths(): string[] {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates: string[] = [];

  try {
    // Lazy require so unit tests can import without a full Electron lifecycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    // Do NOT gate on app.isPackaged — portable zips must still find resources/.
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "ffmpeg", exe));
      candidates.push(path.join(process.resourcesPath, exe));
    }
    if (app?.getAppPath) {
      // app.asar lives in resources/app.asar → sibling ffmpeg/
      candidates.push(path.join(app.getAppPath(), "..", "ffmpeg", exe));
      candidates.push(path.join(app.getAppPath(), "vendor", "ffmpeg", exe));
    }
  } catch {
    /* not running inside Electron */
  }

  // Next to the executable: <app>/resources/ffmpeg/ffmpeg.exe (and fallbacks)
  if (process.execPath) {
    const appDir = path.dirname(process.execPath);
    candidates.push(path.join(appDir, "resources", "ffmpeg", exe));
    candidates.push(path.join(appDir, "ffmpeg", exe));
    candidates.push(path.join(appDir, exe));
  }

  // Dev / unpackaged: screen-clip/vendor/ffmpeg/ffmpeg.exe
  candidates.push(path.join(__dirname, "..", "..", "vendor", "ffmpeg", exe));
  candidates.push(path.join(process.cwd(), "vendor", "ffmpeg", exe));

  // Dedupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const abs = path.resolve(c);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/**
 * Resolve bundled FFmpeg. Packaged Electron apps put extraResources under
 * `process.resourcesPath` (…/resources/ffmpeg/ffmpeg.exe). Also try paths
 * relative to the .exe so portable zips keep working even if `isPackaged`
 * / `resourcesPath` are odd on first launch.
 */
export function resolveFfmpegPath(): string {
  for (const candidate of ffmpegCandidatePaths()) {
    if (fileExists(candidate)) return candidate;
  }

  // Last resort — PATH lookup (basename only; will ENOENT clearly if missing).
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

export function assertFfmpegAvailable(ffmpegPath = resolveFfmpegPath()): string {
  if (!fileExists(ffmpegPath) && path.basename(ffmpegPath) === ffmpegPath) {
    const tried = ffmpegCandidatePaths().slice(0, 6).join("\n  - ");
    throw new Error(
      `ffmpeg.exe introuvable. Extrayez TOUT le zip (ne déplacez pas seulement Screen Clip.exe).\n` +
        `resources/ffmpeg/ffmpeg.exe doit être à côté de l'appli.\nCherché:\n  - ${tried}`,
    );
  }
  if (!fileExists(ffmpegPath)) {
    throw new Error(`ffmpeg introuvable: ${ffmpegPath}`);
  }
  return ffmpegPath;
}

export async function probeEncoders(ffmpegPath = resolveFfmpegPath()): Promise<VideoEncoderId[]> {
  try {
    const resolved = fileExists(ffmpegPath) ? ffmpegPath : resolveFfmpegPath();
    if (!fileExists(resolved) && path.basename(resolved) === resolved) {
      return ["libx264"];
    }
    const { stdout, stderr } = await execFileAsync(resolved, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const text = `${stdout}\n${stderr}`;
    return KNOWN_ENCODERS.filter((id) =>
      new RegExp(`\\b${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`).test(text),
    );
  } catch {
    return ["libx264"];
  }
}
