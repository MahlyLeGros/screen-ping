/** Trail erase — each point dies after Stay on screen, stroke retracts along its path. */

export interface TimedPoint {
  x: number;
  y: number;
  t: number;
}

export interface TrailStroke {
  points: TimedPoint[];
  color: string;
  width: number;
  durationMs?: number;
  strokeId?: string;
}

/** Soft tip fade after a point's hold so the retracting end does not pop. */
export const TRAIL_TIP_FADE_MS = 150;

export function pointAlpha(now: number, drawnAt: number, durationMs: number): number {
  const age = now - drawnAt;
  if (age <= durationMs) return 1;
  const fade = (age - durationMs) / TRAIL_TIP_FADE_MS;
  if (fade >= 1) return 0;
  if (fade <= 0) return 1;
  return 1 - fade;
}

function lerpPoint(a: TimedPoint, b: TimedPoint, u: number): TimedPoint {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    t: a.t + (b.t - a.t) * u,
  };
}

/**
 * Visible portion of a stroke: from the interpolated cutoff (now - durationMs)
 * along the path to the newest point. Older geometry is dropped so a L→R stroke
 * retracts L→R at the same rhythm it was drawn.
 */
export function trailCutoff(
  points: TimedPoint[],
  now: number,
  durationMs: number,
): TimedPoint[] {
  if (points.length === 0) return [];
  const cutoff = now - durationMs;
  const last = points[points.length - 1];
  if (last.t < cutoff) return [];
  if (points[0].t >= cutoff) return points;

  let i = 1;
  while (i < points.length && points[i].t < cutoff) i++;
  if (i >= points.length) return [];

  const prev = points[i - 1];
  const next = points[i];
  const span = next.t - prev.t;
  const u = span > 0 ? (cutoff - prev.t) / span : 1;
  const start = lerpPoint(prev, next, Math.max(0, Math.min(1, u)));
  return [start, ...points.slice(i)];
}

export function strokeStillAlive(
  points: TimedPoint[],
  now: number,
  durationMs: number,
): boolean {
  if (points.length === 0) return false;
  return pointAlpha(now, points[points.length - 1].t, durationMs) > 0.01;
}

/** Fill missing `t` for older clients: space points evenly ending at receivedAt. */
export function assignMissingTimestamps(
  points: Array<{ x: number; y: number; t?: number }>,
  receivedAt: number,
): TimedPoint[] {
  if (points.length === 0) return [];
  const hasAny = points.some((p) => typeof p.t === "number" && Number.isFinite(p.t));
  if (!hasAny) {
    const span = Math.max(0, (points.length - 1) * 16);
    const start = receivedAt - span;
    return points.map((p, i) => ({
      x: p.x,
      y: p.y,
      t: start + (points.length === 1 ? 0 : (i / (points.length - 1)) * span),
    }));
  }
  let lastT = receivedAt;
  const timed = points.map((p) => {
    if (typeof p.t === "number" && Number.isFinite(p.t)) {
      lastT = p.t;
      return { x: p.x, y: p.y, t: p.t };
    }
    lastT += 1;
    return { x: p.x, y: p.y, t: lastT };
  });
  return alignTimestampsToNow(timed, receivedAt);
}

/** Shift a packet so its last point lands at receivedAt — duration uses the receiver clock. */
export function alignTimestampsToNow(points: TimedPoint[], receivedAt: number): TimedPoint[] {
  if (points.length === 0) return points;
  const lastT = points[points.length - 1].t;
  const skew = receivedAt - lastT;
  if (skew === 0) return points;
  return points.map((p) => ({ ...p, x: p.x, y: p.y, t: p.t + skew }));
}

function strokeDuration(stroke: TrailStroke, fallbackMs: number): number {
  return stroke.durationMs && stroke.durationMs > 0 ? stroke.durationMs : fallbackMs;
}

