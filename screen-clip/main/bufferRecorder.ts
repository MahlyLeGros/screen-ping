import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { app, screen } from "electron";
import {
  buildCaptureArgs,
  buildRemuxArgs,
  containerExtension,
  normalizeEncoding,
  segmentCountForBuffer,
  type CaptureGeometry,
} from "./ffmpegArgs";
import { assertFfmpegAvailable } from "./ffmpegPath";
import {
  formatClipFilename,
  pruneSegments,
  selectSegmentsForFlush,
  writeConcatList,
} from "./ringBuffer";
import store, { getAllSettings, type ClipSettings } from "./store";

const SEGMENT_TIME = 5;

export type BufferStatus = "running" | "paused" | "stopped" | "error";

export interface BufferState {
  status: BufferStatus;
  lastError: string | null;
  lastClipPath: string | null;
  flushing: boolean;
}

type Listener = (state: BufferState) => void;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function segmentDir(): string {
  return path.join(app.getPath("userData"), "buffer-segments");
}

function grabGeometry(displayId: number | null): CaptureGeometry {
  const displays = screen.getAllDisplays();
  const display =
    (displayId != null ? displays.find((d) => d.id === displayId) : null) ?? screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  return {
    offsetX: Math.round(x),
    offsetY: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export class BufferRecorder {
  private proc: ChildProcess | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();
  private state: BufferState = {
    status: "stopped",
    lastError: null,
    lastClipPath: null,
    flushing: false,
  };
  private intentionalStop = false;

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): BufferState {
    return { ...this.state };
  }

  private emit() {
    const snap = this.getState();
    for (const listener of this.listeners) listener(snap);
  }

  private setState(partial: Partial<BufferState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  async start(settings: ClipSettings = getAllSettings()): Promise<void> {
    if (!settings.bufferEnabled) {
      await this.stopProcessOnly();
      this.setState({ status: "paused", lastError: null });
      return;
    }

    await this.stopProcessOnly();
    ensureDir(segmentDir());
    ensureDir(settings.outputDir);

    const keep = segmentCountForBuffer(settings.bufferSeconds, SEGMENT_TIME);
    for (const file of fs.readdirSync(segmentDir())) {
      try {
        fs.unlinkSync(path.join(segmentDir(), file));
      } catch {
        /* ignore */
      }
    }

    const segmentPattern = path.join(segmentDir(), "seg_%05d.mkv");
    const geometry = grabGeometry(settings.displayId);
    const args = buildCaptureArgs({
      settings,
      geometry,
      segmentPattern,
      segmentTimeSec: SEGMENT_TIME,
    });

    let ffmpeg: string;
    try {
      ffmpeg = assertFfmpegAvailable();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ status: "error", lastError: message });
      return;
    }
    this.intentionalStop = false;

    try {
      this.proc = spawn(ffmpeg, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ status: "error", lastError: message });
      return;
    }

    const proc = this.proc;
    if (!proc) return;

    // Without this listener, spawn ENOENT becomes an uncaught exception and kills Electron.
    proc.on("error", (err) => {
      this.proc = null;
      this.setState({
        status: "error",
        lastError: err.message.includes("ENOENT")
          ? `ffmpeg.exe introuvable (${ffmpeg})`
          : err.message,
      });
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    proc.on("exit", (code) => {
      this.proc = null;
      if (this.intentionalStop) return;
      if (code && code !== 0) {
        this.setState({
          status: "error",
          lastError: stderr.trim() || `FFmpeg exited with code ${code}`,
        });
      } else if (this.state.status === "running") {
        this.setState({ status: "stopped" });
      }
    });

    this.setState({ status: "running", lastError: null });

    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => {
      pruneSegments(segmentDir(), keep);
    }, 2000);
  }

  async pause(): Promise<void> {
    store.set("bufferEnabled", false);
    await this.stopProcessOnly();
    this.setState({ status: "paused", lastError: null });
  }

  async resume(): Promise<void> {
    store.set("bufferEnabled", true);
    await this.start(getAllSettings());
  }

  async restart(): Promise<void> {
    await this.start(getAllSettings());
  }

  async stop(): Promise<void> {
    await this.stopProcessOnly();
    this.setState({ status: "stopped" });
  }

  private async stopProcessOnly(): Promise<void> {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    const proc = this.proc;
    if (!proc) return;
    this.intentionalStop = true;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      proc.once("exit", done);
      try {
        proc.kill("SIGTERM");
      } catch {
        done();
      }
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        done();
      }, 2000);
    });
    this.proc = null;
  }

  async flushClip(settings: ClipSettings = getAllSettings()): Promise<string | null> {
    if (this.state.flushing) return this.state.lastClipPath;
    this.setState({ flushing: true });
    try {
      const needed = segmentCountForBuffer(settings.bufferSeconds, SEGMENT_TIME);
      const all = selectSegmentsForFlush(segmentDir(), needed);
      const usable = all.length > 1 ? all.slice(0, -1) : all;
      if (!usable.length) {
        this.setState({ flushing: false, lastError: "Buffer empty — wait a few seconds." });
        return null;
      }

      const normalized = normalizeEncoding(settings);
      ensureDir(settings.outputDir);
      const filename = formatClipFilename(new Date(), containerExtension(normalized.containerFormat));
      const outputPath = path.join(settings.outputDir, filename);
      const listPath = path.join(segmentDir(), "concat.txt");
      writeConcatList(usable, listPath);

      const ffmpeg = assertFfmpegAvailable();
      const args = buildRemuxArgs(listPath, outputPath);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpeg, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let err = "";
        child.on("error", (e) => reject(e));
        child.stderr?.on("data", (c: Buffer) => {
          err += c.toString("utf8");
        });
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(err.trim() || `Remux failed (${code})`));
        });
      });

      this.setState({ flushing: false, lastClipPath: outputPath, lastError: null });
      return outputPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ flushing: false, lastError: message });
      return null;
    }
  }
}

export const bufferRecorder = new BufferRecorder();
