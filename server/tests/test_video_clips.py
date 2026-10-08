from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import User, MediaImport, utcnow
from app.routes import imports
from app.services.media_access import can_access_media, media_path_still_in_use
from app.services.video_import import validate_link, validate_clip, source_duration, GLOBAL_BYTES


@pytest.mark.parametrize("url,platform", [
    ("https://www.tiktok.com/@leparisien/video/7693478003635948832", "tiktok"),
    ("https://vm.tiktok.com/ABC/", "tiktok"),
    ("https://www.youtube.com/shorts/BaW_jenozKc?feature=share", "youtube"),
    ("https://youtu.be/BaW_jenozKc?si=test", "youtube"),
    ("https://www.youtube.com/watch?v=BaW_jenozKc", "youtube"),
    ("https://www.instagram.com/reel/ABC_123/?igsh=test", "instagram"),
])
def test_video_links(url, platform):
    assert validate_link(url)[0] == platform


@pytest.mark.parametrize("url", [
    "http://youtube.com/watch?v=BaW_jenozKc", "https://youtube.com.evil.test/watch?v=BaW_jenozKc",
    "https://www.youtube.com/watch?v=BaW_jenozKc&list=PL123", "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@test", "https://www.instagram.com/p/ABC/", "https://instagram.com/stories/test/123",
    "https://127.0.0.1/reel/ABC/", "https://user:pass@youtu.be/BaW_jenozKc", "https://youtu.be:8080/BaW_jenozKc",
])
def test_invalid_sources(url):
    with pytest.raises(ValueError): validate_link(url)


@pytest.mark.parametrize("start,end", [(0, 30000), (20000, 50000), (1170000, 1200000), (1000, 3000)])
def test_valid_excerpts(start, end):
    assert validate_clip(1200000, start, end) == end - start


@pytest.mark.parametrize("start,end", [(-1, 2000), (0, 30001), (1200000, 1201000), (0, 1999), (10, 10), (0.0, 2000), (True, 2000), (0, float("nan"))])
def test_invalid_excerpts(start, end):
    with pytest.raises(ValueError): validate_clip(1200000, start, end)


def test_short_and_source_limits():
    assert validate_clip(500, 0, 500) == 500
    with pytest.raises(ValueError): validate_clip(500, 1, 500)
    assert source_duration({"format": {"duration": 1200}}) == 1200000
    for value in (1200.01, 0, float("inf"), float("nan")):
        with pytest.raises(ValueError): source_duration({"format": {"duration": value}})


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        for name in ("owner", "other"):
            session.add(User(id=name, username=name, email=name + "@example.invalid", password_hash="x"))
        session.commit()
        yield session
    engine.dispose()


def prepared_job(db):
    job = MediaImport(user_id="owner", url="", platform="local", status="awaiting_selection",
                      source_path="/uploads/source.mp4", source_duration_ms=120000,
                      reserved_bytes=100000, expires_at=utcnow() + timedelta(minutes=30))
    db.add(job); db.commit()
    return job


def test_replacing_idle_drafts_frees_user_quota(db):
    drafts = [prepared_job(db) for _ in range(5)]
    drafts[0].status = "ready"
    other = prepared_job(db); other.user_id = "other"
    active = prepared_job(db); active.status = "queued"
    db.commit()
    with pytest.raises(HTTPException) as error:
        imports.reserve_capacity(db, "owner", 1)
    assert "storage" in error.value.detail.lower()
    new = imports.new_clip_job(db, db.get(User, "owner"), "local", "", 100, replace_previous=True)
    assert new.status == "queued"
    assert all(job.status == "cancelled" for job in drafts)
    assert other.status == "awaiting_selection" and active.status == "queued"


@pytest.mark.parametrize("volume", [-0.1, 1.1, float("nan"), float("inf")])
def test_reject_invalid_clip_volume(volume):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        imports.ClipRequest(start_ms=0, end_ms=2000, volume=volume)


def test_clip_volume_persisted(db, monkeypatch):
    job = prepared_job(db)
    monkeypatch.setattr(imports.settings, "video_clip_enabled", True)
    monkeypatch.setattr(imports, "check_upload_rate_limit", lambda _: True)
    result = imports.select_clip(job.id, imports.ClipRequest(start_ms=1000, end_ms=4000, volume=0.35), db.get(User, "owner"), db)
    assert result["volume"] == job.volume == 0.35


@pytest.mark.parametrize("volume", [0, 0.35, 1])
def test_clip_volume_applied_to_encoder(tmp_path, monkeypatch, volume):
    from app.services import video_import
    final = tmp_path / "clip.mp4"
    final.write_bytes(b"fixture")
    metadata = iter([{"format": {"duration": 10}}, {"format": {"duration": 3}}])
    monkeypatch.setattr(video_import, "probe", lambda _: next(metadata))
    calls = []
    monkeypatch.setattr(video_import, "run_ffmpeg", lambda args, timeout: calls.append(args))
    assert video_import.clip_video(tmp_path / "source.mp4", final, 1000, 4000, volume)["duration_ms"] == 3000
    assert calls[0][calls[0].index("-af") + 1] == f"volume={volume}"


