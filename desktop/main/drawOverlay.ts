import { BrowserWindow } from "electron";

import { applyOverlayTopMost, parkOverlayWindow, reinforceOverlayWindow, showOverlayWindow } from "./windows";
import { disableOverlayZOrderGuard, enableOverlayZOrderGuard } from "./win32Overlay";

export interface DrawBeginPayload {
  sessionId: string;
  fromUserId: string;
  durationMs: number;
  color: string;
  width: number;
}

export interface DrawStrokePayload {
  sessionId: string;
  fromUserId: string;
  points: Array<{ x: number; y: number; t?: number }>;
  color: string;
  width: number;
  durationMs?: number;
  strokeId?: string;
}

export interface DrawSessionPayload {
  sessionId: string;
  fromUserId: string;
}

/**
 * Live draw layer on the same overlay window as pings.
 * Keeps the window visible while strokes are active even if no ping is showing.
 */
class DrawOverlayController {
  private overlayWindow: BrowserWindow | null = null;
  private activeSessions = new Set<string>();
  private holdingWindow = false;
  private topMostTimer: ReturnType<typeof setInterval> | null = null;
  private pingShowing = false;

  setWindow(win: BrowserWindow | null) {
    this.overlayWindow = win;
  }

  setPingShowing(showing: boolean) {
    this.pingShowing = showing;
    if (!showing) {
      this.maybePark();
    }
  }

  isActive(): boolean {
    return this.activeSessions.size > 0;
  }

  begin(payload: DrawBeginPayload) {
    this.activeSessions.add(payload.sessionId);
    this.ensureVisible();
    this.send("draw:begin", payload);
  }

  stroke(payload: DrawStrokePayload) {
    if (!this.activeSessions.has(payload.sessionId)) {
      this.activeSessions.add(payload.sessionId);
    }
    this.ensureVisible();
    this.send("draw:stroke", payload);
  }

  clear(payload: DrawSessionPayload) {
    this.send("draw:clear", payload);
  }

  end(payload: DrawSessionPayload) {
    this.activeSessions.delete(payload.sessionId);
    this.send("draw:end", payload);
    // Keep the overlay up so the trail can finish; park on onRendererIdle.
  }

  /** Called when renderer reports all strokes faded out. */
  onRendererIdle() {
    if (this.activeSessions.size === 0) {
      this.maybePark();
    }
  }

  private send(channel: string, payload: unknown) {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  private ensureVisible() {
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;

    if (this.pingShowing) {
      // Ping already owns visibility / topmost — just make sure we stay up.
      reinforceOverlayWindow(win);
      return;
    }

    showOverlayWindow(win);
    if (win.getOpacity() < 1) {
      win.setOpacity(1);
    }
    this.holdingWindow = true;
    this.startTopMostKeeper();
  }

  private startTopMostKeeper() {
    if (this.topMostTimer) return;
    const win = this.overlayWindow;
    if (!win || win.isDestroyed()) return;
    enableOverlayZOrderGuard(win);
    applyOverlayTopMost(win);
    this.topMostTimer = setInterval(() => {
      if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
      reinforceOverlayWindow(this.overlayWindow);
    }, 800);
  }

  private stopTopMostKeeper() {
    if (this.topMostTimer) {
      clearInterval(this.topMostTimer);
      this.topMostTimer = null;
    }
    if (!this.pingShowing) {
      disableOverlayZOrderGuard();
    }
  }

  private maybePark() {
    if (this.pingShowing || this.activeSessions.size > 0) return;
    if (!this.holdingWindow) return;
    this.stopTopMostKeeper();
    const win = this.overlayWindow;
    if (win && !win.isDestroyed()) {
      parkOverlayWindow(win);
    }
    this.holdingWindow = false;
  }
}

export const drawOverlay = new DrawOverlayController();
