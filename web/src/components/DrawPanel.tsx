import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import type { Friend, User } from "../lib/api";
import { pointerPctFromRect, rectFromDom } from "../lib/layoutEditorMath";
import {
  emitDrawStroke,
  endDrawSession,
  startDrawSession,
  type DrawPoint,
} from "../lib/socket";
import {
  assignMissingTimestamps,
  concatStrokePoints,
  paintTrailStrokes,
  pruneDeadStrokes,
  strokesStillAlive,
  type TimedPoint,
  type TrailStroke,
} from "../../../shared/drawFade";
import {
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
} from "../../../shared/types";
import FriendPicker from "./FriendPicker";
import PrecisionSlider from "./PrecisionSlider";
import ColorWheelPicker from "./ColorWheelPicker";
import ComposeColumnGlows from "./ComposeColumnGlows";

const DEFAULT_COLOR = "#8b5cf6";
const DEFAULT_WIDTH = 0.9;
const MIN_BRUSH_WIDTH = 0.15;
const MAX_BRUSH_WIDTH = 8;
/** Vertical pixels for a 2× / ½ brush size change (Photoshop-style). */
const BRUSH_RESIZE_HALF_LIFE_PX = 110;
/** Fixed ring box — size changes via scale so the preview stays sub-pixel smooth. */
const BRUSH_RING_BASE_PX = 64;

function clampBrushWidth(value: number) {
  return Math.min(MAX_BRUSH_WIDTH, Math.max(MIN_BRUSH_WIDTH, value));
}

function roundBrushWidth(value: number) {
  return Math.round(clampBrushWidth(value) * 100) / 100;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
}

function makeSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface DrawPanelProps {
  friends: Friend[];
  currentUser: User | null;
}

