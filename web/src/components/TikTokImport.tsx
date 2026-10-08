import { useEffect, useRef, useState } from "react";
import { api, type MediaImportJob } from "../lib/api";

export default function TikTokImport({ job, onChange }: {
  job: MediaImportJob | null; onChange: (job: MediaImportJob | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [videoName, setVideoName] = useState("TikTok video");
  const urlInput = useRef<HTMLInputElement>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const active = Boolean(job && ["queued", "fetching", "optimizing"].includes(job.status));
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
      onChange(await api.startTikTokImport(url.trim()));
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
    <p role="status" aria-live="polite" className="text-xs text-slate-400">
      {error || job?.error || (job ? ({ queued: "Waiting for import…", fetching: "Retrieving video…", optimizing: "Optimizing video…", ready: "Ready — place the video below", failed: "Import failed; upload the file instead", cancelled: "Import cancelled" })[job.status] : "Public videos up to 3 minutes. No TikTok login needed.")}
    </p>
    {job?.status === "ready" && <div>
      <span className="field-label">File</span>
      <div className="upload-zone px-3 py-3 pr-8">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 bg-transparent text-left"
          onClick={() => { urlInput.current?.scrollIntoView({ block: "center", behavior: "smooth" }); urlInput.current?.focus(); }}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-[rgb(8_8_12/0.55)] text-base text-slate-400">✓</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white" title={videoName}>{videoName}</span>
            <span className="block text-xs text-slate-500">Click to replace</span>
          </span>
        </button>
        <button type="button" aria-label="Remove TikTok video" title="Remove TikTok video" disabled={busy}
          className="absolute right-2 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded p-2 text-slate-500 transition hover:text-red-400"
          onClick={() => { setBusy(true); void api.cancelImport(job.id).then(() => onChange(null)).catch(err => setError(String(err))).finally(() => setBusy(false)); }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>}
    {job && !active && job.status !== "cancelled" && job.status !== "ready" && <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
      setBusy(true);
      void api.cancelImport(job.id).then(() => onChange(null)).catch(err => setError(String(err))).finally(() => setBusy(false));
    }}>Remove video</button>}
  </div>;
}
