import { useEffect, useRef, useState } from "react";
import { api, type MediaImportJob } from "../lib/api";

export default function TikTokImport({ job, onChange }: {
  job: MediaImportJob | null; onChange: (job: MediaImportJob | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
      setUrl("");
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <label className="field-label" htmlFor="tiktok-url">TikTok link</label>
    <div className="flex gap-2">
      <input id="tiktok-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off"
        className="field-input min-w-0 flex-1" placeholder="Paste a TikTok video link" value={url}
        onChange={event => setUrl(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!busy && !active) void start(); } }} />
      <button type="button" className="btn-secondary" disabled={!url.trim() || busy || active} onClick={() => void start()}>Import</button>
    </div>
    <p role="status" aria-live="polite" className="text-xs text-slate-400">
      {error || job?.error || (job ? ({ queued: "Waiting for import…", fetching: "Retrieving video…", optimizing: "Optimizing video…", ready: "Ready — place the video below", failed: "Import failed; upload the file instead", cancelled: "Import cancelled" })[job.status] : "Public videos up to 3 minutes. No TikTok login needed.")}
    </p>
    {job && job.status !== "cancelled" && <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
      setBusy(true);
      void api.cancelImport(job.id).then(() => onChange(null)).catch(err => setError(String(err))).finally(() => setBusy(false));
    }}>{active ? "Cancel import" : "Remove video"}</button>}
  </div>;
}
