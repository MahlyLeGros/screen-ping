import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CaptionLayout, MediaLayout, ObjectFitMode } from "../../../shared/types";
import {
  captionLayoutToMedia,
  clampCaptionLayout,
  clampLayout,
  clampLayoutPosition,
  DEFAULT_CAPTION_FONT_SIZE_PCT,
} from "../../../shared/types";
import ScaledMemeCaption from "../../../shared/ScaledMemeCaption";
import {
  captionLayoutAroundCenter,
  defaultCaptionCenter,
  measureCaptionElement,
} from "../lib/captionMeasure";
import { memeCaptionTextStyle } from "../../../shared/memeCaptionStyle";
import { applyObjectFitToMedia } from "../lib/layoutEditorMath";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  describeLayoutChange,
  handleCaptionLayoutKeyboardEvent,
  handleLayoutKeyboardEvent,
} from "../lib/layoutKeyboard";

interface MediaLayoutEditorProps {
  previewUrl: string;
  isVideo: boolean;
  isAudio: boolean;
  layout: MediaLayout;
  onChange: (layout: MediaLayout) => void;
  caption?: string;
  captionLayout?: CaptionLayout;
  onCaptionLayoutChange?: (layout: CaptionLayout) => void;
  large?: boolean;
}

type DragMode = "move" | "resize" | "rotate" | "none";
type Corner = "tl" | "tr" | "br" | "bl";
type LayerTarget = "media" | "caption";

interface HitResult {
  mode: DragMode;
  corner?: Corner;
}

