"""Profile photos are resized and stored as WebP."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from app.services.media import compress_avatar_bytes, persist_avatar_file


def _png(w: int, h: int, color: tuple[int, int, int] = (40, 80, 200)) -> bytes:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_compress_avatar_bytes_is_small_webp():
    raw = _png(2000, 2000)
    out = compress_avatar_bytes(raw)
    assert len(out) < 40_000
    assert len(out) < len(raw) // 10
    img = Image.open(io.BytesIO(out))
    assert img.format == "WEBP"
    assert max(img.size) <= 384


def test_persist_avatar_file_replaces_old_extensions(tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    user_id = "11111111-1111-1111-1111-111111111111"
    avatars = tmp_path / "avatars"
    avatars.mkdir()
    leftover = avatars / f"{user_id}.jpg"
    leftover.write_bytes(_png(64, 64))

    url = persist_avatar_file(user_id, _png(800, 800))
    assert url == f"/uploads/avatars/{user_id}.webp"
    assert not leftover.exists()
    dest = Path(tmp_path) / "avatars" / f"{user_id}.webp"
    assert dest.is_file()
    assert dest.stat().st_size < 40_000
