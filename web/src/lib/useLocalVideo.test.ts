import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type MediaImportJob } from "./api";
import { waitForLocalSource } from "./useLocalVideo";

vi.mock("./api", () => ({ api: { importStatus: vi.fn() } }));
const job: MediaImportJob = { id: "local", platform: "local", status: "queued", error: null, duration_ms: null, media_url: null };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("local video background preparation", () => {
  it("waits for the source to become ready for local selection", async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    vi.mocked(api.importStatus).mockResolvedValue({ ...job, status: "awaiting_selection", source_duration_ms: 42000 });
    const result = waitForLocalSource(job, () => true, update);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ status: "awaiting_selection", source_duration_ms: 42000 });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("ignores a late response after replacement", async () => {
    vi.useFakeTimers();
    let current = true;
    let finish!: (next: MediaImportJob) => void;
    vi.mocked(api.importStatus).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const update = vi.fn();
    const result = expect(waitForLocalSource(job, () => current, update)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1200);
    current = false;
    finish({ ...job, status: "ready", media_url: "/old.mp4" });
    await result;
    expect(update).toHaveBeenCalledExactlyOnceWith(job);
  });
});
