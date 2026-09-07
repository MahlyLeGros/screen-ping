"""Unit tests for multi-layer image composition."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.services.compose_layers import compose_layers
from app.services.ping_limits import COMPOSE_CANVAS_HEIGHT, COMPOSE_CANVAS_WIDTH


def _solid(w: int, h: int, color: tuple[int, int, int, int]) -> bytes:
    img = Image.new("RGBA", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _layer(layout: dict, opacity: float = 1.0, z_index: int = 0) -> dict:
    return {"layout": layout, "opacity": opacity, "zIndex": z_index}


def test_compose_two_layers_z_order():
    red = _solid(200, 200, (255, 0, 0, 255))
    blue = _solid(200, 200, (0, 0, 255, 255))
    base = _layer({"x": 10, "y": 10, "width": 30, "height": 30, "rotation": 0, "objectFit": "contain"}, z_index=0)
    top = _layer({"x": 20, "y": 20, "width": 30, "height": 30, "rotation": 0, "objectFit": "contain"}, z_index=1)

    out = compose_layers([(red, base), (blue, top)])
    img = Image.open(io.BytesIO(out)).convert("RGBA")
    # Center of overlap should be blue (top layer)
    px = img.getpixel((int(COMPOSE_CANVAS_WIDTH * 0.35), int(COMPOSE_CANVAS_HEIGHT * 0.35)))
    assert px[2] > px[0], "Blue channel should dominate where layers overlap"


def test_compose_opacity():
    red = _solid(400, 400, (255, 0, 0, 255))
    layout = _layer({"x": 30, "y": 30, "width": 40, "height": 40, "objectFit": "fill"}, opacity=0.5)
    out = compose_layers([(red, layout)])
    img = Image.open(io.BytesIO(out)).convert("RGBA")
    cx = int(COMPOSE_CANVAS_WIDTH * 0.5)
    cy = int(COMPOSE_CANVAS_HEIGHT * 0.5)
    _, _, _, a = img.getpixel((cx, cy))
    assert 40 < a < 220


def test_compose_flip_and_rotation():
    # Non-square gradient-ish block to detect transform
    img = Image.new("RGBA", (100, 50), (0, 255, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = buf.getvalue()

    layout = _layer(
        {
            "x": 40,
            "y": 40,
            "width": 20,
            "height": 20,
            "rotation": 90,
            "flipX": True,
            "objectFit": "contain",
        }
    )
    out = compose_layers([(data, layout)])
    composed = Image.open(io.BytesIO(out))
    assert composed.format == "WEBP"
    assert composed.size == (COMPOSE_CANVAS_WIDTH, COMPOSE_CANVAS_HEIGHT)


def test_compose_arbitrary_rotation():
    data = _solid(80, 80, (0, 255, 0, 255))
    layout = _layer(
        {
            "x": 30,
            "y": 30,
            "width": 40,
            "height": 40,
            "rotation": 33,
            "objectFit": "contain",
        }
    )
    out = compose_layers([(data, layout)])
    composed = Image.open(io.BytesIO(out))
    assert composed.format == "WEBP"
    assert composed.size == (COMPOSE_CANVAS_WIDTH, COMPOSE_CANVAS_HEIGHT)


def test_clamp_layout_keeps_opacity():
    from app.services.ping_limits import clamp_layout

    out = clamp_layout({"x": 10, "y": 10, "width": 20, "height": 20, "opacity": 0.35})
    assert out["opacity"] == pytest.approx(0.35)

    clamped = clamp_layout({"x": 10, "y": 10, "width": 20, "height": 20, "opacity": 2})
    assert clamped["opacity"] == 1.0

    defaulted = clamp_layout({"x": 10, "y": 10, "width": 20, "height": 20})
    assert defaulted["opacity"] == 1.0


def test_sanitize_keeps_upload_order():
    from app.services.ping_limits import sanitize_image_layers

    raw = [
        {"layout": {"x": 0, "y": 0, "width": 40, "height": 40}, "opacity": 1, "zIndex": 1},
        {"layout": {"x": 50, "y": 50, "width": 40, "height": 40}, "opacity": 1, "zIndex": 0},
    ]
    out = sanitize_image_layers(raw)
    assert [layer["zIndex"] for layer in out] == [1, 0]
    assert out[0]["layout"]["x"] == 0
    assert out[1]["layout"]["x"] == 50


def test_compose_requires_layer():
    with pytest.raises(ValueError):
        compose_layers([])


def test_compose_preserves_solid_color():
    red = _solid(400, 400, (255, 0, 0, 255))
    layout = _layer({"x": 0, "y": 0, "width": 100, "height": 100, "objectFit": "fill"})
    out = compose_layers([(red, layout)])
    img = Image.open(io.BytesIO(out)).convert("RGBA")
    r, g, b, a = img.getpixel((40, 40))
    assert (r, g, b, a) == (255, 0, 0, 255)
