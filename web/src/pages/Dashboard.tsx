import { FormEvent, useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import ComposeColumnGlows from "../components/ComposeColumnGlows";
import { useDashboardChrome } from "../context/DashboardChromeContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  api,
  fetchDesktopLatest,
  logoutSession,
  type Friend,
  type MessageHistoryItem,
  type User,
} from "../lib/api";
import {
  cancelMessage,
  connectSocket,
  disconnectSocket,
  reconnectSocket,
  requestDesktopUpdate,
  sendMessage,
  subscribeFriends,
  subscribeSocketConnection,
  waitForSocket,
} from "../lib/socket";
import type { MediaLayout, CaptionLayout } from "../../../shared/types";
import { DEFAULT_LAYOUT, DEFAULT_FADE_IN_MS, DEFAULT_FADE_OUT_MS, MAX_AUDIO_DELAY_MS, MAX_FADE_MS, DEFAULT_CAPTION_LAYOUT, MIN_DURATION_MS, MAX_DURATION_MS, DEFAULT_DURATION_MS, MAX_IMAGE_LAYERS, clampLayout, clampCaptionLayout, COMPILED_SCENE_LAYOUT } from "../../../shared/types";
import { isVersionOlder } from "../../../shared/version";
import { applyPresenceUpdate } from "../lib/presence";
import {
  hasEverConnectedDesktop,
  markDesktopEverConnected,
  openDesktopInstaller,
  openDesktopUpdateApp,
} from "../lib/desktopUpdate";
import MediaLayoutEditor from "../components/MediaLayoutEditor";
import LayeredComposeEditor from "../components/LayeredComposeEditor";
import ComposeLayersPanel from "../components/ComposeLayersPanel";
import PrecisionSlider from "../components/PrecisionSlider";
import FriendsPanel from "../components/FriendsPanel";
import DrawPanel from "../components/DrawPanel";
import FriendPicker from "../components/FriendPicker";
import DesktopStatusToast from "../components/DesktopStatusToast";
import EmptyState from "../components/EmptyState";
import DashboardSkeleton from "../components/DashboardSkeleton";
import LoadingDots from "../components/LoadingDots";
import StatusBadge from "../components/StatusBadge";
import {
  blobToFile,
  deleteSavedPing,
  getSavedPing,
  listSavedPings,
  savePing,
  type SavedPingSummary,
} from "../lib/savedPings";
import { createEditorPreviewUrl, guessMediaKind, isGifFile, isVisualMediaFile } from "../lib/editorPreview";
import { mediaDurationKey, stayDurationFromMedia } from "../lib/mediaDuration";
import { rasterizeCaptionText } from "../lib/rasterizeCaption";
import {
  canAddLayers,
  createEditorLayer,
  reindexLayers,
  revokeLayerUrls,
  sortLayersByZ,
  type EditorImageLayer,
} from "../lib/imageLayers";

type Tab = "send" | "friends" | "draw";

interface FilePickerProps {
  label: string;
  hint?: string;
  accept: string;
  value: File | null;
  onChange: (file: File | null) => void;
  onPickFiles?: (files: File[]) => void;
  multiple?: boolean;
  displayLabel?: string;
  required?: boolean;
  compact?: boolean;
}

function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes("Files");
}

function filesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  if (dt.files?.length) return Array.from(dt.files);
  return Array.from(dt.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function useFileDrop(onFiles: (files: File[]) => void) {
  const [dropActive, setDropActive] = useState(false);
  const depthRef = useRef(0);

  const onDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current += 1;
    setDropActive(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDropActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      depthRef.current = 0;
      setDropActive(false);
      const files = filesFromDataTransfer(e.dataTransfer);
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  return { dropActive, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

function FilePicker({ label, hint, accept, value, onChange, onPickFiles, multiple, displayLabel, compact }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioOnly = accept.includes("audio") && !accept.includes("image") && !accept.includes("video");

  const handleDropped = useCallback(
    (files: File[]) => {
      if (audioOnly) {
        const audio = files.find((file) => guessMediaKind(file) === "audio");
        if (audio) onChange(audio);
        return;
      }
      if (onPickFiles) {
        onPickFiles(files);
        return;
      }
      if (files[0]) onChange(files[0]);
    },
    [audioOnly, onChange, onPickFiles],
  );
  const { dropActive, dropHandlers } = useFileDrop(handleDropped);

  function openPicker() {
    if (inputRef.current) {
      // Allow re-selecting the same file (browser skips onChange if path unchanged).
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }

  function clearFile(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = "";
    onChange(null);
  }

  const hasSelection = Boolean(value || displayLabel);

  return (
    <div>
      <span className="field-label">{label}</span>
      <div
        className={`upload-zone ${compact ? "px-2.5 py-2" : "px-3 py-3"} ${hasSelection ? "pr-8" : ""} ${
          dropActive ? "is-drop-active" : ""
        }`}
        {...dropHandlers}
      >
        <button
          type="button"
          onClick={openPicker}
          className="flex min-w-0 flex-1 items-center gap-2.5 bg-transparent text-left"
        >
          <span
            className={`flex shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-[rgb(8_8_12/0.55)] text-slate-400 ${
              compact ? "h-7 w-7 text-sm" : "h-8 w-8 text-base"
            }`}
          >
            {value ? "✓" : "+"}
          </span>
          <span className="min-w-0 flex-1">
            {value || displayLabel ? (
              <>
                <span className="block truncate text-sm font-medium text-white">{value?.name ?? displayLabel}</span>
                <span className="block text-xs text-slate-500">{value ? "Click to replace" : hint}</span>
              </>
            ) : (
              <>
                <span className="block text-sm text-slate-300">Choose a file</span>
                {hint && <span className="block text-xs text-slate-500">{hint}</span>}
              </>
            )}
          </span>
        </button>
        {hasSelection && (
          <button
            type="button"
            onClick={clearFile}
            aria-label={displayLabel ? "Remove all layers" : `Remove ${label.toLowerCase()}`}
            title={displayLabel ? "Remove all layers" : `Remove ${label.toLowerCase()}`}
            className="absolute right-2 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded p-2 text-slate-500 transition hover:text-red-400"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const list = e.target.files;
          if (!list?.length) {
            onChange(null);
            return;
          }
          if (onPickFiles) {
            onPickFiles(Array.from(list));
            return;
          }
          onChange(list[0] || null);
        }}
      />
    </div>
  );
}

function ComposePreviewDropzone({ onPickFiles }: { onPickFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dropActive, dropHandlers } = useFileDrop(onPickFiles);

  function openPicker() {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className={`compose-preview-empty group ${dropActive ? "is-drop-active" : ""}`}
        {...dropHandlers}
      >
        <span className="compose-preview-empty-icon" aria-hidden>
          +
        </span>
        <p className="text-sm text-slate-300 transition duration-200 group-hover:text-white">
          Add images or a video to preview and position
        </p>
        <p className="mt-1 text-xs text-slate-500 transition duration-200 group-hover:text-slate-400">
          Click to choose — multiple images become layers
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/mp4,video/webm"
        multiple
        className="sr-only"
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) onPickFiles(Array.from(list));
          e.target.value = "";
        }}
      />
    </>
  );
}

function formatDelay(ms: number): string {
  if (ms === 0) return "Now";
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  return sec % 1 === 0 ? `${sec} sec` : `${sec.toFixed(2)} sec`;
}

function formatDuration(ms: number): string {
  const sec = ms / 1000;
  return sec % 1 === 0 ? `${sec} sec` : `${sec.toFixed(2)} sec`;
}

function formatFade(ms: number): string {
  if (ms === 0) return "None";
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  return sec % 1 === 0 ? `${sec} sec` : `${sec.toFixed(2)} sec`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function statusTone(message: string): "neutral" | "success" | "error" {
  const lower = message.toLowerCase();
  if (lower.includes("failed") || lower.includes("error") || lower.includes("no longer available")) return "error";
  if (lower.includes("sent to") || lower.includes("saved") || lower.includes("loaded")) return "success";
  return "neutral";
}

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
  const { setChrome } = useDashboardChrome();
  const [tab, setTab] = useState<Tab>("send");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [history, setHistory] = useState<MessageHistoryItem[]>([]);
  const [savedPings, setSavedPings] = useState<SavedPingSummary[]>([]);
  const [receiverIds, setReceiverIds] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [soundFile, setSoundFile] = useState<File | null>(null);
  const [editorPreviewUrl, setEditorPreviewUrl] = useState<string | null>(null);
  const [editorPreviewIsVideo, setEditorPreviewIsVideo] = useState(false);
  const [caption, setCaption] = useState("");
  const [overlayCaption, setOverlayCaption] = useState("");
  const [captionLayout, setCaptionLayout] = useState<CaptionLayout>(DEFAULT_CAPTION_LAYOUT);
  const [addingCaption, setAddingCaption] = useState(false);
  const [duration, setDuration] = useState(DEFAULT_DURATION_MS);
  const [delayMs, setDelayMs] = useState(0);
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  const [fadeInMs, setFadeInMs] = useState(DEFAULT_FADE_IN_MS);
  const [fadeOutMs, setFadeOutMs] = useState(DEFAULT_FADE_OUT_MS);
  const [layout, setLayout] = useState<MediaLayout>(DEFAULT_LAYOUT);
  const [imageLayers, setImageLayers] = useState<EditorImageLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [desktopDownload, setDesktopDownload] = useState<{ version: string; download_url: string } | null>(
    null,
  );
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(() =>
    sessionStorage.getItem("sp-dismiss-desktop-update-for"),
  );
  const [dismissedClosed, setDismissedClosed] = useState(
    () => sessionStorage.getItem("sp-dismiss-desktop-closed") === "1",
  );
  const [dismissedInstall, setDismissedInstall] = useState(
    () => sessionStorage.getItem("sp-dismiss-desktop-install") === "1",
  );
  const skipDurationSyncRef = useRef(false);
  const lastDurationMediaKeyRef = useRef("");

  const uploadFile = file ?? soundFile;
  const isLayerCompose = imageLayers.length > 0 && !file;
  const isSoundOnly = Boolean(soundFile && !file && imageLayers.length === 0);
  const isVideo = file ? guessMediaKind(file) === "video" : false;
  const isImage = file ? guessMediaKind(file) === "image" : false;
  const hasVisualMedia = isVisualMediaFile(file) || imageLayers.length > 0;
  const hasSound = Boolean(soundFile);
  const overlaySound = hasVisualMedia && soundFile ? soundFile : undefined;
  const showLayoutEditor = isVisualMediaFile(file) || imageLayers.length > 0;
  const hasSendMedia = Boolean(uploadFile) || imageLayers.length > 0;
  const canSend = hasSendMedia && receiverIds.length > 0 && !loading;

  const desktopUrl =
    desktopDownload?.download_url ?? "https://screenping.xyz/api/desktop/download";
  const desktopOnline = Boolean(currentUser?.is_desktop_online);
  const needsDesktopInstall = Boolean(currentUser && !desktopOnline && !hasEverConnectedDesktop());
  const needsDesktopOpen = Boolean(currentUser && !desktopOnline && hasEverConnectedDesktop());
  const desktopUpdateAvailable = Boolean(
    desktopDownload &&
      desktopOnline &&
      dismissedUpdateVersion !== desktopDownload.version &&
      currentUser?.desktop_version &&
      isVersionOlder(currentUser.desktop_version, desktopDownload.version),
  );

  function downloadDesktopApp() {
    openDesktopInstaller(desktopUrl);
    setStatus("Downloading Screen Ping — run the installer when it is ready, then sign in.");
  }

  async function openDesktopUpdate() {
    if (desktopOnline) {
      try {
        const result = await requestDesktopUpdate();
        if (result.ok) {
          setStatus("Update check started in the desktop app.");
          return;
        }
      } catch {
        // Fallback to protocol below.
      }
    }

    openDesktopUpdateApp();
    setStatus(
      "Screen Ping opened — the update check starts from the tray menu. Allow it if your browser asks.",
    );
  }

  async function refreshSaved() {
    setSavedPings(await listSavedPings());
  }

  const imageLayersRef = useRef(imageLayers);
  imageLayersRef.current = imageLayers;

  function onCaptionChange(value: string) {
    setCaption(value);
  }

  const addCaptionAsLayer = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    if (isVideo) {
      setCaptionLayout((prev) => (overlayCaption.trim() ? prev : DEFAULT_CAPTION_LAYOUT));
      setOverlayCaption(trimmed);
      return true;
    }

    if (!canAddLayers(imageLayersRef.current.length, 1)) {
      setStatus(`Maximum ${MAX_IMAGE_LAYERS} image layers`);
      return false;
    }

    const { file: captionFile, layout: captionLayerLayout } = await rasterizeCaptionText(trimmed);
    const preview = await createEditorPreviewUrl(captionFile);
    const zIndex = imageLayersRef.current.length;
    const layer = createEditorLayer(captionFile, preview.url, zIndex, captionLayerLayout);

    setFile(null);
    setImageLayers((prev) => reindexLayers([...prev, layer]));
    setActiveLayerId(layer.id);
    setOverlayCaption("");
    setCaptionLayout(DEFAULT_CAPTION_LAYOUT);
    return true;
  }, [isVideo, overlayCaption]);

  async function handleAddCaption() {
    const trimmed = caption.trim();
    if (!trimmed || addingCaption) return;
    setAddingCaption(true);
    try {
      const added = await addCaptionAsLayer(trimmed);
      if (added) setCaption("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not add caption");
    } finally {
      setAddingCaption(false);
    }
  }

  const addImageFiles = useCallback(async (files: FileList | File[], replace = false) => {
    const list = Array.from(files).filter((f) => guessMediaKind(f) === "image");
    if (list.length === 0) return;

    const baseCount = replace ? 0 : imageLayersRef.current.length;
    if (!canAddLayers(baseCount, list.length)) {
      setStatus(`Maximum ${MAX_IMAGE_LAYERS} image layers`);
      return;
    }

    const allowed = list.slice(0, MAX_IMAGE_LAYERS - baseCount);
    const created: EditorImageLayer[] = [];
    for (let i = 0; i < allowed.length; i++) {
      const f = allowed[i];
      const preview = await createEditorPreviewUrl(f);
      created.push(createEditorLayer(f, preview.url, baseCount + i));
    }

    setImageLayers((prev) => {
      if (replace) {
        revokeLayerUrls(prev);
        return reindexLayers(created);
      }
      return reindexLayers([...prev, ...created]);
    });
    setActiveLayerId(created[created.length - 1]?.id ?? null);
    setFile(null);
  }, []);

  const ingestMediaFiles = useCallback(
    (files: File[]) => {
      const video = files.find((f) => guessMediaKind(f) === "video");
      if (video) {
        revokeLayerUrls(imageLayersRef.current);
        setImageLayers([]);
        setActiveLayerId(null);
        setFile(video);
        setLayout(DEFAULT_LAYOUT);
        setOverlayCaption("");
        setCaptionLayout(DEFAULT_CAPTION_LAYOUT);
        return;
      }

      const images = files.filter((f) => guessMediaKind(f) === "image");
      if (images.length === 0) return;

      setFile(null);
      setOverlayCaption("");
      setCaptionLayout(DEFAULT_CAPTION_LAYOUT);
      const replace = imageLayersRef.current.length === 0;
      void addImageFiles(images, replace);
    },
    [addImageFiles],
  );

  const ingestDroppedFiles = useCallback(
    (files: File[]) => {
      const audio = files.find((f) => guessMediaKind(f) === "audio");
      if (audio) setSoundFile(audio);
      ingestMediaFiles(files);
    },
    [ingestMediaFiles],
  );
  const { dropActive: previewDropActive, dropHandlers: previewDropHandlers } = useFileDrop(ingestDroppedFiles);

  function onMediaFileChange(newFile: File | null) {
    if (!newFile) {
      setFile(null);
      revokeLayerUrls(imageLayers);
      setImageLayers([]);
      setActiveLayerId(null);
      return;
    }
    void ingestMediaFiles([newFile]);
  }

  const handleAddImages = useCallback(
    (files: FileList | File[]) => {
      void addImageFiles(files, false);
    },
    [addImageFiles],
  );

  useEffect(() => {
    return () => revokeLayerUrls(imageLayers);
  }, []);

  useEffect(() => {
    if (!file) {
      setEditorPreviewUrl(null);
      setEditorPreviewIsVideo(false);
      return;
    }

    let activeUrl: string | null = null;
    let cancelled = false;
    void createEditorPreviewUrl(file).then((preview) => {
      if (cancelled) {
        URL.revokeObjectURL(preview.url);
        return;
      }
      activeUrl = preview.url;
      setEditorPreviewUrl(preview.url);
      setEditorPreviewIsVideo(preview.isVideo);
    });

    return () => {
      cancelled = true;
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [file]);

  // Match Stay on screen to the longest of video / sound (clamped 2–30s).
  useEffect(() => {
    const key = mediaDurationKey(file, soundFile);
    if (!key || key === "|" || key === lastDurationMediaKeyRef.current) return;
    if (skipDurationSyncRef.current) {
      skipDurationSyncRef.current = false;
      lastDurationMediaKeyRef.current = key;
      return;
    }
    lastDurationMediaKeyRef.current = key;
    let cancelled = false;
    void stayDurationFromMedia(file, soundFile).then((ms) => {
      if (cancelled || ms == null) return;
      setDuration(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [file, soundFile]);

  const handleLayoutChange = useCallback((next: MediaLayout) => {
    setLayout(next);
  }, []);

  useEffect(() => {
    const onlineIds = new Set(
      friends.filter((f) => f.status === "accepted" && f.is_online).map((f) => f.user_id),
    );
    if (currentUser?.is_desktop_online) {
      onlineIds.add(currentUser.id);
    }
    setReceiverIds((prev) => prev.filter((id) => onlineIds.has(id)));
  }, [friends, currentUser]);

  async function refreshCurrentUser() {
    try {
      setCurrentUser(await api.me());
    } catch {
      setCurrentUser(null);
    }
  }

  async function refreshDesktopLatest() {
    try {
      setDesktopDownload(await fetchDesktopLatest());
    } catch {
      setDesktopDownload(null);
    }
  }

  useEffect(() => {
    void refreshDesktopLatest();
    const onFocus = () => {
      void refreshDesktopLatest();
      void refreshCurrentUser();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    return subscribeSocketConnection((connected) => {
      if (connected) {
        void refreshCurrentUser();
        void api.friends().then(setFriends).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (!desktopOnline) return;
    markDesktopEverConnected();
    sessionStorage.removeItem("sp-dismiss-desktop-closed");
    sessionStorage.removeItem("sp-dismiss-desktop-install");
    setDismissedClosed(false);
    setDismissedInstall(false);
  }, [desktopOnline]);

  useEffect(() => {
    void (async () => {
      try {
        await refreshCurrentUser();
        setFriends(await api.friends());
        setHistory(await api.history());
        await refreshSaved();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Could not load dashboard");
      } finally {
        setPageLoading(false);
      }
    })();
    connectSocket((data) => {
      setStatus(`Message ${data.messageId.slice(0, 8)}... → ${data.status}${data.reason ? ` (${data.reason})` : ""}`);
      void api.history().then(setHistory).catch(() => {});
    }, (data) => {
      setFriends((prev) => applyPresenceUpdate(prev, data));
      setCurrentUser((prev) =>
        prev && prev.id === data.userId ? { ...prev, is_desktop_online: data.isOnline } : prev,
      );
    });
    const unsubFriends = subscribeFriends(() => {
      void api.friends().then(setFriends).catch(() => {});
    });
    return () => {
      unsubFriends();
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    if (tab !== "send") return;
    void refreshCurrentUser();
    void refreshDesktopLatest();
    const timer = setInterval(() => {
      void refreshCurrentUser();
      void refreshDesktopLatest();
    }, 10_000);
    return () => clearInterval(timer);
  }, [tab]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!hasSendMedia) {
      setStatus("Choose a file or load a saved ping");
      return;
    }
    if (receiverIds.length === 0) {
      setStatus("Select at least one online friend");
      return;
    }
    const uploadSound = overlaySound;
    const sendAudioDelay = hasSound ? audioDelayMs : 0;
    setLoading(true);
    setStatus("Uploading...");
    try {
      await reconnectSocket();
      await waitForSocket();

      let uploads;
      let sendLayout = layout;

      const sendOverlayCaption = isVideo ? overlayCaption.trim() || undefined : undefined;

      if (isLayerCompose) {
        const orderedLayers = sortLayersByZ(imageLayers);
        const onlyGif = orderedLayers.length === 1 && isGifFile(orderedLayers[0].file);
        if (onlyGif) {
          // Keep the original GIF so the receiver animates it. Compose flattens to a still WebP.
          uploads = await api.uploadBatch(receiverIds, orderedLayers[0].file, undefined, uploadSound);
          sendLayout = {
            ...orderedLayers[0].layout,
            opacity: orderedLayers[0].opacity,
          };
        } else {
          uploads = await api.uploadLayers(
            receiverIds,
            orderedLayers.map((layer) => ({
              file: layer.file,
              layout: layer.layout,
              opacity: layer.opacity,
              zIndex: layer.zIndex,
            })),
            undefined,
            uploadSound,
          );
          sendLayout = COMPILED_SCENE_LAYOUT;
        }
      } else {
        const mainFile = file ?? soundFile;
        if (!mainFile) throw new Error("Choose a file or load a saved ping");
        uploads = await api.uploadBatch(
          receiverIds,
          mainFile,
          sendOverlayCaption,
          uploadSound,
        );
      }

      setStatus("Sending...");
      for (const upload of uploads) {
        sendMessage(
          upload.receiver_id,
          upload.message_id,
          duration,
          sendLayout,
          delayMs,
          fadeInMs,
          fadeOutMs,
          hasSound ? sendAudioDelay : 0,
          sendOverlayCaption ? captionLayout : undefined,
        );
      }
      const count = uploads.length;
      setStatus(`Sent to ${count} friend${count === 1 ? "" : "s"} — you can send again`);
      setCaption("");
      setOverlayCaption("");
      setCaptionLayout(DEFAULT_CAPTION_LAYOUT);
      void api.history().then(setHistory).catch(() => {});
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  function handleCancelPending(messageId: string) {
    try {
      setHistory((prev) =>
        prev.map((item) =>
          item.id === messageId ? { ...item, delivery_status: "failed" } : item,
        ),
      );
      cancelMessage(messageId);
      setStatus(`Cancelling ${messageId.slice(0, 8)}...`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not cancel");
      void api.history().then(setHistory).catch(() => {});
    }
  }

  async function handleSavePing() {
    const hasLayers = imageLayers.length > 0;
    const uploadFile = file ?? soundFile;
    if (!hasLayers && !uploadFile) return;
    try {
      if (hasLayers) {
        await savePing({
          name: saveName || (imageLayers.length === 1 ? imageLayers[0].name : `${imageLayers.length} layers`),
          layers: imageLayers.map((layer) => ({
            file: layer.file,
            layout: layer.layout,
            opacity: layer.opacity,
            zIndex: layer.zIndex,
          })),
          soundFile: overlaySound ?? null,
          caption: "",
          duration,
          delayMs,
          audioDelayMs: hasSound ? audioDelayMs : 0,
          fadeInMs,
          fadeOutMs,
          layout: imageLayers.length === 1 ? imageLayers[0].layout : COMPILED_SCENE_LAYOUT,
        });
      } else {
        await savePing({
          name: saveName || uploadFile!.name,
          file: uploadFile!,
          soundFile: overlaySound ?? null,
          caption: overlayCaption,
          duration,
          delayMs,
          audioDelayMs: hasSound ? audioDelayMs : 0,
          fadeInMs,
          fadeOutMs,
          layout,
          captionLayout: overlayCaption.trim() ? captionLayout : undefined,
        });
      }
      setSaveName("");
      setShowSaveInput(false);
      setStatus("Ping saved");
      await refreshSaved();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save ping");
    }
  }

  async function loadSavedPing(id: string) {
    const saved = await getSavedPing(id);
    if (!saved) return;

    // Keep the saved Stay on screen — don't re-probe media length on this load.
    skipDurationSyncRef.current = true;

    revokeLayerUrls(imageLayersRef.current);
    setImageLayers([]);
    setActiveLayerId(null);

    const sound =
      saved.soundBlob && saved.soundFileName
        ? blobToFile(saved.soundBlob, saved.soundFileName, saved.soundMime ?? "")
        : null;

    let loadedVideo = false;
    let pendingCaptionLayers: EditorImageLayer[] | null = null;

    if (saved.layers && saved.layers.length > 0) {
      const created: EditorImageLayer[] = [];
      for (let i = 0; i < saved.layers.length; i++) {
        const layer = saved.layers[i];
        const layerFile = blobToFile(layer.blob, layer.fileName, layer.mime);
        const preview = await createEditorPreviewUrl(layerFile);
        created.push({
          ...createEditorLayer(layerFile, preview.url, layer.zIndex ?? i),
          layout: clampLayout(layer.layout ?? DEFAULT_LAYOUT),
          opacity: layer.opacity ?? 1,
          zIndex: layer.zIndex ?? i,
        });
      }
      pendingCaptionLayers = created;
      setFile(null);
      setSoundFile(sound);
    } else {
      const mediaFile = blobToFile(saved.mediaBlob, saved.mediaFileName, saved.mediaMime);
      if (saved.mediaType === "audio") {
        setFile(null);
        setSoundFile(mediaFile);
      } else if (saved.mediaType === "video") {
        loadedVideo = true;
        setFile(mediaFile);
        setSoundFile(sound);
      } else {
        const preview = await createEditorPreviewUrl(mediaFile);
        const layer = {
          ...createEditorLayer(mediaFile, preview.url, 0),
          layout: clampLayout(saved.layout ?? DEFAULT_LAYOUT),
        };
        pendingCaptionLayers = [layer];
        setFile(null);
        setSoundFile(sound);
      }
    }

    if (pendingCaptionLayers) {
      const captionText = saved.caption.trim();
      if (captionText && canAddLayers(pendingCaptionLayers.length, 1)) {
        try {
          const { file: captionFile, layout: captionLayerLayout } = await rasterizeCaptionText(captionText);
          const preview = await createEditorPreviewUrl(captionFile);
          pendingCaptionLayers.push(
            createEditorLayer(captionFile, preview.url, pendingCaptionLayers.length, captionLayerLayout),
          );
        } catch {
          // Keep the ping even if the old caption cannot be rasterized.
        }
      }
      const nextLayers = reindexLayers(pendingCaptionLayers);
      setImageLayers(nextLayers);
      setActiveLayerId(nextLayers[nextLayers.length - 1]?.id ?? null);
    }

    setCaption("");
    setOverlayCaption(loadedVideo ? saved.caption : "");
    setCaptionLayout(clampCaptionLayout(saved.captionLayout ?? DEFAULT_CAPTION_LAYOUT));
    setDuration(saved.duration);
    setDelayMs(saved.delayMs);
    setAudioDelayMs(saved.audioDelayMs ?? 0);
    setFadeInMs(saved.fadeInMs ?? DEFAULT_FADE_IN_MS);
    setFadeOutMs(saved.fadeOutMs ?? DEFAULT_FADE_OUT_MS);
    setLayout(clampLayout(saved.layout ?? DEFAULT_LAYOUT));
    setTab("send");
    setStatus(`Loaded "${saved.name}"`);
  }

  async function removeSavedPing(id: string) {
    await deleteSavedPing(id);
    await refreshSaved();
  }

  const logout = useCallback(() => {
    disconnectSocket();
    void logoutSession().then(() => {
      window.location.href = "/login";
    });
  }, []);

  const friendsPending = friends.some((f) => f.status === "pending" && f.direction === "incoming");

  useEffect(() => {
    setChrome({
      tab,
      setTab,
      friendsPending,
      onLogout: logout,
    });
    return () => setChrome(null);
  }, [tab, friendsPending, logout, setChrome]);

  if (pageLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className={tab === "friends" ? "space-y-4" : tab === "draw" ? "flex h-full min-h-0 flex-col xl:flex-1" : "flex min-h-0 flex-col xl:flex-1"}>
      {desktopUpdateAvailable && desktopDownload && (
        <DesktopStatusToast
          title="Desktop update available"
          onDismiss={() => {
            sessionStorage.setItem("sp-dismiss-desktop-update-for", desktopDownload.version);
            setDismissedUpdateVersion(desktopDownload.version);
          }}
        >
          You have v{currentUser?.desktop_version}. Update to v{desktopDownload.version} for the latest fixes.{" "}
          <button type="button" onClick={openDesktopUpdate} className="underline hover:text-white">
            Update Screen Ping
          </button>{" "}
          <span className="text-slate-500">(</span>
          <button type="button" onClick={downloadDesktopApp} className="underline hover:text-white">
            manual installer
          </button>
          <span className="text-slate-500">)</span>
        </DesktopStatusToast>
      )}
      {!desktopUpdateAvailable && needsDesktopOpen && !dismissedClosed && (
        <DesktopStatusToast
          title="Desktop app is closed"
          onDismiss={() => {
            sessionStorage.setItem("sp-dismiss-desktop-closed", "1");
            setDismissedClosed(true);
          }}
        >
          Open <span className="font-medium text-white">Screen Ping</span> from the system tray to receive pings.
          Friends only show as online when their desktop app is open.
        </DesktopStatusToast>
      )}
      {!desktopUpdateAvailable && needsDesktopInstall && !dismissedInstall && (
        <DesktopStatusToast
          title="Install the desktop app"
          onDismiss={() => {
            sessionStorage.setItem("sp-dismiss-desktop-install", "1");
            setDismissedInstall(true);
          }}
        >
          To receive pings on your screen, download and install{" "}
          <button type="button" onClick={downloadDesktopApp} className="underline hover:text-white">
            Screen Ping{desktopDownload ? ` v${desktopDownload.version}` : ""}
          </button>
          , then open the app (icon near the clock).
        </DesktopStatusToast>
      )}
      {tab === "friends" ? (
        <div id="panel-friends" className="panel p-4" role="tabpanel" aria-labelledby="tab-friends">
          <FriendsPanel onFriendsChange={setFriends} />
        </div>
      ) : tab === "draw" ? (
        <DrawPanel friends={friends} currentUser={currentUser} />
      ) : (
        <div id="panel-send" role="tabpanel" aria-labelledby="tab-send" className="flex min-h-0 flex-col gap-3 overflow-visible xl:flex-1">
          <form noValidate onSubmit={handleSend} className="compose-layout compose-layout-fill">
            <ComposeColumnGlows />
            <section className="compose-recipients-mobile compose-mobile-block order-0 panel p-3 xl:hidden" aria-label="Recipients">
              <h3 className="form-section-title mb-2">To</h3>
              <FriendPicker
                friends={friends}
                selectedIds={receiverIds}
                onChange={setReceiverIds}
                currentUser={currentUser}
                compact
              />
            </section>

            <aside className="compose-side compose-side-left panel order-2 flex min-h-0 flex-col gap-3 p-3 sm:p-4 xl:order-none">
              <section className="form-section compose-side-panel compose-side-saved flex min-h-0 flex-1 flex-col overflow-hidden">
                <h3 className="form-section-title">Saved pings</h3>
                {savedPings.length === 0 ? (
                  <EmptyState
                    title="No saved pings"
                    className="compose-side-panel-body mt-2 py-4"
                  />
                ) : (
                  <ul className="scroll-area compose-side-saved-list mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                    {savedPings.map((s) => (
                      <li key={s.id} className="list-row">
                        <span className="min-w-0 truncate text-slate-300">
                          <strong className="font-medium text-white">{s.name}</strong>
                          <span className="text-slate-500"> · {s.mediaType}</span>
                        </span>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => void loadSavedPing(s.id)}
                            className="btn-compact"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeSavedPing(s.id)}
                            className="btn-ghost"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="form-section compose-side-panel compose-side-recent flex min-h-0 flex-1 flex-col overflow-hidden">
                <h3 className="form-section-title">Recent sends</h3>
                {history.length === 0 ? (
                  <EmptyState
                    title="No pings sent yet"
                    className="compose-side-panel-body mt-2 py-4"
                  />
                ) : (
                  <ul
                    className="scroll-area compose-side-recent-list mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto"
                    aria-label="Send history"
                  >
                    {history.map((h) => (
                      <li key={h.id} className="list-row">
                        <span className="min-w-0 truncate text-slate-300">
                          To <strong className="font-medium text-white">{h.receiver_username}</strong>
                          <span className="text-slate-500"> · {h.media_type}</span>
                          <span className="text-slate-600"> · {formatRelativeTime(h.created_at)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <StatusBadge status={h.delivery_status} />
                          {(h.delivery_status === "pending" ||
                            h.delivery_status === "offline" ||
                            h.delivery_status === "paused") && (
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() => handleCancelPending(h.id)}
                              aria-label={`Cancel pending send to ${h.receiver_username}`}
                            >
                              Cancel
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>

            <div className="compose-center-col order-1 flex min-h-0 flex-col xl:order-none">
            <section className="compose-center compose-center-fill panel flex flex-col p-1 sm:p-1.5 xl:h-full xl:min-h-0">
              <div className="compose-center-stack flex flex-col xl:min-h-0 xl:flex-1">
                <div className="compose-preview-column flex flex-col items-center xl:min-h-0 xl:flex-1">
                  <div className="compose-preview-stack w-full xl:min-h-0 xl:flex-1">
                    <div className="compose-preview-grow w-full">
                      <div
                        className={`compose-preview-slot ${previewDropActive ? "is-drop-active" : ""}`}
                        {...previewDropHandlers}
                      >
                        {showLayoutEditor ? (
                          isLayerCompose ? (
                            <LayeredComposeEditor
                              layers={imageLayers}
                              activeLayerId={activeLayerId}
                              onLayersChange={setImageLayers}
                              onActiveLayerChange={setActiveLayerId}
                              large
                            />
                          ) : editorPreviewUrl ? (
                            <MediaLayoutEditor
                              previewUrl={editorPreviewUrl}
                              isVideo={editorPreviewIsVideo}
                              isAudio={false}
                              layout={layout}
                              onChange={handleLayoutChange}
                              caption={overlayCaption}
                              captionLayout={captionLayout}
                              onCaptionLayoutChange={setCaptionLayout}
                              large
                            />
                          ) : (
                            <div className="compose-preview-editor flex h-full w-full items-center justify-center">
                              <div className="compose-preview-frame flex h-full w-full items-center justify-center">
                                <LoadingDots label="Loading preview…" />
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="compose-preview-editor compose-preview-editor--dropzone h-full w-full">
                            <div className="compose-preview-frame">
                              <ComposePreviewDropzone onPickFiles={ingestDroppedFiles} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <section className="compose-recipients-bar hidden shrink-0 xl:flex" aria-label="Recipients">
                      <FriendPicker
                        friends={friends}
                        selectedIds={receiverIds}
                        onChange={setReceiverIds}
                        currentUser={currentUser}
                        compact
                      />
                    </section>
                  </div>
                </div>
              </div>
            </section>
            </div>

            <aside className="compose-side compose-side-right panel order-3 flex min-h-0 flex-col gap-3 p-3 sm:p-4 xl:order-none">
              <div className="compose-side-right-body min-h-0 flex-1 space-y-3">
              <section className="form-section space-y-2.5">
                <h3 className="form-section-title">Media</h3>
                <FilePicker
                  label="File"
                  hint={isLayerCompose ? "Add more images as layers" : "Image(s) or video — multi-select for layers"}
                  accept="image/*,video/mp4,video/webm"
                  value={file}
                  onChange={onMediaFileChange}
                  onPickFiles={ingestDroppedFiles}
                  multiple
                  displayLabel={isLayerCompose ? `${imageLayers.length} image layer(s)` : undefined}
                />
                {isLayerCompose && (
                  <ComposeLayersPanel
                    layers={imageLayers}
                    activeLayerId={activeLayerId}
                    onLayersChange={setImageLayers}
                    onActiveLayerChange={setActiveLayerId}
                    onAddImages={handleAddImages}
                  />
                )}
                <FilePicker
                  label="Sound"
                  hint="Optional — plays with image or video"
                  accept="audio/*"
                  value={soundFile}
                  onChange={setSoundFile}
                  compact
                />
                {isSoundOnly && (
                  <p className="text-xs text-slate-500">Sound only — nothing appears on screen.</p>
                )}
                {hasSound && (
                  <PrecisionSlider
                    label="Sound delay"
                    value={audioDelayMs}
                    min={0}
                    max={MAX_AUDIO_DELAY_MS}
                    step={10}
                    inputStep={10}
                    displayAsSeconds
                    format={formatDelay}
                    onChange={setAudioDelayMs}
                  />
                )}
                <div className="flex flex-col gap-2 pt-1">
                  <button type="submit" disabled={!canSend} className="btn-primary w-full">
                    {loading
                      ? "Sending…"
                      : receiverIds.length > 1
                        ? `Send to ${receiverIds.length} friends`
                        : "Send ping"}
                  </button>
                  {hasSendMedia && (
                    <button
                      type="button"
                      onClick={() => setShowSaveInput((v) => !v)}
                      className="btn-secondary w-full"
                    >
                      Save ping
                    </button>
                  )}
                </div>
                {status && (
                  <p
                    role="status"
                    aria-live="polite"
                    className={`text-xs ${
                      statusTone(status) === "error"
                        ? "text-red-400"
                        : statusTone(status) === "success"
                          ? "text-accent-400"
                          : "text-slate-400"
                    }`}
                  >
                    {status}
                  </p>
                )}
                {showSaveInput && hasSendMedia && (
                  <div className="flex gap-2">
                    <input
                      className="field-input min-w-0 flex-1"
                      placeholder="Name for this ping"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                    />
                    <button type="button" onClick={() => void handleSavePing()} className="btn-secondary shrink-0">
                      Save
                    </button>
                  </div>
                )}
              </section>

              <section className="form-section space-y-3">
                <h3 className="form-section-title">Caption &amp; timing</h3>
                <div>
                  <label htmlFor="caption" className="field-label">
                    Caption
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="caption"
                      className="field-input min-w-0 flex-1"
                      placeholder={isVideo ? "Meme text — press + to place it" : "Meme text — press + to add as a layer"}
                      value={caption}
                      maxLength={500}
                      onChange={(e) => onCaptionChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAddCaption();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn-secondary flex h-[42px] w-[42px] shrink-0 items-center justify-center !p-0 text-xl leading-none"
                      aria-label="Add caption"
                      title="Add caption"
                      disabled={!caption.trim() || addingCaption || (!isVideo && !canAddLayers(imageLayers.length, 1))}
                      onClick={() => void handleAddCaption()}
                    >
                      {addingCaption ? "…" : "+"}
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <PrecisionSlider
                    label="Show after"
                    value={delayMs}
                    min={0}
                    max={30_000}
                    step={100}
                    inputStep={10}
                    displayAsSeconds
                    format={formatDelay}
                    onChange={setDelayMs}
                  />
                  <PrecisionSlider
                    label="Stay on screen"
                    value={duration}
                    min={MIN_DURATION_MS}
                    max={MAX_DURATION_MS}
                    step={100}
                    inputStep={10}
                    displayAsSeconds
                    format={formatDuration}
                    onChange={setDuration}
                  />
                  <PrecisionSlider
                    label="Fade in"
                    value={fadeInMs}
                    min={0}
                    max={MAX_FADE_MS}
                    step={10}
                    inputStep={1}
                    displayAsSeconds
                    format={formatFade}
                    onChange={setFadeInMs}
                  />
                  <PrecisionSlider
                    label="Fade out"
                    value={fadeOutMs}
                    min={0}
                    max={MAX_FADE_MS}
                    step={10}
                    inputStep={1}
                    displayAsSeconds
                    format={formatFade}
                    onChange={setFadeOutMs}
                  />
                </div>
              </section>
              </div>
            </aside>
          </form>
        </div>
      )}
    </div>
  );
}
