import { useEffect, useRef, useState } from "react";
import { api, type MediaImportJob } from "../lib/api";
import VideoClipDialog from "./VideoClipDialog";

export default function TikTokImport({ job, onChange, clipping = false }: {
  job: MediaImportJob | null; onChange: (job: MediaImportJob | null) => void; clipping?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [videoName, setVideoName] = useState("TikTok video");
  const urlInput = useRef<HTMLInputElement>(null);
  const [clipOpen, setClipOpen] = useState(false);
  const openedJob = useRef<string | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const active = Boolean(job && ["queued", "fetching", "optimizing", "uploading", "queued_clip", "cropping"].includes(job.status));
  useEffect(() => {
    if (job?.status === "awaiting_selection" && (job.source_duration_ms ?? 0) > 30000 && openedJob.current !== job.id) {
      openedJob.current = job.id; setClipOpen(true);
    }
    if (!job) { openedJob.current = null; setClipOpen(false); }
  }, [job?.id, job?.status, job?.source_duration_ms]);
  useEffect(() => {
    if (!job || !active) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void api.importStatus(job.id).then(next => {
        if (!disposed) { callback.current(next); setError(""); }
      }).catch(err => { if (!disposed) setError(err instanceof Error ? err.message : "Connection interrupted; retrying…"); });
    }, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [job?.id, active]);
  async function start() {
    setBusy(true); setError("");
    try {
      if (job) await api.cancelImport(job.id).catch(() => undefined);
      onChange(await (clipping ? api.startVideoImport(url.trim()) : api.startTikTokImport(url.trim())));
      const author = new URL(url.trim()).pathname.match(/\/@([^/]+)\/video\//)?.[1];
      setVideoName(author ? `TikTok — @${author}` : "TikTok video");
      setUrl("");
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <label className="field-label" htmlFor="tiktok-url">TikTok link</label>
    <div className="flex gap-2">
      <input ref={urlInput} id="tiktok-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off"
        className="field-input min-w-0 flex-1" placeholder="Paste a TikTok video link" value={url}
        onChange={event => setUrl(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!busy && !active) void start(); } }} />
      <button type="button" className="btn-secondary" disabled={!url.trim() || busy || active} onClick={() => void start()}>Import</button>
    </div>
    {job?.status === "optimizing" && !error && !job.error && <div className="video-import-progress" role="progressbar" aria-label="Optimizing video" aria-valuetext="In progress"><span /></div>}
    {(error || job?.error || (job && job.status !== "ready" && job.status !== "awaiting_selection" && job.status !== "optimizing")) && <p role="status" aria-live="polite" className="text-xs text-slate-400">
      {error || job?.error || (job ? ({ queued: "Waiting for import…", fetching: "Preparing source video…", optimizing: "Optimizing video…", uploading: "Uploading source video…", awaiting_selection: "Choose your excerpt before sending", queued_clip: "Waiting to prepare your excerpt…", cropping: "Preparing your excerpt…", ready: "Ready — place the video below", failed: "Import failed; upload the file instead", cancelled: "Import cancelled" })[job.status] : "")}
    </p>}
    {(job?.status === "ready" || job?.status === "awaiting_selection") && <div>
      <span className="field-label">File</span>
      <div className={`upload-zone px-2.5 py-2 ${job.status === "awaiting_selection" ? "pr-14" : "pr-[6.5rem]"}`}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 bg-transparent text-left"
          onClick={() => { if (job.status === "awaiting_selection") { setClipOpen(true); return; } urlInput.current?.scrollIntoView({ block: "center", behavior: "smooth" }); urlInput.current?.focus(); }}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-[rgb(8_8_12/0.55)] text-sm text-slate-400">{job.status === "awaiting_selection" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.5 3.8H7.2a4.9 4.9 0 0 0-4.9 4.9v9a4.9 4.9 0 0 0 4.9 4.9h9a4.9 4.9 0 0 0 4.9-4.9v-4" /><path d="m8.2 16.6.6-4.3L18.2 3a2.6 2.6 0 0 1 3.7 3.7l-9.3 9.4-4.4.5Z" /><path d="m16.5 4.7 3.7 3.7" /></svg> : "✓"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white" title={job.status === "awaiting_selection" ? undefined : job.title || videoName}>{job.status === "awaiting_selection" ? "Trim video" : job.title || videoName}</span>
            <span className="block text-xs text-slate-500">{job.status === "awaiting_selection" ? "Choose the part to upload" : "Click to replace"}</span>
          </span>
        </button>
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
        {job.status === "ready" && job.preview_url && Boolean(job.source_duration_ms) && <button type="button" aria-label="Trim video" title="Trim video" disabled={busy}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded bg-transparent p-2 text-slate-500 transition hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
          onClick={() => setClipOpen(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 3.8H7.2a4.9 4.9 0 0 0-4.9 4.9v9a4.9 4.9 0 0 0 4.9 4.9h9a4.9 4.9 0 0 0 4.9-4.9v-4" />
              <path d="m8.2 16.6.6-4.3L18.2 3a2.6 2.6 0 0 1 3.7 3.7l-9.3 9.4-4.4.5Z" />
              <path d="m16.5 4.7 3.7 3.7" />
            </g>
          </svg>
        </button>}
        <button type="button" aria-label="Remove imported video" title="Remove imported video" disabled={busy}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded bg-transparent p-2 text-slate-500 transition hover:text-red-400"
          onClick={() => { setBusy(true); void api.cancelImport(job.id).then(() => onChange(null)).catch(err => setError(String(err))).finally(() => setBusy(false)); }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
        </button>
        </div>
      </div>
    </div>}
    {clipOpen && job?.preview_url && <VideoClipDialog key={job.id} job={job} onClose={() => setClipOpen(false)}
      onChange={onChange} onDraft={(start_ms, end_ms, volume) => onChange({ ...job, start_ms, end_ms, volume,
        status: job.status === "ready" && (start_ms !== job.start_ms || end_ms !== job.end_ms || volume !== (job.volume ?? 1)) ? "awaiting_selection" : job.status })} />}
    {job && !active && job.status !== "cancelled" && job.status !== "ready" && job.status !== "awaiting_selection" && <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
      setBusy(true);
      void api.cancelImport(job.id).then(() => onChange(null)).catch(err => setError(String(err))).finally(() => setBusy(false));
    }}>Remove video</button>}
  </div>;
}
