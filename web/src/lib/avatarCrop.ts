export interface AvatarCropState {
  x: number;
  y: number;
  zoom: number;
}

const OUTPUT_SIZE = 384;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function clampPan(
  x: number,
  y: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number,
  containerSize: number,
) {
  const baseScale = Math.max(containerSize / imageWidth, containerSize / imageHeight);
  const scale = baseScale * zoom;
  const displayW = imageWidth * scale;
  const displayH = imageHeight * scale;
  const maxX = Math.max(0, (displayW - containerSize) / 2);
  const maxY = Math.max(0, (displayH - containerSize) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function clampAvatarCrop(
  crop: AvatarCropState,
  imageWidth: number,
  imageHeight: number,
  containerSize: number,
): AvatarCropState {
  const pan = clampPan(crop.x, crop.y, crop.zoom, imageWidth, imageHeight, containerSize);
  return { x: pan.x, y: pan.y, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, crop.zoom)) };
}

/** Bias crop toward the face area instead of dead-center (portraits cut off heads otherwise). */
export function getInitialAvatarCrop(
  imageWidth: number,
  imageHeight: number,
  containerSize: number,
): AvatarCropState {
  const aspect = imageWidth / imageHeight;
  const zoom = aspect < 0.85 ? 1.35 : aspect > 1.2 ? 1.2 : 1.25;

  const baseScale = Math.max(containerSize / imageWidth, containerSize / imageHeight);
  const scale = baseScale * zoom;
  const displayW = imageWidth * scale;
  const displayH = imageHeight * scale;
  const maxX = Math.max(0, (displayW - containerSize) / 2);
  const maxY = Math.max(0, (displayH - containerSize) / 2);

  let x = 0;
  let y = 0;
  if (imageHeight > imageWidth * 1.05) {
    y = maxY * 0.65;
  } else if (imageWidth > imageHeight * 1.05) {
    x = 0;
  }

  return clampAvatarCrop({ x, y, zoom }, imageWidth, imageHeight, containerSize);
}

export function getImageLayout(
  imageWidth: number,
  imageHeight: number,
  containerSize: number,
  crop: AvatarCropState,
) {
  const baseScale = Math.max(containerSize / imageWidth, containerSize / imageHeight);
  const scale = baseScale * crop.zoom;
  return {
    scale,
    width: imageWidth * scale,
    height: imageHeight * scale,
    x: (containerSize - imageWidth * scale) / 2 + crop.x,
    y: (containerSize - imageHeight * scale) / 2 + crop.y,
  };
}

export async function cropAvatarToFile(
  imageSrc: string,
  crop: AvatarCropState,
  containerSize: number,
): Promise<File> {
  const image = await loadImage(imageSrc);
  const safe = clampAvatarCrop(crop, image.naturalWidth, image.naturalHeight, containerSize);
  const layout = getImageLayout(image.naturalWidth, image.naturalHeight, containerSize, safe);

  const sx = (0 - layout.x) / layout.scale;
  const sy = (0 - layout.y) / layout.scale;
  const sSize = containerSize / layout.scale;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.drawImage(image, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not export image"))),
      "image/jpeg",
      0.8,
    );
  });

  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}
