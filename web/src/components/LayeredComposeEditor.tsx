import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CaptionLayout, MediaLayout, ObjectFitMode } from "../../../shared/types";
import {
  clampCaptionLayout,
  clampLayout,
  DEFAULT_CAPTION_FONT_SIZE_PCT,
  captionLayoutToMedia,
} from "../../../shared/types";
import { flipStyle, layerShellStyle } from "../../../shared/layerTransform";
import ScaledMemeCaption from "../../../shared/ScaledMemeCaption";
import MemeCaption from "../../../shared/MemeCaption";
import { memeCaptionTextStyle } from "../../../shared/memeCaptionStyle";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { EditorImageLayer } from "../lib/imageLayers";
import { sortLayersByZ } from "../lib/imageLayers";
import {
  clampDragLayout,
  CORNER_LOCAL,
  cursorForHit,
  getCornerPct,
  HANDLE_SIZE_PX,
  hitTestCaption,
  hitTestImageLayer,
  mediaClass,
  OPPOSITE,
  pointerPctFromRect,
  rectFromDom,
  resizeFromCorner,
  applyObjectFitToMedia,
  resolvedObjectFit,
  softClampResize,
  type Corner,
  type DragState,
  type LayerTarget,
} from "../lib/layoutEditorMath";
import {
  describeLayoutChange,
  handleCaptionLayoutKeyboardEvent,
  handleLayoutKeyboardEvent,
} from "../lib/layoutKeyboard";

interface LayeredComposeEditorProps {
  layers: EditorImageLayer[];
  activeLayerId: string | null;
  onLayersChange: (layers: EditorImageLayer[]) => void;
  onActiveLayerChange: (id: string | null) => void;
  caption?: string;
  captionLayout?: CaptionLayout;
  onCaptionLayoutChange?: (layout: CaptionLayout) => void;
  large?: boolean;
}

const CORNER_LABELS: Record<Corner, string> = {
  tl: "top-left",
  tr: "top-right",
  br: "bottom-right",
  bl: "bottom-left",
};

const FRAME_SHELL: React.CSSProperties = {
  position: "absolute",
  transformOrigin: "center center",
  boxSizing: "border-box",
};

function handleStyle(corner: Corner, highlighted: boolean, tone: "brand" | "amber"): React.CSSProperties {
  const ls = CORNER_LOCAL[corner];
  return {
    position: "absolute",
    width: HANDLE_SIZE_PX,
    height: HANDLE_SIZE_PX,
    left: ls.x < 0 ? 0 : undefined,
    right: ls.x > 0 ? 0 : undefined,
    top: ls.y < 0 ? 0 : undefined,
    bottom: ls.y > 0 ? 0 : undefined,
    background: highlighted ? "#fff" : tone === "brand" ? "#60a5fa" : "#fbbf24",
    boxShadow: `inset 0 0 0 2px ${tone === "brand" ? "#2563eb" : "#f59e0b"}`,
    borderRadius: 2,
    pointerEvents: "none",
    zIndex: 3,
  };
}

