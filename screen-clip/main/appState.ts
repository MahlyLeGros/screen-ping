import { screen } from "electron";
import type { BufferState } from "./bufferRecorder";
import { getAllSettings, type ClipSettings, type VideoEncoderId } from "./store";

export interface DisplayInfo {
  id: number;
  label: string;
  shortLabel: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ClipAppState {
  settings: ClipSettings;
  buffer: BufferState;
  displays: DisplayInfo[];
  availableEncoders: VideoEncoderId[];
  encodingWarning: string | null;
}

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, index) => {
    const isPrimary = d.id === primaryId;
    const shortLabel = isPrimary ? "Primary" : `Display ${index + 1}`;
    return {
      id: d.id,
      shortLabel,
      label: `${shortLabel} (${d.bounds.width}×${d.bounds.height})`,
      bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    };
  });
}

export function buildAppState(
  buffer: BufferState,
  availableEncoders: VideoEncoderId[],
  encodingWarning: string | null,
): ClipAppState {
  return {
    settings: getAllSettings(),
    buffer,
    displays: listDisplays(),
    availableEncoders,
    encodingWarning,
  };
}
