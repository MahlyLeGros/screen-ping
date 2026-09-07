import { useCallback, useEffect, useId, useRef, useState } from "react";
import AccessibleDialog from "./AccessibleDialog";
import PrecisionSlider from "./PrecisionSlider";
import {
  clampAvatarCrop,
  cropAvatarToFile,
  getImageLayout,
  getInitialAvatarCrop,
  type AvatarCropState,
} from "../lib/avatarCrop";

interface AvatarCropModalProps {
  imageSrc: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

export default function AvatarCropModal({ imageSrc, onCancel, onConfirm }: AvatarCropModalProps) {
  const titleId = useId();
  const cropRef = useRef<HTMLDivElement>(null);
  const [cropSize, setCropSize] = useState(260);
  const [crop, setCrop] = useState<AvatarCropState>({ x: 0, y: 0, zoom: 1 });
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    cropX: number;
    cropY: number;
    zoom: number;
  } | null>(null);
  const cropStateRef = useRef(crop);
  cropStateRef.current = crop;

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const size = cropRef.current?.clientWidth ?? 260;
      setImageSize({ w, h });
      if (size > 0) setCropSize(size);
      setCrop(getInitialAvatarCrop(w, h, size > 0 ? size : 260));
    };
    img.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    const el = cropRef.current;
    if (!el) return;

    function measure() {
      const size = el?.clientWidth ?? 0;
      if (size > 0) setCropSize(size);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const updateCrop = useCallback(
    (next: AvatarCropState) => {
      if (!imageSize.w) {
        setCrop(next);
        return;
      }
      setCrop(clampAvatarCrop(next, imageSize.w, imageSize.h, cropSize));
    },
    [imageSize, cropSize],
  );

  const layout =
    imageSize.w > 0 && cropSize > 0
      ? getImageLayout(imageSize.w, imageSize.h, cropSize, crop)
      : null;

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      cropX: crop.x,
      cropY: crop.y,
      zoom: crop.zoom,
    };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const { startX, startY, cropX, cropY, zoom } = dragRef.current;
    updateCrop({
      x: cropX + (e.clientX - startX),
      y: cropY + (e.clientY - startY),
      zoom,
    });
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    updateCrop({ ...cropStateRef.current, zoom: cropStateRef.current.zoom + delta });
  }

  async function onSave() {
    setSaving(true);
    try {
      const file = await cropAvatarToFile(imageSrc, crop, cropSize);
      onConfirm(file);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessibleDialog open labelledBy={titleId} onClose={onCancel}>
      <div>
        <h2 id={titleId} className="text-base font-semibold text-white">
          Crop profile picture
        </h2>
        <p className="mt-1 text-xs text-slate-400">Drag to reposition. Use the slider to zoom.</p>
      </div>

      <div
        ref={cropRef}
        className={`relative mx-auto aspect-square w-full max-w-[260px] touch-none overflow-hidden rounded-full bg-[rgb(3_3_4)] ring-1 ring-white/10 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label="Crop preview — drag to reposition the image"
      >
        {layout && (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            className="absolute max-w-none select-none"
            style={{
              width: layout.width,
              height: layout.height,
              left: layout.x,
              top: layout.y,
            }}
          />
        )}
        <div
          className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_rgba(56,189,248,0.35)]"
          aria-hidden
        />
      </div>

      <PrecisionSlider
        label="Zoom"
        value={crop.zoom}
        min={1}
        max={4}
        step={0.01}
        inputStep={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(zoom) => updateCrop({ ...cropStateRef.current, zoom })}
      />

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void onSave()}
          disabled={saving || !layout}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </AccessibleDialog>
  );
}
