import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface WinAudioDevices {
  systemLoopback: string | null;
  microphone: string | null;
  allAudio: string[];
  warning: string | null;
}

const LOOPBACK_PATTERNS = [
  /stereo\s*mix/i,
  /wave\s*out\s*mix/i,
  /what\s*u\s*hear/i,
  /loopback/i,
  /cable\s*output/i,
  /cable\s*input/i,
  /vb-?audio/i,
  /voicemeeter/i,
];

const MIC_PATTERNS = [/microphone/i, /\bmic\b/i, /headset/i, /array/i];

export function parseDshowAudioDevices(stderr: string): string[] {
  const names: string[] = [];
  const re = /"([^"]+)"\s*\(audio\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) names.push(m[1]);
  return names;
}

export function pickLoopbackDevice(devices: string[]): string | null {
  for (const pattern of LOOPBACK_PATTERNS) {
    const hit = devices.find((d) => pattern.test(d));
    if (hit) return hit;
  }
  return null;
}

export function pickMicDevice(devices: string[], exclude: string | null): string | null {
  const candidates = devices.filter((d) => d !== exclude);
  for (const pattern of MIC_PATTERNS) {
    const hit = candidates.find((d) => pattern.test(d));
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

/**
 * Probe Windows DirectShow audio devices via bundled FFmpeg.
 * System audio requires Stereo Mix / VB-Cable / similar.
 */
export async function probeWinAudioDevices(ffmpegPath: string): Promise<WinAudioDevices> {
  let stderr = "";
  try {
    const result = await execFileAsync(
      ffmpegPath,
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { encoding: "utf8", timeout: 15000, windowsHide: true },
    );
    stderr = `${result.stdout}\n${result.stderr}`;
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    stderr = `${e.stdout || ""}\n${e.stderr || ""}`;
  }

  const allAudio = parseDshowAudioDevices(stderr);
  const systemLoopback = pickLoopbackDevice(allAudio);
  const microphone = pickMicDevice(allAudio, systemLoopback);

  let warning: string | null = null;
  if (!systemLoopback) {
    warning =
      "No system-audio loopback device found (enable Stereo Mix, or install VB-Cable). Capturing video only.";
  }

  return { systemLoopback, microphone, allAudio, warning };
}
