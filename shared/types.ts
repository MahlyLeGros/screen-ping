export type MediaType = "image" | "video" | "audio";

export type ObjectFitMode = "contain" | "fill";

/** Position and size as percentages of the receiver's screen. */
export interface MediaLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  objectFit?: ObjectFitMode;
  /** Live overlay opacity for a single uncompiled media (e.g. animated GIF). */
  opacity?: number;
}

export const LAYOUT_ASPECT_WIDTH = 16;
export const LAYOUT_ASPECT_HEIGHT = 9;

/** Outer wrapper crops any overflow to the physical receiver screen. */
export function layoutViewportStyle(): Record<string, string | number> {
  return {
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    pointerEvents: "none",
    overflow: "hidden",
    background: "transparent",
  };
}

/**
 * 16:9 coordinate space — must match MediaLayoutEditor preview (`aspect-ratio: 16/9`).
 * The canvas covers the physical screen, so non-16:9 monitors crop at the screen edge
 * instead of letterboxing a smaller 16:9 box inside the screen.
 */
export function layoutCanvasStyle(): Record<string, string | number> {
  return {
    position: "relative",
    width: `max(100vw, calc(100vh * ${LAYOUT_ASPECT_WIDTH} / ${LAYOUT_ASPECT_HEIGHT}))`,
    height: `max(100vh, calc(100vw * ${LAYOUT_ASPECT_HEIGHT} / ${LAYOUT_ASPECT_WIDTH}))`,
    overflow: "hidden",
    flex: "none",
  };
}

/**
 * Centered 16:9 drawing plane — letterboxed so the full sketch stays on screen.
 * Pings still use layoutCanvasStyle (cover); draw must not be cropped.
 */
export function drawCanvasContainStyle(): Record<string, string | number> {
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: `min(100vw, calc(100vh * ${LAYOUT_ASPECT_WIDTH} / ${LAYOUT_ASPECT_HEIGHT}))`,
    height: `min(100vh, calc(100vw * ${LAYOUT_ASPECT_HEIGHT} / ${LAYOUT_ASPECT_WIDTH}))`,
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: 20,
  };
}

export const DEFAULT_LAYOUT: MediaLayout = {
  x: 30,
  y: 30,
  width: 40,
  height: 40,
  rotation: 0,
  objectFit: "contain",
};

/** Compiled multi-image ping — one layer in the compose stack. */
export interface ImageLayer {
  id: string;
  layout: MediaLayout;
  opacity: number;
  zIndex: number;
  /** Editor-only — not sent to the server. */
  locked?: boolean;
}

export const COMPOSE_CANVAS_WIDTH = 2560;
export const COMPOSE_CANVAS_HEIGHT = 1440;
export const MAX_IMAGE_LAYERS = 10;

/** Fullscreen layout for server-compiled scene (already flattened to 16:9 canvas). */
export const COMPILED_SCENE_LAYOUT: MediaLayout = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  objectFit: "contain",
};

export const LAYOUT_PRESETS: { label: string; layout: Pick<MediaLayout, "x" | "y" | "width" | "height"> }[] = [
  { label: "Top left", layout: { x: 0, y: 0, width: 30, height: 30 } },
  { label: "Top right", layout: { x: 70, y: 0, width: 30, height: 30 } },
  { label: "Center", layout: { x: 30, y: 30, width: 40, height: 40 } },
  { label: "Bottom left", layout: { x: 0, y: 70, width: 30, height: 30 } },
  { label: "Bottom right", layout: { x: 70, y: 70, width: 30, height: 30 } },
  { label: "Edge left", layout: { x: -12, y: 30, width: 40, height: 40 } },
  { label: "Edge right", layout: { x: 72, y: 30, width: 40, height: 40 } },
  { label: "Full width", layout: { x: 0, y: 20, width: 100, height: 60 } },
];

