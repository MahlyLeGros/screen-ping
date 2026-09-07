import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

export interface PrecisionSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Slider track step (internal value units). */
  step: number;
  /** Number field step (internal value units). */
  inputStep?: number;
  /** Show the number field in seconds (value is still ms internally). */
  displayAsSeconds?: boolean;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number) {
  if (step <= 0) return value;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(decimals));
}

export default function PrecisionSlider({
  label,
  value,
  min,
  max,
  step,
  inputStep,
  displayAsSeconds = false,
  format,
  onChange,
}: PrecisionSliderProps) {
  const id = useId();
  const draggingRef = useRef(false);
  const localValueRef = useRef(value);
  const [localValue, setLocalValue] = useState(value);
  const resolvedInputStep = inputStep ?? step;

  useEffect(() => {
    localValueRef.current = localValue;
  }, [localValue]);

  useEffect(() => {
    if (!draggingRef.current) {
      setLocalValue(value);
      localValueRef.current = value;
    }
  }, [value]);

  const commit = (next: number) => {
    const clamped = clamp(roundToStep(next, resolvedInputStep), min, max);
    setLocalValue(clamped);
    localValueRef.current = clamped;
    onChange(clamped);
  };

  const handleSliderInput = (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    const clamped = clamp(next, min, max);
    setLocalValue(clamped);
    localValueRef.current = clamped;
    onChange(clamped);
  };

  const handlePointerDown = (e: PointerEvent<HTMLInputElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const finishDrag = (e: PointerEvent<HTMLInputElement>) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onChange(localValueRef.current);
  };

  const handleNumberChange = (raw: string) => {
    if (raw.trim() === "" || raw === "-" || raw === ".") return;
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    commit(displayAsSeconds ? next * 1000 : next);
  };

  const handleNumberBlur = (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next)) {
      setLocalValue(value);
      localValueRef.current = value;
      return;
    }
    commit(displayAsSeconds ? next * 1000 : next);
  };

  const numberMin = displayAsSeconds ? min / 1000 : min;
  const numberMax = displayAsSeconds ? max / 1000 : max;
  const numberStep = displayAsSeconds ? resolvedInputStep / 1000 : resolvedInputStep;
  const numberValue = displayAsSeconds
    ? Number((localValue / 1000).toFixed(3))
    : localValue;

  return (
    <div className="precision-slider">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-slate-400">
          {label}
        </label>
        <span className="text-[11px] font-medium text-slate-500">{format(localValue)}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          className="range-slider min-w-0 flex-1"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={localValue}
          onPointerDown={handlePointerDown}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={() => {
            draggingRef.current = false;
          }}
          onInput={(e) => handleSliderInput(e.currentTarget.value)}
          onChange={(e) => handleSliderInput(e.currentTarget.value)}
        />
        <input
          type="number"
          className="field-input w-[5.5rem] shrink-0 px-2 py-1 text-right text-xs tabular-nums"
          aria-label={`${label} precise value`}
          min={numberMin}
          max={numberMax}
          step={numberStep}
          value={numberValue}
          onChange={(e) => handleNumberChange(e.target.value)}
          onBlur={(e) => handleNumberBlur(e.target.value)}
        />
      </div>
    </div>
  );
}
