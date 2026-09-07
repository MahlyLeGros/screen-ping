"""Ping media is deleted when every recipient is done, with a TTL safety net."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base
from app.models import DeliveryStatus, MediaMessage, MediaType, User
from app.services.media_access import release_media_for_message


def _user(name: str) -> User:
    return User(
        id=str(uuid.uuid4()),
        username=name,
        email=f"{name}@example.com",
        password_hash="x",
    )


def _write_upload(root: Path, name: str) -> str:
    dest = root / name
    dest.write_bytes(b"ping-bytes")
    return f"/uploads/{name}"


@pytest.fixture
def db_session(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session, tmp_path
    finally:
        session.close()


def test_release_waits_until_all_receivers_are_done(db_session):
    db, root = db_session
    sender = _user("sender")
    a = _user("alice")
    b = _user("bob")
    db.add_all([sender, a, b])
    db.flush()

    path = _write_upload(root, "clip.webm")
    first = MediaMessage(
        sender_id=sender.id,
        receiver_id=a.id,
        media_type=MediaType.video,
        storage_path=path,
        delivery_status=DeliveryStatus.delivered,
    )
    second = MediaMessage(
        sender_id=sender.id,
        receiver_id=b.id,
        media_type=MediaType.video,
        storage_path=path,
        delivery_status=DeliveryStatus.pending,
    )
    db.add_all([first, second])
    db.commit()

    release_media_for_message(db, first)
    assert (root / "clip.webm").is_file()

    second.delivery_status = DeliveryStatus.delivered
    db.commit()
    release_media_for_message(db, second)
    assert not (root / "clip.webm").exists()


def test_release_keeps_file_while_paused_or_offline(db_session):
    db, root = db_session
    sender = _user("sender")
    recv = _user("recv")
    db.add_all([sender, recv])
    db.flush()

    path = _write_upload(root, "still.webp")
    msg = MediaMessage(
        sender_id=sender.id,
        receiver_id=recv.id,
        media_type=MediaType.image,
        storage_path=path,
        delivery_status=DeliveryStatus.paused,
    )
    db.add(msg)
    db.commit()
    release_media_for_message(db, msg)
    assert (root / "still.webp").is_file()

    msg.delivery_status = DeliveryStatus.offline
    db.commit()
    release_media_for_message(db, msg)
    assert (root / "still.webp").is_file()


def test_release_deletes_audio_and_layers_with_compiled(db_session):
    db, root = db_session
    sender = _user("sender")
    recv = _user("recv")
    db.add_all([sender, recv])
    db.flush()

    compiled = _write_upload(root, "compiled.webp")
    layer = _write_upload(root, "layer.png")
    audio = _write_upload(root, "sound.mp3")
    msg = MediaMessage(
        sender_id=sender.id,
        receiver_id=recv.id,
        media_type=MediaType.image,
        storage_path=compiled,
        audio_path=audio,
        source_layers='[{"path":"/uploads/layer.png","name":"layer"}]',
        delivery_status=DeliveryStatus.failed,
    )
    db.add(msg)
    db.commit()
    release_media_for_message(db, msg)
    assert not (root / "compiled.webp").exists()
    assert not (root / "layer.png").exists()
    assert not (root / "sound.mp3").exists()
