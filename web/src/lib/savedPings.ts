import type { MediaLayout, CaptionLayout } from "../../../shared/types";
import { DEFAULT_FADE_IN_MS, DEFAULT_FADE_OUT_MS } from "../../../shared/types";
import { guessMediaKind } from "./editorPreview";

const DB_NAME = "screen-ping";
const DB_VERSION = 1;
const STORE = "saved-pings";

export interface SavedPingLayer {
  fileName: string;
  mime: string;
  blob: Blob;
  layout: MediaLayout;
  opacity: number;
  zIndex: number;
}

export interface SavedPingRecord {
  id: string;
  name: string;
  createdAt: number;
  mediaType: "image" | "video" | "audio";
  mediaFileName: string;
  mediaMime: string;
  soundFileName?: string;
  soundMime?: string;
  caption: string;
  duration: number;
  delayMs: number;
  audioDelayMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  layout: MediaLayout;
  captionLayout?: CaptionLayout;
  mediaBlob: Blob;
  soundBlob?: Blob;
  layers?: SavedPingLayer[];
}

export interface SavedPingSummary {
  id: string;
  name: string;
  createdAt: number;
  mediaType: string;
  mediaFileName: string;
}

export interface SavePingLayerInput {
  file: File;
  layout: MediaLayout;
  opacity: number;
  zIndex: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open saved pings"));
  });
}

function runTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => reject(req.error ?? new Error("Saved ping request failed"));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error("Could not save ping"));
        tx.onabort = () => reject(tx.error ?? new Error("Could not save ping"));
      }),
  );
}

function cloneBlob(file: Blob, mime?: string): Blob {
  return file.slice(0, file.size, mime || file.type || "application/octet-stream");
}

function mediaTypeOf(file: File): "image" | "video" | "audio" {
  const kind = guessMediaKind(file);
  if (kind === "video" || kind === "audio" || kind === "image") return kind;
  return "image";
}

export async function listSavedPings(): Promise<SavedPingSummary[]> {
  const rows = await runTx<SavedPingRecord[]>("readonly", (s) => s.getAll());
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      mediaType: r.mediaType,
      mediaFileName: r.mediaFileName,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSavedPing(id: string): Promise<SavedPingRecord | null> {
  return runTx<SavedPingRecord | undefined>("readonly", (s) => s.get(id)).then((r) => r ?? null);
}

export async function savePing(input: {
  name: string;
  file?: File | null;
  layers?: SavePingLayerInput[];
  soundFile?: File | null;
  caption: string;
  duration: number;
  delayMs: number;
  audioDelayMs?: number;
  layout: MediaLayout;
  captionLayout?: CaptionLayout;
  fadeInMs?: number;
  fadeOutMs?: number;
}): Promise<string> {
  const layers = input.layers ?? [];
  const primary = layers[0]?.file ?? input.file;
  if (!primary) throw new Error("Choose a file to save");

  const storedLayers: SavedPingLayer[] | undefined =
    layers.length > 0
      ? layers.map((layer) => ({
          fileName: layer.file.name,
          mime: layer.file.type,
          blob: cloneBlob(layer.file, layer.file.type),
          layout: layer.layout,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
        }))
      : undefined;

  const mediaType = layers.length > 0 ? "image" : mediaTypeOf(primary);
  const mediaFileName =
    layers.length > 1 ? `${layers.length} layers` : primary.name;

  const record: SavedPingRecord = {
    id: crypto.randomUUID(),
    name: input.name.trim() || mediaFileName,
    createdAt: Date.now(),
    mediaType,
    mediaFileName,
    mediaMime: primary.type,
    soundFileName: input.soundFile?.name,
    soundMime: input.soundFile?.type,
    caption: input.caption,
    duration: input.duration,
    delayMs: input.delayMs,
    audioDelayMs: input.audioDelayMs ?? 0,
    fadeInMs: input.fadeInMs ?? DEFAULT_FADE_IN_MS,
    fadeOutMs: input.fadeOutMs ?? DEFAULT_FADE_OUT_MS,
    layout: input.layout,
    captionLayout: input.captionLayout,
    mediaBlob: cloneBlob(primary, primary.type),
    soundBlob: input.soundFile ? cloneBlob(input.soundFile, input.soundFile.type) : undefined,
    layers: storedLayers,
  };

  await runTx("readwrite", (s) => s.put(record));
  return record.id;
}

export async function deleteSavedPing(id: string): Promise<void> {
  await runTx("readwrite", (s) => s.delete(id));
}

export function blobToFile(blob: Blob, name: string, type: string): File {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  const fromExt =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : ext === "mp4"
              ? "video/mp4"
              : ext === "webm"
                ? "video/webm"
                : ext === "mp3"
                  ? "audio/mpeg"
                  : ext === "wav"
                    ? "audio/wav"
                    : ext === "ogg"
                      ? "audio/ogg"
                      : ext === "m4a"
                        ? "audio/mp4"
                        : "";
  const mime = type || blob.type || fromExt || "application/octet-stream";
  return new File([blob], name, { type: mime });
}
