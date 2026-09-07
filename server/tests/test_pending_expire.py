"""Pending ping cancel + TTL expire helpers."""

from __future__ import annotations

import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base
from app.models import DeliveryStatus, MediaMessage, MediaType, User, utcnow
from app.services.pending import find_stale_dispatched_pending, mark_message_failed


def _user(name: str) -> User:
    return User(
        id=str(uuid.uuid4()),
        username=name,
        email=f"{name}@example.com",
        password_hash="x",
    )


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(settings, "pending_ping_ttl_seconds", 60)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session, tmp_path
    finally:
        session.close()


def _message(
    sender: User,
    receiver: User,
    *,
    status: DeliveryStatus = DeliveryStatus.pending,
    dispatched_at=None,
    path: str = "/uploads/a.webp",
) -> MediaMessage:
    return MediaMessage(
        id=str(uuid.uuid4()),
        sender_id=sender.id,
        receiver_id=receiver.id,
        media_type=MediaType.image,
        storage_path=path,
        delivery_status=status,
        dispatched_at=dispatched_at,
        created_at=utcnow(),
    )


def test_mark_message_failed_pending(db):
    session, root = db
    (root / "a.webp").write_bytes(b"x")
    sender, receiver = _user("s"), _user("r")
    session.add_all([sender, receiver])
    msg = _message(sender, receiver, dispatched_at=utcnow())
    session.add(msg)
    session.commit()

    assert mark_message_failed(session, msg) is True
    session.refresh(msg)
    assert msg.delivery_status == DeliveryStatus.failed
    assert mark_message_failed(session, msg) is False
    assert not (root / "a.webp").exists()


def test_mark_message_failed_rejects_delivered(db):
    session, _root = db
    sender, receiver = _user("s"), _user("r")
    session.add_all([sender, receiver])
    msg = _message(sender, receiver, status=DeliveryStatus.delivered, dispatched_at=utcnow())
    session.add(msg)
    session.commit()
    assert mark_message_failed(session, msg) is False


def test_find_stale_dispatched_pending(db):
    session, _root = db
    sender, receiver = _user("s"), _user("r")
    session.add_all([sender, receiver])
    fresh = _message(sender, receiver, dispatched_at=utcnow())
    fresh.id = "fresh"
    stale = _message(sender, receiver, dispatched_at=utcnow() - timedelta(seconds=90))
    stale.id = "stale"
    undelivered = _message(sender, receiver, dispatched_at=None)
    undelivered.id = "undelivered"
    session.add_all([fresh, stale, undelivered])
    session.commit()

    found = find_stale_dispatched_pending(session)
    assert [m.id for m in found] == ["stale"]
