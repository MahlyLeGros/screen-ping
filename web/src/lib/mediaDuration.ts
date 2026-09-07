import { MAX_DURATION_MS, MIN_DURATION_MS } from "../../../shared/types";
import { guessMediaKind } from "./editorPreview";

export function clampStayDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return MIN_DURATION_MS;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(ms)));
}

/** Read media length via HTMLMediaElement metadata (browser / Electron). */
export function probeMediaDurationMs(file: File): Promise<number | null> {
  const kind = guessMediaKind(file);
  if (kind !== "video" && kind !== "audio") return Promise.resolve(null);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === "video" ? "video" : "audio");
    let settled = false;

    const finish = (ms: number | null) => {
      if (settled) return;
      settled = true;
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(ms);
    };

    const timer = window.setTimeout(() => finish(null), 8_000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const seconds = el.duration;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        finish(null);
        return;
      }
      finish(seconds * 1000);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    el.src = url;
  });
}

/**
 * Stay-on-screen target from the longest of video / sound files.
 * Images alone return null (keep current / default duration).
 */
export async function stayDurationFromMedia(
  visualFile: File | null | undefined,
  soundFile: File | null | undefined,
): Promise<number | null> {
  const probes: Promise<number | null>[] = [];
  if (visualFile) {
    const kind = guessMediaKind(visualFile);
    if (kind === "video" || kind === "audio") {
      probes.push(probeMediaDurationMs(visualFile));
    }
  }
  if (soundFile && soundFile !== visualFile && guessMediaKind(soundFile) === "audio") {
    probes.push(probeMediaDurationMs(soundFile));
  }

  if (probes.length === 0) return null;
  const values = (await Promise.all(probes)).filter((v): v is number => typeof v === "number" && v > 0);
  if (values.length === 0) return null;
  return clampStayDurationMs(Math.max(...values));
}

export function mediaDurationKey(visualFile: File | null | undefined, soundFile: File | null | undefined): string {
  const part = (f: File | null | undefined) => (f ? `${f.name}:${f.size}:${f.lastModified}` : "");
  return `${part(visualFile)}|${part(soundFile)}`;
}