export default function DrawPanel({ friends, currentUser }: DrawPanelProps) {
  const [receiverIds, setReceiverIds] = useState<string[]>([]);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [status, setStatus] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const receiverIdsRef = useRef(receiverIds);
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  const durationRef = useRef(durationMs);
  const pendingPointsRef = useRef<DrawPoint[]>([]);
  const lastSentRef = useRef<TimedPoint | null>(null);
  const strokeIdRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const fadeRafRef = useRef(0);
  const strokesRef = useRef<TrailStroke[]>([]);

  const flushPendingRef = useRef<() => void>(() => undefined);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const brushPosRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const brushResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startWidth: number;
    anchorX: number;
    anchorY: number;
    canvasW: number;
    canvasH: number;
  } | null>(null);
  /**
   * After a right-click resize the OS pointer is still at the drag end, but the
   * ring should stay on the click. Shift raw client coords so preview + strokes
   * keep going from that click — no Pointer Lock (Chrome's "controls your pointer" bar).
   */
  const ptrShiftRef = useRef({ x: 0, y: 0 });
  /** Cached canvas rect for the active stroke — avoids layout thrash on every pointer event. */
  const strokeRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  /** Latest pointer client coords — survives async gaps in pointerdown. */
  const latestPtrRef = useRef({ x: 0, y: 0 });
  const activeDrawPointerIdRef = useRef<number | null>(null);
  const brushPaintRafRef = useRef(0);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    receiverIdsRef.current = receiverIds;
  }, [receiverIds]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  function paintBrushCursor() {
    const el = brushCursorRef.current;
    const pos = brushPosRef.current;
    if (!el || !pos) {
      if (el) el.hidden = true;
      return;
    }
    const size = Math.max(1, (widthRef.current / 100) * Math.min(pos.w, pos.h));
    el.hidden = false;
    el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    // Scale a fixed box — changing width/height every frame snapped to integer
    // CSS pixels and made the resize look stepped / jerky.
    el.style.setProperty("--brush-scale", String(size / BRUSH_RING_BASE_PX));
    el.style.setProperty("--brush-color", colorRef.current);
  }

  function scheduleBrushPaint() {
    if (brushPaintRafRef.current) return;
    brushPaintRafRef.current = requestAnimationFrame(() => {
      brushPaintRafRef.current = 0;
      paintBrushCursor();
    });
  }

  function pointerClient(clientX: number, clientY: number) {
    return {
      x: clientX + ptrShiftRef.current.x,
      y: clientY + ptrShiftRef.current.y,
    };
  }

  function clearPtrShift() {
    ptrShiftRef.current = { x: 0, y: 0 };
  }

  function moveBrushCursor(clientX: number, clientY: number, { hideIfOutside = true } = {}) {
    const canvas = canvasRef.current;
    const el = brushCursorRef.current;
    if (!canvas || !el) return;
    const rect = canvas.getBoundingClientRect();
    const p = pointerClient(clientX, clientY);
    latestPtrRef.current = p;
    const x = p.x - rect.left;
    const y = p.y - rect.top;
    const outside = x < 0 || y < 0 || x > rect.width || y > rect.height;
    if (outside && hideIfOutside) {
      brushPosRef.current = null;
      el.hidden = true;
      return;
    }
    brushPosRef.current = {
      x: Math.max(0, Math.min(rect.width, x)),
      y: Math.max(0, Math.min(rect.height, y)),
      w: rect.width,
      h: rect.height,
    };
    paintBrushCursor();
  }

  useEffect(() => {
    paintBrushCursor();
  }, [width, color]);

  const redrawLocal = useCallback((now = Date.now()) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const duration = durationRef.current;
    strokesRef.current = pruneDeadStrokes(strokesRef.current, now, duration);
    paintTrailStrokes(ctx, strokesRef.current, rect.width, rect.height, now, duration);
  }, []);

  const ensureFadeLoop = useCallback(() => {
    if (fadeRafRef.current) return;
    const loop = () => {
      fadeRafRef.current = 0;
      const now = Date.now();
      redrawLocal(now);
      if (strokesStillAlive(strokesRef.current, now, durationRef.current)) {
        fadeRafRef.current = requestAnimationFrame(loop);
      }
    };
    fadeRafRef.current = requestAnimationFrame(loop);
  }, [redrawLocal]);

  const layoutDrawStage = useCallback(() => {
    // Avoid mid-resize layout thrash (slider re-render used to resize the stage).
    if (brushResizeRef.current) return;
    const stage = stageRef.current;
    const slot = slotRef.current;
    if (!stage || !slot) return;

    const wide = window.matchMedia("(min-width: 1280px)").matches;
    const centerCol = stage.closest(".draw-center-col") as HTMLElement | null;
    if (!wide) {
      slot.style.width = "";
      slot.style.height = "";
      if (centerCol) {
        centerCol.style.width = "";
        centerCol.style.height = "";
      }
      return;
    }

    const layout = stage.closest(".draw-layout") as HTMLElement | null;
    if (!layout || !centerCol) return;

    const styles = getComputedStyle(layout);
    const gap = parseFloat(styles.columnGap || styles.gap) || 0;
    // Equal side minima so leftover width splits evenly and the preview stays centered.
    const minLeft = 12.5 * 16;
    const minRight = 12.5 * 16;
    const boxW = Math.max(8, layout.clientWidth - minLeft - minRight - gap * 2);
    const boxH = Math.max(8, layout.clientHeight);
    let fitW = (boxH * 16) / 9;
    let fitH = boxH;
    if (fitW > boxW) {
      fitW = boxW;
      fitH = (boxW * 9) / 16;
    }
    const w = Math.max(1, Math.floor(fitW));
    const h = Math.max(1, Math.floor(fitH));
    centerCol.style.width = `${w}px`;
    centerCol.style.height = `${h}px`;
    slot.style.width = "100%";
    slot.style.height = "100%";
  }, []);

  const resizeCanvas = useCallback(() => {
    layoutDrawStage();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    }
    redrawLocal();
  }, [layoutDrawStage, redrawLocal]);

  useEffect(() => {
    resizeCanvas();
    const stage = stageRef.current;
    const layout = stage?.closest(".draw-layout") ?? null;
    const observer = new ResizeObserver(() => resizeCanvas());
    if (stage) observer.observe(stage);
    if (layout) observer.observe(layout);
    window.addEventListener("resize", resizeCanvas);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [resizeCanvas]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
      if (brushPaintRafRef.current) cancelAnimationFrame(brushPaintRafRef.current);
      const sid = sessionIdRef.current;
      const ids = receiverIdsRef.current;
      if (sid && ids.length) {
        void endDrawSession(sid, ids).catch(() => undefined);
      }
    };
  }, []);

  function appendLocal(points: TimedPoint[], strokeId: string) {
    if (points.length === 0) return;
    const strokes = strokesRef.current;
    const last = strokes[strokes.length - 1];
    if (last && last.strokeId === strokeId) {
      last.points = concatStrokePoints(last.points, points);
      last.color = colorRef.current;
      last.width = widthRef.current;
      last.durationMs = durationRef.current;
    } else {
      strokes.push({
        points: [...points],
        color: colorRef.current,
        width: widthRef.current,
        durationMs: durationRef.current,
        strokeId,
      });
    }
    // Fade loop already paints at display refresh — skip an extra full redraw here.
    ensureFadeLoop();
  }

  function flushPending() {
    rafRef.current = 0;
    const points = pendingPointsRef.current;
    pendingPointsRef.current = [];
    const sid = sessionIdRef.current;
    const ids = receiverIdsRef.current;
    const strokeId = strokeIdRef.current;
    if (!sid || ids.length === 0 || points.length === 0 || !strokeId) return;
    let timed = assignMissingTimestamps(points, Date.now());
    const join = lastSentRef.current;
    if (join) timed = concatStrokePoints([join], timed);
    lastSentRef.current = timed[timed.length - 1] ?? join;
    appendLocal(timed, strokeId);
    try {
      emitDrawStroke({
        sessionId: sid,
        receiverIds: ids,
        points: timed,
        color: colorRef.current,
        width: widthRef.current,
        durationMs: durationRef.current,
        strokeId,
      });
    } catch {
      setStatus("Not connected — reconnecting…");
    }
  }

  flushPendingRef.current = flushPending;

  function queuePoint(point: { x: number; y: number }) {
    const pending = pendingPointsRef.current;
    const last = pending[pending.length - 1] ?? lastSentRef.current;
    const rect = strokeRectRef.current;
    // ~1.5 CSS px in percent space (falls back to a small % if rect unknown).
    const minDx = rect && rect.width > 0 ? (1.5 / rect.width) * 100 : 0.12;
    const minDy = rect && rect.height > 0 ? (1.5 / rect.height) * 100 : 0.12;
    if (
      last &&
      Math.abs(last.x - point.x) < minDx &&
      Math.abs(last.y - point.y) < minDy
    ) {
      return;
    }
    pending.push({ ...point, t: Date.now() });
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => flushPendingRef.current());
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    const onRaw = (event: Event) => {
      const e = event as globalThis.PointerEvent;
      if (brushResizeRef.current) {
        updateBrushResize(e);
        return;
      }
      const p = pointerClient(e.clientX, e.clientY);
      latestPtrRef.current = p;
      if (!drawingRef.current) return;
      moveBrushCursor(e.clientX, e.clientY, { hideIfOutside: false });
      const rect = strokeRectRef.current ?? rectFromDom(canvas.getBoundingClientRect());
      queuePoint(pointerPctFromRect(p.x, p.y, rect));
    };

    // Window-level moves: pointerdown awaits ensureSession(), and without capture
    // (or with a late capture) canvas pointermove can miss frames — the ring then
    // stays stuck at the original click.
    const onWinMove = (e: PointerEvent) => {
      if (brushResizeRef.current) {
        if (brushResizeRef.current.pointerId === e.pointerId) updateBrushResize(e);
        return;
      }
      const p = pointerClient(e.clientX, e.clientY);
      latestPtrRef.current = p;
      if (!drawingRef.current) return;
      if (activeDrawPointerIdRef.current != null && e.pointerId !== activeDrawPointerIdRef.current) {
        return;
      }
      moveBrushCursor(e.clientX, e.clientY, { hideIfOutside: false });
      const rect = strokeRectRef.current ?? rectFromDom(canvas.getBoundingClientRect());
      queuePoint(pointerPctFromRect(p.x, p.y, rect));
    };

    const onWinUp = (e: PointerEvent) => {
      if (brushResizeRef.current) endBrushResize(e);
    };

    canvas.addEventListener("pointerrawupdate", onRaw);
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    return () => {
      canvas.removeEventListener("pointerrawupdate", onRaw);
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
    };
  }, []);

  async function ensureSession() {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (receiverIdsRef.current.length === 0) {
      setStatus("Pick at least one online friend (or yourself).");
      return null;
    }
    setBusy(true);
    try {
      const nextId = makeSessionId();
      const result = await startDrawSession({
        sessionId: nextId,
        receiverIds: receiverIdsRef.current,
        durationMs: durationRef.current,
        color: colorRef.current,
        width: widthRef.current,
      });
      if (!result.ok || !result.sessionId) {
        setStatus(result.reason === "no_targets" ? "No valid recipients online." : "Could not start draw session.");
        return null;
      }
      setSessionId(result.sessionId);
      sessionIdRef.current = result.sessionId;
      const online = result.onlineIds?.length ?? 0;
      setStatus(
        online === 0
          ? "Session ready — waiting for their desktop app…"
          : `Live to ${online} screen${online === 1 ? "" : "s"}.`,
      );
      return result.sessionId;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not start draw session.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function beginBrushResize(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* window pointermove still tracks the drag */
    }
    const rect = canvas.getBoundingClientRect();
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;
    clearPtrShift();
    latestPtrRef.current = { x: e.clientX, y: e.clientY };
    brushResizeRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startWidth: widthRef.current,
      anchorX,
      anchorY,
      canvasW: rect.width,
      canvasH: rect.height,
    };
    brushPosRef.current = { x: anchorX, y: anchorY, w: rect.width, h: rect.height };
    paintBrushCursor();
  }

  function updateBrushResize(e: { pointerId: number; clientY: number }) {
    const resize = brushResizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    const deltaY = e.clientY - resize.startY;
    widthRef.current = clampBrushWidth(resize.startWidth * 2 ** (-deltaY / BRUSH_RESIZE_HALF_LIFE_PX));
    brushPosRef.current = {
      x: resize.anchorX,
      y: resize.anchorY,
      w: resize.canvasW,
      h: resize.canvasH,
    };
    scheduleBrushPaint();
  }

  function endBrushResize(e: { pointerId: number; clientX: number; clientY: number }) {
    const resize = brushResizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    brushResizeRef.current = null;
    const rounded = roundBrushWidth(widthRef.current);
    widthRef.current = rounded;
    setWidth(rounded);
    const canvas = canvasRef.current;
    try {
      canvas?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    const rect = canvas?.getBoundingClientRect();
    const screenX = resize.anchorX + (rect?.left ?? 0);
    const screenY = resize.anchorY + (rect?.top ?? 0);
    // Keep the ring on the click; later moves are offset from this release point.
    ptrShiftRef.current = {
      x: screenX - e.clientX,
      y: screenY - e.clientY,
    };
    latestPtrRef.current = { x: screenX, y: screenY };
    brushPosRef.current = {
      x: resize.anchorX,
      y: resize.anchorY,
      w: resize.canvasW,
      h: resize.canvasH,
    };
    paintBrushCursor();
  }

  async function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button === 2) {
      beginBrushResize(e);
      return;
    }
    if (e.button !== 0) return;
    if (brushResizeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture + track immediately — never await before this or the ring freezes at click.
    latestPtrRef.current = pointerClient(e.clientX, e.clientY);
    activeDrawPointerIdRef.current = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drawingRef.current = true;
    lastSentRef.current = null;
    strokeIdRef.current = makeSessionId();
    const rect = rectFromDom(canvas.getBoundingClientRect());
    strokeRectRef.current = rect;
    moveBrushCursor(e.clientX, e.clientY, { hideIfOutside: false });

    const sid = await ensureSession();
    if (!sid || activeDrawPointerIdRef.current !== e.pointerId) {
      drawingRef.current = false;
      strokeRectRef.current = null;
      strokeIdRef.current = null;
      activeDrawPointerIdRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    strokesRef.current.push({
      points: [],
      color: colorRef.current,
      width: widthRef.current,
      durationMs: durationRef.current,
      strokeId: strokeIdRef.current!,
    });

    // Use the *latest* pointer pos after the await — not the stale down event.
    const live = latestPtrRef.current;
    const liveRect = strokeRectRef.current ?? rectFromDom(canvas.getBoundingClientRect());
    strokeRectRef.current = liveRect;
    moveBrushCursor(live.x, live.y, { hideIfOutside: false });
    queuePoint(pointerPctFromRect(live.x, live.y, liveRect));
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (brushResizeRef.current) {
      updateBrushResize(e);
      return;
    }
    if (!drawingRef.current) {
      moveBrushCursor(e.clientX, e.clientY);
      return;
    }
    moveBrushCursor(e.clientX, e.clientY, { hideIfOutside: false });
    const p = pointerClient(e.clientX, e.clientY);
    const rect = strokeRectRef.current ?? rectFromDom(e.currentTarget.getBoundingClientRect());
    queuePoint(pointerPctFromRect(p.x, p.y, rect));
  }

  function onPointerEnter(e: PointerEvent<HTMLCanvasElement>) {
    if (brushResizeRef.current || drawingRef.current) return;
    clearPtrShift();
    moveBrushCursor(e.clientX, e.clientY);
  }

  function onPointerLeave() {
    if (drawingRef.current || brushResizeRef.current) return;
    clearPtrShift();
    brushPosRef.current = null;
    const el = brushCursorRef.current;
    if (el) el.hidden = true;
  }

  function endStroke(e: PointerEvent<HTMLCanvasElement>) {
    if (brushResizeRef.current) {
      endBrushResize(e);
      return;
    }
    if (!drawingRef.current) return;
    if (activeDrawPointerIdRef.current != null && e.pointerId !== activeDrawPointerIdRef.current) {
      return;
    }
    drawingRef.current = false;
    activeDrawPointerIdRef.current = null;
    strokeRectRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      flushPendingRef.current();
    }
    lastSentRef.current = null;
    strokeIdRef.current = null;
    moveBrushCursor(e.clientX, e.clientY);
  }

  return (
    <div
      id="panel-draw"
      role="tabpanel"
      aria-labelledby="tab-draw"
      className="draw-layout draw-layout-fill"
    >
      <ComposeColumnGlows />
      <aside className="draw-side draw-side-left panel order-0 flex min-h-0 flex-col p-2.5 sm:p-3 xl:order-none">
        <section className="form-section min-h-0 flex-1 overflow-y-auto" aria-label="Recipients">
          <FriendPicker
            friends={friends}
            selectedIds={receiverIds}
            onChange={setReceiverIds}
            currentUser={currentUser}
            compact
            stack
          />
        </section>
      </aside>

      <div className="draw-center-col order-1 flex min-h-0 flex-col xl:order-none">
        <section className="draw-center panel flex min-h-0 flex-col p-0.5 sm:p-1 xl:h-full">
          <div ref={workspaceRef} className="draw-workspace">
            <div ref={stageRef} className="draw-stage">
              <div ref={slotRef} className="draw-slot">
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 h-full w-full touch-none cursor-none"
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerDown={(e) => void onPointerDown(e)}
                  onPointerMove={onPointerMove}
                  onPointerEnter={onPointerEnter}
                  onPointerLeave={onPointerLeave}
                  onPointerUp={endStroke}
                  onPointerCancel={endStroke}
                />
                {!sessionId && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center">
                    <p className="text-sm text-slate-500">Choose recipients, then draw here</p>
                  </div>
                )}
                <div ref={brushCursorRef} className="draw-brush-cursor" hidden aria-hidden>
                  <span className="draw-brush-cursor-ring" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <aside className="draw-side draw-side-right panel order-2 flex min-h-0 flex-col p-2.5 sm:p-3 xl:order-none">
        <div className="draw-aside-body min-h-0 flex-1 space-y-3 overflow-y-auto">
          <section className="form-section space-y-2">
            <h3 className="form-section-title">Brush</h3>
            <ColorWheelPicker color={color} onChange={setColor} />
            <PrecisionSlider
              label="Thickness"
              value={Math.round(width * 100)}
              min={Math.round(MIN_BRUSH_WIDTH * 100)}
              max={Math.round(MAX_BRUSH_WIDTH * 100)}
              step={5}
              inputStep={5}
              format={(v) => `${(v / 100).toFixed(2)}%`}
              onChange={(v) => setWidth(roundBrushWidth(v / 100))}
            />
            <p className="text-[11px] leading-snug text-slate-500">
              Right-click + drag up/down on the canvas to resize the brush.
            </p>
            <PrecisionSlider
              label="Stay on screen"
              value={durationMs}
              min={MIN_DURATION_MS}
              max={MAX_DURATION_MS}
              step={100}
              inputStep={10}
              displayAsSeconds
              format={formatDuration}
              onChange={setDurationMs}
            />
          </section>
          {status && (
            <p className="text-xs text-slate-400" role="status">
              {status}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