interface DragState {
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

const CORNER_LABELS: Record<Corner, string> = {
  tl: "top-left",
  tr: "top-right",
  br: "bottom-right",
  bl: "bottom-left",
};

const OPPOSITE: Record<Corner, Corner> = {
  tl: "br",
  tr: "bl",
  br: "tl",
  bl: "tr",
};

const CORNER_LOCAL: Record<Corner, { x: number; y: number }> = {
  tl: { x: -1, y: -1 },
  tr: { x: 1, y: -1 },
  br: { x: 1, y: 1 },
  bl: { x: -1, y: 1 },
};

const RESIZE_HIT_PX = 14;
const ROTATE_INNER_PX = 8;
const ROTATE_OUTER_PX = 52;
const HANDLE_SIZE_PX = 12;

const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'%3E%3Cg stroke='%23000' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12a8 8 0 0 1 13.7-5.7M20 4v5h-5'/%3E%3Cpath d='M20 12a8 8 0 0 1-13.7 5.7M4 20v-5h5'/%3E%3C/g%3E%3Cg stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12a8 8 0 0 1 13.7-5.7M20 4v5h-5'/%3E%3Cpath d='M20 12a8 8 0 0 1-13.7 5.7M4 20v-5h5'/%3E%3C/g%3E%3C/svg%3E\") 12 12, grab";

const CORNER_DIAGONAL_ANGLE: Record<Corner, number> = {
  tl: 225,
  tr: 315,
  br: 45,
  bl: 135,
};

function resizeCursor(corner: Corner, rotationDeg: number): string {
  const angle = (CORNER_DIAGONAL_ANGLE[corner] + rotationDeg + 360) % 360;
  const bucket = Math.round(angle / 45) % 4;
  return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[bucket];
}

function softClampResize(layout: MediaLayout): MediaLayout {
  return {
    ...layout,
    width: Math.max(0.001, layout.width),
    height: Math.max(0.001, layout.height),
    rotation: ((layout.rotation ?? 0) % 360 + 360) % 360,
    flipX: layout.flipX ?? false,
    flipY: layout.flipY ?? false,
    objectFit: layout.objectFit ?? "contain",
  };
}

function mediaClass(objectFit: ObjectFitMode = "contain") {
  return objectFit === "fill"
    ? "preview-media preview-media--fill"
    : "preview-media preview-media--fit";
}

const FRAME_SHELL_STYLE: React.CSSProperties = {
  position: "absolute",
  transformOrigin: "center center",
  boxSizing: "border-box",
};

function applyLayoutToElement(el: HTMLElement | null, layout: MediaLayout) {
  if (!el) return;
  el.style.left = `${layout.x}%`;
  el.style.top = `${layout.y}%`;
  el.style.width = `${layout.width}%`;
  el.style.height = `${layout.height}%`;
  el.style.transform = `rotate(${layout.rotation ?? 0}deg)`;
}

function mediaBackgroundSize(objectFit: ObjectFitMode): string {
  return objectFit === "fill" ? "100% 100%" : "contain";
}

function setMediaBgPreview(
  shell: HTMLElement | null,
  inner: HTMLElement | null,
  previewUrl: string,
  objectFit: ObjectFitMode,
  enabled: boolean,
) {
  if (!shell) return;
  if (enabled) {
    shell.classList.add("media-bg-preview");
    shell.style.backgroundImage = `url("${previewUrl.replace(/"/g, "%22")}")`;
    shell.style.backgroundSize = mediaBackgroundSize(objectFit);
    shell.style.backgroundPosition = "center";
    shell.style.backgroundRepeat = "no-repeat";
    // Match the <img> content box — border-box made the still jump outward for a frame.
    shell.style.backgroundOrigin = "content-box";
    shell.style.backgroundClip = "content-box";
    if (inner) inner.style.visibility = "hidden";
    return;
  }
  shell.classList.remove("media-bg-preview");
  shell.style.backgroundImage = "";
  shell.style.backgroundSize = "";
  shell.style.backgroundPosition = "";
  shell.style.backgroundRepeat = "";
  shell.style.backgroundOrigin = "";
  shell.style.backgroundClip = "";
  if (inner) inner.style.visibility = "";
}

function applyMediaFrameLayout(
  shell: HTMLElement | null,
  flipInner: HTMLElement | null,
  layout: MediaLayout,
  bgPreview: boolean,
) {
  if (!shell) return;
  shell.style.left = `${layout.x}%`;
  shell.style.top = `${layout.y}%`;
  shell.style.width = `${layout.width}%`;
  shell.style.height = `${layout.height}%`;

  const rotation = layout.rotation ?? 0;
  if (bgPreview) {
    const fx = layout.flipX ? -1 : 1;
    const fy = layout.flipY ? -1 : 1;
    shell.style.transform = `rotate(${rotation}deg) scale(${fx}, ${fy})`;
    if (flipInner) {
      flipInner.style.transform = "";
      flipInner.style.width = "100%";
      flipInner.style.height = "100%";
    }
    applyObjectFitToMedia(flipInner ?? shell, layout.objectFit);
    return;
  }

  shell.style.transform = `rotate(${rotation}deg)`;
  applyFlipToElement(flipInner, layout);
  applyObjectFitToMedia(flipInner ?? shell, layout.objectFit);
}

function applyFlipToElement(el: HTMLElement | null, layout: MediaLayout) {
  if (!el) return;
  const sx = layout.flipX ? -1 : 1;
  const sy = layout.flipY ? -1 : 1;
  if (sx === 1 && sy === 1) {
    el.style.transform = "";
    el.style.width = "100%";
    el.style.height = "100%";
    return;
  }
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.transform = `scale(${sx}, ${sy})`;
  el.style.transformOrigin = "center center";
}

function applyFlipIfChanged(
  el: HTMLElement | null,
  layout: MediaLayout,
  lastFlip: { flipX: boolean; flipY: boolean },
) {
  const flipX = layout.flipX ?? false;
  const flipY = layout.flipY ?? false;
  if (lastFlip.flipX === flipX && lastFlip.flipY === flipY) return;
  lastFlip.flipX = flipX;
  lastFlip.flipY = flipY;
  applyFlipToElement(el, layout);
}

function rectFromDom(rect: DOMRect): DragState["containerRect"] {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function pointerPctFromRect(
  clientX: number,
  clientY: number,
  rect: DragState["containerRect"],
) {
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

const PreviewMedia = memo(function PreviewMedia({
  previewUrl,
  isVideo,
  objectFit,
  videoRef,
}: {
  previewUrl: string;
  isVideo: boolean;
  objectFit: ObjectFitMode;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const cls = `preview-media ${mediaClass(objectFit)}`;

  useEffect(() => {
    if (!isVideo) return;
    const video = videoRef.current;
    if (!video) return;

    const showFirstFrame = () => {
      video.pause();
      const t =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.1, video.duration * 0.01)
          : 0.001;
      if (Math.abs(video.currentTime - t) > 0.0005) {
        video.currentTime = t;
      }
    };

    video.addEventListener("loadeddata", showFirstFrame);
    video.addEventListener("seeked", showFirstFrame);
    if (video.readyState >= 1) showFirstFrame();
    return () => {
      video.removeEventListener("loadeddata", showFirstFrame);
      video.removeEventListener("seeked", showFirstFrame);
    };
  }, [isVideo, previewUrl, videoRef]);

  if (isVideo) {
    return (
      <video
        ref={videoRef}
        src={previewUrl}
        className={cls}
        style={{ objectFit }}
        muted
        playsInline
        preload="auto"
        draggable={false}
      />
    );
  }
  return (
    <img
      src={previewUrl}
      alt="Preview"
      className={cls}
      style={{ objectFit }}
      draggable={false}
      loading="eager"
    />
  );
});

function getCornerPct(
  layout: MediaLayout,
  corner: Corner,
  cw: number,
  ch: number
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

function pointerToLocalPx(
  layout: MediaLayout,
  px: number,
  py: number,
  cw: number,
  ch: number
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

function hitTestPx(layout: MediaLayout, localPx: { x: number; y: number }, cw: number, ch: number): HitResult {
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

  if (insideBox) {
    return { mode: "move" };
  }

  return { mode: "none" };
}

function localDeltaFromAnchor(
  start: MediaLayout,
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  cw: number,
  ch: number
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

function geomFlip(corner: Corner, ldx: number, ldy: number) {
  const sign = CORNER_LOCAL[corner];
  return {
    flipX: sign.x > 0 ? ldx < 0 : ldx > 0,
    flipY: sign.y > 0 ? ldy < 0 : ldy > 0,
  };
}

function flipDuringResize(
  start: MediaLayout,
  corner: Corner,
  ldx: number,
  ldy: number,
  startLdx: number,
  startLdy: number
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

function resizeFromCorner(
  start: MediaLayout,
  anchor: { x: number; y: number },
  draggedCorner: { x: number; y: number },
  corner: Corner,
  cw: number,
  ch: number,
  startLdx: number,
  startLdy: number
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
    objectFit: start.objectFit === "fill" ? "fill" : "contain",
  };
}

function cursorForHit(hit: HitResult, rotationDeg: number): string {
  if (hit.mode === "rotate") return ROTATE_CURSOR;
  if (hit.mode === "resize" && hit.corner) return resizeCursor(hit.corner, rotationDeg);
  if (hit.mode === "move") return "move";
  return "default";
}

function hitTestLayers(
  mediaLayout: MediaLayout,
  captionLayout: CaptionLayout | null,
  px: number,
  py: number,
  cw: number,
  ch: number
): { target: LayerTarget; hit: HitResult } {
  if (captionLayout) {
    const captionMedia = captionLayoutToMedia(captionLayout);
    const localCaption = pointerToLocalPx(captionMedia, px, py, cw, ch);
    const captionHit = hitTestPx(captionMedia, localCaption, cw, ch);
    if (captionHit.mode !== "none") {
      return { target: "caption", hit: captionHit };
    }
  }
  const localMedia = pointerToLocalPx(mediaLayout, px, py, cw, ch);
  const mediaHit = hitTestPx(mediaLayout, localMedia, cw, ch);
  return { target: "media", hit: mediaHit };
}

function MediaLayoutEditor({
  previewUrl,
  isVideo,
  isAudio,
  layout,
  onChange,
  caption,
  captionLayout,
  onCaptionLayoutChange,
  large = false,
}: MediaLayoutEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chromeHideTimerRef = useRef(0);
  const mediaFrameRef = useRef<HTMLDivElement>(null);
  const captionFrameRef = useRef<HTMLDivElement>(null);
  const flipInnerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captionMeasureRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const applyRafRef = useRef(0);
  const hoverRafRef = useRef(0);
  const hoverPointerRef = useRef({ x: 0, y: 0 });
  const lastFlipRef = useRef({ flipX: false, flipY: false });
  const mediaBgPreviewRef = useRef(false);
  const captionLiveResizeRef = useRef(false);
  const previewUrlRef = useRef(previewUrl);
  const objectFitRef = useRef<ObjectFitMode>("contain");
  const mediaDraftRef = useRef(layout);
  const captionDraftRef = useRef(captionLayout);
  const cursorRef = useRef("default");
  const [mediaDraft, setMediaDraft] = useState(layout);
  const [captionDraft, setCaptionDraft] = useState(captionLayout);
  const [activeTarget, setActiveTarget] = useState<LayerTarget | null>(null);
  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  const chromeVisibleRef = useRef(false);
  const xlUp = useMediaQuery("(min-width: 1280px)");
  const showFloatingChrome = large && xlUp;
  const showBelowControls = large && !xlUp;
  chromeVisibleRef.current = chromeVisible;

  const captionText = caption?.trim() ?? "";
  const showCaption = Boolean(captionText && captionLayout && onCaptionLayoutChange);

  const objectFit = mediaDraft.objectFit ?? "contain";

  previewUrlRef.current = previewUrl;
  objectFitRef.current = objectFit;

  mediaDraftRef.current = mediaDraft;
  captionDraftRef.current = captionDraft;

  useLayoutEffect(() => {
    const media = mediaDraftRef.current;
    lastFlipRef.current = { flipX: media.flipX ?? false, flipY: media.flipY ?? false };
    applyMediaFrameLayout(mediaFrameRef.current, flipInnerRef.current, media, false);
    if (captionDraftRef.current) {
      applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(captionDraftRef.current));
    }
  }, []);

  useEffect(() => {
    if (!dragRef.current) {
      setMediaDraft(layout);
      mediaDraftRef.current = layout;
      lastFlipRef.current = { flipX: layout.flipX ?? false, flipY: layout.flipY ?? false };
      applyMediaFrameLayout(mediaFrameRef.current, flipInnerRef.current, layout, false);
    }
  }, [layout]);

  useEffect(() => {
    if (!dragRef.current) {
      setCaptionDraft(captionLayout);
      captionDraftRef.current = captionLayout;
      if (captionLayout) {
        applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(captionLayout));
      }
    }
  }, [captionLayout]);

  const CHROME_TOP_BAND_PX = 48;
  const CHROME_HIDE_MS = 40;

  const hideChromeNow = useCallback(() => {
    window.clearTimeout(chromeHideTimerRef.current);
    chromeHideTimerRef.current = 0;
    if (!chromeVisibleRef.current) return;
    chromeVisibleRef.current = false;
    setChromeVisible(false);
  }, []);

  const revealChrome = useCallback(() => {
    window.clearTimeout(chromeHideTimerRef.current);
    chromeHideTimerRef.current = 0;
    if (chromeVisibleRef.current) return;
    chromeVisibleRef.current = true;
    setChromeVisible(true);
  }, []);

  const scheduleChromeHide = useCallback(() => {
    if (!chromeVisibleRef.current || chromeHideTimerRef.current) return;
    chromeHideTimerRef.current = window.setTimeout(() => {
      chromeHideTimerRef.current = 0;
      chromeVisibleRef.current = false;
      setChromeVisible(false);
    }, CHROME_HIDE_MS);
  }, []);

  const onEditorPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = e.clientX - rect.left;
      const overChrome = e.target instanceof Element && Boolean(e.target.closest(".compose-preview-chrome"));
      if (overChrome || (x >= 0 && x <= rect.width && y >= 0 && y <= CHROME_TOP_BAND_PX)) {
        revealChrome();
        return;
      }
      if (chromeVisibleRef.current) scheduleChromeHide();
    },
    [revealChrome, scheduleChromeHide],
  );

  useEffect(() => {
    return () => window.clearTimeout(chromeHideTimerRef.current);
  }, []);

  const setContainerCursor = useCallback((next: string) => {
    if (cursorRef.current === next) return;
    cursorRef.current = next;
    if (containerRef.current) {
      containerRef.current.style.cursor = next;
    }
  }, []);

  const setDraggingUi = useCallback((dragging: boolean) => {
    containerRef.current?.classList.toggle("is-dragging", dragging);
    mediaFrameRef.current?.classList.toggle("is-drag-layer", dragging);
    const video = videoRef.current;
    if (!video) return;
    if (dragging) {
      video.pause();
    } else {
      void video.play().catch(() => {});
    }
  }, []);

  const flushLayoutPaint = useCallback((target: LayerTarget) => {
    if (target === "caption") {
      const caption = captionDraftRef.current;
      if (caption) {
        applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(caption));
      }
      return;
    }
    const media = mediaDraftRef.current;
    const bgPreview = mediaBgPreviewRef.current;
    applyMediaFrameLayout(mediaFrameRef.current, flipInnerRef.current, media, bgPreview);
    if (!bgPreview) {
      applyFlipIfChanged(flipInnerRef.current, media, lastFlipRef.current);
    }
  }, []);

  const cancelApplyRaf = useCallback(() => {
    if (!applyRafRef.current) return;
    cancelAnimationFrame(applyRafRef.current);
    applyRafRef.current = 0;
  }, []);

  const scheduleLayoutPaint = useCallback(
    (target: LayerTarget) => {
      if (!dragRef.current) {
        flushLayoutPaint(target);
        return;
      }
      if (applyRafRef.current) return;
      applyRafRef.current = requestAnimationFrame(() => {
        applyRafRef.current = 0;
        if (!dragRef.current) return;
        flushLayoutPaint(dragRef.current.target);
      });
    },
    [flushLayoutPaint],
  );

  const fitCaptionToText = useCallback(() => {
    if (!captionText || !onCaptionLayoutChange || !containerRef.current || !captionMeasureRef.current) return;
    if (dragRef.current) return;

    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const size = measureCaptionElement(captionMeasureRef.current, cw, ch);
    const prev = captionDraftRef.current;
    const fontSizePct = prev?.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT;
    const center = prev
      ? { x: prev.x + prev.width / 2, y: prev.y + prev.height / 2 }
      : defaultCaptionCenter();
    const next = clampCaptionLayout(
      captionLayoutAroundCenter(center.x, center.y, size, prev?.rotation ?? 0, fontSizePct)
    );

    const unchanged =
      prev &&
      Math.abs(prev.width - next.width) < 0.05 &&
      Math.abs(prev.height - next.height) < 0.05 &&
      Math.abs(prev.x - next.x) < 0.05 &&
      Math.abs(prev.y - next.y) < 0.05;
    if (unchanged) return;

    captionDraftRef.current = next;
    setCaptionDraft(next);
    onCaptionLayoutChange(next);
  }, [captionText, onCaptionLayoutChange]);

  useEffect(() => {
    if (!captionText || !onCaptionLayoutChange || dragRef.current) return;
    const id = requestAnimationFrame(() => fitCaptionToText());
    return () => cancelAnimationFrame(id);
  }, [captionText, fitCaptionToText, onCaptionLayoutChange]);

  const getLayoutForTarget = useCallback(
    (target: LayerTarget): MediaLayout => {
      if (target === "caption" && captionDraftRef.current) {
        return captionLayoutToMedia(captionDraftRef.current);
      }
      return mediaDraftRef.current;
    },
    []
  );

  const setLayoutForTarget = useCallback(
    (target: LayerTarget, next: MediaLayout, syncReact = false) => {
      if (target === "caption") {
        const captionNext: CaptionLayout = {
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
          rotation: next.rotation,
          fontSizePct: captionDraftRef.current?.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT,
        };
        captionDraftRef.current = captionNext;
        if (syncReact) {
          cancelApplyRaf();
          flushLayoutPaint("caption");
          setCaptionDraft(captionNext);
        } else {
          scheduleLayoutPaint("caption");
        }
        return;
      }

      mediaDraftRef.current = next;
      if (syncReact) {
        cancelApplyRaf();
        flushLayoutPaint("media");
        setMediaDraft(next);
      } else {
        scheduleLayoutPaint("media");
      }
    },
    [cancelApplyRaf, flushLayoutPaint, scheduleLayoutPaint],
  );

  const finishDrag = useCallback(
    (target: LayerTarget, next: MediaLayout) => {
      cancelApplyRaf();
      dragRef.current = null;
      setDraggingUi(false);
      setActiveTarget(null);
      setActiveCorner(null);
      setContainerCursor("default");

      if (target === "caption") {
        const clamped = clampCaptionLayout({
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
          rotation: next.rotation,
          fontSizePct: captionDraftRef.current?.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT,
        });
        if (captionLiveResizeRef.current) {
          captionLiveResizeRef.current = false;
          captionFrameRef.current?.classList.remove("caption-live-resize");
        }
        setCaptionDraft(clamped);
        captionDraftRef.current = clamped;
        applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(clamped));
        onCaptionLayoutChange?.(clamped);
        return;
      }

      if (mediaBgPreviewRef.current) {
        mediaBgPreviewRef.current = false;
        setMediaBgPreview(
          mediaFrameRef.current,
          flipInnerRef.current,
          previewUrlRef.current,
          objectFitRef.current,
          false,
        );
      }

      const clamped = clampLayout({
        ...next,
        objectFit:
          next.objectFit === "fill" || mediaDraftRef.current.objectFit === "fill" || objectFitRef.current === "fill"
            ? "fill"
            : next.objectFit ?? mediaDraftRef.current.objectFit ?? "contain",
      });
      setMediaDraft(clamped);
      mediaDraftRef.current = clamped;
      lastFlipRef.current = { flipX: clamped.flipX ?? false, flipY: clamped.flipY ?? false };
      applyMediaFrameLayout(mediaFrameRef.current, flipInnerRef.current, clamped, false);
      onChange(clamped);
    },
    [cancelApplyRaf, onChange, onCaptionLayoutChange, setContainerCursor, setDraggingUi],
  );