def test_source_access_and_owner_only_clip(db, monkeypatch):
    job = prepared_job(db)
    assert can_access_media(db, "owner", job.source_path)
    assert not can_access_media(db, "other", job.source_path)
    assert media_path_still_in_use(db, job.source_path)
    monkeypatch.setattr(imports.settings, "video_clip_enabled", True)
    monkeypatch.setattr(imports, "check_upload_rate_limit", lambda _: True)
    with pytest.raises(HTTPException) as error:
        imports.select_clip(job.id, imports.ClipRequest(start_ms=10000, end_ms=20000), db.get(User, "other"), db)
    assert error.value.status_code == 404
    result = imports.select_clip(job.id, imports.ClipRequest(start_ms=10000, end_ms=20000), db.get(User, "owner"), db)
    assert result["status"] == "queued_clip" and job.start_ms == 10000 and job.end_ms == 20000
    assert can_access_media(db, "owner", job.source_path)
    job.status = "cancelled"; db.commit()
    assert not can_access_media(db, "owner", job.source_path)


def test_global_reservation_and_feature_switch(db, monkeypatch):
    job = prepared_job(db); job.reserved_bytes = GLOBAL_BYTES; db.commit()
    with pytest.raises(HTTPException) as error: imports.reserve_capacity(db, "other", 1)
    assert error.value.status_code == 429
    monkeypatch.setattr(imports.settings, "video_clip_enabled", False)
    with pytest.raises(HTTPException) as error:
        imports.start_import(imports.ImportRequest(url="https://youtu.be/BaW_jenozKc", clip=True), db.get(User, "owner"), db)
    assert error.value.status_code == 503


def test_activity_refreshes_new_source_only(db):
    job = prepared_job(db)
    previous = utcnow() + timedelta(seconds=10)
    job.expires_at = previous; db.commit()
    imports.import_status(job.id, db.get(User, "owner"), db)
    assert job.expires_at.replace(tzinfo=previous.tzinfo) > previous + timedelta(minutes=25)


def test_legacy_jobs_count_against_disk_budget(db):
    job = prepared_job(db)
    job.reserved_bytes = GLOBAL_BYTES - 3 * imports.FINAL_BYTES; db.commit()
    legacy = MediaImport(user_id="other", url="https://vm.tiktok.com/ABC/", status="queued",
                         expires_at=utcnow() + timedelta(minutes=30))
    db.add(legacy); db.commit()
    with pytest.raises(HTTPException) as error: imports.reserve_capacity(db, "owner", 1)
    assert error.value.status_code == 429


@pytest.mark.parametrize("platform,host", [("youtube", "r1.googlevideo.com"), ("instagram", "scontent.cdninstagram.com")])
def test_every_platform_checks_dns_and_redirect_destinations(platform, host):
    import socket
    from app.services.tiktok_network import install_network_guard
    from app.services.video_import import DOMAINS
    original = socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex
    try:
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("169.254.169.254", 443))]):
            install_network_guard(DOMAINS[platform])
            for destination in (host, "localhost", "metadata.google.internal", "example.com"):
                with pytest.raises(OSError): socket.getaddrinfo(destination, 443)
            with pytest.raises(OSError): socket.socket().connect(("169.254.169.254", 443))
    finally:
        socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex = original


def test_cleanup_keeps_clip_needed_by_pending_ping(db, monkeypatch):
    import clip_worker
    from app.models import MediaMessage, MediaType, DeliveryStatus
    job = prepared_job(db)
    job.storage_path = "/uploads/clip.mp4"; job.status = "failed"
    db.add(MediaMessage(sender_id="owner", receiver_id="other", media_type=MediaType.video,
                        storage_path=job.storage_path, delivery_status=DeliveryStatus.pending))
    db.commit()
    removed = []
    monkeypatch.setattr(clip_worker, "delete_upload_file", removed.append)
    clip_worker.clean_job(db, job)
    assert removed == ["/uploads/source.mp4"]
    assert job.source_path is None and job.storage_path is None and job.reserved_bytes == 0


def test_invalid_edit_does_not_mutate_prepared_job(db, monkeypatch):
    job = prepared_job(db)
    job.status = "ready"; job.storage_path = "/uploads/clip.mp4"
    job.start_ms = 10000; job.end_ms = 20000; db.commit()
    monkeypatch.setattr(imports.settings, "video_clip_enabled", True)
    with pytest.raises(HTTPException) as error:
        imports.select_clip(job.id, imports.ClipRequest(start_ms=-1, end_ms=31000), db.get(User, "owner"), db)
    assert error.value.status_code == 400
    assert job.status == "ready" and job.start_ms == 10000 and job.end_ms == 20000
