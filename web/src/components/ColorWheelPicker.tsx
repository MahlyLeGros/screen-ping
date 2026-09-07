import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

interface ColorWheelPickerProps {
  color: string;
  onChange: (hex: string) => void;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const WHEEL_CSS = 148;
const DEFAULT_HSV: Hsv = { h: 258, s: 0.48, v: 0.98 };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function hsvToHex(hsv: Hsv) {
  return rgbToHex(...hsvToRgb(hsv.h, hsv.s, hsv.v));
}

function hexToRgb(hex: string): [number, number, number] | null {
  const text = hex.trim();
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(text)) return null;
  const raw = text.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hexToHsv(hex: string, fallback: Hsv): Hsv {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  const parsed = rgbToHsv(...rgb);
  if (parsed.s < 0.01) parsed.h = fallback.h;
  if (parsed.v < 0.01) {
    parsed.h = fallback.h;
    parsed.s = fallback.s;
  }
  return parsed;
}

function markerFromHs(h: number, s: number) {
  const radius = WHEEL_CSS / 2 - 1;
  const angle = ((h - 180) * Math.PI) / 180;
  return {
    x: WHEEL_CSS / 2 + Math.cos(angle) * radius * s,
    y: WHEEL_CSS / 2 + Math.sin(angle) * radius * s,
  };
}

function drawWheel(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const size = WHEEL_CSS;
  const px = Math.round(size * dpr);
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const cx = px / 2;
  const cy = px / 2;
  const radius = px / 2 - dpr;
  const image = ctx.createImageData(px, px);
  const data = image.data;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * px + x) * 4;
      if (dist > radius) {
        data[i + 3] = 0;
        continue;
      }
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
      const sat = dist / radius;
      const [r, g, b] = hsvToRgb(hue, sat, 1);
      const edge = clamp((radius - dist) / dpr, 0, 1);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(255 * edge);
    }
  }
  ctx.putImageData(image, 0, 0);
}

export default function ColorWheelPicker({ color, onChange }: ColorWheelPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initial = hexToHsv(color, DEFAULT_HSV);
  const hsvRef = useRef<Hsv>(initial);
  const draggingRef = useRef(false);
  const hueId = useId();
  const valueId = useId();

  const [hue, setHue] = useState(initial.h);
  const [sat, setSat] = useState(initial.s);
  const [value, setValue] = useState(initial.v);
  const [hexDraft, setHexDraft] = useState(color);

  const fullHex = hsvToHex({ h: hue, s: sat, v: 1 });
  const marker = markerFromHs(hue, sat);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawWheel(canvas);
  }, []);

  function emit(next: Hsv) {
    hsvRef.current = next;
    onChange(hsvToHex(next));
    setHexDraft(hsvToHex(next));
  }

  function commitFromPointer(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const radius = rect.width / 2 - 1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const h = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
    const s = clamp(dist / radius, 0, 1);
    const next = { h, s, v: hsvRef.current.v };
    setHue(h);
    setSat(s);
    emit(next);
  }

  function onWheelPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    commitFromPointer(e.clientX, e.clientY);
  }

  function onWheelPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    commitFromPointer(e.clientX, e.clientY);
  }

  function onWheelPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center">
        <div className="relative" style={{ width: WHEEL_CSS, height: WHEEL_CSS }}>
          <canvas
            ref={canvasRef}
            className="touch-none cursor-crosshair rounded-full"
            width={WHEEL_CSS}
            height={WHEEL_CSS}
            role="slider"
            aria-label="Color hue and saturation"
            aria-valuetext={color}
            onPointerDown={onWheelPointerDown}
            onPointerMove={onWheelPointerMove}
            onPointerUp={onWheelPointerUp}
            onPointerCancel={onWheelPointerUp}
          />
          <div
            className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(${marker.x - 7}px, ${marker.y - 7}px, 0)`,
              backgroundColor: fullHex,
            }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={valueId} className="flex items-center justify-between text-xs text-slate-400">
          <span>Darkness</span>
          <span className="tabular-nums text-[11px] text-slate-500">{Math.round((1 - value) * 100)}%</span>
        </label>
        <input
          id={valueId}
          type="range"
          className="color-value-slider"
          min={0}
          max={100}
          step={1}
          value={Math.round((1 - value) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((1 - value) * 100)}
          aria-label="Color darkness"
          onChange={(e) => {
            const v = clamp(1 - Number(e.target.value) / 100, 0, 1);
            setValue(v);
            emit({ h: hsvRef.current.h, s: hsvRef.current.s, v });
          }}
          style={{
            background: `linear-gradient(to right, ${fullHex} 0%, #000 100%)`,
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span
          className="h-6 w-6 shrink-0 rounded-md border border-white/15"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <label htmlFor={hueId} className="sr-only">
          Hex color
        </label>
        <input
          id={hueId}
          type="text"
          spellCheck={false}
          value={hexDraft}
          onChange={(e) => {
            const next = e.target.value;
            setHexDraft(next);
            const rgb = hexToRgb(next);
            if (!rgb) return;
            const parsed = hexToHsv(next, hsvRef.current);
            hsvRef.current = parsed;
            setHue(parsed.h);
            setSat(parsed.s);
            setValue(parsed.v);
            onChange(rgbToHex(...rgb));
          }}
          onBlur={() => setHexDraft(hsvToHex(hsvRef.current))}
          className="field-input min-w-0 flex-1 px-2 py-1 font-mono text-xs uppercase"
        />
      </div>
    </div>
  );
}