/** Clamp position only — keeps tiny sizes during resize so mirror/flip can cross zero smoothly. */
export function clampLayoutPosition(layout: MediaLayout): MediaLayout {
  const width = Math.max(layout.width, 0.001);
  const height = Math.max(layout.height, 0.001);
  const rotation = ((layout.rotation ?? 0) % 360 + 360) % 360;
  // Keep a sliver on-screen for dragging; allow sizes beyond 100% for zoom/crop.
  const minVisible = 2;
  const minX = -width + minVisible;
  const minY = -height + minVisible;
  const maxX = 100 - minVisible;
  const maxY = 100 - minVisible;
  return {
    ...layout,
    x: Math.max(minX, Math.min(layout.x, maxX)),
    y: Math.max(minY, Math.min(layout.y, maxY)),
    width,
    height,
    rotation,
    flipX: layout.flipX ?? false,
    flipY: layout.flipY ?? false,
    objectFit: layout.objectFit ?? "contain",
  };
}

export function frameRotationTransform(layout: MediaLayout): string {
  return `rotate(${layout.rotation ?? 0}deg)`;
}

export function contentFlipTransform(layout: MediaLayout): string {
  const sx = layout.flipX ? -1 : 1;
  const sy = layout.flipY ? -1 : 1;
  return `scale(${sx}, ${sy})`;
}

/** Normalize layout after edits — no max size cap (scale freely in the editor). */
export function clampLayout(layout: MediaLayout, minSize = 0.001): MediaLayout {
  const width = Math.max(minSize, layout.width);
  const height = Math.max(minSize, layout.height);
  return clampLayoutPosition({ ...layout, width, height });
}

export const MIN_DURATION_MS = 2000;
export const MAX_DURATION_MS = 30_000;
export const DEFAULT_DURATION_MS = 3000;

export const DURATION_PRESETS: { label: string; ms: number }[] = [
  { label: "3 sec", ms: 3000 },
  { label: "5 sec", ms: 5000 },
  { label: "8 sec", ms: 8000 },
  { label: "15 sec", ms: 15000 },
  { label: "30 sec", ms: 30000 },
];

export const DELAY_PRESETS: { label: string; ms: number }[] = [
  { label: "Now", ms: 0 },
  { label: "3 sec", ms: 3000 },
  { label: "5 sec", ms: 5000 },
  { label: "10 sec", ms: 10000 },
  { label: "30 sec", ms: 30000 },
];

export const MAX_DELAY_MS = 60_000;
export const MAX_AUDIO_DELAY_MS = 60_000;
export const DEFAULT_AUDIO_DELAY_MS = 0;

export const DEFAULT_FADE_IN_MS = 200;
export const DEFAULT_FADE_OUT_MS = 0;
export const MAX_FADE_MS = 3000;

export interface DeliverPayload {
  messageId: string;
  fromUserId: string;
  mediaType: MediaType;
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

/** Position and size for meme-style caption overlay (percent of 16:9 canvas). */
export interface CaptionLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  /** Font size as % of canvas height (e.g. 9 = 9% of preview height). */
  fontSizePct?: number;
}

export const DEFAULT_CAPTION_FONT_SIZE_PCT = 10;

export const DEFAULT_CAPTION_LAYOUT: CaptionLayout = {
  x: 10,
  y: 78,
  width: 40,
  height: 12,
  rotation: 0,
  fontSizePct: DEFAULT_CAPTION_FONT_SIZE_PCT,
};

export function captionLayoutToMedia(layout: CaptionLayout): MediaLayout {
  return {
    ...layout,
    rotation: layout.rotation ?? 0,
    flipX: false,
    flipY: false,
    objectFit: "contain",
  };
}

/** Fallback when older pings have no captionLayout — place below media. */
export function captionLayoutBelowMedia(media: MediaLayout): CaptionLayout {
  return {
    x: media.x,
    y: Math.min(media.y + media.height + 1, 85),
    width: media.width,
    height: 14,
    rotation: 0,
    fontSizePct: DEFAULT_CAPTION_FONT_SIZE_PCT,
  };
}

export function clampCaptionLayout(layout: CaptionLayout): CaptionLayout {
  const asMedia = clampLayout(captionLayoutToMedia(layout));
  return {
    x: asMedia.x,
    y: asMedia.y,
    width: asMedia.width,
    height: asMedia.height,
    rotation: asMedia.rotation,
    fontSizePct: layout.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT,
  };
}

export interface PresenceUpdate {
  userId: string;
  isOnline: boolean;
}

export interface MessageResult {
  messageId: string;
  status: string;
  reason?: string;
}
