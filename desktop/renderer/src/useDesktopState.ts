import { useEffect, useState } from "react";

import type { DesktopState } from "./desktopApi";

function displaysEqual(a: DesktopState["displays"], b: DesktopState["displays"]): boolean {
  if (a.length !== b.length) return false;
  return a.every((d, i) => {
    const other = b[i];
    return (
      other &&
      d.id === other.id &&
      d.label === other.label &&
      d.shortLabel === other.shortLabel &&
      d.primary === other.primary &&
      d.bounds.x === other.bounds.x &&
      d.bounds.y === other.bounds.y &&
      d.bounds.width === other.bounds.width &&
      d.bounds.height === other.bounds.height
    );
  });
}

/** Skip React updates when IPC state is unchanged — stops cursor flicker from constant re-renders. */
export function desktopStatesEqual(a: DesktopState, b: DesktopState): boolean {
  return (
    a.version === b.version &&
    a.packaged === b.packaged &&
    a.username === b.username &&
    a.userId === b.userId &&
    a.serverUrl === b.serverUrl &&
    a.connected === b.connected &&
    a.online === b.online &&
    a.paused === b.paused &&
    a.launchAtLogin === b.launchAtLogin &&
    a.alwaysOnTop === b.alwaysOnTop &&
    a.compact === b.compact &&
    a.overlayDisplayId === b.overlayDisplayId &&
    a.latestVersion === b.latestVersion &&
    a.outdated === b.outdated &&
    a.update.state === b.update.state &&
    a.update.version === b.update.version &&
    a.update.message === b.update.message &&
    Math.floor(a.update.percent ?? 0) === Math.floor(b.update.percent ?? 0) &&
    displaysEqual(a.displays, b.displays)
  );
}

export function useDesktopState() {
  const [state, setState] = useState<DesktopState | null>(null);

  useEffect(() => {
    void window.desktopAPI.getState().then(setState);
    window.desktopAPI.onState((next) => {
      const incoming = next as DesktopState;
      setState((prev) => (prev && desktopStatesEqual(prev, incoming) ? prev : incoming));
    });
  }, []);

  return state;
}
