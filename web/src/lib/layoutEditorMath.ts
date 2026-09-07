import type { MediaLayout, ObjectFitMode } from "../../../shared/types";
import { clampLayout, clampLayoutPosition, captionLayoutToMedia } from "../../../shared/types";
import type { CaptionLayout } from "../../../shared/types";

export type DragMode = "move" | "resize" | "rotate" | "none";
export type Corner = "tl" | "tr" | "br" | "bl";
export type LayerTarget = "media" | "caption" | string;

export interface HitResult {
  mode: DragMode;
  corner?: Corner;
}

export interface DragState {
  target: LayerTarget;
  mode: Exclude<DragMode, "none">;
  corner?: Corner;
  startPointer: { x: number; y: number };
  startAngle: number;
  startLayout: MediaLayout;
  anchorPct: { x: number; y: number };
  cornerOffset: { x: number; y: number };
  startLdx: number;
  startLdy: number;
  containerW: number;
  containerH: number;
  containerRect: { left: number; top: number; width: number; height: number };
}

export const OPPOSITE: Record<Corner, Corner> = {
  tl: "br",
  tr: "bl",
  br: "tl",
  bl: "tr",
};

export const CORNER_LOCAL: Record<Corner, { x: number; y: number }> = {
  tl: { x: -1, y: -1 },
  tr: { x: 1, y: -1 },
  br: { x: 1, y: 1 },
  bl: { x: -1, y: 1 },
};

export const RESIZE_HIT_PX = 14;
export const ROTATE_INNER_PX = 8;
export const ROTATE_OUTER_PX = 52;
export const HANDLE_SIZE_PX = 12;

export const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'%3E%3Cg stroke='%23000' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12a8 8 0 0 1 13.7-5.7M20 4v5h-5'/%3E%3Cpath d='M20 12a8 8 0 0 1-13.7 5.7M4 20v-5h5'/%3E%3C/g%3E%3Cg stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12a8 8 0 0 1 13.7-5.7M20 4v5h-5'/%3E%3Cpath d='M20 12a8 8 0 0 1-13.7 5.7M4 20v-5h5'/%3E%3C/g%3E%3C/svg%3E\") 12 12, grab";

const CORNER_DIAGONAL_ANGLE: Record<Corner, number> = {
  tl: 225,
  tr: 315,
  br: 45,
  bl: 135,
};

export function resizeCursor(corner: Corner, rotationDeg: number): string {
  const angle = (CORNER_DIAGONAL_ANGLE[corner] + rotationDeg + 360) % 360;
  const bucket = Math.round(angle / 45) % 4;
  return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[bucket];
}

export function resolvedObjectFit(
  layout?: Pick<MediaLayout, "objectFit"> | ObjectFitMode | null,
  fallback: ObjectFitMode = "contain",
): ObjectFitMode {
  const value = typeof layout === "string" ? layout : layout?.objectFit;
  return value === "fill" ? "fill" : value === "contain" ? "contain" : fallback;
}

export function softClampResize(layout: MediaLayout): MediaLayout {
  return {
    ...layout,
    width: Math.max(0.001, layout.width),
    height: Math.max(0.001, layout.height),
    rotation: ((layout.rotation ?? 0) % 360 + 360) % 360,
    flipX: layout.flipX ?? false,
    flipY: layout.flipY ?? false,
    objectFit: resolvedObjectFit(layout),
  };
}

export function applyObjectFitToMedia(
  root: HTMLElement | null,
  objectFit?: ObjectFitMode,
  fallback: ObjectFitMode = "contain",
) {
  const el = (
    root?.matches?.("img, video") ? root : root?.querySelector("img, video")
  ) as HTMLElement | null;
  if (!el) return;
  const current: ObjectFitMode =
    el.style.objectFit === "fill" || el.classList.contains("preview-media--fill") ? "fill" : "contain";
  const fit = resolvedObjectFit(objectFit, objectFit == null ? current : fallback);
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.minWidth = "0";
  el.style.minHeight = "0";
  el.style.objectFit = fit;
  el.classList.toggle("preview-media--fill", fit === "fill");
  el.classList.toggle("preview-media--fit", fit !== "fill");
}