  const runHoverHitTest = useCallback(() => {
    const el = containerRef.current;
    if (!el || dragRef.current) return;
    const rect = el.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const { x: clientX, y: clientY } = hoverPointerRef.current;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const currentMedia = mediaDraftRef.current;
    const currentCaption = showCaption ? captionDraftRef.current ?? null : null;
    const { target, hit } = hitTestLayers(currentMedia, currentCaption, px, py, cw, ch);
    const activeLayout =
      hit.mode !== "none"
        ? target === "caption" && currentCaption
          ? captionLayoutToMedia(currentCaption)
          : currentMedia
        : currentMedia;
    setContainerCursor(cursorForHit(hit, activeLayout.rotation ?? 0));
  }, [setContainerCursor, showCaption]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      hideChromeNow();

      const rect = el.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      if (cw <= 0 || ch <= 0) return;

      const currentMedia = mediaDraftRef.current;
      const currentCaption = showCaption ? captionDraftRef.current ?? null : null;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { target, hit } = hitTestLayers(currentMedia, currentCaption, px, py, cw, ch);
      if (hit.mode === "none") return;

      e.preventDefault();
      el.setPointerCapture(e.pointerId);

      const current = getLayoutForTarget(target);
      const containerRect = rectFromDom(rect);
      const ptr = pointerPctFromRect(e.clientX, e.clientY, containerRect);
      const centerPct = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
      const ptrPx = {
        x: (ptr.x / 100) * cw,
        y: (ptr.y / 100) * ch,
      };
      const centerPx = {
        x: (centerPct.x / 100) * cw,
        y: (centerPct.y / 100) * ch,
      };
      const startAngle = Math.atan2(ptrPx.y - centerPx.y, ptrPx.x - centerPx.x);

      const opposite = hit.corner ? OPPOSITE[hit.corner] : "tl";
      const anchorPct = hit.corner ? getCornerPct(current, opposite, cw, ch) : centerPct;
      const draggedCorner = hit.corner ? getCornerPct(current, hit.corner, cw, ch) : centerPct;
      const cornerOffset = {
        x: ptr.x - draggedCorner.x,
        y: ptr.y - draggedCorner.y,
      };
      const { ldx: startLdx, ldy: startLdy } = hit.corner
        ? localDeltaFromAnchor(current, anchorPct, draggedCorner, cw, ch)
        : { ldx: 0, ldy: 0 };

      dragRef.current = {
        target,
        mode: hit.mode,
        corner: hit.corner,
        startPointer: ptr,
        startAngle,
        startLayout: {
          ...current,
          objectFit: current.objectFit === "fill" || objectFitRef.current === "fill" ? "fill" : "contain",
        },
        anchorPct,
        cornerOffset,
        startLdx,
        startLdy,
        containerW: cw,
        containerH: ch,
        containerRect,
      };

      lastFlipRef.current = {
        flipX: current.flipX ?? false,
        flipY: current.flipY ?? false,
      };

      // Still-frame bg swap is only for video (paused/hidden while dragging).
      // On images it flashes for a frame because border-box ≠ content-box.
      if (target === "media" && hit.mode === "resize" && isVideo) {
        mediaBgPreviewRef.current = true;
        setMediaBgPreview(
          mediaFrameRef.current,
          flipInnerRef.current,
          previewUrlRef.current,
          objectFitRef.current,
          true,
        );
      }
      if (target === "caption" && hit.mode === "resize") {
        captionLiveResizeRef.current = true;
        captionFrameRef.current?.classList.add("caption-live-resize");
      }

      cancelApplyRaf();
      flushLayoutPaint(target);

      setDraggingUi(true);
      setActiveTarget(target);
      if (hit.corner) setActiveCorner(hit.corner);
      setContainerCursor(cursorForHit(hit, current.rotation ?? 0));
    },
    [
      cancelApplyRaf,
      flushLayoutPaint,
      getLayoutForTarget,
      hideChromeNow,
      isVideo,
      setContainerCursor,
      setDraggingUi,
      showCaption,
    ],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;

