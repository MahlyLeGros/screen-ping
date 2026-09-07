import type { CaptionLayout, MediaLayout } from "../../../shared/types";
import {
  captionLayoutToMedia,
  clampCaptionLayout,
  clampLayout,
  LAYOUT_PRESETS,
} from "../../../shared/types";

export type NudgeDirection = "left" | "right" | "up" | "down";
export type SizeDirection = "grow" | "shrink";
export type RotateDirection = "ccw" | "cw";

export const NUDGE_STEP_PCT = 1;
export const NUDGE_SHIFT_STEP_PCT = 5;
export const SIZE_STEP_PCT = 2;
export const SIZE_SHIFT_STEP_PCT = 5;
export const ROTATE_STEP_DEG = 5;
export const ROTATE_SHIFT_STEP_DEG = 15;

export function stepForShift(shiftKey: boolean, normal: number, shifted: number): number {
  return shiftKey ? shifted : normal;
}

export function nudgeLayout(
  layout: MediaLayout,
  direction: NudgeDirection,
  stepPct = NUDGE_STEP_PCT,
): MediaLayout {
  let { x, y } = layout;
  switch (direction) {
    case "left":
      x -= stepPct;
      break;
    case "right":
      x += stepPct;
      break;
    case "up":
      y -= stepPct;
      break;
    case "down":
      y += stepPct;
      break;
  }
  return clampLayout({ ...layout, x, y });
}

export function nudgeSize(
  layout: MediaLayout,
  direction: SizeDirection,
  stepPct = SIZE_STEP_PCT,
): MediaLayout {
  const delta = direction === "grow" ? stepPct : -stepPct;
  return clampLayout({
    ...layout,
    width: layout.width + delta,
    height: layout.height + delta,
  });
}

export function nudgeRotation(
  layout: MediaLayout,
  direction: RotateDirection,
  stepDeg = ROTATE_STEP_DEG,
): MediaLayout {
  const delta = direction === "cw" ? stepDeg : -stepDeg;
  return clampLayout({ ...layout, rotation: (layout.rotation ?? 0) + delta });
}

export function applyLayoutPreset(layout: MediaLayout, presetLabel: string): MediaLayout {
  const preset = LAYOUT_PRESETS.find((entry) => entry.label === presetLabel);
  if (!preset) return clampLayout(layout);
  return clampLayout({ ...layout, ...preset.layout });
}

export function nudgeCaptionLayout(
  layout: CaptionLayout,
  direction: NudgeDirection,
  stepPct = NUDGE_STEP_PCT,
): CaptionLayout {
  const nudged = nudgeLayout(captionLayoutToMedia(layout), direction, stepPct);
  return clampCaptionLayout({
    ...layout,
    x: nudged.x,
    y: nudged.y,
    width: nudged.width,
    height: nudged.height,
    rotation: nudged.rotation,
  });
}

export function nudgeCaptionSize(
  layout: CaptionLayout,
  direction: SizeDirection,
  stepPct = SIZE_STEP_PCT,
): CaptionLayout {
  const sized = nudgeSize(captionLayoutToMedia(layout), direction, stepPct);
  return clampCaptionLayout({
    ...layout,
    x: sized.x,
    y: sized.y,
    width: sized.width,
    height: sized.height,
    rotation: sized.rotation,
  });
}

export function nudgeCaptionRotation(
  layout: CaptionLayout,
  direction: RotateDirection,
  stepDeg = ROTATE_STEP_DEG,
): CaptionLayout {
  const rotated = nudgeRotation(captionLayoutToMedia(layout), direction, stepDeg);
  return clampCaptionLayout({
    ...layout,
    x: rotated.x,
    y: rotated.y,
    width: rotated.width,
    height: rotated.height,
    rotation: rotated.rotation,
  });
}

export function applyCaptionLayoutPreset(layout: CaptionLayout, presetLabel: string): CaptionLayout {
  const preset = LAYOUT_PRESETS.find((entry) => entry.label === presetLabel);
  if (!preset) return clampCaptionLayout(layout);
  return clampCaptionLayout({ ...layout, ...preset.layout });
}