export function mediaClass(objectFit: ObjectFitMode = "contain") {
  return objectFit === "fill"
    ? "preview-media preview-media--fill"
    : "preview-media preview-media--fit";
}

export function rectFromDom(rect: DOMRect): DragState["containerRect"] {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function pointerPctFromRect(
  clientX: number,
  clientY: number,
  rect: DragState["containerRect"],
) {
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

export function pointerToLocalPx(
  layout: MediaLayout,
  px: number,
  py: number,
  cw: number,
  ch: number,
): { x: number; y: number } {
  const cx = ((layout.x + layout.width / 2) / 100) * cw;
  const cy = ((layout.y + layout.height / 2) / 100) * ch;
  const dx = px - cx;
  const dy = py - cy;
  const rad = -((layout.rotation ?? 0) * Math.PI) / 180;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export function hitTestPx(layout: MediaLayout, localPx: { x: number; y: number }, cw: number, ch: number): HitResult {
  const hw = (layout.width / 100) * cw * 0.5;
  const hh = (layout.height / 100) * ch * 0.5;
  const corners: Corner[] = ["tl", "tr", "br", "bl"];

  let resizeCorner: Corner | undefined;
  let resizeDist = Infinity;
  let rotateCorner: Corner | undefined;
  let rotateDist = Infinity;

  for (const corner of corners) {
    const ls = CORNER_LOCAL[corner];
    const cx = ls.x * hw;
    const cy = ls.y * hh;
    const dist = Math.hypot(localPx.x - cx, localPx.y - cy);

    if (dist <= RESIZE_HIT_PX && dist < resizeDist) {
      resizeDist = dist;
      resizeCorner = corner;
    }
  }

  if (resizeCorner) return { mode: "resize", corner: resizeCorner };

  const insideBox = Math.abs(localPx.x) <= hw && Math.abs(localPx.y) <= hh;

  if (!insideBox) {
    for (const corner of corners) {
      const ls = CORNER_LOCAL[corner];
      const cx = ls.x * hw;
      const cy = ls.y * hh;
      const dist = Math.hypot(localPx.x - cx, localPx.y - cy);
      if (dist > ROTATE_INNER_PX && dist <= ROTATE_OUTER_PX && dist < rotateDist) {
        rotateDist = dist;
        rotateCorner = corner;
      }
    }
  }

  if (rotateCorner) return { mode: "rotate", corner: rotateCorner };
  if (insideBox) return { mode: "move" };
  return { mode: "none" };
}

function geomFlip(corner: Corner, ldx: number, ldy: number) {
  const sign = CORNER_LOCAL[corner];
  return {
    flipX: sign.x > 0 ? ldx < 0 : ldx > 0,
    flipY: sign.y > 0 ? ldy < 0 : ldy > 0,
  };
}

function localDeltaFromAnchor(
  start: MediaLayout,
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  cw: number,
  ch: number,
) {
  const rad = ((start.rotation ?? 0) * Math.PI) / 180;
  const ax = (anchor.x / 100) * cw;
  const ay = (anchor.y / 100) * ch;
  const px = (point.x / 100) * cw;
  const py = (point.y / 100) * ch;
  const dx = px - ax;
  const dy = py - ay;
  return {
    ldx: dx * Math.cos(-rad) - dy * Math.sin(-rad),
    ldy: dx * Math.sin(-rad) + dy * Math.cos(-rad),
  };
}

function flipDuringResize(
  start: MediaLayout,
  corner: Corner,
  ldx: number,
  ldy: number,
  startLdx: number,
  startLdy: number,
) {
  const startGeom = geomFlip(corner, startLdx, startLdy);
  const currentGeom = geomFlip(corner, ldx, ldy);
  const userFlipX = (start.flipX ?? false) !== startGeom.flipX;
  const userFlipY = (start.flipY ?? false) !== startGeom.flipY;
  return {
    flipX: userFlipX !== currentGeom.flipX,
    flipY: userFlipY !== currentGeom.flipY,
  };
}

export function resizeFromCorner(
  start: MediaLayout,
  anchor: { x: number; y: number },
  draggedCorner: { x: number; y: number },
  corner: Corner,
  cw: number,
  ch: number,
  startLdx: number,
  startLdy: number,
): MediaLayout {
  const ax = (anchor.x / 100) * cw;
  const ay = (anchor.y / 100) * ch;
  const px = (draggedCorner.x / 100) * cw;
  const py = (draggedCorner.y / 100) * ch;

  const { ldx, ldy } = localDeltaFromAnchor(start, anchor, draggedCorner, cw, ch);
  const { flipX, flipY } = flipDuringResize(start, corner, ldx, ldy, startLdx, startLdy);

  const widthPx = Math.max(1, Math.abs(ldx));
  const heightPx = Math.max(1, Math.abs(ldy));
  const cxPx = (ax + px) / 2;
  const cyPx = (ay + py) / 2;

  return {
    ...start,
    x: ((cxPx - widthPx / 2) / cw) * 100,
    y: ((cyPx - heightPx / 2) / ch) * 100,
    width: (widthPx / cw) * 100,
    height: (heightPx / ch) * 100,
    rotation: start.rotation ?? 0,
    flipX,
    flipY,
    objectFit: resolvedObjectFit(start),
  };
}

export function getCornerPct(
  layout: MediaLayout,
  corner: Corner,
  cw: number,
  ch: number,
): { x: number; y: number } {
  const cxPx = ((layout.x + layout.width / 2) / 100) * cw;
  const cyPx = ((layout.y + layout.height / 2) / 100) * ch;
  const hwPx = (layout.width / 100) * cw * 0.5;
  const hhPx = (layout.height / 100) * ch * 0.5;
  const ls = CORNER_LOCAL[corner];
  const lxPx = ls.x * hwPx;
  const lyPx = ls.y * hhPx;
  const rad = ((layout.rotation ?? 0) * Math.PI) / 180;
  const cornerXPx = cxPx + lxPx * Math.cos(rad) - lyPx * Math.sin(rad);
  const cornerYPx = cyPx + lxPx * Math.sin(rad) + lyPx * Math.cos(rad);
  return {
    x: (cornerXPx / cw) * 100,
    y: (cornerYPx / ch) * 100,
  };
}

export function cursorForHit(hit: HitResult, rotationDeg: number): string {
  if (hit.mode === "rotate") return ROTATE_CURSOR;
  if (hit.mode === "resize" && hit.corner) return resizeCursor(hit.corner, rotationDeg);
  if (hit.mode === "move") return "move";
  return "default";
}

export function hitTestImageLayer(
  layout: MediaLayout,
  pxPct: number,
  pyPct: number,
  cw: number,
  ch: number,
): HitResult {
  const px = (pxPct / 100) * cw;
  const py = (pyPct / 100) * ch;
  const local = pointerToLocalPx(layout, px, py, cw, ch);
  return hitTestPx(layout, local, cw, ch);
}

export function hitTestCaption(
  captionLayout: CaptionLayout,
  pxPct: number,
  pyPct: number,
  cw: number,
  ch: number,
): HitResult {
  const media = captionLayoutToMedia(captionLayout);
  const px = (pxPct / 100) * cw;
  const py = (pyPct / 100) * ch;
  const local = pointerToLocalPx(media, px, py, cw, ch);
  return hitTestPx(media, local, cw, ch);
}

export function clampDragLayout(layout: MediaLayout): MediaLayout {
  return clampLayout(clampLayoutPosition(layout));
}
