import { describe, expect, it } from "vitest";
import { slideshowTiming } from "./slideshow";
describe("slideshow timing", () => {
  it("keeps the default three seconds and bounds the transition", () => {
    expect(slideshowTiming(3, 3)).toEqual({ seconds: 3, transition: 7/30, duration: 9 });
  });
  it("accelerates the whole post, never truncating the last photos", () => {
    const result = slideshowTiming(24, 3);
    expect(result.duration).toBeLessThanOrEqual(30);
    expect(result.seconds * 24).toBe(result.duration);
    expect(result.transition).toBeLessThanOrEqual(result.seconds / 4);
  });
  it("keeps one image long enough for the existing video transport", () => {
    expect(slideshowTiming(1, .5).duration).toBe(2);
  });
});