export function describeLayoutChange(
  layout: Pick<MediaLayout, "x" | "y" | "width" | "height" | "rotation">,
): string {
  const rotation = Math.round(layout.rotation ?? 0);
  return `Position ${Math.round(layout.x)}%, ${Math.round(layout.y)}%. Size ${Math.round(layout.width)}% by ${Math.round(layout.height)}%. Rotation ${rotation} degrees.`;
}

type KeyboardLike = Pick<KeyboardEvent, "key" | "shiftKey" | "defaultPrevented" | "preventDefault">;

export function handleLayoutKeyboardEvent(
  e: KeyboardLike,
  layout: MediaLayout,
  onChange: (layout: MediaLayout) => void,
): boolean {
  if (e.defaultPrevented) return false;

  const nudgeStep = stepForShift(e.shiftKey, NUDGE_STEP_PCT, NUDGE_SHIFT_STEP_PCT);
  const sizeStep = stepForShift(e.shiftKey, SIZE_STEP_PCT, SIZE_SHIFT_STEP_PCT);
  const rotateStep = stepForShift(e.shiftKey, ROTATE_STEP_DEG, ROTATE_SHIFT_STEP_DEG);

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      onChange(nudgeLayout(layout, "left", nudgeStep));
      return true;
    case "ArrowRight":
      e.preventDefault();
      onChange(nudgeLayout(layout, "right", nudgeStep));
      return true;
    case "ArrowUp":
      e.preventDefault();
      onChange(nudgeLayout(layout, "up", nudgeStep));
      return true;
    case "ArrowDown":
      e.preventDefault();
      onChange(nudgeLayout(layout, "down", nudgeStep));
      return true;
    case "+":
    case "=":
      e.preventDefault();
      onChange(nudgeSize(layout, "grow", sizeStep));
      return true;
    case "-":
    case "_":
      e.preventDefault();
      onChange(nudgeSize(layout, "shrink", sizeStep));
      return true;
    case "[":
      e.preventDefault();
      onChange(nudgeRotation(layout, "ccw", rotateStep));
      return true;
    case "]":
      e.preventDefault();
      onChange(nudgeRotation(layout, "cw", rotateStep));
      return true;
    default:
      return false;
  }
}

export function handleCaptionLayoutKeyboardEvent(
  e: KeyboardLike,
  layout: CaptionLayout,
  onChange: (layout: CaptionLayout) => void,
): boolean {
  if (e.defaultPrevented) return false;

  const nudgeStep = stepForShift(e.shiftKey, NUDGE_STEP_PCT, NUDGE_SHIFT_STEP_PCT);
  const sizeStep = stepForShift(e.shiftKey, SIZE_STEP_PCT, SIZE_SHIFT_STEP_PCT);
  const rotateStep = stepForShift(e.shiftKey, ROTATE_STEP_DEG, ROTATE_SHIFT_STEP_DEG);

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      onChange(nudgeCaptionLayout(layout, "left", nudgeStep));
      return true;
    case "ArrowRight":
      e.preventDefault();
      onChange(nudgeCaptionLayout(layout, "right", nudgeStep));
      return true;
    case "ArrowUp":
      e.preventDefault();
      onChange(nudgeCaptionLayout(layout, "up", nudgeStep));
      return true;
    case "ArrowDown":
      e.preventDefault();
      onChange(nudgeCaptionLayout(layout, "down", nudgeStep));
      return true;
    case "+":
    case "=":
      e.preventDefault();
      onChange(nudgeCaptionSize(layout, "grow", sizeStep));
      return true;
    case "-":
    case "_":
      e.preventDefault();
      onChange(nudgeCaptionSize(layout, "shrink", sizeStep));
      return true;
    case "[":
      e.preventDefault();
      onChange(nudgeCaptionRotation(layout, "ccw", rotateStep));
      return true;
    case "]":
      e.preventDefault();
      onChange(nudgeCaptionRotation(layout, "cw", rotateStep));
      return true;
    default:
      return false;
  }
}
