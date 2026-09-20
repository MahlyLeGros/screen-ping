import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import issue_tokens, rotate_refresh_token
from app.database import Base
from app.models import User
from app.services.media import delete_avatar_files, read_upload_limited
from app.config import settings


def test_refresh_token_is_rotated_and_single_use():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    user = User(username="rotation-user", email="rotation@example.com", password_hash="unused")
    db.add(user)
    db.commit()
    _, first = issue_tokens(db, user)

    rotated_user, second = rotate_refresh_token(db, first)
    assert rotated_user.id == user.id
    assert second != first
    with pytest.raises(HTTPException) as exc:
        rotate_refresh_token(db, first)
    assert exc.value.status_code == 401


def test_upload_reader_stops_at_limit():
    upload = UploadFile(filename="large.bin", file=BytesIO(b"123456"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(read_upload_limited(upload, 5))
    assert exc.value.status_code == 413


def test_avatar_cleanup_removes_all_user_variants(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    avatars = tmp_path / "avatars"
    avatars.mkdir()
    (avatars / "user-1.webp").write_bytes(b"avatar")
    (avatars / "user-1.png").write_bytes(b"old")
    (avatars / "user-2.webp").write_bytes(b"other")

    delete_avatar_files("user-1")

    assert not (avatars / "user-1.webp").exists()
    assert not (avatars / "user-1.png").exists()
    assert (avatars / "user-2.webp").exists()
