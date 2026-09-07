const MAX_EDITOR_EDGE = 1280;

export interface EditorPreview {
  url: string;
  isVideo: boolean;
}

const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"]);

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** MIME from file.type or extension — file picker often leaves type empty on Windows. */
export function guessMediaKind(file: File): "image" | "video" | "audio" | "other" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const ext = fileExtension(file.name);
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "other";
}

export function isVisualMediaFile(file: File | null | undefined): boolean {
  if (!file) return false;
  const kind = guessMediaKind(file);
  return kind === "image" || kind === "video";
}

/** Animated GIFs must stay as the original file — canvas/bitmap capture freezes them. */
export function isGifFile(file: File | null | undefined): boolean {
  if (!file) return false;
  return file.type === "image/gif" || fileExtension(file.name) === "gif";
}

async function downscaleBitmap(
  bitmap: ImageBitmap,
  fallbackUrl: string,
  preserveAlpha: boolean,
): Promise<string> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, MAX_EDITOR_EDGE / longest);
  if (scale >= 1) {
    bitmap.close();
    return fallbackUrl;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return fallbackUrl;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mime = preserveAlpha ? "image/png" : "image/jpeg";
  const quality = preserveAlpha ? undefined : 0.88;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) return fallbackUrl;
  return URL.createObjectURL(blob);
}

function canvasFromVideoFrame(video: HTMLVideoElement): Promise<string> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no canvas context"));
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("thumbnail blob failed"));
        else resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.88,
    );
  });
}

function waitForVideoEvent(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`video ${event} timeout`));
    }, ms);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`video ${event} error`));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onOk);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener(event, onOk, { once: true });
    video.addEventListener("error", onErr, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return;
  video.currentTime = time;
  await waitForVideoEvent(video, "seeked", 8000);
}

async function captureVideoThumbnail(blobUrl: string): Promise<string> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = blobUrl;

  await waitForVideoEvent(video, "loadedmetadata", 15000);
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("no video dimensions");
  }

  const seekTime =
    Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(0.1, video.duration * 0.01)
      : 0.001;
  await seekVideo(video, seekTime);

  try {
    const bitmap = await createImageBitmap(video);
    const fallback = await canvasFromVideoFrame(video);
    const url = await downscaleBitmap(bitmap, fallback, false);
    if (url !== fallback) URL.revokeObjectURL(fallback);
    return url;
  } catch {
    return canvasFromVideoFrame(video);
  }
}

function imagePreservesAlpha(mime: string): boolean {
  return mime === "image/png" || mime === "image/webp" || mime === "image/gif";
}

/** Smaller bitmap for the layout editor — keeps drag/resize responsive on large files. */
export async function createEditorPreviewUrl(file: File): Promise<EditorPreview> {
  const kind = guessMediaKind(file);

  if (kind === "image") {
    if (isGifFile(file)) {
      return { url: URL.createObjectURL(file), isVideo: false };
    }
    const fallbackUrl = URL.createObjectURL(file);
    try {
      const bitmap = await createImageBitmap(file);
      const url = await downscaleBitmap(bitmap, fallbackUrl, imagePreservesAlpha(file.type));
      if (url !== fallbackUrl) URL.revokeObjectURL(fallbackUrl);
      return { url, isVideo: false };
    } catch {
      return { url: fallbackUrl, isVideo: false };
    }
  }

  if (kind === "video") {
    const fallbackUrl = URL.createObjectURL(file);
    try {
      const thumbUrl = await captureVideoThumbnail(fallbackUrl);
      URL.revokeObjectURL(fallbackUrl);
      return { url: thumbUrl, isVideo: false };
    } catch {
      return { url: fallbackUrl, isVideo: true };
    }
  }

  return { url: URL.createObjectURL(file), isVideo: false };
}