export function pruneDeadStrokes(
  strokes: TrailStroke[],
  now: number,
  durationMs: number,
): TrailStroke[] {
  return strokes.filter((s) => strokeStillAlive(s.points, now, strokeDuration(s, durationMs)));
}

export function strokesStillAlive(
  strokes: TrailStroke[],
  now: number,
  durationMs: number,
): boolean {
  return strokes.some((s) => strokeStillAlive(s.points, now, strokeDuration(s, durationMs)));
}

/** Append incoming points, skipping a duplicate join so packets overlap cleanly. */
export function concatStrokePoints(existing: TimedPoint[], incoming: TimedPoint[]): TimedPoint[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming.slice();
  const last = existing[existing.length - 1];
  const first = incoming[0];
  const same = Math.abs(last.x - first.x) < 1e-4 && Math.abs(last.y - first.y) < 1e-4;
  return same ? existing.concat(incoming.slice(1)) : existing.concat(incoming);
}

function strokeToPx(p: TimedPoint, widthPx: number, heightPx: number) {
  return { x: (p.x / 100) * widthPx, y: (p.y / 100) * heightPx };
}

/**
 * Map stroke points into pixel space (render helpers / tests).
 * Paint uses cubic beziers directly — no dense Catmull-Rom resampling.
 */
export function smoothStrokePoints(
  points: TimedPoint[],
  widthPx: number,
  heightPx: number,
): Array<{ x: number; y: number }> {
  return points.map((p) => strokeToPx(p, widthPx, heightPx));
}

/** Catmull-Rom segment (p0..p3) as cubic Bezier from p1 → p2. */
function catmullRomToBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
) {
  return {
    cp1x: p1.x + (p2.x - p0.x) / 6,
    cp1y: p1.y + (p2.y - p0.y) / 6,
    cp2x: p2.x - (p3.x - p1.x) / 6,
    cp2y: p2.y - (p3.y - p1.y) / 6,
    x: p2.x,
    y: p2.y,
  };
}

function traceSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: TimedPoint[],
  widthPx: number,
  heightPx: number,
) {
  const px = points.map((p) => strokeToPx(p, widthPx, heightPx));
  if (px.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(px[0].x, px[0].y);
  if (px.length === 1) {
    ctx.lineTo(px[0].x + 0.01, px[0].y);
    return;
  }
  if (px.length === 2) {
    ctx.lineTo(px[1].x, px[1].y);
    return;
  }
  for (let i = 0; i < px.length - 1; i++) {
    const p0 = px[i - 1] ?? px[i];
    const p1 = px[i];
    const p2 = px[i + 1];
    const p3 = px[i + 2] ?? p2;
    const b = catmullRomToBezier(p0, p1, p2, p3);
    ctx.bezierCurveTo(b.cp1x, b.cp1y, b.cp2x, b.cp2y, b.x, b.y);
  }
}

/** Paint trail strokes into a canvas context. Returns true if anything is still alive. */
export function paintTrailStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: TrailStroke[],
  widthPx: number,
  heightPx: number,
  now: number,
  durationMs: number,
  options?: { clear?: boolean },
): boolean {
  if (options?.clear !== false) {
    ctx.clearRect(0, 0, widthPx, heightPx);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality: string }).imageSmoothingQuality =
      "medium";
  }

  let alive = false;
  const minDim = Math.min(widthPx, heightPx);

  for (const stroke of strokes) {
    const holdMs = strokeDuration(stroke, durationMs);
    if (!strokeStillAlive(stroke.points, now, holdMs)) continue;
    const visible = trailCutoff(stroke.points, now, holdMs);
    if (visible.length === 0) continue;
    alive = true;

    const tipAlpha = pointAlpha(now, visible[0].t, holdMs);
    const lineWidth = Math.max(0.75, (stroke.width / 100) * minDim);
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = tipAlpha;
    ctx.lineWidth = lineWidth;
    traceSmoothPath(ctx, visible, widthPx, heightPx);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return alive;
}
