import type { CSSProperties } from "react";

/** Visible black border thickness as a fraction of font size (~classic meme). */
export const MEME_OUTLINE_RATIO = 0.12;

export const IMPACT_STACK = 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif';

export function memeCaptionTextStyle(fontSizePct = 10): CSSProperties {
  // paint-order stroke+fill: fill covers inner half → visible outline ≈ stroke/2
  const strokeEm = (MEME_OUTLINE_RATIO * 2).toFixed(4);

  return {
    ["--caption-fs-pct" as string]: fontSizePct,
    fontFamily: IMPACT_STACK,
    fontWeight: 900,
    textTransform: "uppercase",
    textAlign: "center",
    lineHeight: 1.05,
    color: "#fff",
    overflowWrap: "normal",
    wordBreak: "normal",
    whiteSpace: "pre-wrap",
    fontSize: "calc(var(--caption-fs-pct, 10) * 1cqh)",
    WebkitTextStroke: `${strokeEm}em #000`,
    paintOrder: "stroke fill",
  };
}
