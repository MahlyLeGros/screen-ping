import { useEffect, useRef, useState } from "react";
import type { CaptionLayout, MediaLayout } from "../../../shared/types";
import { LAYOUT_PRESETS } from "../../../shared/types";
import {
  applyCaptionLayoutPreset,
  applyLayoutPreset,
  describeLayoutChange,
  handleCaptionLayoutKeyboardEvent,
  handleLayoutKeyboardEvent,
  nudgeCaptionLayout,
  nudgeCaptionRotation,
  nudgeCaptionSize,
  nudgeLayout,
  nudgeRotation,
  nudgeSize,
  stepForShift,
  NUDGE_SHIFT_STEP_PCT,
  NUDGE_STEP_PCT,
  ROTATE_SHIFT_STEP_DEG,
  ROTATE_STEP_DEG,
  SIZE_SHIFT_STEP_PCT,
  SIZE_STEP_PCT,
  type NudgeDirection,
  type RotateDirection,
  type SizeDirection,
} from "../lib/layoutKeyboard";

interface LayoutKeyboardPanelProps {
  layout: MediaLayout;
  onChange: (layout: MediaLayout) => void;
  disabled?: boolean;
}

interface CaptionLayoutKeyboardPanelProps {
  layout: CaptionLayout;
  onChange: (layout: CaptionLayout) => void;
  disabled?: boolean;
}

function useLayoutAnnouncement() {
  const [message, setMessage] = useState("");
  const announce = (next: string) => setMessage(next);
  return { message, announce };
}

function MoveButtons({
  disabled,
  onMove,
}: {
  disabled?: boolean;
  onMove: (direction: NudgeDirection, shiftKey: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Move</span>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Move left" onClick={() => onMove("left", false)}>
        ←
      </button>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Move up" onClick={() => onMove("up", false)}>
        ↑
      </button>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Move down" onClick={() => onMove("down", false)}>
        ↓
      </button>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Move right" onClick={() => onMove("right", false)}>
        →
      </button>
    </div>
  );
}

function SizeButtons({
  disabled,
  onSize,
}: {
  disabled?: boolean;
  onSize: (direction: SizeDirection, shiftKey: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Size</span>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Decrease size" onClick={() => onSize("shrink", false)}>
        −
      </button>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Increase size" onClick={() => onSize("grow", false)}>
        +
      </button>
    </div>
  );
}

function RotateButtons({
  disabled,
  onRotate,
}: {
  disabled?: boolean;
  onRotate: (direction: RotateDirection, shiftKey: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Rotate</span>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Rotate counter-clockwise" onClick={() => onRotate("ccw", false)}>
        ↺
      </button>
      <button type="button" disabled={disabled} className="pill-btn !px-2 !py-0.5 !text-xs" aria-label="Rotate clockwise" onClick={() => onRotate("cw", false)}>
        ↻
      </button>
    </div>
  );
}

function PresetButtons({
  disabled,
  onPreset,
}: {
  disabled?: boolean;
  onPreset: (label: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Presets</span>
      {LAYOUT_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          disabled={disabled}
          className="pill-btn !px-2 !py-0.5 !text-xs"
          onClick={() => onPreset(preset.label)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

export function LayoutKeyboardPanel({ layout, onChange, disabled }: LayoutKeyboardPanelProps) {
  const { message, announce } = useLayoutAnnouncement();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  function apply(next: MediaLayout) {
    onChange(next);
    announce(describeLayoutChange(next));
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400">
        Focus the preview, then use arrow keys to move, +/− for size, [ ] to rotate. Hold Shift for larger steps.
      </p>
      <div className="flex flex-col gap-2">
        <MoveButtons
          disabled={disabled}
          onMove={(direction, shiftKey) =>
            apply(nudgeLayout(layoutRef.current, direction, stepForShift(shiftKey, NUDGE_STEP_PCT, NUDGE_SHIFT_STEP_PCT)))
          }
        />
        <SizeButtons
          disabled={disabled}
          onSize={(direction, shiftKey) =>
            apply(nudgeSize(layoutRef.current, direction, stepForShift(shiftKey, SIZE_STEP_PCT, SIZE_SHIFT_STEP_PCT)))
          }
        />
        <RotateButtons
          disabled={disabled}
          onRotate={(direction, shiftKey) =>
            apply(nudgeRotation(layoutRef.current, direction, stepForShift(shiftKey, ROTATE_STEP_DEG, ROTATE_SHIFT_STEP_DEG)))
          }
        />
        <PresetButtons disabled={disabled} onPreset={(label) => apply(applyLayoutPreset(layoutRef.current, label))} />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </div>
  );
}

export function CaptionLayoutKeyboardPanel({ layout, onChange, disabled }: CaptionLayoutKeyboardPanelProps) {
  const { message, announce } = useLayoutAnnouncement();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  function apply(next: CaptionLayout) {
    onChange(next);
    announce(describeLayoutChange(next));
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400">Keyboard controls apply to the caption layer.</p>
      <div className="flex flex-col gap-2">
        <MoveButtons
          disabled={disabled}
          onMove={(direction, shiftKey) =>
            apply(nudgeCaptionLayout(layoutRef.current, direction, stepForShift(shiftKey, NUDGE_STEP_PCT, NUDGE_SHIFT_STEP_PCT)))
          }
        />
        <SizeButtons
          disabled={disabled}
          onSize={(direction, shiftKey) =>
            apply(nudgeCaptionSize(layoutRef.current, direction, stepForShift(shiftKey, SIZE_STEP_PCT, SIZE_SHIFT_STEP_PCT)))
          }
        />
        <RotateButtons
          disabled={disabled}
          onRotate={(direction, shiftKey) =>
            apply(nudgeCaptionRotation(layoutRef.current, direction, stepForShift(shiftKey, ROTATE_STEP_DEG, ROTATE_SHIFT_STEP_DEG)))
          }
        />
        <PresetButtons disabled={disabled} onPreset={(label) => apply(applyCaptionLayoutPreset(layoutRef.current, label))} />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </div>
  );
}

export function useLayoutCanvasKeyboard(
  layout: MediaLayout,
  onChange: (layout: MediaLayout) => void,
  disabled?: boolean,
) {
  const layoutRef = useRef(layout);
  const onChangeRef = useRef(onChange);
  const announceRef = useRef<(message: string) => void>(() => {});

  layoutRef.current = layout;
  onChangeRef.current = onChange;

  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    announceRef.current = setAnnouncement;
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    const handled = handleLayoutKeyboardEvent(e, layoutRef.current, (next) => {
      onChangeRef.current(next);
      announceRef.current(describeLayoutChange(next));
    });
    if (!handled && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
    }
  }

  return { onKeyDown, announcement };
}

export function useCaptionLayoutCanvasKeyboard(
  layout: CaptionLayout,
  onChange: (layout: CaptionLayout) => void,
  disabled?: boolean,
) {
  const layoutRef = useRef(layout);
  const onChangeRef = useRef(onChange);
  const announceRef = useRef<(message: string) => void>(() => {});

  layoutRef.current = layout;
  onChangeRef.current = onChange;

  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    announceRef.current = setAnnouncement;
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    const handled = handleCaptionLayoutKeyboardEvent(e, layoutRef.current, (next) => {
      onChangeRef.current(next);
      announceRef.current(describeLayoutChange(next));
    });
    if (!handled && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
    }
  }

  return { onKeyDown, announcement };
}
