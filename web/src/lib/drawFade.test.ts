import { describe, expect, it } from "vitest";

import {
  TRAIL_TIP_FADE_MS,
  assignMissingTimestamps,
  concatStrokePoints,
  pointAlpha,
  smoothStrokePoints,
  strokeStillAlive,
  trailCutoff,
} from "../../../shared/drawFade";

describe("pointAlpha", () => {
  it("stays fully visible during the hold", () => {
    expect(pointAlpha(1000, 1000, 2000)).toBe(1);
    expect(pointAlpha(3000, 1000, 2000)).toBe(1);
  });

  it("fades briefly after the hold", () => {
    const mid = pointAlpha(3000 + TRAIL_TIP_FADE_MS / 2, 1000, 2000);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
  });

  it("is gone after the tip fade", () => {
    expect(pointAlpha(3000 + TRAIL_TIP_FADE_MS + 1, 1000, 2000)).toBe(0);
  });
});

describe("trailCutoff", () => {
  const stroke = [
    { x: 0, y: 50, t: 1000 },
    { x: 50, y: 50, t: 2000 },
    { x: 100, y: 50, t: 3000 },
  ];

  it("returns the full stroke while everything is still alive", () => {
    expect(trailCutoff(stroke, 2500, 2000)).toEqual(stroke);
  });

  it("interpolates the retracting tip left-to-right", () => {
    // Stay=2000ms: at t=3500, cutoff=1500 → halfway between left (1000) and mid (2000)
    const visible = trailCutoff(stroke, 3500, 2000);
    expect(visible.length).toBe(3);
    expect(visible[0].x).toBeCloseTo(25);
    expect(visible[0].y).toBeCloseTo(50);
    expect(visible[0].t).toBeCloseTo(1500);
    expect(visible[1]).toEqual(stroke[1]);
    expect(visible[2]).toEqual(stroke[2]);
  });

  it("drops the left side once it expires", () => {
    // At t=4500, cutoff=2500 → between mid (2000) and right (3000)
    const visible = trailCutoff(stroke, 4500, 2000);
    expect(visible.length).toBe(2);
    expect(visible[0].x).toBeCloseTo(75);
    expect(visible[1]).toEqual(stroke[2]);
  });

  it("returns empty when the whole stroke is gone", () => {
    const goneAt = 3000 + 2000 + TRAIL_TIP_FADE_MS + 1;
    expect(trailCutoff(stroke, goneAt, 2000)).toEqual([]);
    expect(strokeStillAlive(stroke, goneAt, 2000)).toBe(false);
  });
});

describe("assignMissingTimestamps", () => {
  it("keeps relative spacing and aligns the last point to receivedAt", () => {
    const pts = assignMissingTimestamps(
      [
        { x: 1, y: 2, t: 10 },
        { x: 3, y: 4, t: 20 },
      ],
      99,
    );
    expect(pts[0].t).toBe(89);
    expect(pts[1].t).toBe(99);
    expect(pts[1].t - pts[0].t).toBe(10);
  });

  it("fills evenly when t is missing", () => {
    const pts = assignMissingTimestamps(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      1000,
    );
    expect(pts[0].t).toBeLessThan(pts[1].t);
    expect(pts[1].t).toBeLessThan(pts[2].t);
    expect(pts[2].t).toBe(1000);
  });
});

describe("concatStrokePoints", () => {
  it("skips a duplicate join point", () => {
    const existing = [
      { x: 0, y: 0, t: 1 },
      { x: 10, y: 10, t: 2 },
    ];
    const incoming = [
      { x: 10, y: 10, t: 2 },
      { x: 20, y: 20, t: 3 },
    ];
    expect(concatStrokePoints(existing, incoming)).toEqual([
      { x: 0, y: 0, t: 1 },
      { x: 10, y: 10, t: 2 },
      { x: 20, y: 20, t: 3 },
    ]);
  });

  it("keeps a connector when packets do not overlap", () => {
    const existing = [{ x: 0, y: 0, t: 1 }];
    const incoming = [{ x: 40, y: 10, t: 2 }];
    expect(concatStrokePoints(existing, incoming)).toEqual([
      { x: 0, y: 0, t: 1 },
      { x: 40, y: 10, t: 2 },
    ]);
  });
});

describe("smoothStrokePoints", () => {
  it("maps percent points into pixel space and keeps endpoints", () => {
    const pts = [
      { x: 0, y: 50, t: 1 },
      { x: 50, y: 0, t: 2 },
      { x: 100, y: 50, t: 3 },
    ];
    const smooth = smoothStrokePoints(pts, 200, 100);
    expect(smooth).toHaveLength(3);
    expect(smooth[0].x).toBeCloseTo(0);
    expect(smooth[0].y).toBeCloseTo(50);
    expect(smooth[2].x).toBeCloseTo(200);
    expect(smooth[2].y).toBeCloseTo(50);
  });
});
