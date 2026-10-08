import { describe, expect, it, vi, afterEach } from "vitest";
import { api, type MediaImportJob } from "./api";
import { restoreVideoImport, videoRecipe } from "./restoreVideoImport";
vi.mock("./api", () => ({ api: { startVideoImport: vi.fn(), uploadVideoSource: vi.fn(), importStatus: vi.fn(), selectVideoClip: vi.fn(), cancelImport: vi.fn() } }));
const recipe = { url: "https://vm.tiktok.com/ABC/", start_ms: 5000, end_ms: 12000, volume: .35 };
const job = { id: "new", status: "queued", source_url: recipe.url, platform: "tiktok" } as MediaImportJob;
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("restore imported video", () => {
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
