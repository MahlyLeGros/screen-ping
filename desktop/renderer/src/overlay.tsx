import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "../../../shared/memeCaption.css";
import ScaledMemeCaption from "../../../shared/ScaledMemeCaption";
import {
  DEFAULT_LAYOUT,
  captionLayoutBelowMedia,
  drawCanvasContainStyle,
  layoutCanvasStyle,
  layoutViewportStyle,
} from "../../../shared/types";
import {
  assignMissingTimestamps,
  concatStrokePoints,
  paintTrailStrokes,
  pruneDeadStrokes,
  strokesStillAlive,
  type TrailStroke,
} from "../../../shared/drawFade";
import type { OverlayPayload } from "./types";
import { captionFrameStyle, flipStyle, frameStyle, mediaObjectFit } from "./types";

interface DisplaySession {
  payload: OverlayPayload;
  ready: boolean;
}

interface DrawSessionLayer {
  sessionId: string;
  durationMs: number;
  strokes: TrailStroke[];
}

interface SessionDefaults {
  durationMs: number;
  color: string;
  width: number;
}

const PRELOAD_MEDIA_TIMEOUT_MS = 12_000;

function stopAllMedia(root: ParentNode | Document = document) {
  root.querySelectorAll("audio, video").forEach((node) => {
    const media = node as HTMLMediaElement;
    media.pause();
    media.currentTime = 0;
  });
}

function preloadMedia(payload: OverlayPayload): Promise<void> {
  if (payload.mediaType === "audio") return Promise.resolve();

  const load = new Promise<void>((resolve) => {
    if (payload.mediaType === "image") {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = payload.mediaUrl;
      return;
    }

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true; // unlock faster metadata load; display element is unmuted
    const done = () => resolve();
    video.onloadeddata = done;
    video.oncanplay = done;
    video.onerror = done;
    video.src = payload.mediaUrl;
    void video.load();
  });

  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, PRELOAD_MEDIA_TIMEOUT_MS);
  });

  return Promise.race([load, timeout]);
}

