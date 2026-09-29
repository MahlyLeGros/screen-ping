import { execFile, type ExecFileException } from "child_process";

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

let cached: WinAudioDevices | null = null;
let inflight: Promise<WinAudioDevices> | null = null;

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

export function clearWinAudioCache() {
  cached = null;
}

function fromStderr(stderr: string): WinAudioDevices {
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

/**
 * Probe Windows DirectShow audio devices via bundled FFmpeg.
 * Cached after first successful probe. Hard-capped so Resume never hangs the UI.
 */
export async function probeWinAudioDevices(
  ffmpegPath: string,
  opts: { timeoutMs?: number; forceRefresh?: boolean } = {},
): Promise<WinAudioDevices> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  if (!opts.forceRefresh && cached) return cached;
  if (inflight) return inflight;

  inflight = new Promise<WinAudioDevices>((resolve) => {
    const child = execFile(
      ffmpegPath,
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        clearTimeout(timer);
        const text = `${stdout || ""}\n${stderr || ""}\n${err?.message || ""}`;
        const result = fromStderr(text);
        cached = result;
        inflight = null;
        resolve(result);
      },
    );

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      if (!cached) {
        cached = fromStderr("");
        if (!cached.warning) {
          cached.warning =
            "Audio device probe timed out — starting video-only. Enable Stereo Mix / VB-Cable for sound.";
        }
      }
      inflight = null;
      resolve(cached);
    }, timeoutMs);
  });

  return inflight;
}
