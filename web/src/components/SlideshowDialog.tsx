import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type MediaImportJob } from "../lib/api";
import { slideshowTiming } from "../lib/slideshow";

export default function SlideshowDialog({ job, onClose, onChange }: {
  job: MediaImportJob; onClose: () => void; onChange: (job: MediaImportJob) => void;
}) {
  const [seconds, setSeconds] = useState(job.seconds_per_photo ?? 3);
  const [volume, setVolume] = useState(job.volume ?? 1);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [aspect, setAspect] = useState(9 / 16);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const preview = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const backdrop = useRef(false);
  const close = useRef(onClose); close.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  const photos = job.photo_urls ?? [];
  const timing = slideshowTiming(photos.length, seconds);
  const current = Math.min(photos.length - 1, Math.floor(position / timing.seconds));
  const within = position - current * timing.seconds;
  const shift = current + 1 < photos.length && timing.transition > 0
    ? Math.max(0, Math.min(1, (within - timing.seconds + timing.transition) / timing.transition)) : 0;
  const stageWidth = Math.min(previewSize.width, previewSize.height * aspect);
  useEffect(() => {
    if (!preview.current) return;
    const observer = new ResizeObserver(([entry]) => setPreviewSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) close.current();
      if (e.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    let lastTouch = Date.now();
    const touch = () => { if (Date.now() - lastTouch > 60000) { lastTouch = Date.now(); void api.importStatus(job.id).catch(() => {}); } };
    const element = dialog.current;
    element?.addEventListener("pointerdown", touch); element?.addEventListener("keydown", touch);
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key);
      element?.removeEventListener("pointerdown", touch); element?.removeEventListener("keydown", touch); previous?.focus(); };
  }, [job.id]);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);
  useEffect(() => {
    if (!playing) return;
    const started = performance.now(), initial = position;
    let frame = 0;
    const tick = () => {
      const next = initial + (performance.now() - started) / 1000;
      setPosition(Math.min(next, timing.duration));
      if (next >= timing.duration) { setPlaying(false); audio.current?.pause(); }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, timing.duration]);
  useEffect(() => {
    let disposed = false;
    setLoaded(0); setFailed(false);
    const images = photos.map((url, index) => {
      const image = new Image();
      image.onload = () => { if (!disposed) { setLoaded(value => value + 1); if (index === 0) setAspect(image.naturalWidth / image.naturalHeight); } };
      image.onerror = () => { if (!disposed) setFailed(true); };
      image.src = url; return image;
    });
    return () => { disposed = true; images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [job.id]);
  async function play() {
    if (playing) { setPlaying(false); audio.current?.pause(); return; }
    const next = position >= timing.duration ? 0 : position;
    setPosition(next); setError("");
    if (audio.current) {
      audio.current.currentTime = next % (audio.current.duration || 30);
      try { await audio.current.play(); } catch { setError("Audio preview could not start. Try again."); return; }
    }
    setPlaying(true);
  }
  async function confirm() {
    setBusy(true); setPlaying(false); audio.current?.pause(); setError("");
    try { onChange(await api.selectSlideshow(job.id, seconds, volume)); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not prepare slideshow"); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="clip-dialog-backdrop" onPointerDown={e => { backdrop.current = e.target === e.currentTarget; }}
    onPointerUp={e => { if (backdrop.current && e.target === e.currentTarget && !busy) onClose(); backdrop.current = false; }}>
    <div ref={dialog} className="clip-dialog panel" role="dialog" aria-modal="true" aria-label="Edit TikTok slideshow">
      <div ref={preview} className="slideshow-preview" aria-label={`Photo ${Math.max(1, current + 1)} of ${photos.length}`}>
        <div className="slideshow-stage" style={{ width: stageWidth, height: stageWidth / aspect }}>
        <div className="slideshow-slide" style={{ transform: `translateX(${-shift * 100}%)` }}><img src={photos[current]} alt={`Photo ${current + 1}`} /></div>
        {current + 1 < photos.length && <div className="slideshow-slide" style={{ transform: `translateX(${100 - shift * 100}%)` }}><img src={photos[current + 1]} alt={`Photo ${current + 2}`} /></div>}
        </div>
      </div>
      {job.music_url && <audio ref={audio} src={job.music_url} preload="auto" loop />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-primary" disabled={busy || failed || loaded !== photos.length} onClick={() => void confirm()}>Upload</button>
        <button type="button" className="btn-secondary" aria-label={playing ? "Pause slideshow" : "Play slideshow"} disabled={busy || failed || loaded !== photos.length} onClick={() => void play()}>{playing ? "Ⅱ" : "▶"}</button>
        <span className="text-xs tabular-nums text-slate-400">{position.toFixed(1)} / {timing.duration.toFixed(1)}s · {current + 1}/{photos.length}</span>
        <label className="flex items-center gap-2 text-xs text-slate-400">Volume <input aria-label="Slideshow volume" type="range" min="0" max="1" step="0.01" value={volume} disabled={!job.has_music || busy} onChange={e => setVolume(Number(e.target.value))} className="site-range w-24" style={{ "--range-value": `${volume * 100}%` } as React.CSSProperties} /></label>
      </div>
      <label className="flex items-center gap-3 text-sm text-slate-300">Seconds per photo
        <input aria-label="Seconds per photo" type="range" min="0.5" max="10" step="0.1" value={seconds} disabled={busy} className="site-range min-w-0 flex-1" style={{ "--range-value": `${(seconds - 0.5) / 9.5 * 100}%` } as React.CSSProperties} onChange={e => { setPlaying(false); audio.current?.pause(); setPosition(0); setSeconds(Number(e.target.value)); }} />
        <span className="w-10 text-right tabular-nums">{seconds.toFixed(1)}s</span>
      </label>
      <p className="text-xs text-slate-400">{timing.seconds < seconds - 0.04 ? `Accelerated to ${timing.seconds.toFixed(2)}s per photo to keep all ${photos.length} photos within 30 seconds.` : `${photos.length} photos · ${timing.seconds.toFixed(2)}s per photo · original order`}</p>
      {!job.has_music && <p role="status" className="text-xs text-slate-400">Public music unavailable — this slideshow will be sent without sound.</p>}
      {loaded !== photos.length && !failed && <p role="status" className="text-xs text-slate-400">Loading photos… {loaded}/{photos.length}</p>}
      {(error || failed) && <p role="alert" className="text-sm text-red-300">{error || "Photos could not load. Close and reopen the editor to try again."}</p>}
    </div>
  </div>, document.body);
}
