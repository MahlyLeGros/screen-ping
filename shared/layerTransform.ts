import type { CSSProperties } from "react";
import type { MediaLayout } from "./types";
import { DEFAULT_LAYOUT } from "./types";

/** Position + rotation on one wrapper — no inner scaling. */
export function frameStyle(layout: MediaLayout = DEFAULT_LAYOUT): CSSProperties {
  const opacity = typeof layout.opacity === "number" ? layout.opacity : 1;
  return {
    position: "absolute",
    left: `${layout.x}%`,
    top: `${layout.y}%`,
    width: `${layout.width}%`,
    height: `${layout.height}%`,
    transform: `rotate(${layout.rotation ?? 0}deg)`,
    transformOrigin: "center center",
    overflow: "hidden",
    boxSizing: "border-box",
    opacity,
  };
}

export function flipStyle(layout: MediaLayout): CSSProperties {
  const sx = layout.flipX ? -1 : 1;
  const sy = layout.flipY ? -1 : 1;
  if (sx === 1 && sy === 1) return { width: "100%", height: "100%" };
  return {
    width: "100%",
    height: "100%",
    transform: `scale(${sx}, ${sy})`,
    transformOrigin: "center center",
  };
}

export function mediaObjectFit(layout: MediaLayout): CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: layout.objectFit === "fill" ? "fill" : "contain",
  };
}

export function layerFrameStyle(
  layout: MediaLayout,
  opacity: number,
  zIndex: number,
): CSSProperties {
  return {
    ...frameStyle(layout),
    opacity,
    zIndex,
  };
}

/** Shell for layer editor — position/rotation/z-index only (selection border stays opaque). */
export function layerShellStyle(layout: MediaLayout, zIndex: number): CSSProperties {
  return {
    ...frameStyle(layout),
    zIndex,
  };
}
