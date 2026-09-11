import Store from "electron-store";
import path from "path";
import os from "os";

/** FFmpeg encoder names. */
export type VideoEncoderId =
  | "libx264"
  | "h264_nvenc"
  | "hevc_nvenc"
  | "h264_amf"
  | "h264_qsv"
  | "libvpx-vp9";

export type RateControl = "cbr" | "vbr";
export type ScaleFilter = "bicubic" | "bilinear" | "lanczos";
export type AudioCodec = "aac" | "opus";
export type ContainerFormat = "mp4" | "mkv" | "mov" | "webm";
export type ResolutionMode = "native" | "1920x1080" | "1280x720" | "854x480" | "custom";

export interface ClipSettings {
  bufferSeconds: number;
  hotkey: string;
  outputDir: string;
  displayId: number | null;
  includeMic: boolean;
  includeSystemAudio: boolean;
  launchAtLogin: boolean;
  launchAtLoginDefaulted: boolean;
  bufferEnabled: boolean;

  resolutionMode: ResolutionMode;
  customWidth: number;
  customHeight: number;
  fps: number;
  scaleFilter: ScaleFilter;
  videoEncoder: VideoEncoderId;
  rateControl: RateControl;
  videoBitrateKbps: number;
  encoderPreset: string;
  keyframeIntervalSec: number;

  audioCodec: AudioCodec;
  audioBitrateKbps: number;
  sampleRate: number;

  containerFormat: ContainerFormat;
}

function defaultOutputDir(): string {
  return path.join(os.homedir(), "Videos", "Screen Clip");
}

export const DEFAULT_SETTINGS: ClipSettings = {
  bufferSeconds: 30,
  hotkey: "CommandOrControl+Shift+S",
  outputDir: defaultOutputDir(),
  displayId: null,
  includeMic: false,
  includeSystemAudio: true,
  launchAtLogin: true,
  launchAtLoginDefaulted: false,
  bufferEnabled: true,

  resolutionMode: "native",
  customWidth: 1920,
  customHeight: 1080,
  fps: 60,
  scaleFilter: "bicubic",
  videoEncoder: "libx264",
  rateControl: "cbr",
  videoBitrateKbps: 6000,
  encoderPreset: "veryfast",
  keyframeIntervalSec: 2,

  audioCodec: "aac",
  audioBitrateKbps: 160,
  sampleRate: 48000,

  containerFormat: "mp4",
};

const store = new Store<ClipSettings>({
  name: "screen-clip-settings",
  defaults: DEFAULT_SETTINGS,
});

export function applyLaunchAtLoginDefault() {
  if (store.get("launchAtLoginDefaulted")) return;
  store.set("launchAtLogin", true);
  store.set("launchAtLoginDefaulted", true);
}

export function setStoredValue<K extends keyof ClipSettings>(key: K, value: ClipSettings[K] | null | undefined) {
  if (value === null || value === undefined) {
    store.delete(key);
    return;
  }
  store.set(key, value);
}

export function getAllSettings(): ClipSettings {
  const out = { ...DEFAULT_SETTINGS } as ClipSettings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ClipSettings)[]) {
    out[key] = store.get(key) as never;
  }
  return out;
}

export default store;
