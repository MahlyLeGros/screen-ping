import type { CaptionLayout } from "../../../shared/types";
import { DEFAULT_CAPTION_FONT_SIZE_PCT } from "../../../shared/types";
import { CAPTION_MAX_WIDTH_CQW, paddedCaptionSize } from "../../../shared/captionMetrics";

export function measureCaptionElement(
  el: HTMLElement,
  canvasWidthPx: number,
  canvasHeightPx: number
): Pick<CaptionLayout, "width" | "height"> {
  const rect = el.getBoundingClientRect();
  const { width: widthPx, height: heightPx } = paddedCaptionSize(rect.width, rect.height);
  return {
    width: Math.min(CAPTION_MAX_WIDTH_CQW, (widthPx / canvasWidthPx) * 100),
    height: (heightPx / canvasHeightPx) * 100,
  };
}

export function captionLayoutAroundCenter(
  centerX: number,
  centerY: number,
  size: Pick<CaptionLayout, "width" | "height">,
  rotation = 0,
  fontSizePct = DEFAULT_CAPTION_FONT_SIZE_PCT
): CaptionLayout {
  return {
    x: centerX - size.width / 2,
    y: centerY - size.height / 2,
    width: size.width,
    height: size.height,
    rotation,
    fontSizePct,
  };
}

export function defaultCaptionCenter(): { x: number; y: number } {
  return { x: 50, y: 82 };
}
