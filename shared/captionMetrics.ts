export const CAPTION_PAD_PX = 10;
export const CAPTION_MAX_WIDTH_CQW = 92;

export function paddedCaptionSize(widthPx: number, heightPx: number): { width: number; height: number } {
  return {
    width: widthPx + CAPTION_PAD_PX * 2,
    height: heightPx + CAPTION_PAD_PX * 2,
  };
}
