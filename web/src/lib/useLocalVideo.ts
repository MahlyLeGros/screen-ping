import { useEffect, useRef, useState } from "react";
import { api, type MediaImportJob } from "./api";
import { createRemoteVideoPreviewUrl } from "./editorPreview";
import { probeMediaDurationMs } from "./mediaDuration";

type Cut = { start: number; end: number; volume: number };
type Draft = {
  file: File; url: string; poster?: string; duration?: number; job?: MediaImportJob; localPreviewFailed?: boolean;
  cut?: Cut; draftCut?: Cut; open: boolean; error?: string;
  source?: Promise<MediaImportJob>; prepared?: Promise<MediaImportJob | null>;
  work?: Promise<MediaImportJob | null>; attempt: number; posterAttempt: number;
};

export async function waitForLocalSource(job: MediaImportJob, current: () => boolean, update: (job: MediaImportJob) => void) {
  const deadline = Date.now() + 15 * 60_000;
  while (current() && Date.now() < deadline) {
    update(job);
    if (job.status === "ready" || job.status === "awaiting_selection") return job;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || "Video preparation failed");
    await new Promise(resolve => setTimeout(resolve, 1200));
    if (!current()) break;
    job = await api.importStatus(job.id);
  }
  if (!current()) throw new DOMException("Video replaced", "AbortError");
  throw new Error("Video preparation timed out; please retry");
}

export function useLocalVideo() {
  const ref = useRef<Draft | null>(null);
  const [local, setLocal] = useState<Draft | null>(null);
  const sync = (draft: Draft) => { if (ref.current === draft) setLocal({ ...draft }); };
  function clear() {
    const draft = ref.current;
    ref.current = null;
    if (!draft) return;
    URL.revokeObjectURL(draft.url);
    if (draft.poster) URL.revokeObjectURL(draft.poster);
    if (draft.job) void api.cancelImport(draft.job.id).catch(() => {});
  }
  useEffect(() => () => clear(), []);

  async function poster(draft: Draft, url: string, start: number) {
    const attempt = ++draft.posterAttempt;
    try {
      const result = await createRemoteVideoPreviewUrl(url, start);
      if (ref.current !== draft || attempt !== draft.posterAttempt) { URL.revokeObjectURL(result.url); return; }
      if (draft.poster) URL.revokeObjectURL(draft.poster);
      draft.poster = result.url; sync(draft);
    } catch {
      if (ref.current === draft && attempt === draft.posterAttempt && url === draft.url) {
        draft.localPreviewFailed = true; sync(draft);
        if (draft.job?.preview_url) void poster(draft, draft.job.preview_url, start);
      }
    }
  }

  function upload(draft: Draft) {
    const attempt = ++draft.attempt;
    const current = () => ref.current === draft && draft.attempt === attempt;
    const old = draft.job;
    draft.error = undefined; draft.job = undefined; draft.prepared = undefined; draft.work = undefined;
    draft.source = (async () => {
      if (old) await api.cancelImport(old.id).catch(() => {});
      if (!current()) throw new DOMException("Video replaced", "AbortError");
      const initial = await api.uploadVideoSource(draft.file, false);
      if (!current()) {
        await api.cancelImport(initial.id).catch(() => {});
        throw new DOMException("Video replaced", "AbortError");
      }
      const job = await waitForLocalSource(initial, current, next => { draft.job = next; sync(draft); });
      if (job.source_duration_ms && (!draft.duration || (job.status === "awaiting_selection" && draft.duration <= 30000))) {
        draft.duration = job.source_duration_ms;
        if (draft.duration > 30000 && !draft.cut) draft.open = true;
      }
      if (draft.localPreviewFailed && job.preview_url) void poster(draft, job.preview_url, draft.cut?.start ?? 0);
      sync(draft);
      return job;
    })();
    void draft.source.catch(error => { if (current()) { draft.error = error.message; sync(draft); } });
    sync(draft);
    if (draft.cut) void prepare(draft).catch(() => {});
  }

  function prepare(draft: Draft) {
    if (draft.prepared) return draft.prepared;
    const cut = draft.cut;
    const attempt = draft.attempt;
    const current = () => ref.current === draft && draft.attempt === attempt;
    const source = draft.source!;
    const previous = draft.work;
    const work = (async () => {
      const initial = await source;
      if (previous) await previous.catch(() => {});
      if (!current()) throw new DOMException("Video replaced", "AbortError");
      const job = draft.job ?? initial;
      if (!cut) return job.status === "ready" ? job : null;
      const end = Math.min(cut.end, job.source_duration_ms ?? cut.end);
      const start = Math.max(0, Math.min(cut.start, end - Math.min(2000, job.source_duration_ms ?? end)));
      if (job.status === "ready" && start === job.start_ms && end === job.end_ms && cut.volume === (job.volume ?? 1)) return job;
      const queued = await api.selectVideoClip(job.id, start, end, cut.volume);
      return waitForLocalSource(queued, current, next => { draft.job = next; sync(draft); });
    })();
    draft.prepared = draft.work = work;
    void work.catch(error => { if (current() && draft.prepared === work) { draft.error = error.message; sync(draft); } });
    return work;
  }

  function start(file: File) {
    clear();
    const draft: Draft = { file, url: URL.createObjectURL(file), open: false, attempt: 0, posterAttempt: 0 };
    ref.current = draft; sync(draft);
    void probeMediaDurationMs(file).then(ms => {
      if (ref.current !== draft || !ms || draft.duration) return;
      draft.duration = Math.round(ms); draft.open = draft.duration > 30000; sync(draft);
    });
    void poster(draft, draft.url, 0);
    upload(draft);
  }

  return {
    local, start,
    hasDraft: () => ref.current !== null,
    remove() { clear(); setLocal(null); },
    retry() { if (ref.current) upload(ref.current); },
    open(value: boolean) { const draft = ref.current; if (draft) { draft.open = value; sync(draft); } },
    setDraft(start: number, end: number, volume: number) { if (ref.current) ref.current.draftCut = { start, end, volume }; },
    select(start: number, end: number, volume: number) {
      const draft = ref.current;
      if (!draft) return;
      draft.cut = draft.draftCut = { start, end, volume }; draft.prepared = undefined; sync(draft);
      void poster(draft, draft.url, start);
      void prepare(draft).catch(() => {});
    },
    async ready(file: File, signal?: AbortSignal) {
      const draft = ref.current;
      if (!draft || draft.file !== file) return null;
      let job = await prepare(draft);
      if (ref.current !== draft || signal?.aborted) return null;
      if (!draft.cut && (draft.duration ?? 0) > 30000) job = null;
      if (job) {
        try { job = await api.importStatus(job.id); }
        catch (error) {
          if (!(error instanceof Error) || !/Import (expired|not found)/i.test(error.message)) throw error;
          if (ref.current !== draft || signal?.aborted) return null;
          upload(draft);
          job = await prepare(draft);
        }
      }
      if (ref.current !== draft || signal?.aborted) return null;
      if (!job) { draft.open = true; sync(draft); }
      else if (job.status !== "ready") throw new Error(job.error || "Video is not ready; please retry");
      return job;
    },
  };
}
