import { useEffect, useRef, useState } from "react";

export function interpolateProgress(from: number, target: number, elapsed: number) {
  return from + (target - from) * Math.max(0, Math.min(1, elapsed / 1400));
}

// Animate only towards confirmed progress; never predict server completion.
export function useSmoothedProgress(id: string | undefined, target: number | null | undefined) {
  const [displayed, setDisplayed] = useState(0);
  const current = useRef(0);
  useEffect(() => { current.current = 0; setDisplayed(0); }, [id]);
  useEffect(() => {
    const goal = Math.max(0, Math.min(100, target ?? 0));
    const from = current.current;
    if (goal <= from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = goal; setDisplayed(goal); return;
    }
    const started = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const value = interpolateProgress(from, goal, now - started);
      current.current = value; setDisplayed(value);
      if (value < goal) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, target]);
  return displayed;
}
