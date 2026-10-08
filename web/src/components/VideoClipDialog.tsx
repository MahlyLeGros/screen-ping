import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type MediaImportJob } from "../lib/api";

const timeLabel = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;

function PreviewIcon({ kind }: { kind: "start" | "back" | "play" | "pause" | "forward" | "end" | "sound" | "mute" }) {
  const paths = {
    start: "M4 5h3v14H4z M19 5v14L8 12z",
    back: "M12 5v14L2 12z M22 5v14l-10-7z",
    play: "M7 4v16l14-8z",
    pause: "M6 4h4v16H6z M14 4h4v16h-4z",
    forward: "M2 5v14l10-7z M12 5v14l10-7z",
    end: "M17 5h3v14h-3z M5 5v14l11-7z",
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {kind === "sound" || kind === "mute" ? <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d={kind === "mute" ? "m16 9 6 6m0-6-6 6" : "M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"} />
    </g> : <path fill="currentColor" d={paths[kind]} />}
  </svg>;
}

export default function VideoClipDialog({ job, onClose, onChange, onDraft }: {
  job: MediaImportJob; onClose: () => void; onChange: (job: MediaImportJob) => void; onDraft: (start: number, end: number, volume: number) => void;
}) {
  const sourceMs = job.source_duration_ms || 0;
  const minLength = Math.min(2000, sourceMs);
  const [start, setStart] = useState(job.start_ms || 0);
  const [end, setEnd] = useState(job.end_ms || Math.min(30000, sourceMs));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(job.volume ?? 1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [previewMs, setPreviewMs] = useState(job.start_ms || 0);
  const selectionDrag = useRef<{ pointerId: number; x: number; width: number; start: number; end: number; moved: boolean } | null>(null);
  const backdropPress = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  const draftRef = useRef(onDraft); draftRef.current = onDraft;
  useEffect(() => { draftRef.current(start, end, volume); }, [start, end, volume]);
  useEffect(() => { if (video.current) video.current.volume = volume; }, [volume]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      syncPreview();
      if (video.current && !video.current.paused) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, start, end]);
  useEffect(() => {
    // Keep the private source alive only while the user is choosing an excerpt.
    const timer = window.setInterval(() => { void api.importStatus(job.id).catch(() => {}); }, 60000);
    return () => window.clearInterval(timer);
  }, [job.id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, video[controls]') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  function changeStart(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(Math.round(value), sourceMs - minLength));
    setStart(next); setEnd(Math.min(sourceMs, Math.max(next + minLength, Math.min(end, next + 30000))));
    video.current?.pause(); setPreviewMs(next);
    if (video.current) video.current.currentTime = next / 1000;
  }
  function changeEnd(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(minLength, Math.min(sourceMs, Math.round(value)));
    const nextStart = Math.max(0, Math.min(next - minLength, Math.max(start, next - 30000)));
    setEnd(next); setStart(nextStart);
    video.current?.pause(); setPreviewMs(nextStart);
    if (video.current) video.current.currentTime = nextStart / 1000;
  }
  function moveSelection(value: number, length = end - start) {
    const next = Math.max(0, Math.min(Math.round(value), sourceMs - length));
    setStart(next); setEnd(next + length);
    video.current?.pause(); setPreviewMs(next);
    if (video.current) video.current.currentTime = next / 1000;
  }
  function syncPreview() {
    const player = video.current;
    if (!player) return;
    const position = player.currentTime * 1000;
    if (position >= end) {
      player.pause();
      if (position > end + 1) player.currentTime = end / 1000;
      setPreviewMs(end);
    } else if (position < start - 1) {
      player.currentTime = start / 1000; setPreviewMs(start);
    } else setPreviewMs(Math.max(start, position));
  }
  async function togglePlayback() {
    const player = video.current;
    if (!player) return;
    if (!player.paused) { player.pause(); return; }
    setError("");
    if (player.currentTime * 1000 < start || player.currentTime * 1000 >= end - 1) player.currentTime = start / 1000;
    try { await player.play(); }
    catch { setError("Playback could not start. Please try again."); }
  }
  function seekPreview(position: number) {
    const next = Math.max(start, Math.min(end, position));
    if (video.current) video.current.currentTime = next / 1000;
    setPreviewMs(next);
    if (next >= end) video.current?.pause();
  }
  async function confirm() {
    setBusy(true); setError("");
    try { onChange(await api.selectVideoClip(job.id, start, end, volume)); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not prepare the excerpt"); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="clip-dialog-backdrop"
    onPointerDown={event => { backdropPress.current = event.button === 0 && event.target === event.currentTarget; }}
    onPointerCancel={() => { backdropPress.current = false; }}
    onClick={event => {
      if (backdropPress.current && event.target === event.currentTarget && !busy) onClose();
      backdropPress.current = false;
    }}>
    <div ref={dialog} className="clip-dialog panel" role="dialog" aria-modal="true" aria-label="Choose your excerpt">
      <button type="button" className="clip-close-button" disabled={busy} onClick={onClose} aria-label="Close excerpt selection">×</button>
      <video ref={video} src={job.preview_url || undefined} muted={volume === 0} playsInline preload="metadata" className="clip-source-video"
        onLoadedMetadata={() => { setPreviewFailed(false); if (video.current) video.current.currentTime = start / 1000; }}
        onError={() => { setPreviewFailed(true); setError("The preview could not load. Close this menu and import the video again."); }}
        onPlay={() => { setPlaying(true); syncPreview(); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={syncPreview} />
      <div className="clip-preview-controls">
        <button type="button" className="btn-primary clip-confirm-button" disabled={busy || previewFailed} onClick={() => void confirm()}>{busy ? "Preparing…" : "Upload"}</button>
        <div className="clip-transport-group">
        <button type="button" className="clip-transport-button" aria-label="Go to excerpt start" title="Go to excerpt start" disabled={busy || previewFailed} onClick={() => seekPreview(start)}>
          <PreviewIcon kind="start" />
        </button>
        <button type="button" className="clip-transport-button" aria-label="Rewind two seconds" title="Rewind two seconds" disabled={busy || previewFailed} onClick={() => seekPreview(previewMs - 2000)}>
          <PreviewIcon kind="back" />
        </button>
        <button type="button" className="clip-transport-button clip-play-button" aria-label={playing ? "Pause excerpt" : "Play excerpt"} title={playing ? "Pause excerpt" : "Play excerpt"} disabled={busy || previewFailed} onClick={() => void togglePlayback()}>
          <PreviewIcon kind={playing ? "pause" : "play"} />
        </button>
        <button type="button" className="clip-transport-button" aria-label="Forward two seconds" title="Forward two seconds" disabled={busy || previewFailed} onClick={() => seekPreview(previewMs + 2000)}>
          <PreviewIcon kind="forward" />
        </button>
        <button type="button" className="clip-transport-button" aria-label="Go to excerpt end" title="Go to excerpt end" disabled={busy || previewFailed} onClick={() => seekPreview(end)}>
          <PreviewIcon kind="end" />
        </button>
        </div>
        <div className="clip-preview-meta">
        <span className="clip-preview-time text-xs text-slate-300 tabular-nums">{timeLabel(Math.min(end - start, Math.max(0, previewMs - start)))} / {timeLabel(end - start)}</span>
        <div className="clip-volume-control">
          <button type="button" className="clip-transport-button" aria-label="Video volume" title={`Video volume: ${Math.round(volume * 100)}%`} aria-expanded={volumeOpen} disabled={busy}
            onClick={() => setVolumeOpen(value => !value)}><PreviewIcon kind={volume === 0 ? "mute" : "sound"} /></button>
          {volumeOpen && <div className="clip-volume-popover">
            <input type="range" min="0" max="100" step="1" aria-label="Sent video volume" value={Math.round(volume * 100)} disabled={busy}
              onChange={event => setVolume(Number(event.target.value) / 100)} />
            <output className="text-xs tabular-nums">{Math.round(volume * 100)}%</output>
          </div>}
        </div>
        </div>
      </div>
      <div className="clip-timeline" style={{ "--clip-start": `${start / sourceMs * 100}%`, "--clip-end": `${end / sourceMs * 100}%` } as React.CSSProperties}>
        <div className="clip-timeline-track" aria-hidden />
        <button type="button" className={`clip-selection${dragging ? " is-dragging" : ""}`} disabled={busy}
          style={{ left: `${start / sourceMs * 100}%`, width: `${(end - start) / sourceMs * 100}%` }}
          role="slider" aria-label="Move excerpt" aria-valuemin={0} aria-valuemax={sourceMs - (end - start)}
          aria-valuenow={start} aria-valuetext={`${timeLabel(start)} to ${timeLabel(end)}`} aria-orientation="horizontal"
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            const width = event.currentTarget.parentElement!.getBoundingClientRect().width;
            if (!width) return;
            event.preventDefault(); event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            selectionDrag.current = { pointerId: event.pointerId, x: event.clientX, width, start, end, moved: false };
          }}
          onPointerMove={event => {
            const drag = selectionDrag.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (!drag.moved && Math.abs(event.clientX - drag.x) < 5) return;
            drag.moved = true;
            setDragging(true);
            const shift = Math.round((event.clientX - drag.x) / drag.width * sourceMs / 100) * 100;
            moveSelection(drag.start + shift, drag.end - drag.start);
          }}
          onPointerUp={event => {
            const drag = selectionDrag.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (!drag.moved && !previewFailed) {
              const track = event.currentTarget.parentElement!.getBoundingClientRect();
              seekPreview((event.clientX - track.left) / track.width * sourceMs);
            }
            selectionDrag.current = null; setDragging(false);
          }}
          onLostPointerCapture={() => { selectionDrag.current = null; setDragging(false); }}
          onKeyDown={event => {
            const step = event.shiftKey ? 1000 : 100;
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            moveSelection(event.key === "Home" ? 0 : event.key === "End" ? sourceMs - (end - start) : start + (event.key === "ArrowRight" ? step : -step));
          }} />
        <input type="range" min={0} max={sourceMs} step={100} value={start} aria-label="Excerpt start" onChange={e => changeStart(Number(e.target.value))} />
        <input type="range" min={0} max={sourceMs} step={100} value={end} aria-label="Excerpt end" onChange={e => changeEnd(Number(e.target.value))} />
        <span className="clip-boundary clip-boundary-start" aria-hidden="true" style={{ left: `${start / sourceMs * 100}%` }} />
        <span className="clip-boundary clip-boundary-end" aria-hidden="true" style={{ left: `${end / sourceMs * 100}%` }} />
        <span className="clip-playhead" aria-hidden="true" style={{ left: `clamp(calc(${start / sourceMs * 100}% + min(4px, ${(end - start) / sourceMs * 50}%)), ${Math.min(end, Math.max(start, previewMs)) / sourceMs * 100}%, calc(${end / sourceMs * 100}% - min(4px, ${(end - start) / sourceMs * 50}%)))` }} />
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </div>
  </div>, document.body);
}
