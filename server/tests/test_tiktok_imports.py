from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import MediaImport, MediaMessage, MediaType, DeliveryStatus, User, utcnow
from app.routes import imports
from app.services.media_access import can_access_media, media_path_still_in_use
from app.services.pending import find_stale_dispatched_pending
from app.services.tiktok_network import allowed_host, public_ip, validate_url, install_network_guard
from app.services.tiktok_extract import duration_of


@pytest.mark.parametrize("url", ["https://www.tiktok.com/@name/video/12345", "https://vm.tiktok.com/ABC123/", "https://vt.tiktok.com/XYZ/", "https://www.tiktok.com/t/ABC/"])
def test_supported_links(url):
    assert validate_url(url, initial=True) == url


@pytest.mark.parametrize("url", ["http://www.tiktok.com/@a/video/1", "https://www.tiktok.com.evil.test/@a/video/1", "https://127.0.0.1/video/1", "https://user:pass@www.tiktok.com/@a/video/1", "https://www.tiktok.com:8080/@a/video/1", "https://www.tiktok.com/@a/photo/1", "https://www.tiktok.com/@a/live", "https://www.tiktok.com/@a", "https://www.tiktok.com/@a/video/1\n"])
def test_rejected_links(url):
    with pytest.raises(ValueError): validate_url(url, initial=True)


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1", "::ffff:127.0.0.1", "224.0.0.1"])
def test_non_public_addresses(ip):
    assert not public_ip(ip)


def test_domains_fail_closed():
    assert allowed_host("v1.tiktokcdn.com")
    assert not allowed_host("tiktokcdn.com.evil.test")
    assert not allowed_host("example.com")


def test_dns_rebinding_and_redirect_destination_guard():
    import socket
    original_dns, original_connect, original_ex = socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex
    try:
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            install_network_guard()
            with pytest.raises(OSError): socket.getaddrinfo("v1.tiktokcdn.com", 443)
            with pytest.raises(OSError): socket.getaddrinfo("metadata.google.internal", 443)
            with pytest.raises(OSError): socket.getaddrinfo("www.tiktok.com", 80)
    finally:
        socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex = original_dns, original_connect, original_ex


@pytest.mark.parametrize("duration", [181, 0, -1, float("nan"), float("inf")])
def test_duration_limit(duration):
    with pytest.raises(ValueError): duration_of({"format": {"duration": duration}})


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        for name in ("owner", "stranger"):
            session.add(User(id=name, username=name, email=f"{name}@example.com", password_hash="x"))
        session.commit()
        yield session
    engine.dispose()


def test_ownership_cancellation_and_private_preview(db):
    job = MediaImport(user_id="owner", url="https://vm.tiktok.com/ABC/", status="ready", storage_path="/uploads/ready.mp4", duration_ms=90000, expires_at=utcnow() + timedelta(minutes=30))
    db.add(job); db.commit()
    owner, stranger = db.get(User, "owner"), db.get(User, "stranger")
    with pytest.raises(HTTPException) as error: imports.owned_job(db, stranger, job.id)
    assert error.value.status_code == 404
    assert can_access_media(db, "owner", job.storage_path)
    assert not can_access_media(db, "stranger", job.storage_path)
    assert media_path_still_in_use(db, job.storage_path)
    imports.cancel_import(job.id, owner, db)
    assert not can_access_media(db, "owner", job.storage_path)


def test_queue_limit_and_feature_switch(db, monkeypatch):
    monkeypatch.setattr(imports.settings, "tiktok_import_enabled", False)
    owner = db.get(User, "owner")
    with pytest.raises(HTTPException) as error: imports.start_import(imports.ImportRequest(url="https://vm.tiktok.com/ABC/"), owner, db)
    assert error.value.status_code == 503
    monkeypatch.setattr(imports.settings, "tiktok_import_enabled", True)
    monkeypatch.setattr(imports, "check_upload_rate_limit", lambda _: True)
    for _ in range(2): imports.start_import(imports.ImportRequest(url="https://vm.tiktok.com/ABC/"), owner, db)
    with pytest.raises(HTTPException) as error: imports.start_import(imports.ImportRequest(url="https://vm.tiktok.com/ABC/"), owner, db)
    assert error.value.status_code == 429


def test_long_ping_does_not_expire_during_playback(db):
    msg = MediaMessage(sender_id="owner", receiver_id="owner", media_type=MediaType.video,
                       storage_path="/uploads/v.mp4", delivery_status=DeliveryStatus.pending,
                       dispatched_at=utcnow() - timedelta(seconds=90), expires_at=utcnow() + timedelta(seconds=150))
    db.add(msg); db.commit()
    assert find_stale_dispatched_pending(db) == []
    msg.expires_at = utcnow() - timedelta(seconds=1); db.commit()
    assert find_stale_dispatched_pending(db) == [msg]


def test_send_import_reuses_file_and_checks_long_video_before_creating_messages(db, monkeypatch):
    import asyncio
    job = MediaImport(user_id="owner", url="https://vm.tiktok.com/ABC/", status="ready", storage_path="/uploads/ready.mp4", duration_ms=53000, expires_at=utcnow() + timedelta(minutes=30))
    db.add(job); db.commit()
    owner = db.get(User, "owner")
    monkeypatch.setattr(imports, "check_upload_rate_limit", lambda _: True)
    monkeypatch.setattr(imports.presence_manager, "supports_long_video", lambda _: False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(imports.send_import(job.id, "owner", None, 53000, None, owner, db))
    assert error.value.status_code == 409
    assert db.query(MediaMessage).count() == 0
    monkeypatch.setattr(imports.presence_manager, "supports_long_video", lambda _: True)
    result = asyncio.run(imports.send_import(job.id, "owner", "hello", 53000, None, owner, db))
    assert len(result["uploads"]) == 1
    msg = db.query(MediaMessage).one()
    assert msg.storage_path == job.storage_path and msg.media_duration_ms == 53000
    assert msg.caption == "hello"


def test_long_video_requires_every_connected_desktop_to_support_it():
    from app.realtime import PresenceManager
    presence = PresenceManager()
    presence.connect("receiver", "web", "web")
    assert not presence.supports_long_video("receiver")
    presence.connect("receiver", "new", "desktop", "1.0.66", 180_000)
    assert presence.supports_long_video("receiver")
    presence.connect("receiver", "old", "desktop", "1.0.65")
    assert not presence.supports_long_video("receiver")
    presence.disconnect("old")
    assert presence.supports_long_video("receiver")
    presence.disconnect("new")
    assert not presence.supports_long_video("receiver")