function applyLayoutToElement(el: HTMLElement | null, layout: MediaLayout) {
  if (!el) return;
  el.style.left = `${layout.x}%`;
  el.style.top = `${layout.y}%`;
  el.style.width = `${layout.width}%`;
  el.style.height = `${layout.height}%`;
  el.style.transform = `rotate(${layout.rotation ?? 0}deg)`;
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

function applyMediaFrameLayout(
  shell: HTMLElement | null,
  flipInner: HTMLElement | null,
  layout: MediaLayout,
  syncFlip = true,
) {
  if (!shell) return;
  shell.style.left = `${layout.x}%`;
  shell.style.top = `${layout.y}%`;
  shell.style.width = `${layout.width}%`;
  shell.style.height = `${layout.height}%`;
  shell.style.transform = `rotate(${layout.rotation ?? 0}deg)`;
  if (syncFlip) applyFlipToElement(flipInner, layout);
  applyObjectFitToMedia(flipInner ?? shell, layout.objectFit);
}

function LayerMoveGrip() {
  return (
    <div className="layer-move-grip pointer-events-none absolute left-1 top-1/2 z-[3] flex -translate-y-1/2 flex-col items-center gap-[3px]" aria-hidden>
      <span className="block h-[4px] w-[4px] rounded-full bg-brand-200" />
      <span className="block h-[4px] w-[4px] rounded-full bg-brand-200" />
      <span className="block h-[4px] w-[4px] rounded-full bg-brand-200" />
    </div>
  );
}

function LayeredComposeEditor({
  layers,
  activeLayerId,
  onLayersChange,
  onActiveLayerChange,
  caption,
  captionLayout,
  onCaptionLayoutChange,
  large = false,
}: LayeredComposeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const captionFrameRef = useRef<HTMLDivElement>(null);
  const captionMeasureRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const layerDraftRef = useRef<Record<string, MediaLayout>>({});
  const captionDraftRef = useRef(captionLayout);
  const frameRefs = useRef(new Map<string, HTMLDivElement>());
  const flipRefs = useRef(new Map<string, HTMLDivElement>());
  const selectOverlayRef = useRef<HTMLDivElement>(null);
  const bgPreviewLayerRef = useRef<string | null>(null);
  const layersRef = useRef(layers);
  const hoverRafRef = useRef(0);
  const applyRafRef = useRef(0);
  const hoverPointerRef = useRef({ x: 0, y: 0 });
  const pendingLayoutRef = useRef<{ target: LayerTarget; layout: MediaLayout } | null>(null);
  const skipLayersSyncRef = useRef(false);
  const chromeHideTimerRef = useRef(0);
  const chromeVisibleRef = useRef(false);
  const activeLayerIdRef = useRef(activeLayerId);
  const handlerBag = useRef({
    onPointerDown: (_e: PointerEvent) => {},
    onPointerMove: (_e: PointerEvent) => {},
    onPointerUp: (_e: PointerEvent) => {},
  });

  const [captionDraft, setCaptionDraft] = useState(captionLayout);
  const [activeTarget, setActiveTarget] = useState<LayerTarget | null>(null);
  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  const xlUp = useMediaQuery("(min-width: 1280px)");
  const showFloatingChrome = large && xlUp;
  const showBelowControls = large && !xlUp;

  const captionText = caption?.trim() ?? "";
  const showCaption = Boolean(captionText && captionLayout && onCaptionLayoutChange);
  const sortedLayers = sortLayersByZ(layers);
  const activeLayer =
    sortedLayers.find((layer) => layer.id === activeLayerId) ?? sortedLayers[sortedLayers.length - 1] ?? null;

  layersRef.current = layers;
  captionDraftRef.current = captionDraft;
  activeLayerIdRef.current = activeLayerId;
  chromeVisibleRef.current = chromeVisible;

  useEffect(() => {
    if (!dragRef.current) setCaptionDraft(captionLayout);
  }, [captionLayout]);

  useLayoutEffect(() => {
    if (captionDraftRef.current) {
      applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(captionDraftRef.current));
    }
  }, []);

  useEffect(() => {
    if (dragRef.current) return;
    if (skipLayersSyncRef.current) {
      skipLayersSyncRef.current = false;
      return;
    }
    for (const layer of layers) {
      const shell = frameRefs.current.get(layer.id) ?? null;
      const flip = flipRefs.current.get(layer.id) ?? null;
      applyMediaFrameLayout(shell, flip, layer.layout, true);
    }
  }, [layers]);

  useLayoutEffect(() => {
    if (!activeLayer) return;
    if (dragRef.current?.target === activeLayer.id) return;
    applyLayoutToElement(selectOverlayRef.current, activeLayer.layout);
  }, [activeLayer]);

  function applyLayerDom(id: string, layout: MediaLayout) {
    applyMediaFrameLayout(frameRefs.current.get(id) ?? null, flipRefs.current.get(id) ?? null, layout, true);
    if (id === activeLayerIdRef.current) {
      applyLayoutToElement(selectOverlayRef.current, layout);
    }
  }

  function enableDragPreview(layerId: string) {
    frameRefs.current.get(layerId)?.classList.add("is-drag-layer");
    containerRef.current?.classList.add("is-dragging");
    bgPreviewLayerRef.current = layerId;
  }

  function disableDragPreview() {
    const layerId = bgPreviewLayerRef.current;
    if (layerId) frameRefs.current.get(layerId)?.classList.remove("is-drag-layer");
    bgPreviewLayerRef.current = null;
    containerRef.current?.classList.remove("is-dragging");
  }

  function getLayoutForTarget(target: LayerTarget): MediaLayout {
    if (target === "caption" && captionDraftRef.current) {
      return captionLayoutToMedia(captionDraftRef.current);
    }
    if (typeof target === "string") {
      const live = layersRef.current.find((layer) => layer.id === target)?.layout;
      const draft = layerDraftRef.current[target];
      if (draft) {
        return {
          ...draft,
          objectFit:
            draft.objectFit === "fill" || live?.objectFit === "fill"
              ? "fill"
              : resolvedObjectFit(draft, live?.objectFit),
        };
      }
      return live ?? clampLayout({});
    }
    return clampLayout({});
  }

  function setLayoutForTarget(target: LayerTarget, next: MediaLayout) {
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
      applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(captionNext));
      return;
    }
    if (typeof target === "string") {
      const live = layersRef.current.find((layer) => layer.id === target)?.layout;
      layerDraftRef.current[target] = {
        ...next,
        objectFit: next.objectFit === "fill" || live?.objectFit === "fill" ? "fill" : resolvedObjectFit(next, live?.objectFit),
      };
      applyLayerDom(target, layerDraftRef.current[target]);
    }
  }

  function finishDrag(target: LayerTarget, next: MediaLayout) {
    if (applyRafRef.current) {
      cancelAnimationFrame(applyRafRef.current);
      applyRafRef.current = 0;
    }
    pendingLayoutRef.current = null;
    if (typeof target === "string") {
      const prevFit = layersRef.current.find((layer) => layer.id === target)?.layout.objectFit;
      const fit = next.objectFit === "fill" || prevFit === "fill" ? "fill" : resolvedObjectFit(next, prevFit);
      applyLayerDom(target, clampDragLayout({ ...next, objectFit: fit }));
    }
    dragRef.current = null;
    disableDragPreview();
    if (containerRef.current) containerRef.current.style.cursor = "default";

    if (target === "caption") {
      const clamped = clampCaptionLayout({
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        rotation: next.rotation,
        fontSizePct: captionDraftRef.current?.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT,
      });
      setCaptionDraft(clamped);
      captionDraftRef.current = clamped;
      applyLayoutToElement(captionFrameRef.current, captionLayoutToMedia(clamped));
      onCaptionLayoutChange?.(clamped);
      return;
    }

    if (typeof target === "string") {
      const prev = layersRef.current.find((layer) => layer.id === target)?.layout;
      const clamped = clampDragLayout({
        ...next,
        objectFit: next.objectFit === "fill" || prev?.objectFit === "fill" ? "fill" : resolvedObjectFit(next, prev?.objectFit),
      });
      delete layerDraftRef.current[target];
      if (
        prev &&
        prev.x === clamped.x &&
        prev.y === clamped.y &&
        prev.width === clamped.width &&
        prev.height === clamped.height &&
        (prev.rotation ?? 0) === (clamped.rotation ?? 0) &&
        resolvedObjectFit(prev) === clamped.objectFit
      ) {
        return;
      }
      skipLayersSyncRef.current = true;
      onLayersChange(
        layersRef.current.map((layer) => (layer.id === target ? { ...layer, layout: clamped } : layer)),
      );
    }
  }

  function pickLayerAt(pxPct: number, pyPct: number, cw: number, ch: number): string | null {
    const current = sortLayersByZ(layersRef.current);
    for (let i = current.length - 1; i >= 0; i--) {
      const layer = current[i];
      if (layer.locked) continue;
      if (hitTestImageLayer(layer.layout, pxPct, pyPct, cw, ch).mode !== "none") return layer.id;
    }
    return null;
  }

  function hitActiveLayerHandles(
    pxPct: number,
    pyPct: number,
    cw: number,
    ch: number,
  ): { layerId: string; layout: MediaLayout; hit: { mode: "resize" | "rotate"; corner?: Corner } } | null {
    const id = activeLayerIdRef.current;
    if (!id) return null;
    const layer = layersRef.current.find((item) => item.id === id);
    if (!layer || layer.locked) return null;
    // Never start a resize from a leftover drag draft — it can still have
    // the previous objectFit (Stretch → Fit) after the user changed Fit/Stretch.
    const layout = layer.layout;
    const hit = hitTestImageLayer(layout, pxPct, pyPct, cw, ch);
    if (hit.mode !== "resize" && hit.mode !== "rotate") return null;
    return { layerId: id, layout, hit: { mode: hit.mode, corner: hit.corner } };
  }

  handlerBag.current.onPointerDown = (e: PointerEvent) => {
    const el = containerRef.current;
    if (!el || e.button !== 0) return;
    hideChromeNow();
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const containerRect = rectFromDom(rect);
    const ptr = pointerPctFromRect(e.clientX, e.clientY, containerRect);
    const cw = rect.width;
    const ch = rect.height;

    if (showCaption && captionDraftRef.current) {
      const capHit = hitTestCaption(captionDraftRef.current, ptr.x, ptr.y, cw, ch);
      if (capHit.mode !== "none") {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        dragRef.current = buildDragState("caption", capHit, ptr, captionLayoutToMedia(captionDraftRef.current), containerRect, cw, ch);
        setActiveTarget("caption");
        setActiveCorner(capHit.corner ?? null);
        return;
      }
    }

    const handleHit = hitActiveLayerHandles(ptr.x, ptr.y, cw, ch);
    if (handleHit) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const liveLayout = {
        ...handleHit.layout,
        objectFit: resolvedObjectFit(handleHit.layout),
      };
      layerDraftRef.current[handleHit.layerId] = liveLayout;
      dragRef.current = buildDragState(handleHit.layerId, handleHit.hit, ptr, liveLayout, containerRect, cw, ch);
      setActiveTarget(handleHit.layerId);
      setActiveCorner(handleHit.hit.corner ?? null);
      return;
    }

    const layerId = pickLayerAt(ptr.x, ptr.y, cw, ch);
    if (!layerId) {
      if (activeLayerIdRef.current) onActiveLayerChange(null);
      return;
    }

    const layer = layersRef.current.find((item) => item.id === layerId);
    if (!layer || layer.locked) return;

    if (activeLayerIdRef.current !== layerId) onActiveLayerChange(layerId);
    const liveLayout = { ...layer.layout, objectFit: resolvedObjectFit(layer.layout) };
    layerDraftRef.current[layerId] = liveLayout;
    const hit = hitTestImageLayer(liveLayout, ptr.x, ptr.y, cw, ch);
    if (hit.mode === "none") return;

    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragRef.current = buildDragState(layerId, hit, ptr, liveLayout, containerRect, cw, ch);
  };

  handlerBag.current.onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current;

    if (!drag) {
      hoverPointerRef.current = { x: e.clientX, y: e.clientY };
      if (hoverRafRef.current) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = 0;
        const canvas = containerRef.current;
        if (!canvas || dragRef.current) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const { x: clientX, y: clientY } = hoverPointerRef.current;
        const ptr = pointerPctFromRect(clientX, clientY, rectFromDom(rect));
        const hoverCw = rect.width;
        const hoverCh = rect.height;

        let cursor = "default";
        if (showCaption && captionDraftRef.current) {
          const capHit = hitTestCaption(captionDraftRef.current, ptr.x, ptr.y, hoverCw, hoverCh);
          if (capHit.mode !== "none") {
            canvas.style.cursor = cursorForHit(capHit, captionDraftRef.current.rotation ?? 0);
            return;
          }
        }
        const handleHit = hitActiveLayerHandles(ptr.x, ptr.y, hoverCw, hoverCh);
        if (handleHit) {
          canvas.style.cursor = cursorForHit(handleHit.hit, handleHit.layout.rotation ?? 0);
          return;
        }
        const hoverId = pickLayerAt(ptr.x, ptr.y, hoverCw, hoverCh);
        if (hoverId) {
          const layer = layersRef.current.find((item) => item.id === hoverId);
          if (layer) {
            const hit = hitTestImageLayer(layer.layout, ptr.x, ptr.y, hoverCw, hoverCh);
            cursor = cursorForHit(hit, layer.layout.rotation ?? 0);
          }
        }
        canvas.style.cursor = cursor;
      });
      return;
    }

    e.preventDefault();
    const ptr = pointerPctFromRect(e.clientX, e.clientY, drag.containerRect);
    if (
      typeof drag.target === "string" &&
      !bgPreviewLayerRef.current &&
      (Math.abs(ptr.x - drag.startPointer.x) > 0.15 || Math.abs(ptr.y - drag.startPointer.y) > 0.15)
    ) {
      enableDragPreview(drag.target);
    }
    const cw = drag.containerW;
    const ch = drag.containerH;
    const startLayout = drag.startLayout;
    let next = startLayout;

    if (drag.mode === "move") {
      next = clampDragLayout({
        ...startLayout,
        x: startLayout.x + (ptr.x - drag.startPointer.x),
        y: startLayout.y + (ptr.y - drag.startPointer.y),
      });
    } else if (drag.mode === "resize" && drag.corner) {
      next = softClampResize(
        resizeFromCorner(
          startLayout,
          drag.anchorPct,
          { x: ptr.x - drag.cornerOffset.x, y: ptr.y - drag.cornerOffset.y },
          drag.corner,
          cw,
          ch,
          drag.startLdx,
          drag.startLdy,
        ),
      );
    } else if (drag.mode === "rotate") {
      const cxPx = ((startLayout.x + startLayout.width / 2) / 100) * cw;
      const cyPx = ((startLayout.y + startLayout.height / 2) / 100) * ch;
      const ptrPx = { x: (ptr.x / 100) * cw, y: (ptr.y / 100) * ch };
      const angle = Math.atan2(ptrPx.y - cyPx, ptrPx.x - cxPx);
      const delta = ((angle - drag.startAngle) * 180) / Math.PI;
      next = { ...startLayout, rotation: ((startLayout.rotation ?? 0) + delta + 360) % 360 };
    }

    pendingLayoutRef.current = { target: drag.target, layout: next };
    if (drag.target === "caption" && captionDraftRef.current) {
      captionDraftRef.current = {
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        rotation: next.rotation,
        fontSizePct: captionDraftRef.current.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT,
      };
    } else if (typeof drag.target === "string") {
      layerDraftRef.current[drag.target] = next;
    }
    if (applyRafRef.current) return;
    applyRafRef.current = requestAnimationFrame(() => {
      applyRafRef.current = 0;
      const pending = pendingLayoutRef.current;
      if (!pending || !dragRef.current) return;
      setLayoutForTarget(pending.target, pending.layout);
    });
  };

  handlerBag.current.onPointerUp = (e: PointerEvent) => {
    if (!dragRef.current) return;
    const target = dragRef.current.target;
    const el = containerRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (applyRafRef.current) {
      cancelAnimationFrame(applyRafRef.current);
      applyRafRef.current = 0;
    }
    const pending = pendingLayoutRef.current;
    if (pending) setLayoutForTarget(pending.target, pending.layout);
    finishDrag(target, getLayoutForTarget(target));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const down = (e: PointerEvent) => handlerBag.current.onPointerDown(e);
    const move = (e: PointerEvent) => handlerBag.current.onPointerMove(e);
    const up = (e: PointerEvent) => handlerBag.current.onPointerUp(e);

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
      if (applyRafRef.current) cancelAnimationFrame(applyRafRef.current);
    };
  }, []);

  function setObjectFit(mode: ObjectFitMode) {
    if (!activeLayer) return;
    delete layerDraftRef.current[activeLayer.id];
    onLayersChange(
      layers.map((layer) =>
        layer.id === activeLayer.id ? { ...layer, layout: clampLayout({ ...layer.layout, objectFit: mode }) } : layer,
      ),
    );
  }

  function toggleFlip(axis: "x" | "y") {
    if (!activeLayer) return;
    delete layerDraftRef.current[activeLayer.id];
    onLayersChange(
      layers.map((layer) =>
        layer.id === activeLayer.id
          ? {
              ...layer,
              layout: clampLayout({
                ...layer.layout,
                flipX: axis === "x" ? !layer.layout.flipX : layer.layout.flipX,
                flipY: axis === "y" ? !layer.layout.flipY : layer.layout.flipY,
              }),
            }
          : layer,
      ),
    );
  }

  function fillScreen() {
    if (!activeLayer) return;
    delete layerDraftRef.current[activeLayer.id];
    onLayersChange(
      layers.map((layer) =>
        layer.id === activeLayer.id
          ? { ...layer, layout: clampLayout({ ...layer.layout, x: 0, y: 0, width: 100, height: 100, rotation: 0 }) }
          : layer,
      ),
    );
  }

  const applyActiveLayerLayoutFromKeyboard = useCallback(
    (next: MediaLayout) => {
      if (!activeLayer) return;
      const clamped = clampLayout(next);
      delete layerDraftRef.current[activeLayer.id];
      applyLayoutToElement(selectOverlayRef.current, clamped);
      onLayersChange(
        layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, layout: clamped } : layer)),
      );
    },
    [activeLayer, layers, onLayersChange],
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
      if (activeTarget === "caption" && captionDraftRef.current && onCaptionLayoutChange) {
        handleCaptionLayoutKeyboardEvent(e, captionDraftRef.current, (next) => {
          applyCaptionLayoutFromKeyboard(next);
          setKeyboardAnnouncement(describeLayoutChange(next));
        });
        return;
      }
      if (!activeLayer) return;
      handleLayoutKeyboardEvent(e, activeLayer.layout, (next) => {
        applyActiveLayerLayoutFromKeyboard(next);
        setKeyboardAnnouncement(describeLayoutChange(next));
      });
    },
    [activeLayer, activeTarget, applyActiveLayerLayoutFromKeyboard, applyCaptionLayoutFromKeyboard, onCaptionLayoutChange],
  );

  const objectFit = activeLayer?.layout.objectFit ?? "contain";
  const isFullScreen = Boolean(
    activeLayer &&
      Math.abs(activeLayer.layout.x) < 0.5 &&
      Math.abs(activeLayer.layout.y) < 0.5 &&
      Math.abs(activeLayer.layout.width - 100) < 0.5 &&
      Math.abs(activeLayer.layout.height - 100) < 0.5,
  );
  const CHROME_TOP_BAND_PX = 48;

  function revealChrome() {
    if (chromeHideTimerRef.current) {
      window.clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = 0;
    }
    if (chromeVisibleRef.current) return;
    chromeVisibleRef.current = true;
    setChromeVisible(true);
  }

  function hideChromeNow() {
    if (chromeHideTimerRef.current) {
      window.clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = 0;
    }
    if (!chromeVisibleRef.current) return;
    chromeVisibleRef.current = false;
    setChromeVisible(false);
  }

  function scheduleChromeHide() {
    if (!chromeVisibleRef.current || chromeHideTimerRef.current) return;
    chromeHideTimerRef.current = window.setTimeout(() => {
      chromeHideTimerRef.current = 0;
      chromeVisibleRef.current = false;
      setChromeVisible(false);
    }, 40);
  }

  function onEditorPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const overChrome = e.target instanceof Element && Boolean(e.target.closest(".compose-preview-chrome"));
    if (overChrome || (x >= 0 && x <= rect.width && y >= 0 && y <= CHROME_TOP_BAND_PX)) {
      revealChrome();
      return;
    }
    scheduleChromeHide();
  }

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

      {sortedLayers.map((layer) => {
        const fit = layer.layout.objectFit ?? "contain";
        return (
          <div
            key={layer.id}
            ref={(el) => {
              if (el) frameRefs.current.set(layer.id, el);
              else frameRefs.current.delete(layer.id);
            }}
            className="media-frame-shell absolute"
            style={{ ...layerShellStyle(layer.layout, layer.zIndex + 1), overflow: "visible" }}
          >
            <div
              ref={(el) => {
                if (el) flipRefs.current.set(layer.id, el);
                else flipRefs.current.delete(layer.id);
              }}
              className="preview-inner h-full w-full overflow-hidden"
              style={{ ...flipStyle(layer.layout), opacity: layer.opacity }}
            >
              <img
                src={layer.previewUrl}
                alt={layer.name}
                className={mediaClass(fit)}
                style={{ objectFit: fit }}
                draggable={false}
                loading="eager"
              />
            </div>
          </div>
        );
      })}

      {activeLayer && (
        <div
          ref={selectOverlayRef}
          className="pointer-events-none absolute overflow-visible"
          style={{ ...layerShellStyle(activeLayer.layout, 50), overflow: "visible" }}
        >
          <div className="layer-select-ring absolute inset-0" aria-hidden />
          <LayerMoveGrip />
          {(["tl", "tr", "br", "bl"] as Corner[]).map((corner) => (
            <button
              key={corner}
              type="button"
              data-handle="1"
              tabIndex={0}
              aria-label={`Resize ${CORNER_LABELS[corner]}`}
              style={{ ...handleStyle(corner, false, "brand"), pointerEvents: "none" }}
            />
          ))}
        </div>
      )}

      {showCaption && captionDraft && (
        <div
          ref={captionFrameRef}
          className="absolute border-2 border-amber-400/90"
          style={{ ...FRAME_SHELL, ...layerShellStyle(captionLayoutToMedia(captionDraft), 20) }}
        >
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <MemeCaption text={captionText} fontSizePct={captionDraft.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT} />
          </div>
          <ScaledMemeCaption text={captionText} fontSizePct={captionDraft.fontSizePct ?? DEFAULT_CAPTION_FONT_SIZE_PCT} />
          {activeTarget === "caption" &&
            (["tl", "tr", "br", "bl"] as Corner[]).map((corner) => (
              <button
                key={corner}
                type="button"
                data-handle="1"
                tabIndex={0}
                aria-label={`Resize caption ${CORNER_LABELS[corner]}`}
                style={{ ...handleStyle(corner, activeCorner === corner, "amber"), pointerEvents: "none" }}
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
          disabled={!activeLayer}
          onClick={() => setObjectFit("contain")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${objectFit === "contain" ? "pill-btn-active" : ""}`}
        >
          Fit
        </button>
        <button
          type="button"
          disabled={!activeLayer}
          onClick={() => setObjectFit("fill")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${objectFit === "fill" ? "pill-btn-active" : ""}`}
        >
          Stretch
        </button>
      </div>
      <div className="pill-group !gap-0.5 !p-0.5">
        <button
          type="button"
          disabled={!activeLayer}
          onClick={() => toggleFlip("x")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${activeLayer?.layout.flipX ? "pill-btn-active" : ""}`}
        >
          Flip H
        </button>
        <button
          type="button"
          disabled={!activeLayer}
          onClick={() => toggleFlip("y")}
          className={`pill-btn !px-2 !py-0.5 !text-xs ${activeLayer?.layout.flipY ? "pill-btn-active" : ""}`}
        >
          Flip V
        </button>
      </div>
      <button
        type="button"
        disabled={!activeLayer}
        onClick={fillScreen}
        className={`pill-btn !rounded-lg !px-2 !py-0.5 !text-xs ${isFullScreen ? "pill-btn-active" : ""}`}
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
          <div className="compose-preview-frame h-full w-full">{canvas}</div>
          {showFloatingChrome ? (
            <div className={`compose-preview-chrome-zone${chromeVisible ? " is-open" : ""}`}>
              <div className="compose-preview-chrome compose-preview-chrome--floating">{layoutControls}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {canvas}
          <div className="mt-2">{layoutControls}</div>
        </>
      )}
      {showBelowControls ? <div className="compose-preview-mobile-controls">{layoutControls}</div> : null}
    </div>
  );
}

function buildDragState(
  target: LayerTarget,
  hit: { mode: DragState["mode"]; corner?: Corner },
  ptr: { x: number; y: number },
  startLayout: MediaLayout,
  containerRect: DragState["containerRect"],
  cw: number,
  ch: number,
): DragState {
  let anchorPct = { x: 0, y: 0 };
  let cornerOffset = { x: 0, y: 0 };
  let startLdx = 0;
  let startLdy = 0;
  let startAngle = 0;

  if (hit.mode === "resize" && hit.corner) {
    const opp = OPPOSITE[hit.corner];
    anchorPct = getCornerPct(startLayout, opp, cw, ch);
    const cornerPct = getCornerPct(startLayout, hit.corner, cw, ch);
    cornerOffset = { x: ptr.x - cornerPct.x, y: ptr.y - cornerPct.y };
    const anchorPx = { x: (anchorPct.x / 100) * cw, y: (anchorPct.y / 100) * ch };
    const ptrPx = { x: (ptr.x / 100) * cw, y: (ptr.y / 100) * ch };
    const rad = -((startLayout.rotation ?? 0) * Math.PI) / 180;
    const dx = ptrPx.x - anchorPx.x;
    const dy = ptrPx.y - anchorPx.y;
    startLdx = dx * Math.cos(rad) - dy * Math.sin(rad);
    startLdy = dx * Math.sin(rad) + dy * Math.cos(rad);
  }

  if (hit.mode === "rotate") {
    const cxPx = ((startLayout.x + startLayout.width / 2) / 100) * cw;
    const cyPx = ((startLayout.y + startLayout.height / 2) / 100) * ch;
    const ptrPx = { x: (ptr.x / 100) * cw, y: (ptr.y / 100) * ch };
    startAngle = Math.atan2(ptrPx.y - cyPx, ptrPx.x - cxPx);
  }

  return {
    target,
    mode: hit.mode,
    corner: hit.corner,
    startPointer: ptr,
    startAngle,
    startLayout,
    anchorPct,
    cornerOffset,
    startLdx,
    startLdy,
    containerW: cw,
    containerH: ch,
    containerRect,
  };
}

export default memo(LayeredComposeEditor);
