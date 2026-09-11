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

export function resolveFfmpegPath(): string {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates: string[] = [];

  try {
    // Lazy require so unit tests can import without a full Electron lifecycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    if (app?.isPackaged) {
      candidates.push(path.join(process.resourcesPath, "ffmpeg", exe));
    }
  } catch {
    /* not running inside Electron */
  }

  candidates.push(path.join(__dirname, "..", "..", "vendor", "ffmpeg", exe));
  candidates.push(exe);

  for (const candidate of candidates) {
    if (candidate === exe) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return exe;
}

export async function probeEncoders(ffmpegPath = resolveFfmpegPath()): Promise<VideoEncoderId[]> {
  try {
    const { stdout, stderr } = await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
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
