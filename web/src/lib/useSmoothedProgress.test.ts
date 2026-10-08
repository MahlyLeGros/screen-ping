import { describe, expect, it } from "vitest";
import { interpolateProgress } from "./useSmoothedProgress";

describe("progress smoothing", () => {
  it("fills intermediate values instead of jumping to the next update", () => {
    expect(interpolateProgress(20, 40, 0)).toBe(20);
    expect(interpolateProgress(20, 40, 700)).toBe(30);
    expect(interpolateProgress(20, 40, 1400)).toBe(40);
  });
  it("never exceeds confirmed progress even after a long pause", () => {
    expect(interpolateProgress(20, 40, 10000)).toBe(40);
    expect(interpolateProgress(20, 40, -1)).toBe(20);
  });
});
