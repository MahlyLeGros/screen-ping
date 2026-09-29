import type {
  AudioCodec,
  ClipSettings,
  ContainerFormat,
  RateControl,
  ResolutionMode,
  ScaleFilter,
  VideoEncoderId,
} from "../../main/store";

export type {
  AudioCodec,
  ClipSettings,
  ContainerFormat,
  RateControl,
  ResolutionMode,
  ScaleFilter,
  VideoEncoderId,
};

export interface DisplayInfo {
  id: number;
  label: string;
  shortLabel: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface BufferState {
  status: "running" | "paused" | "stopped" | "error";
  lastError: string | null;
  lastClipPath: string | null;
  flushing: boolean;
}

export interface ClipAppState {
  settings: ClipSettings;
  buffer: BufferState;
  displays: DisplayInfo[];
  availableEncoders: VideoEncoderId[];
  encodingWarning: string | null;
}

export type ActionName =
  | "save-clip"
  | "pause-buffer"
  | "resume-buffer"
  | "open-settings"
  | "open-output-dir"
  | "toggle-launch-at-login"
  | "quit";

export type SettingKey = keyof ClipSettings;

export interface ClipAPI {
  getState: () => Promise<ClipAppState>;
  onState: (callback: (state: ClipAppState) => void) => () => void;
  set: (key: SettingKey, value: ClipSettings[SettingKey]) => void;
  action: (name: ActionName) => void;
  minimize: () => void;
  close: () => void;
  resizeMenu: (width: number, height: number) => void;
  hideMenu: () => void;
  pickOutputDir: () => Promise<string | null>;
}

declare global {
  interface Window {
    clipAPI: ClipAPI;
  }
}

export {};