function OverlayApp() {
  const [session, setSession] = useState<DisplaySession | null>(null);
  const overlayAudioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<DisplaySession | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionsRef = useRef<Map<string, DrawSessionLayer>>(new Map());
  const sessionDefaultsRef = useRef<Map<string, SessionDefaults>>(new Map());
  const idleNotifiedRef = useRef(true);
  const animRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    function paint() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const dpr = window.devicePixelRatio || 1;
      // Prefer cached CSS size from style/client box — avoid getBoundingClientRect every frame.
      let cssW = parent.clientWidth;
      let cssH = parent.clientHeight;
      if (cssW < 2 || cssH < 2) {
        const rect = parent.getBoundingClientRect();
        cssW = rect.width;
        cssH = rect.height;
      }
      const nextW = Math.max(1, Math.round(cssW * dpr));
      const nextH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = Date.now();
      const layers = [...sessionsRef.current.values()];
      ctx.clearRect(0, 0, cssW, cssH);
      for (const layer of layers) {
        layer.strokes = pruneDeadStrokes(layer.strokes, now, layer.durationMs);
        paintTrailStrokes(ctx, layer.strokes, cssW, cssH, now, layer.durationMs, {
          clear: false,
        });
      }
    }

    function pruneAndIdle(now: number) {
      for (const [id, layer] of sessionsRef.current) {
        layer.strokes = pruneDeadStrokes(layer.strokes, now, layer.durationMs);
        if (layer.strokes.length === 0 && !sessionDefaultsRef.current.has(id)) {
          sessionsRef.current.delete(id);
        }
      }

      const anyAlive = [...sessionsRef.current.values()].some((layer) =>
        strokesStillAlive(layer.strokes, now, layer.durationMs),
      );
      const anyOpenSession = sessionDefaultsRef.current.size > 0;
      if (!anyAlive && !anyOpenSession && !idleNotifiedRef.current) {
        idleNotifiedRef.current = true;
        sessionsRef.current.clear();
        window.electronAPI.notifyDrawIdle();
      }
    }

    function scheduleDraw() {
      if (animRef.current) return;
      const loop = () => {
        animRef.current = 0;
        const now = Date.now();
        paint();
        pruneAndIdle(now);
        const keepGoing =
          sessionDefaultsRef.current.size > 0 ||
          [...sessionsRef.current.values()].some((layer) =>
            strokesStillAlive(layer.strokes, now, layer.durationMs),
          );
        if (keepGoing) {
          animRef.current = requestAnimationFrame(loop);
        }
      };
      animRef.current = requestAnimationFrame(loop);
    }

    function ensureLayer(sessionId: string, defaults?: SessionDefaults): DrawSessionLayer {
      let layer = sessionsRef.current.get(sessionId);
      if (!layer) {
        layer = {
          sessionId,
          durationMs: defaults?.durationMs ?? 3000,
          strokes: [],
        };
        sessionsRef.current.set(sessionId, layer);
      }
      return layer;
    }

    window.electronAPI.onShowOverlay((data) => {
      const payload = data as OverlayPayload;
      if (payload.mediaType === "audio") return;
      setSession({ payload, ready: false });
    });

    window.electronAPI.onHideOverlay(() => {
      stopAllMedia();
      setSession(null);
      requestAnimationFrame(() => {
        window.electronAPI.notifyOverlayCleared();
      });
    });

    window.electronAPI.onDrawBegin((raw) => {
      const data = raw as {
        sessionId: string;
        durationMs: number;
        color: string;
        width: number;
      };
      sessionDefaultsRef.current.set(data.sessionId, {
        durationMs: data.durationMs,
        color: data.color,
        width: data.width,
      });
      const layer = ensureLayer(data.sessionId, {
        durationMs: data.durationMs,
        color: data.color,
        width: data.width,
      });
      layer.durationMs = data.durationMs;
      idleNotifiedRef.current = false;
      scheduleDraw();
    });

    window.electronAPI.onDrawStroke((raw) => {
      const data = raw as {
        sessionId: string;
        points: Array<{ x: number; y: number; t?: number }>;
        color: string;
        width: number;
        durationMs?: number;
        strokeId?: string;
      };
      if (!data.points?.length) return;
      const receivedAt = Date.now();
      const defaults = sessionDefaultsRef.current.get(data.sessionId);
      const layer = ensureLayer(data.sessionId, defaults);
      const durationMs =
        typeof data.durationMs === "number" && data.durationMs > 0
          ? data.durationMs
          : defaults?.durationMs ?? layer.durationMs;
      layer.durationMs = durationMs;
      if (defaults) defaults.durationMs = durationMs;
      const color = data.color || defaults?.color || "#a78bfa";
      const width = data.width || defaults?.width || 0.8;
      const timed = assignMissingTimestamps(data.points, receivedAt);
      const strokeId = typeof data.strokeId === "string" && data.strokeId ? data.strokeId : "";
      let target: TrailStroke | undefined;
      if (strokeId) {
        for (let i = layer.strokes.length - 1; i >= 0; i--) {
          if (layer.strokes[i].strokeId === strokeId) {
            target = layer.strokes[i];
            break;
          }
        }
      } else {
        target = layer.strokes[layer.strokes.length - 1];
      }
      if (target) {
        target.points = concatStrokePoints(target.points, timed);
        target.color = color;
        target.width = width;
        target.durationMs = durationMs;
        if (strokeId) target.strokeId = strokeId;
      } else {
        layer.strokes.push({ points: timed, color, width, durationMs, strokeId });
      }
      idleNotifiedRef.current = false;
      scheduleDraw();
    });

    window.electronAPI.onDrawClear((raw) => {
      const data = raw as { sessionId: string };
      sessionsRef.current.delete(data.sessionId);
      scheduleDraw();
    });

    window.electronAPI.onDrawEnd((raw) => {
      const data = raw as { sessionId: string };
      sessionDefaultsRef.current.delete(data.sessionId);
      // Existing strokes finish their trail naturally.
      scheduleDraw();
    });

    window.addEventListener("resize", scheduleDraw);
    scheduleDraw();
    return () => {
      window.removeEventListener("resize", scheduleDraw);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const current = sessionRef.current;
      if (e.key === "Escape" && current?.ready) {
        window.electronAPI.dismissOverlay(current.payload.messageId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!session || session.ready) return;
    const payload = session.payload;
    const { messageId } = payload;
    let cancelled = false;

    void (async () => {
      await preloadMedia(payload);
      if (cancelled || sessionRef.current?.payload.messageId !== messageId) return;
      setSession({ payload, ready: true });
      window.electronAPI.notifyOverlayReady(messageId);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.ready) return;
    const { payload } = session;
    const delay = Math.max(0, payload.audioDelayMs ?? 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let audioRaf = 0;
    let videoRaf = 0;

    const schedulePlay = (getEl: () => HTMLAudioElement | null) => {
      audioRaf = requestAnimationFrame(() => {
        const el = getEl();
        if (!el) return;
        el.currentTime = 0;
        timer = setTimeout(() => {
          void el.play().catch(() => {});
        }, delay);
      });
    };

    if (payload.audioUrl) {
      schedulePlay(() => overlayAudioRef.current);
    }

    // Explicit play() — autoPlay alone can fail intermittently (Chromium policy / race).
    if (payload.mediaType === "video") {
      videoRaf = requestAnimationFrame(() => {
        const video = document.querySelector(".media-frame video") as HTMLVideoElement | null;
        if (!video) return;
        video.muted = false;
        void video.play().catch(() => {});
      });
    }

    return () => {
      cancelAnimationFrame(audioRaf);
      cancelAnimationFrame(videoRaf);
      if (timer) clearTimeout(timer);
      overlayAudioRef.current?.pause();
      stopAllMedia();
    };
  }, [session]);

  const mediaReady = Boolean(session?.ready);
  const payload = session?.ready ? session.payload : null;
  const layout = payload?.layout ?? DEFAULT_LAYOUT;
  const fitStyle = payload ? mediaObjectFit(layout) : null;
  const audioFullUrl = payload?.audioUrl ?? null;
  const captionLayout = payload ? payload.captionLayout ?? captionLayoutBelowMedia(layout) : null;
  const captionFontSize = captionLayout?.fontSizePct ?? 10;

  return (
    <div className="overlay-root" style={{ width: "100%", height: "100%", position: "relative" }}>
      <div style={layoutViewportStyle()}>
        <div className="layout-canvas" style={{ ...layoutCanvasStyle(), position: "relative" }}>
          <style>{`
            .media-frame {
              pointer-events: none;
              overflow: hidden;
              z-index: 1;
            }
            .draw-layer {
              display: block;
              width: 100%;
              height: 100%;
              pointer-events: none;
            }
          `}</style>

          {mediaReady && payload?.mediaType === "image" && (
            <div key={payload.messageId} className="media-frame" style={frameStyle(layout)}>
              <div style={flipStyle(layout)}>
                <img src={payload.mediaUrl} alt="" style={fitStyle!} draggable={false} />
              </div>
            </div>
          )}
          {mediaReady && payload?.mediaType === "video" && (
            <div key={payload.messageId} className="media-frame" style={frameStyle(layout)}>
              <div style={flipStyle(layout)}>
                <video src={payload.mediaUrl} style={fitStyle!} autoPlay muted={false} playsInline />
              </div>
            </div>
          )}

          {audioFullUrl && (
            <audio ref={overlayAudioRef} key={audioFullUrl} src={audioFullUrl} style={{ display: "none" }} />
          )}

          {mediaReady && payload?.caption && captionLayout && (
            <div className="caption" style={captionFrameStyle(captionLayout)}>
              <ScaledMemeCaption text={payload.caption} fontSizePct={captionFontSize} />
            </div>
          )}
        </div>
      </div>

      <div className="draw-contain" style={drawCanvasContainStyle()}>
        <canvas ref={canvasRef} className="draw-layer" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<OverlayApp />);
