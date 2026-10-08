import { api, type MediaImportJob } from "./api";
import type { RemoteVideoRecipe } from "./savedPings";

export function videoRecipe(job: MediaImportJob): RemoteVideoRecipe | undefined {
  if (!job.source_url || job.platform === "local" || !job.end_ms) return undefined;
  return { url: job.source_url, start_ms: job.start_ms ?? 0, end_ms: job.end_ms, volume: job.volume ?? 1, title: job.title ?? undefined };
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
      if (!selected && (job.status !== "ready" || job.start_ms !== recipe.start_ms || job.end_ms !== recipe.end_ms || (job.volume ?? 1) !== recipe.volume)) {
        job = await api.selectVideoClip(job.id, recipe.start_ms, recipe.end_ms, recipe.volume);
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
