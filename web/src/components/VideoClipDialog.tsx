import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type MediaImportJob } from "../lib/api";

const timeLabel = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;

export default function VideoClipDialog({ job, onClose, onChange, onDraft }: {
  job: MediaImportJob; onClose: () => void; onChange: (job: MediaImportJob) => void; onDraft: (start: number, end: number) => void;
}) {
  const sourceMs = job.source_duration_ms || 0;
  const minLength = Math.min(2000, sourceMs);
  const [start, setStart] = useState(job.start_ms || 0);
  const [end, setEnd] = useState(job.end_ms || Math.min(30000, sourceMs));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const playingExcerpt = useRef(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  const draftRef = useRef(onDraft); draftRef.current = onDraft;
  useEffect(() => { draftRef.current(start, end); }, [start, end]);
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
    playingExcerpt.current = false; video.current?.pause();
    if (video.current) video.current.currentTime = next / 1000;
  }
  function changeEnd(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(minLength, Math.min(sourceMs, Math.round(value)));
    setEnd(next); setStart(Math.max(0, Math.min(next - minLength, Math.max(start, next - 30000))));
    playingExcerpt.current = false; video.current?.pause();
  }
  async function confirm() {
    setBusy(true); setError("");
    try { onChange(await api.selectVideoClip(job.id, start, end)); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not prepare the excerpt"); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="clip-dialog-backdrop">
    <div ref={dialog} className="clip-dialog panel" role="dialog" aria-modal="true" aria-labelledby="clip-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="clip-title" className="font-display text-lg font-bold">Choose your excerpt</h2>
        <button type="button" className="btn-ghost" disabled={busy} onClick={onClose} aria-label="Close excerpt selection">×</button>
      </div>
      <p className="text-sm text-slate-400">Choose up to 30 seconds. Your source is {timeLabel(sourceMs)}.</p>
      <video ref={video} src={job.preview_url || undefined} controls playsInline preload="metadata" className="clip-source-video"
        onLoadedMetadata={() => setPreviewFailed(false)}
        onError={() => { setPreviewFailed(true); setError("The preview could not load. Close this menu and import the video again."); }}
        onTimeUpdate={() => { const player = video.current; if (player && playingExcerpt.current && player.currentTime * 1000 >= end) { player.pause(); playingExcerpt.current = false; } }} />
      <div className="clip-timeline" style={{ "--clip-start": `${start / sourceMs * 100}%`, "--clip-end": `${end / sourceMs * 100}%` } as React.CSSProperties}>
        <div className="clip-timeline-track" aria-hidden />
        <input type="range" min={0} max={sourceMs - minLength} step={100} value={start} aria-label="Excerpt start" onChange={e => changeStart(Number(e.target.value))} />
        <input type="range" min={minLength} max={sourceMs} step={100} value={end} aria-label="Excerpt end" onChange={e => changeEnd(Number(e.target.value))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="field-label">Start (seconds)<input className="field-input" type="number" step={0.1} min={0} max={(sourceMs - minLength) / 1000} value={start / 1000} onChange={e => changeStart(e.target.valueAsNumber * 1000)} /></label>
        <label className="field-label">End (seconds)<input className="field-input" type="number" step={0.1} min={minLength / 1000} max={sourceMs / 1000} value={end / 1000} onChange={e => changeEnd(e.target.valueAsNumber * 1000)} /></label>
      </div>
      <p className="text-sm text-slate-300" role="status">Selected: {timeLabel(start)} → {timeLabel(end)} · {((end - start) / 1000).toFixed(1)} seconds</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={busy || previewFailed} onClick={() => {
          setError("");
          const player = video.current; if (!player) return;
          player.currentTime = start / 1000; playingExcerpt.current = true;
          void player.play().catch(() => { playingExcerpt.current = false; setError("Tap the video player to allow playback, then retry."); });
        }}>Play excerpt</button>
        <button type="button" className="btn-primary" disabled={busy || previewFailed} onClick={() => void confirm()}>{busy ? "Preparing…" : "Use this excerpt"}</button>
      </div>
    </div>
  </div>, document.body);
}
