import { memo, useCallback, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { EditorImageLayer } from "../lib/imageLayers";
import { reorderLayersInPanel, sortLayersByZ } from "../lib/imageLayers";

interface ComposeLayersPanelProps {
  layers: EditorImageLayer[];
  activeLayerId: string | null;
  onLayersChange: (layers: EditorImageLayer[]) => void;
  onActiveLayerChange: (id: string | null) => void;
  onAddImages: (files: FileList | File[]) => void;
}

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4.5 7V5a3.5 3.5 0 1 1 7 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4.5 7V5a3.5 3.5 0 0 1 6.2-2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 5V3.75h4V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M5.25 5l.45 7.25h4.6L10.75 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LayerZGrip({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      className="layer-z-grip"
      aria-label="Reorder layer"
      onPointerDown={onPointerDown}
    >
      <span className="block h-[5px] w-[5px] rounded-full bg-slate-100 shadow-[0_0_0_1px_rgb(0_0_0/0.4)]" />
      <span className="block h-[5px] w-[5px] rounded-full bg-slate-100 shadow-[0_0_0_1px_rgb(0_0_0/0.4)]" />
      <span className="block h-[5px] w-[5px] rounded-full bg-slate-100 shadow-[0_0_0_1px_rgb(0_0_0/0.4)]" />
    </button>
  );
}

function rowClassName(layerId: string, activeLayerId: string | null, draggingId: string | null, dropTargetId: string | null) {
  const parts = ["compose-layer-row"];
  if (layerId === activeLayerId) parts.push("compose-layer-row--active");
  if (draggingId === layerId) parts.push("compose-layer-row--dragging");
  if (dropTargetId === layerId && draggingId && draggingId !== layerId) {
    parts.push("compose-layer-row--drop-target");
  }
  return parts.join(" ");
}

function ComposeLayersPanel({
  layers,
  activeLayerId,
  onLayersChange,
  onActiveLayerChange,
  onAddImages,
}: ComposeLayersPanelProps) {
  const addInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const layersRef = useRef(layers);
  const dragLayerIdRef = useRef<string | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  layersRef.current = layers;
  const sortedLayers = sortLayersByZ(layers);
  const displayLayers = [...sortedLayers].reverse();

  function setOpacity(id: string, opacity: number) {
    onLayersChange(layers.map((layer) => (layer.id === id ? { ...layer, opacity } : layer)));
  }

  function toggleLock(id: string) {
    onLayersChange(layers.map((layer) => (layer.id === id ? { ...layer, locked: !layer.locked } : layer)));
  }

  function removeLayer(id: string) {
    const removed = layers.find((layer) => layer.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    const next = layers.filter((layer) => layer.id !== id).map((layer, index) => ({ ...layer, zIndex: index }));
    onLayersChange(next);
    if (activeLayerId === id) onActiveLayerChange(next[next.length - 1]?.id ?? null);
  }

  function onAddInput(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (list?.length) onAddImages(list);
    e.target.value = "";
  }

  const layerIdFromPoint = useCallback((clientX: number, clientY: number): string | null => {
    const list = listRef.current;
    if (!list) return null;

    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-layer-id]"));
    if (rows.length === 0) return null;

    const listRect = list.getBoundingClientRect();
    if (clientX < listRect.left || clientX > listRect.right) return null;

    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      const prevBottom = i > 0 ? rows[i - 1].getBoundingClientRect().bottom : rect.top;
      const nextTop = i < rows.length - 1 ? rows[i + 1].getBoundingClientRect().top : rect.bottom;
      const top = i > 0 ? (prevBottom + rect.top) / 2 : rect.top;
      const bottom = i < rows.length - 1 ? (rect.bottom + nextTop) / 2 : rect.bottom;

      if (clientY >= top && clientY <= bottom) {
        return rows[i].dataset.layerId ?? null;
      }
    }
    return null;
  }, []);

  const finishDrag = useCallback(
    (draggedId: string | null, targetId: string | null) => {
      if (draggedId && targetId && draggedId !== targetId) {
        onLayersChange(reorderLayersInPanel(layersRef.current, draggedId, targetId));
      }
      dragLayerIdRef.current = null;
      setDraggingId(null);
      setDropTargetId(null);
    },
    [onLayersChange],
  );

  const onGripPointerDown = useCallback(
    (layerId: string, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const grip = e.currentTarget;
      grip.setPointerCapture(e.pointerId);

      dragLayerIdRef.current = layerId;
      setDraggingId(layerId);
      setDropTargetId(layerId);

      const pointerId = e.pointerId;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        ev.preventDefault();
        const over = layerIdFromPoint(ev.clientX, ev.clientY);
        if (over) setDropTargetId(over);
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        grip.removeEventListener("pointercancel", onUp);
        if (grip.hasPointerCapture(pointerId)) {
          grip.releasePointerCapture(pointerId);
        }
        const over = layerIdFromPoint(ev.clientX, ev.clientY);
        finishDrag(dragLayerIdRef.current, over ?? dragLayerIdRef.current);
      };

      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
      grip.addEventListener("pointercancel", onUp);
    },
    [finishDrag, layerIdFromPoint],
  );

  return (
    <section className="form-section compose-layers-panel space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="form-section-title !mb-0">Layers</h3>
        <button type="button" className="pill-btn !px-2 !py-0.5 !text-xs" onClick={() => addInputRef.current?.click()}>
          Add image
        </button>
        <input ref={addInputRef} type="file" accept="image/*" multiple className="sr-only" onChange={onAddInput} />
      </div>
      <ul ref={listRef} className="max-h-52 space-y-1 overflow-y-auto scroll-area">
        {displayLayers.map((layer) => (
          <li
            key={layer.id}
            data-layer-id={layer.id}
            aria-selected={layer.id === activeLayerId}
            className={rowClassName(layer.id, activeLayerId, draggingId, dropTargetId)}
          >
            <LayerZGrip onPointerDown={(e) => onGripPointerDown(layer.id, e)} />
            <div className="compose-layer-row-body">
              <button
                type="button"
                className="h-8 w-8 shrink-0 overflow-hidden rounded border border-white/10"
                aria-selected={layer.id === activeLayerId}
                onClick={() => onActiveLayerChange(layer.id)}
              >
                <img src={layer.previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-slate-300">{layer.name}</p>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(layer.opacity * 100)}
                  onChange={(ev) => setOpacity(layer.id, Number(ev.target.value) / 100)}
                  className="mt-0.5 w-full"
                  aria-label={`Opacity for ${layer.name}`}
                />
              </div>
              <button
                type="button"
                className={`pill-btn flex !h-7 !w-7 shrink-0 items-center justify-center !p-0 ${
                  layer.locked ? "pill-btn-active text-brand-200" : "text-slate-400"
                }`}
                onClick={() => toggleLock(layer.id)}
                aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
              >
                <LockIcon locked={Boolean(layer.locked)} />
              </button>
              <button
                type="button"
                className="pill-btn flex !h-7 !w-7 shrink-0 items-center justify-center !p-0 text-red-300 hover:text-red-200"
                onClick={() => removeLayer(layer.id)}
                aria-label="Delete layer"
              >
                <TrashIcon />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default memo(ComposeLayersPanel);
