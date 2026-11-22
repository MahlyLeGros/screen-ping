import { describe, expect, it, vi, afterEach } from "vitest";
import { api, type MediaImportJob } from "./api";
import { prepareSlideshowDuration, prepareTikTokLoop, restoreVideoImport, videoRecipe } from "./restoreVideoImport";
vi.mock("./api", () => ({ api: { startVideoImport: vi.fn(), uploadVideoSource: vi.fn(), importStatus: vi.fn(), selectVideoClip: vi.fn(), selectSlideshow: vi.fn(), cancelImport: vi.fn() } }));
const recipe = { url: "https://vm.tiktok.com/ABC/", start_ms: 5000, end_ms: 12000, volume: .35 };
const job = { id: "new", status: "queued", source_url: recipe.url, platform: "tiktok" } as MediaImportJob;
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("restore imported video", () => {
  it("prepares one loop of the selected TikTok clip with audio settings", async () => {
    vi.useFakeTimers();
    const video = { ...job, status: "ready", start_ms: 2000, end_ms: 8000, duration_ms: 6000, volume: .4 } as MediaImportJob;
    vi.mocked(api.selectVideoClip).mockResolvedValue({ ...video, status: "queued_clip" });
    vi.mocked(api.importStatus).mockResolvedValue({ ...video, duration_ms: 30000 });
    const task = prepareTikTokLoop(video, 30000, vi.fn());
    await vi.runAllTimersAsync();
    await expect(task).resolves.toMatchObject({ duration_ms: 30000 });
    expect(api.selectVideoClip).toHaveBeenCalledExactlyOnceWith("new", 2000, 8000, .4, 30000);
    await prepareTikTokLoop({ ...video, duration_ms: 30000 }, 20000, vi.fn());
    expect(api.selectVideoClip).toHaveBeenCalledTimes(1);
  });
  it("stretches every photo to the selected total once before sending", async () => {
    vi.useFakeTimers();
    const photo = { ...job, status: "ready", media_kind: "slideshow", photo_count: 1, seconds_per_photo: 3, end_ms: 3000, volume: 1 } as MediaImportJob;
    expect(videoRecipe(photo, 30000)?.seconds_per_photo).toBe(30);
    vi.mocked(api.selectSlideshow).mockResolvedValue({ ...photo, status: "queued_clip" });
    vi.mocked(api.importStatus).mockResolvedValue({ ...photo, duration_ms: 30000, seconds_per_photo: 30 });
    const task = prepareSlideshowDuration(photo, 30000, vi.fn());
    await vi.runAllTimersAsync();
    await expect(task).resolves.toMatchObject({ duration_ms: 30000 });
    expect(api.selectSlideshow).toHaveBeenCalledExactlyOnceWith("new", 30, 1);
    expect(videoRecipe({ ...photo, photo_count: 7 }, 21000)?.seconds_per_photo).toBe(3);
  });
  it("does not regenerate unchanged photos or regular videos", async () => {
    const photo = { ...job, status: "ready", media_kind: "slideshow", photo_count: 2, seconds_per_photo: 3 } as MediaImportJob;
    expect(await prepareSlideshowDuration(photo, 6000, vi.fn())).toBe(photo);
    expect(await prepareSlideshowDuration(job, 30000, vi.fn())).toBe(job);
    expect(api.selectSlideshow).not.toHaveBeenCalled();
  });
  it("saves and restores slideshow speed and volume without clipping photos", async () => {
    vi.useFakeTimers();
    const saved = { ...recipe, media_kind: "slideshow" as const, seconds_per_photo: 1.5 };
    expect(videoRecipe({ ...job, ...saved, source_url: recipe.url })).toEqual({ ...saved, title: undefined });
    vi.mocked(api.startVideoImport).mockResolvedValue({ ...job, status: "ready", media_kind: "slideshow", seconds_per_photo: 3, volume: 1 });
    vi.mocked(api.selectSlideshow).mockResolvedValue({ ...job, status: "queued_clip" });
    vi.mocked(api.importStatus).mockResolvedValue({ ...job, ...saved, status: "ready" });
    const task = restoreVideoImport(saved, vi.fn());
    await vi.runAllTimersAsync(); await expect(task).resolves.toMatchObject({ status: "ready" });
    expect(api.selectSlideshow).toHaveBeenCalledWith("new", 1.5, .35);
    expect(api.selectVideoClip).not.toHaveBeenCalled();
  });
  it("retains the source link and exact cut, not a signed media URL", () => {
    expect(videoRecipe({ ...job, ...recipe, source_url: recipe.url, media_url: "/signed.mp4" })).toEqual({ ...recipe, title: undefined });
    expect(videoRecipe({ ...job, platform: "local", end_ms: 1000 })).toBeUndefined();
  });
  it("downloads once, restores the original bounds and volume, and suppresses the chooser", async () => {
    vi.useFakeTimers(); vi.mocked(api.startVideoImport).mockResolvedValue(job);
    vi.mocked(api.importStatus).mockResolvedValueOnce({ ...job, status: "awaiting_selection" }).mockResolvedValueOnce({ ...job, status: "ready", ...recipe });
    vi.mocked(api.selectVideoClip).mockResolvedValue({ ...job, status: "queued_clip" });
    const update = vi.fn(); const task = restoreVideoImport(recipe, update);
    await vi.runAllTimersAsync(); await expect(task).resolves.toMatchObject({ status: "ready" });
    expect(api.startVideoImport).toHaveBeenCalledTimes(1);
    expect(api.selectVideoClip).toHaveBeenCalledWith("new", 5000, 12000, .35);
    expect(update.mock.calls.every(([value]) => value.status !== "awaiting_selection")).toBe(true);
  });
  it("fails clearly and cancels the replacement when the video cannot be prepared", async () => {
    vi.mocked(api.startVideoImport).mockResolvedValue({ ...job, status: "failed", error: "Video unavailable" });
    vi.mocked(api.cancelImport).mockResolvedValue({ ok: true });
    await expect(restoreVideoImport(recipe, vi.fn())).rejects.toThrow("Video unavailable");
    expect(api.cancelImport).toHaveBeenCalledWith("new");
  });
});