      if (!drag) {
        hoverPointerRef.current = { x: e.clientX, y: e.clientY };
        if (hoverRafRef.current) return;
        hoverRafRef.current = requestAnimationFrame(() => {
          hoverRafRef.current = 0;
          runHoverHitTest();
        });
        return;
      }

      e.preventDefault();
      const ptr = pointerPctFromRect(e.clientX, e.clientY, drag.containerRect);

      if (drag.mode === "resize" && drag.corner) {
        setContainerCursor(resizeCursor(drag.corner, drag.startLayout.rotation ?? 0));
      } else if (drag.mode === "rotate") {
        setContainerCursor(ROTATE_CURSOR);
      } else if (drag.mode === "move") {
        setContainerCursor("move");
      }

      if (drag.mode === "move") {
        const dx = ptr.x - drag.startPointer.x;
        const dy = ptr.y - drag.startPointer.y;
        const next = clampLayoutPosition({
          ...drag.startLayout,
          x: drag.startLayout.x + dx,
          y: drag.startLayout.y + dy,
        });
        setLayoutForTarget(drag.target, next);
        return;
      }

      if (drag.mode === "resize" && drag.corner) {
        const draggedCorner = {
          x: ptr.x - drag.cornerOffset.x,
          y: ptr.y - drag.cornerOffset.y,
        };
        const next = softClampResize(
          resizeFromCorner(
            drag.startLayout,
            drag.anchorPct,
            draggedCorner,
            drag.corner,
            drag.containerW,
            drag.containerH,
            drag.startLdx,
            drag.startLdy,
          ),
        );
        setLayoutForTarget(drag.target, next);
        return;
      }

