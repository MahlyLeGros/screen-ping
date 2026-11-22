import { api, type MediaImportJob } from "./api";
import type { RemoteVideoRecipe } from "./savedPings";

export function videoRecipe(job: MediaImportJob, durationMs?: number): RemoteVideoRecipe | undefined {
  if (!job.source_url || job.platform === "local" || !job.end_ms) return undefined;
  return { url: job.source_url, start_ms: job.start_ms ?? 0, end_ms: job.end_ms, volume: job.volume ?? 1, title: job.title ?? undefined,
    ...(job.media_kind === "slideshow" ? { media_kind: "slideshow" as const, seconds_per_photo: durationMs != null && job.photo_count ? durationMs / 1000 / job.photo_count : job.seconds_per_photo ?? 3 } : {}) };
}

export async function prepareSlideshowDuration(job: MediaImportJob, durationMs: number, update: (job: MediaImportJob) => void) {
  if (job.media_kind !== "slideshow") return job;
  if (!job.photo_count) throw new Error("Photo count unavailable; import the TikTok again");
  const seconds = Math.min(30000, Math.max(2000, durationMs)) / 1000 / job.photo_count;
  if (Math.abs((job.seconds_per_photo ?? 3) - seconds) < 0.000001) return job;
  job = await api.selectSlideshow(job.id, seconds, job.volume ?? 1);
  update(job);
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    if (job.status === "ready") return job;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || "Slideshow preparation failed");
    await new Promise(resolve => setTimeout(resolve, 1200));
    job = await api.importStatus(job.id); update(job);
  }
  throw new Error("Slideshow preparation timed out; please try again");
}

export async function prepareTikTokLoop(job: MediaImportJob, durationMs: number, update: (job: MediaImportJob) => void) {
  const target = Math.min(30000, Math.max(2000, durationMs));
  if (job.platform !== "tiktok" || job.media_kind === "slideshow" || target <= (job.duration_ms ?? 0)) return job;
  if (job.end_ms == null) throw new Error("Video bounds unavailable; import the TikTok again");
  job = await api.selectVideoClip(job.id, job.start_ms ?? 0, job.end_ms, job.volume ?? 1, target);
  update(job);
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    if (job.status === "ready") return job;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || "Video loop preparation failed");
    await new Promise(resolve => setTimeout(resolve, 1200));
    job = await api.importStatus(job.id); update(job);
  }
  throw new Error("Video loop preparation timed out; please try again");
}

export async function restoreVideoImport(recipe: RemoteVideoRecipe, update: (job: MediaImportJob) => void, localFile?: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let job = localFile ? await api.uploadVideoSource(localFile) : await api.startVideoImport(recipe.url);
  try {
  signal?.throwIfAborted();
  update(job);
  const deadline = Date.now() + 15 * 60_000;
  let selected = false;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || "Video could not be restored; try another link or file");
    if (job.status === "ready" || job.status === "awaiting_selection") {
      const changed = recipe.media_kind === "slideshow"
        ? job.status !== "ready" || (job.seconds_per_photo ?? 3) !== (recipe.seconds_per_photo ?? 3) || (job.volume ?? 1) !== recipe.volume
        : job.status !== "ready" || job.start_ms !== recipe.start_ms || job.end_ms !== recipe.end_ms || (job.volume ?? 1) !== recipe.volume;
      if (!selected && changed) {
        job = recipe.media_kind === "slideshow" ? await api.selectSlideshow(job.id, recipe.seconds_per_photo ?? 3, recipe.volume)
          : await api.selectVideoClip(job.id, recipe.start_ms, recipe.end_ms, recipe.volume);
        selected = true; update(job);
      } else if (job.status === "ready") { update(job); return job; }
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
    job = await api.importStatus(job.id);
    signal?.throwIfAborted();
    // A saved selection is already known: don't open the selection popup again.
    if (job.status !== "awaiting_selection") update(job);
  }
  throw new Error("Video preparation timed out; please try again");
  } catch (error) {
    await api.cancelImport(job.id).catch(() => {});
    if (!signal?.aborted) update({ ...job, status: "failed", error: error instanceof Error ? error.message : "Could not restore video" });
    throw error;
  }
}
