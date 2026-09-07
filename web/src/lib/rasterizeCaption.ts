import {
  COMPOSE_CANVAS_HEIGHT,
  COMPOSE_CANVAS_WIDTH,
  DEFAULT_CAPTION_FONT_SIZE_PCT,
  clampLayout,
  type MediaLayout,
} from "../../../shared/types";
import { IMPACT_STACK, MEME_OUTLINE_RATIO } from "../../../shared/memeCaptionStyle";
import { CAPTION_MAX_WIDTH_CQW } from "../../../shared/captionMetrics";
import { defaultCaptionCenter } from "./captionMeasure";

const LINE_HEIGHT = 1.05;
const BOX_PAD_EM = 0.35;
const RENDER_SCALE = 2;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
        continue;
      }
      current = "";
      let chunk = "";
      for (const ch of word) {
        const trial = chunk + ch;
        if (ctx.measureText(trial).width <= maxWidth) {
          chunk = trial;
        } else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function captionFileName(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${slug || "caption"}.png`;
}

export interface RasterizedCaption {
  file: File;
  layout: MediaLayout;
}

export async function rasterizeCaptionText(text: string): Promise<RasterizedCaption> {
  const display = text.trim().toUpperCase();
  if (!display) throw new Error("Caption is empty");

  const fontPx = Math.round((DEFAULT_CAPTION_FONT_SIZE_PCT / 100) * COMPOSE_CANVAS_HEIGHT) * RENDER_SCALE;
  const maxTextWidth = (CAPTION_MAX_WIDTH_CQW / 100) * COMPOSE_CANVAS_WIDTH * RENDER_SCALE;
  const strokePx = MEME_OUTLINE_RATIO * 2 * fontPx;
  const padPx = BOX_PAD_EM * fontPx + strokePx / 2;

  const font = `900 ${fontPx}px ${IMPACT_STACK}`;
  try {
    await document.fonts.load(font);
    await document.fonts.ready;
  } catch {
    // Canvas will fall back to Arial Black / sans-serif.
  }

  const measure = document.createElement("canvas");
  const ctx = measure.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  ctx.font = font;

  const lines = wrapLines(ctx, display, maxTextWidth);
  const lineHeight = fontPx * LINE_HEIGHT;
  let textWidth = 0;
  for (const line of lines) {
    textWidth = Math.max(textWidth, ctx.measureText(line).width);
  }
  const textHeight = Math.max(lines.length * lineHeight, fontPx);
  const width = Math.max(1, Math.ceil(textWidth + padPx * 2));
  const height = Math.max(1, Math.ceil(textHeight + padPx * 2));

  measure.width = width;
  measure.height = height;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = strokePx;
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";

  const cx = width / 2;
  const startY = padPx + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    const line = lines[i] || " ";
    ctx.strokeText(line, cx, y);
    ctx.fillText(line, cx, y);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    measure.toBlob((next) => (next ? resolve(next) : reject(new Error("Caption render failed"))), "image/png");
  });
  const file = new File([blob], captionFileName(display), { type: "image/png" });

  const widthPct = (width / RENDER_SCALE / COMPOSE_CANVAS_WIDTH) * 100;
  const heightPct = (height / RENDER_SCALE / COMPOSE_CANVAS_HEIGHT) * 100;
  const center = defaultCaptionCenter();
  const layout = clampLayout({
    x: center.x - widthPct / 2,
    y: center.y - heightPct / 2,
    width: widthPct,
    height: heightPct,
    rotation: 0,
    objectFit: "contain",
  });

  return { file, layout };
}
