import type { MediaLayout } from "../../../shared/types";
import { DEFAULT_LAYOUT, MAX_IMAGE_LAYERS } from "../../../shared/types";

export interface EditorImageLayer {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  layout: MediaLayout;
  opacity: number;
  zIndex: number;
  locked?: boolean;
}

export function newLayerId(): string {
  return crypto.randomUUID();
}

export function createEditorLayer(
  file: File,
  previewUrl: string,
  zIndex: number,
  layout?: MediaLayout,
): EditorImageLayer {
  const offset = (zIndex % 3) * 5;
  return {
    id: newLayerId(),
    file,
    previewUrl,
    name: file.name,
    layout: layout ?? {
      ...DEFAULT_LAYOUT,
      x: DEFAULT_LAYOUT.x + offset,
      y: DEFAULT_LAYOUT.y + offset,
    },
    opacity: 1,
    zIndex,
    locked: false,
  };
}

export function sortLayersByZ(layers: EditorImageLayer[]): EditorImageLayer[] {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex);
}

export function reindexLayers(layers: EditorImageLayer[]): EditorImageLayer[] {
  return sortLayersByZ(layers).map((layer, index) => ({ ...layer, zIndex: index }));
}

export function reorderLayersInPanel(
  layers: EditorImageLayer[],
  draggedId: string,
  targetId: string,
): EditorImageLayer[] {
  const sorted = sortLayersByZ(layers);
  const display = [...sorted].reverse();
  const fromIdx = display.findIndex((layer) => layer.id === draggedId);
  const toIdx = display.findIndex((layer) => layer.id === targetId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return layers;

  const nextDisplay = [...display];
  const [moved] = nextDisplay.splice(fromIdx, 1);
  nextDisplay.splice(toIdx, 0, moved);

  const count = nextDisplay.length;
  return reindexLayers(
    nextDisplay.map((layer, index) => ({ ...layer, zIndex: count - 1 - index })),
  );
}

export function removeLayer(layers: EditorImageLayer[], id: string): EditorImageLayer[] {
  const removed = layers.find((l) => l.id === id);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  return reindexLayers(layers.filter((l) => l.id !== id));
}

export function updateLayer(
  layers: EditorImageLayer[],
  id: string,
  patch: Partial<EditorImageLayer>,
): EditorImageLayer[] {
  return layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer));
}

export function canAddLayers(currentCount: number, adding: number): boolean {
  return currentCount + adding <= MAX_IMAGE_LAYERS;
}

export function revokeLayerUrls(layers: EditorImageLayer[]) {
  for (const layer of layers) {
    URL.revokeObjectURL(layer.previewUrl);
  }
}
