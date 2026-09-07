"""Server-side enforcement of ping timing and layout limits (mirrors shared/types.ts)."""

from __future__ import annotations

from typing import Any

from app.config import settings

MIN_DURATION_MS = 2000
MAX_DURATION_MS = 30_000
DEFAULT_DURATION_MS = 3000

MAX_DELAY_MS = 60_000
MAX_AUDIO_DELAY_MS = 60_000
DEFAULT_FADE_IN_MS = 200
DEFAULT_FADE_OUT_MS = 0
MAX_FADE_MS = 3000

MAX_IMAGE_LAYERS = 10
MIN_LAYER_OPACITY = 0.0
MAX_LAYER_OPACITY = 1.0

COMPOSE_CANVAS_WIDTH = 2560
COMPOSE_CANVAS_HEIGHT = 1440

DEFAULT_CAPTION_FONT_SIZE_PCT = 10
MIN_CAPTION_FONT_SIZE_PCT = 3
MAX_CAPTION_FONT_SIZE_PCT = 24

DEFAULT_LAYOUT: dict[str, Any] = {
    "x": 30,
    "y": 30,
    "width": 40,
    "height": 40,
    "rotation": 0,
    "flipX": False,
    "flipY": False,
    "objectFit": "contain",
}

MIN_VISIBLE_PCT = 2
MIN_LAYOUT_SIZE = 0.001


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def clamp_ms(value: Any, default: int, *, min_ms: int = 0, max_ms: int) -> int:
    return max(min_ms, min(_as_int(value, default), max_ms))


def clamp_layout_position(layout: dict[str, Any]) -> dict[str, Any]:
    width = max(_as_float(layout.get("width"), 40), MIN_LAYOUT_SIZE)
    height = max(_as_float(layout.get("height"), 40), MIN_LAYOUT_SIZE)
    rotation = _as_float(layout.get("rotation"), 0) % 360
    x = _as_float(layout.get("x"), 30)
    y = _as_float(layout.get("y"), 30)

    min_x = -width + MIN_VISIBLE_PCT
    min_y = -height + MIN_VISIBLE_PCT
    max_x = 100 - MIN_VISIBLE_PCT
    max_y = 100 - MIN_VISIBLE_PCT

    object_fit = layout.get("objectFit")
    if object_fit not in ("contain", "fill"):
        object_fit = "contain"

    return {
        "x": max(min_x, min(x, max_x)),
        "y": max(min_y, min(y, max_y)),
        "width": width,
        "height": height,
        "rotation": rotation,
        "flipX": bool(layout.get("flipX")),
        "flipY": bool(layout.get("flipY")),
        "objectFit": object_fit,
        "opacity": clamp_layer_opacity(layout.get("opacity")),
    }


def clamp_layout(raw: dict[str, Any] | None) -> dict[str, Any]:
    base = {**DEFAULT_LAYOUT, **(raw or {})}
    return clamp_layout_position(base)


def clamp_caption_layout(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw:
        return None
    media = clamp_layout(
        {
            "x": raw.get("x", 10),
            "y": raw.get("y", 78),
            "width": raw.get("width", 40),
            "height": raw.get("height", 12),
            "rotation": raw.get("rotation", 0),
            "flipX": False,
            "flipY": False,
            "objectFit": "contain",
        }
    )
    font_size = clamp_ms(
        raw.get("fontSizePct"),
        DEFAULT_CAPTION_FONT_SIZE_PCT,
        min_ms=MIN_CAPTION_FONT_SIZE_PCT,
        max_ms=MAX_CAPTION_FONT_SIZE_PCT,
    )
    return {
        "x": media["x"],
        "y": media["y"],
        "width": media["width"],
        "height": media["height"],
        "rotation": media["rotation"],
        "fontSizePct": font_size,
    }


def clamp_layer_opacity(value: Any) -> float:
    try:
        opacity = float(value)
    except (TypeError, ValueError):
        opacity = 1.0
    return max(MIN_LAYER_OPACITY, min(opacity, MAX_LAYER_OPACITY))


def sanitize_image_layer(raw: dict[str, Any], *, index: int) -> dict[str, Any]:
    layout = clamp_layout(raw.get("layout"))
    z_index = _as_int(raw.get("zIndex"), index)
    return {
        "layout": layout,
        "opacity": clamp_layer_opacity(raw.get("opacity")),
        "zIndex": z_index,
    }


def sanitize_image_layers(raw_layers: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not raw_layers:
        raise ValueError("At least one image layer is required")
    if len(raw_layers) > MAX_IMAGE_LAYERS:
        raise ValueError(f"Too many layers (max {MAX_IMAGE_LAYERS})")
    layers = [sanitize_image_layer(layer, index=i) for i, layer in enumerate(raw_layers)]
    # Keep request order so each file stays paired with its layer metadata.
    return layers


def sanitize_caption(caption: str | None) -> str | None:
    if caption is None:
        return None
    text = caption.strip()
    if not text:
        return None
    limit = settings.max_caption_length
    if len(text) > limit:
        return text[:limit]
    return text


def sanitize_delivery_options(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "durationMs": clamp_ms(
            data.get("durationMs"),
            DEFAULT_DURATION_MS,
            min_ms=MIN_DURATION_MS,
            max_ms=MAX_DURATION_MS,
        ),
        "delayMs": clamp_ms(data.get("delayMs"), 0, min_ms=0, max_ms=MAX_DELAY_MS),
        "audioDelayMs": clamp_ms(data.get("audioDelayMs"), 0, min_ms=0, max_ms=MAX_AUDIO_DELAY_MS),
        "fadeInMs": clamp_ms(data.get("fadeInMs"), DEFAULT_FADE_IN_MS, min_ms=0, max_ms=MAX_FADE_MS),
        "fadeOutMs": clamp_ms(data.get("fadeOutMs"), DEFAULT_FADE_OUT_MS, min_ms=0, max_ms=MAX_FADE_MS),
        "layout": clamp_layout(data.get("layout")),
        "captionLayout": clamp_caption_layout(data.get("captionLayout")),
    }
