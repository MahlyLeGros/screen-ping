"""Compose multiple image layers into a single WebP (mirrors shared/layerTransform + web preview)."""

from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Any, BinaryIO

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps

from app.config import settings
from app.services.media import ALLOWED_IMAGE, _extension_for_mime, sniff_media_mime
from app.services.ping_limits import (
    COMPOSE_CANVAS_HEIGHT,
    COMPOSE_CANVAS_WIDTH,
    clamp_layout,
    clamp_layer_opacity,
)

# Lossless keeps screenshots/text sharp. Quality is encoder effort (0–100), not visual loss.
WEBP_LOSSLESS_EFFORT = 80
# Fallback if lossless exceeds the upload cap (noisy photos at high res).
WEBP_LOSSY_QUALITY = 95
# method 6 is far too slow on a 2560×1440 canvas (~several seconds).
WEBP_METHOD = 4


def _layout_box(layout: dict[str, Any]) -> tuple[int, int, int, int]:
    """Return left, top, width, height in canvas pixels."""
    clamped = clamp_layout(layout)
    cw = COMPOSE_CANVAS_WIDTH
    ch = COMPOSE_CANVAS_HEIGHT
    width = max(1, int(round(clamped["width"] / 100 * cw)))
    height = max(1, int(round(clamped["height"] / 100 * ch)))
    left = int(round(clamped["x"] / 100 * cw))
    top = int(round(clamped["y"] / 100 * ch))
    return left, top, width, height


def _load_rgba(source: bytes | BinaryIO) -> Image.Image:
    img = Image.open(source)
    img = ImageOps.exif_transpose(img) or img
    if getattr(img, "is_animated", False):
        img.seek(0)
    img = img.convert("RGBA")
    return img


def _fit_contain(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    src_w, src_h = img.size
    if src_w <= 0 or src_h <= 0:
        return Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    scale = min(target_w / src_w, target_h / src_h)
    new_w = max(1, int(round(src_w * scale)))
    new_h = max(1, int(round(src_h * scale)))
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    canvas.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2), resized)
    return canvas


def _fit_fill(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    if img.size[0] <= 0 or img.size[1] <= 0:
        return Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    return img.resize((target_w, target_h), Image.Resampling.LANCZOS)


def _apply_flip(img: Image.Image, flip_x: bool, flip_y: bool) -> Image.Image:
    if flip_x:
        img = ImageOps.mirror(img)
    if flip_y:
        img = ImageOps.flip(img)
    return img


def _apply_opacity(img: Image.Image, opacity: float) -> Image.Image:
    if opacity <= 0:
        transparent = img.copy()
        transparent.putalpha(Image.new("L", img.size, 0))
        return transparent
    if opacity >= 0.999:
        return img
    alpha = img.getchannel("A")
    alpha = alpha.point(lambda px: int(px * opacity))
    img = img.copy()
    img.putalpha(alpha)
    return img


def _render_layer(source: bytes | BinaryIO, layer: dict[str, Any]) -> tuple[Image.Image, int, int]:
    layout = clamp_layout(layer["layout"])
    opacity = clamp_layer_opacity(layer.get("opacity"))
    left, top, frame_w, frame_h = _layout_box(layout)

    img = _load_rgba(source)
    object_fit = layout.get("objectFit", "contain")
    if object_fit == "fill":
        framed = _fit_fill(img, frame_w, frame_h)
    else:
        framed = _fit_contain(img, frame_w, frame_h)

    framed = _apply_flip(framed, bool(layout.get("flipX")), bool(layout.get("flipY")))
    rotation = float(layout.get("rotation") or 0)
    if rotation % 360:
        framed = framed.rotate(-rotation, expand=True, resample=Image.Resampling.BICUBIC)

    framed = _apply_opacity(framed, opacity)

    cx = left + frame_w / 2
    cy = top + frame_h / 2
    paste_x = int(round(cx - framed.width / 2))
    paste_y = int(round(cy - framed.height / 2))
    return framed, paste_x, paste_y


def _composite_layer(canvas: Image.Image, framed: Image.Image, paste_x: int, paste_y: int) -> None:
    cw, ch = canvas.size
    fw, fh = framed.size
    src_l = max(0, -paste_x)
    src_t = max(0, -paste_y)
    dst_l = max(0, paste_x)
    dst_t = max(0, paste_y)
    dst_r = min(cw, paste_x + fw)
    dst_b = min(ch, paste_y + fh)
    if dst_r <= dst_l or dst_b <= dst_t:
        return
    crop = framed.crop((src_l, src_t, src_l + (dst_r - dst_l), src_t + (dst_b - dst_t)))
    canvas.alpha_composite(crop, dest=(dst_l, dst_t))


def _encode_composed_webp(canvas: Image.Image) -> bytes:
    lossless = io.BytesIO()
    canvas.save(
        lossless,
        format="WEBP",
        lossless=True,
        quality=WEBP_LOSSLESS_EFFORT,
        method=WEBP_METHOD,
        exact=True,
    )
    data = lossless.getvalue()
    if len(data) <= settings.max_image_bytes:
        return data

    lossy = io.BytesIO()
    canvas.save(
        lossy,
        format="WEBP",
        quality=WEBP_LOSSY_QUALITY,
        method=WEBP_METHOD,
        exact=True,
    )
    return lossy.getvalue()


def compose_layers(layers: list[tuple[bytes, dict[str, Any]]]) -> bytes:
    """Flatten ordered layers onto a transparent 16:9 canvas → WebP bytes."""
    if not layers:
        raise ValueError("At least one layer is required")

    canvas = Image.new("RGBA", (COMPOSE_CANVAS_WIDTH, COMPOSE_CANVAS_HEIGHT), (0, 0, 0, 0))
    for source_bytes, layer_meta in layers:
        framed, paste_x, paste_y = _render_layer(io.BytesIO(source_bytes), layer_meta)
        _composite_layer(canvas, framed, paste_x, paste_y)

    return _encode_composed_webp(canvas)


async def read_layer_upload(file: UploadFile) -> tuple[bytes, str]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty layer file")
    mime = sniff_media_mime(content)
    if mime is None or mime not in ALLOWED_IMAGE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Layer uploads must be images, got: {mime or 'unknown'}",
        )
    return content, mime


def save_compiled_webp(content: bytes) -> tuple[str, str]:
    max_bytes = settings.max_image_bytes
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Compiled image too large",
        )
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.webp"
    dest = upload_dir / filename
    dest.write_bytes(content)
    return filename, f"/uploads/{filename}"


def validate_layers_total_size(sizes: list[int]) -> None:
    total = sum(sizes)
    if total > settings.max_image_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Combined layer uploads too large (max 25MB)",
        )
