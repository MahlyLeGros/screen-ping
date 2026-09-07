import type { CSSProperties } from "react";
import type { CaptionLayout, MediaLayout } from "../../../shared/types";
import { DEFAULT_LAYOUT } from "../../../shared/types";
import { frameStyle, flipStyle, mediaObjectFit } from "../../../shared/layerTransform";

export type { ObjectFitMode } from "../../../shared/types";
export type { MediaLayout, CaptionLayout };
export { DEFAULT_LAYOUT, frameStyle, flipStyle, mediaObjectFit };

export interface ElectronAPI {
  getSavedLogin: () => Promise<{ username: string; password: string; remember: boolean }>;
  login: (username: string, password: string, remember?: boolean) => Promise<{ ok: boolean }>;
  browserLogin: (mode: "google" | "web", remember?: boolean) => Promise<{ ok: boolean }>;
  cancelBrowserLogin: () => Promise<{ ok: boolean }>;
  dismissOverlay: (messageId: string) => void;
  onShowOverlay: (callback: (payload: OverlayPayload) => void) => void;
  onHideOverlay: (callback: () => void) => void;
  notifyOverlayReady: (messageId: string) => void;
  notifyOverlayCleared: () => void;
  onDrawBegin: (callback: (payload: unknown) => void) => void;
  onDrawStroke: (callback: (payload: unknown) => void) => void;
  onDrawClear: (callback: (payload: unknown) => void) => void;
  onDrawEnd: (callback: (payload: unknown) => void) => void;
  notifyDrawIdle: () => void;
}

export interface OverlayPayload {
  messageId: string;
  fromUserId: string;
  mediaType: "image" | "video" | "audio";
  mediaUrl: string;
  audioUrl?: string;
  caption?: string;
  durationMs: number;
  delayMs?: number;
  audioDelayMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  layout?: MediaLayout;
  captionLayout?: CaptionLayout;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export function captionFrameStyle(layout: CaptionLayout): CSSProperties {
  return {
    position: "absolute",
    left: `${layout.x}%`,
    top: `${layout.y}%`,
    width: `${layout.width}%`,
    height: `${layout.height}%`,
    transform: `rotate(${layout.rotation ?? 0}deg)`,
    transformOrigin: "center center",
    overflow: "visible",
    boxSizing: "border-box",
    zIndex: 10,
  };
}

export function captionBelowLayout(layout: MediaLayout): CSSProperties {
  const top = Math.min(layout.y + layout.height + 1, 95);
  return {
    position: "absolute",
    left: `${layout.x}%`,
    top: `${top}%`,
    width: `${layout.width}%`,
    textAlign: "center",
  };
}

export {};
