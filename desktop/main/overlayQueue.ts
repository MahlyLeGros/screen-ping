import { BrowserWindow, ipcMain } from "electron";
import store from "./store";
import { applyOverlayTopMost, parkOverlayWindow, reinforceOverlayWindow, showOverlayWindow } from "./windows";
import { disableOverlayZOrderGuard, enableOverlayZOrderGuard } from "./win32Overlay";
import { drawOverlay } from "./drawOverlay";
export interface DeliverPayload {
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
  layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    objectFit?: "contain" | "fill";
    opacity?: number;
  };
  captionLayout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    fontSizePct?: number;
  };
}

type AckCallback = (messageId: string, status: "delivered" | "failed" | "paused") => void;

function cacheBust(url: string, messageId: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(messageId)}`;
}

function readMs(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

// Do NOT include webm — video/webm is a primary Send format; audio-only WebM
// arrives with mediaType === "audio" from the server.
const AUDIO_URL_PATTERN = /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i;
const OVERLAY_READY_TIMEOUT_MS = 15_000;

function isAudioOnlyPayload(payload: DeliverPayload): boolean {
  // Trust declared type first — URL extension heuristics must never override video/image.
  if (payload.mediaType === "video" || payload.mediaType === "image") return false;
  if (payload.audioUrl) return false;
  if (payload.mediaType === "audio") return true;
  return AUDIO_URL_PATTERN.test(payload.mediaUrl);
}

function animateWindowOpacity(win: BrowserWindow, from: number, to: number, durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    win.setOpacity(to);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / durationMs);
      win.setOpacity(from + (to - from) * t);
      if (t < 1) {
        setTimeout(step, 16);
      } else {
        resolve();
      }
    };
    win.setOpacity(from);
    step();
  });
}

export class OverlayQueue {
  private queue: DeliverPayload[] = [];
  private showing = false;
  private overlayWindow: BrowserWindow | null = null;
  private onAck: AckCallback;
  private currentMessageId: string | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDurationMs = 3000;
  private currentFadeInMs = 200;
  private currentFadeOutMs = 0;
  private currentPayload: DeliverPayload | null = null;
  private audioWindow: BrowserWindow | null = null;
  private wasAudioOnly = false;
  private topMostTimer: ReturnType<typeof setInterval> | null = null;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;
  private overlayFullyVisible = false;
  private visibilityGuardsAttached = false;

  private readonly onOverlayHidden = () => {
    if (!this.showing || this.recoverTimer) return;
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      if (!this.showing || !this.overlayWindow || this.overlayWindow.isDestroyed()) return;
      reinforceOverlayWindow(this.overlayWindow);
      if (this.overlayFullyVisible && this.overlayWindow.getOpacity() < 1) {
        this.overlayWindow.setOpacity(1);
      }
    }, 100);
  };

  private keepOverlayOnTop = () => {
    if (!this.showing || !this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    reinforceOverlayWindow(this.overlayWindow);
  };

  private attachVisibilityGuards() {
    const win = this.overlayWindow;
    if (!win || this.visibilityGuardsAttached) return;
    win.on("hide", this.onOverlayHidden);
    win.on("minimize", this.onOverlayHidden);
    this.visibilityGuardsAttached = true;
  }

  private detachVisibilityGuards() {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed() || !this.visibilityGuardsAttached) return;
    win.removeListener("hide", this.onOverlayHidden);
    win.removeListener("minimize", this.onOverlayHidden);
    this.visibilityGuardsAttached = false;
  }

  constructor(onAck: AckCallback) {
    this.onAck = onAck;
    ipcMain.on("overlay:dismiss", (_event, data: { messageId: string }) => {
      if (data.messageId === this.currentMessageId) {
        void this.finish("delivered");
      }
    });
    ipcMain.on("overlay:ready", (_event, data: { messageId: string }) => {
      void this.onOverlayReady(data.messageId);
    });
  }

  setWindow(win: BrowserWindow) {
    this.overlayWindow = win;
    drawOverlay.setWindow(win);
  }

  isShowing(): boolean {
    return this.showing;
  }

  enqueue(payload: DeliverPayload, paused: boolean) {
    if (paused) {
      this.onAck(payload.messageId, "paused");
      return;
    }
    this.queue.push(payload);
    void this.processNext();
  }

  /** Drop a queued/showing ping (sender cancel or server timeout). */
  revoke(messageId: string) {
    this.queue = this.queue.filter((item) => item.messageId !== messageId);
    if (this.currentMessageId === messageId && this.showing) {
      void this.finish("failed");
    }
  }

  dismissCurrent() {
    if (this.currentMessageId) {
      void this.finish("delivered");
    }
  }

  private async processNext() {
    if (this.showing || this.queue.length === 0 || !this.overlayWindow) return;

    const payload = this.queue.shift()!;
    this.showing = true;
    drawOverlay.setPingShowing(true);
    this.currentMessageId = payload.messageId;

    const delayMs = Math.max(0, payload.delayMs ?? 0);
    const start = async () => {
      if (isAudioOnlyPayload(payload)) {
        await this.playAudioOnly(payload);
        await this.finish("delivered");
        return;
      }
      await this.displayPayload(payload);
    };

    if (delayMs > 0) {
      this.showTimer = setTimeout(() => void start(), delayMs);
    } else {
      await start();
    }
  }

  private ensureAudioWindow(): BrowserWindow {
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      return this.audioWindow;
    }

    this.audioWindow = new BrowserWindow({
      title: "Screen Ping",
      show: false,
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      opacity: 0,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    applyOverlayTopMost(this.audioWindow);
    this.audioWindow.setTitle("Screen Ping");

    return this.audioWindow;
  }

  private async playAudioOnly(payload: DeliverPayload): Promise<void> {
    this.wasAudioOnly = true;
    this.currentPayload = payload;
    this.currentDurationMs = payload.durationMs;

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      parkOverlayWindow(this.overlayWindow);
      this.overlayWindow.webContents.send("overlay:hide");
    }

    const serverUrl = store.get("serverUrl");
    const url = cacheBust(
      payload.mediaUrl.startsWith("http") ? payload.mediaUrl : `${serverUrl}${payload.mediaUrl}`,
      payload.messageId,
    );
    const audioDelayMs = Math.max(0, payload.audioDelayMs ?? 0);
    const win = this.ensureAudioWindow();

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Screen Ping</title></head><body style="margin:0;background:transparent"><audio id="a"></audio><script>
      document.title = "Screen Ping";
      const audio = document.getElementById("a");
      audio.src = ${JSON.stringify(url)};
      setTimeout(() => { audio.play().catch(() => {}); }, ${audioDelayMs});
    </script></body></html>`;

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve) => setTimeout(resolve, audioDelayMs + this.currentDurationMs));
    await this.stopHiddenAudio();
  }

  private async stopHiddenAudio() {
    const win = this.audioWindow;
    if (!win || win.isDestroyed()) return;
    try {
      await win.webContents.executeJavaScript(`
        document.querySelectorAll("audio,video").forEach((el) => {
          el.pause();
          el.removeAttribute("src");
          el.load();
        });
      `);
    } catch {
      /* window may already be gone */
    }
    try {
      await win.loadURL("about:blank");
    } catch {
      /* ignore */
    }
  }

  private async stopOverlayMedia() {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;
    try {
      await win.webContents.executeJavaScript(`
        document.querySelectorAll("audio,video").forEach((el) => {
          el.pause();
          el.currentTime = 0;
        });
      `);
    } catch {
      /* overlay may already be gone */
    }
  }

  private startTopMostKeeper() {
    this.stopTopMostKeeper();
    if (!this.overlayWindow) return;

    enableOverlayZOrderGuard(this.overlayWindow);
    this.attachVisibilityGuards();
    this.keepOverlayOnTop();
    this.topMostTimer = setInterval(() => this.keepOverlayOnTop(), 800);
  }

  private stopTopMostKeeper() {
    disableOverlayZOrderGuard();
    this.detachVisibilityGuards();
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
    }
    if (this.topMostTimer) {
      clearInterval(this.topMostTimer);
      this.topMostTimer = null;
    }
  }

  private clearRenderer(): Promise<void> {
    if (!this.overlayWindow) return Promise.resolve();

    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, 500);
      ipcMain.once("overlay:cleared", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.overlayWindow!.webContents.send("overlay:hide");
    });
  }

  private clearReadyTimeout() {
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
  }

  private scheduleReadyTimeout(messageId: string) {
    this.clearReadyTimeout();
    this.readyTimeout = setTimeout(() => {
      this.readyTimeout = null;
      if (this.currentMessageId === messageId && this.showing) {
        void this.finish("failed");
      }
    }, OVERLAY_READY_TIMEOUT_MS);
  }

  private async onOverlayReady(messageId: string) {
    if (messageId !== this.currentMessageId || !this.overlayWindow) return;

    this.clearReadyTimeout();

    showOverlayWindow(this.overlayWindow);
    await animateWindowOpacity(this.overlayWindow, 0, 1, this.currentFadeInMs);
    this.overlayFullyVisible = true;
    this.startTopMostKeeper();

    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => void this.finish("delivered"), this.currentDurationMs);
  }

  private async displayPayload(payload: DeliverPayload) {
    this.wasAudioOnly = false;
    this.showTimer = null;
    if (!this.overlayWindow || this.currentMessageId !== payload.messageId) return;

    this.overlayWindow.setOpacity(0);
    await this.clearRenderer();

    const serverUrl = store.get("serverUrl");
    const fullUrl = cacheBust(
      payload.mediaUrl.startsWith("http") ? payload.mediaUrl : `${serverUrl}${payload.mediaUrl}`,
      payload.messageId
    );
    const fullAudioUrl = payload.audioUrl
      ? cacheBust(
          payload.audioUrl.startsWith("http") ? payload.audioUrl : `${serverUrl}${payload.audioUrl}`,
          payload.messageId
        )
      : undefined;

    this.currentDurationMs = payload.durationMs;
    this.currentFadeInMs = readMs(payload.fadeInMs, 200);
    this.currentFadeOutMs = readMs(payload.fadeOutMs, 0);
    this.currentPayload = payload;

    this.overlayWindow.webContents.send("overlay:show", {
      ...payload,
      mediaUrl: fullUrl,
      audioUrl: fullAudioUrl,
      fadeInMs: this.currentFadeInMs,
      fadeOutMs: this.currentFadeOutMs,
    });
    this.scheduleReadyTimeout(payload.messageId);
  }

  private async finish(status: "delivered" | "failed" | "paused") {
    this.stopTopMostKeeper();
    this.clearReadyTimeout();
    await this.stopOverlayMedia();
    await this.stopHiddenAudio();
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.currentMessageId) {
      this.onAck(this.currentMessageId, status);
      this.currentMessageId = null;
    }

    if (this.overlayWindow && !this.wasAudioOnly) {
      const opacity = this.overlayWindow.getOpacity();
      // Keep window opaque if live draw is holding it; only clear media.
      if (drawOverlay.isActive()) {
        await this.clearRenderer();
      } else {
        await animateWindowOpacity(this.overlayWindow, opacity, 0, this.currentFadeOutMs);
        await this.clearRenderer();
      }
    }
    this.overlayFullyVisible = false;
    this.currentFadeInMs = 200;
    this.currentFadeOutMs = 0;
    this.currentPayload = null;
    this.wasAudioOnly = false;
    this.showing = false;
    drawOverlay.setPingShowing(false);
    if (this.overlayWindow && !this.overlayWindow.isDestroyed() && !drawOverlay.isActive()) {
      parkOverlayWindow(this.overlayWindow);
    }
    setTimeout(() => void this.processNext(), 50);
  }
}
