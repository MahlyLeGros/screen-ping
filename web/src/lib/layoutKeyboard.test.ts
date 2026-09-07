import { describe, expect, it } from "vitest";
import type { MediaLayout } from "../../../shared/types";
import {
  applyLayoutPreset,
  nudgeLayout,
  nudgeRotation,
  nudgeSize,
} from "./layoutKeyboard";

const baseLayout: MediaLayout = {
  x: 30,
  y: 30,
  width: 40,
  height: 40,
  rotation: 0,
  flipX: false,
  flipY: false,
  objectFit: "contain",
};

describe("layoutKeyboard", () => {
  it("nudges layout within bounds", () => {
    const left = nudgeLayout(baseLayout, "left", 5);
    expect(left.x).toBe(25);

    const edge = nudgeLayout({ ...baseLayout, x: -10, width: 40 }, "left", 50);
    expect(edge.x).toBeGreaterThan(-40);
  });

  it("grows and shrinks size with clamp", () => {
    const bigger = nudgeSize(baseLayout, "grow", 10);
    expect(bigger.width).toBe(50);
    expect(bigger.height).toBe(50);

    const smaller = nudgeSize({ ...baseLayout, width: 3, height: 3 }, "shrink", 5);
    expect(smaller.width).toBeGreaterThan(0);
    expect(smaller.height).toBeGreaterThan(0);
  });

  it("rotates and wraps degrees", () => {
    const rotated = nudgeRotation({ ...baseLayout, rotation: 350 }, "cw", 20);
    expect(rotated.rotation).toBe(10);
  });

  it("applies named presets", () => {
    const centered = applyLayoutPreset(baseLayout, "Center");
    expect(centered.x).toBe(30);
    expect(centered.y).toBe(30);
    expect(centered.width).toBe(40);
    expect(centered.height).toBe(40);
  });
});