      if (drag.mode === "rotate") {
        const cxPx = ((drag.startLayout.x + drag.startLayout.width / 2) / 100) * drag.containerW;
        const cyPx = ((drag.startLayout.y + drag.startLayout.height / 2) / 100) * drag.containerH;
        const ptrPx = {
          x: (ptr.x / 100) * drag.containerW,
          y: (ptr.y / 100) * drag.containerH,
        };
        const angle = Math.atan2(ptrPx.y - cyPx, ptrPx.x - cxPx);
        const delta = ((angle - drag.startAngle) * 180) / Math.PI;
        const nextRotation = (drag.startLayout.rotation ?? 0) + delta;
        const next = {
          ...drag.startLayout,
          rotation: ((nextRotation % 360) + 360) % 360,
        };
        setLayoutForTarget(drag.target, next);
      }
    },
    [runHoverHitTest, setContainerCursor, setLayoutForTarget],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      const target = dragRef.current.target;
      const el = containerRef.current;
      if (el?.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      finishDrag(target, getLayoutForTarget(target));
    },
    [finishDrag, getLayoutForTarget],
  );

  const onPointerLeave = useCallback(
    (_e: PointerEvent) => {
      // With setPointerCapture, moves keep working outside the canvas — do NOT
      // end the drag here or resizing past the preview edge hits a fake size cap.
      if (dragRef.current) return;
      setContainerCursor("default");
    },
    [setContainerCursor],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [onPointerDown, onPointerMove, onPointerUp, onPointerLeave]);

  function setObjectFit(mode: ObjectFitMode) {
    const next = clampLayout({ ...mediaDraftRef.current, objectFit: mode });
    mediaDraftRef.current = next;
    setMediaDraft(next);
    onChange(next);
  }

  function toggleFlip(axis: "x" | "y") {
    const current = mediaDraftRef.current;
    const next = clampLayout({
      ...current,
      flipX: axis === "x" ? !current.flipX : current.flipX,
      flipY: axis === "y" ? !current.flipY : current.flipY,
    });
    mediaDraftRef.current = next;
    applyFlipToElement(flipInnerRef.current, next);
    setMediaDraft(next);
    onChange(next);
  }

  function fillScreen() {
    const current = mediaDraftRef.current;
    const next = clampLayout({
      ...current,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
    });
    mediaDraftRef.current = next;
    lastFlipRef.current = { flipX: next.flipX ?? false, flipY: next.flipY ?? false };
    applyMediaFrameLayout(mediaFrameRef.current, flipInnerRef.current, next, false);
    setMediaDraft(next);
    onChange(next);
  }

  const applyMediaLayoutFromKeyboard = useCallback(
    (next: MediaLayout) => {
      const clamped = clampLayout({
        ...next,
        objectFit: next.objectFit ?? mediaDraftRef.current.objectFit ?? "contain",
      });
      mediaDraftRef.current = clamped;
      lastFlipRef.current = { flipX: clamped.flipX ?? false, flipY: clamped.flipY ?? false };
      applyMediaFrameLayout(mediaFrameRef.current, flipInnerRef.current, clamped, false);
      setMediaDraft(clamped);
      onChange(clamped);
    },
    [onChange],
  );

  const applyCaptionLayoutFromKeyboard = useCallback(
    (next: CaptionLayout) => {
      if (!onCaptionLayoutChange) return;
      const clamped = clampCaptionLayout(next);
      captionDraftRef.current = clamped;
      applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(clamped));
      setCaptionDraft(clamped);
      onCaptionLayoutChange(clamped);
    },
    [onCaptionLayoutChange],
  );

  const onCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = activeTarget ?? "media";
      if (target === "caption" && captionDraftRef.current && onCaptionLayoutChange) {
        handleCaptionLayoutKeyboardEvent(e, captionDraftRef.current, (next) => {
          applyCaptionLayoutFromKeyboard(next);
          setKeyboardAnnouncement(describeLayoutChange(next));
        });
        return;
      }
      handleLayoutKeyboardEvent(e, mediaDraftRef.current, (next) => {
        applyMediaLayoutFromKeyboard(next);
        setKeyboardAnnouncement(describeLayoutChange(next));
      });
    },
    [activeTarget, applyCaptionLayoutFromKeyboard, applyMediaLayoutFromKeyboard, onCaptionLayoutChange],
  );

  const isFullScreen =
    Math.abs(mediaDraft.x) < 0.5 &&
    Math.abs(mediaDraft.y) < 0.5 &&
    Math.abs(mediaDraft.width - 100) < 0.5 &&
    Math.abs(mediaDraft.height - 100) < 0.5;

  function handleStyle(corner: Corner, highlighted: boolean): React.CSSProperties {
    const ls = CORNER_LOCAL[corner];
    const inset = HANDLE_SIZE_PX / 2;

    return {
      position: "absolute",
      width: HANDLE_SIZE_PX,
      height: HANDLE_SIZE_PX,
      left: ls.x < 0 ? -inset : undefined,
      right: ls.x > 0 ? -inset : undefined,
      top: ls.y < 0 ? -inset : undefined,
      bottom: ls.y > 0 ? -inset : undefined,
      background: highlighted ? "#fff" : "#60a5fa",
      border: "2px solid #2563eb",
      borderRadius: 2,
      pointerEvents: "none",
      zIndex: 2,
    };
  }

  function captionHandleStyle(corner: Corner, highlighted: boolean): React.CSSProperties {
    const base = handleStyle(corner, highlighted);
    return {
      ...base,
      background: highlighted ? "#fff" : "#fbbf24",
      border: "2px solid #f59e0b",
    };
  }

  if (isAudio) return null;

  const canvas = (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label="Ping preview layout"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - [ ]"
      onKeyDown={onCanvasKeyDown}
      className={`layout-canvas overflow-hidden bg-[rgb(3_3_4)] touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-brand-400/40 ${
        large ? "border-0" : "relative w-full border border-white/[0.08] preview-frame-16x9"
      }`}
      style={{ cursor: "default" }}
    >
      <div
        className="preview-grid pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "linear-gradient(#64748b 1px, transparent 1px), linear-gradient(90deg, #64748b 1px, transparent 1px)",
          backgroundSize: "10% 10%",
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-600">
        Friend&apos;s screen
      </div>

      {showCaption && (
        <span
          ref={captionMeasureRef}
          className="meme-caption-measurer"
          style={memeCaptionTextStyle(captionDraft?.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT)}
          aria-hidden
        >
          {captionText}
        </span>
      )}

      <div
        ref={mediaFrameRef}
        className="media-frame-shell absolute border-2 border-brand-400"
        style={{ ...FRAME_SHELL_STYLE, zIndex: 1 }}
      >
        <div ref={flipInnerRef} className="preview-inner h-full w-full">
          <PreviewMedia
            previewUrl={previewUrl}
            isVideo={isVideo}
            objectFit={objectFit}
            videoRef={videoRef}
          />
        </div>
        {activeTarget === "media" &&
          (["tl", "tr", "br", "bl"] as Corner[]).map((corner) => (
            <button
              key={corner}
              type="button"
              data-handle="1"
              tabIndex={0}
              aria-label={`Resize ${CORNER_LABELS[corner]}`}
              style={{ ...handleStyle(corner, activeCorner === corner), pointerEvents: "none" }}
            />
          ))}
      </div>

      {showCaption && captionDraft && (
        <div
          ref={captionFrameRef}
          className="absolute border-2 border-amber-400/90"
          style={{ ...FRAME_SHELL_STYLE, zIndex: 10 }}
        >
          <ScaledMemeCaption
            text={captionText}
            fontSizePct={captionDraft.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT}
          />
          {activeTarget === "caption" &&
            (["tl", "tr", "br", "bl"] as Corner[]).map((corner) => (
              <button
                key={corner}
                type="button"
                data-handle="1"
                tabIndex={0}
                aria-label={`Resize caption ${CORNER_LABELS[corner]}`}
                style={{ ...captionHandleStyle(corner, activeCorner === corner), pointerEvents: "none" }}
              />
            ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {keyboardAnnouncement}
      </p>
    </div>
  );

  const layoutControls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="pill-group !gap-0.5 !p-0.5">
        <button
          type="button"
          onClick={() => setObjectFit("contain")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${objectFit === "contain" ? "pill-btn-active" : ""}`}
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => setObjectFit("fill")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${objectFit === "fill" ? "pill-btn-active" : ""}`}
        >
          Stretch
        </button>
      </div>
      <div className="pill-group !gap-0.5 !p-0.5">
        <button
          type="button"
          onClick={() => toggleFlip("x")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${mediaDraft.flipX ? "pill-btn-active" : ""}`}
        >
          Flip H
        </button>
        <button
          type="button"
          onClick={() => toggleFlip("y")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${mediaDraft.flipY ? "pill-btn-active" : ""}`}
        >
          Flip V
        </button>
      </div>
      <button
        type="button"
        onClick={fillScreen}
        title="Fill the friend's screen"
        className={`pill-btn !rounded-lg !px-2 !py-0.5 !text-xs ${
          isFullScreen ? "pill-btn-active" : ""
        }`}
      >
        Fullscreen
      </button>
    </div>
  );

  return (
    <div className={large ? "compose-preview-editor h-full w-full" : "w-full"}>
      {large ? (
        <div
          className="compose-preview-editor compose-preview-editor--large h-full w-full"
          onPointerMove={onEditorPointerMove}
          onPointerLeave={hideChromeNow}
        >
          <div ref={stageRef} className="compose-preview-frame h-full w-full">
            {canvas}
          </div>
          {showFloatingChrome ? (
            <div className={`compose-preview-chrome-zone${chromeVisible ? " is-open" : ""}`}>
              <div className="compose-preview-chrome compose-preview-chrome--floating">
                {layoutControls}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs text-slate-400">Preview — friend&apos;s screen</label>
          </div>
          {canvas}
        </>
      )}

      {showBelowControls ? <div className="compose-preview-mobile-controls">{layoutControls}</div> : null}

      {!large ? (
        <>
          <p className="mt-1 text-[11px] text-slate-500">
            Drag to move · corners to resize · outside corner to rotate
            {showCaption && " · caption is always on top"}
          </p>
          <div className="mt-2">{layoutControls}</div>
        </>
      ) : null}
    </div>
  );
}

export default memo(MediaLayoutEditor);
