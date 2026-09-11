import { useEffect, useState } from "react";
import type { ClipAppState } from "./clipApi";

export function useClipState(): ClipAppState | null {
  const [state, setState] = useState<ClipAppState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.clipAPI.getState().then((next) => {
      if (!cancelled) setState(next);
    });
    const off = window.clipAPI.onState(setState);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
