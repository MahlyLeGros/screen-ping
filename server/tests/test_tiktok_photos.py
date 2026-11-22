import json
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import MediaImport, User, utcnow
from app.routes import imports
from app.services.tiktok_photos import fit_frame, parse_embed, timing
from PIL import Image


def test_even_frame_rounding_has_no_black_seam():
    frame = fit_frame(Image.new("RGB", (720, 1083), "white"), 720, 1082)
    assert frame.getextrema() == ((255, 255),) * 3


def test_real_letterboxing_keeps_entire_image():
    frame = fit_frame(Image.new("RGB", (160, 100), "white"), 100, 160)
    assert frame.getpixel((50, 0)) == (0, 0, 0)
    assert frame.getpixel((50, 80)) == (255, 255, 255)
from app.services.video_import import validate_link
from app.services.media_access import can_access_media, media_path_still_in_use


def test_photo_metadata_keeps_exact_order():
    item = {"imagePostInfo": {"displayImages": [{"urlList": ["https://p16.tiktokcdn-eu.com/first"]}, {"urlList": ["https://p16.tiktokcdn-eu.com/second"]}]}, "musicInfos": {"playUrl": ["https://music.tiktokcdn.com/a"]}}
    state = {"source": {"data": {"/embed/v2/123": {"videoData": item}}}}
    page = '<script id="__FRONTITY_CONNECT_STATE__">'+json.dumps(state)+'</script>'
    images, music, title = parse_embed(page, "123")
    assert images == item["imagePostInfo"]["displayImages"]
    assert music == item["musicInfos"]["playUrl"]
    with pytest.raises(ValueError, match="publicly accessible"):
        parse_embed("<html>unavailable</html>", "123")


@pytest.mark.parametrize("count", [1, 2, 10, 24, 35, 100])
@pytest.mark.parametrize("seconds", [.5, 3, 10])
def test_every_photo_fits_with_bounded_transition(count, seconds):
    frames, transition, duration = timing(count, seconds)
    assert 2000 <= duration <= 30000
    assert transition <= 7 and transition <= frames / 4
    assert abs(duration - round(frames * count / 30 * 1000)) < count * 1000 / 30 + 1


@pytest.mark.parametrize("seconds", [float("inf"), float("nan"), 0, 31, "3"])
def test_invalid_speed(seconds):
    with pytest.raises(ValueError): timing(3, seconds)


@pytest.mark.parametrize("count", [1, 2, 7, 24, 100])
@pytest.mark.parametrize("duration", [3, 12, 30])
def test_selected_total_duration(count, duration):
    frames, transition, actual = timing(count, duration / count)
    assert actual == round(max(duration * 30, count) / 30 * 1000)


def test_photo_links_not_profiles():
    assert validate_link("https://www.tiktok.com/@jettvn/photo/7686515564671520020")[0] == "tiktok"
    with pytest.raises(ValueError): validate_link("https://www.tiktok.com/@jettvn")


def test_photo_rollout_stays_private(monkeypatch):
    monkeypatch.setattr(imports.settings, "tiktok_photo_import_enabled", False)
    monkeypatch.setattr(imports.settings, "tiktok_photo_test_user", "Pilot")
    assert imports.settings.photo_import_allowed("pilot")
    assert not imports.settings.photo_import_allowed("other")


def test_expired_orphan_cleanup_preserves_active_photos_and_pending_pings(monkeypatch, tmp_path):
    import asyncio
    import os
    import time
    from app import database, realtime
    from app.models import MediaMessage, MediaType, DeliveryStatus
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", sessions)
    monkeypatch.setattr(imports.settings, "upload_dir", str(tmp_path))
    for name in ("photo.png", "pending.mp4", "orphan.png"):
        target = tmp_path / name
        target.write_bytes(b"test")
        os.utime(target, (time.time()-7200, time.time()-7200))
    with sessions() as db:
        db.add(User(id="owner", username="owner", email="owner@example.com", password_hash="unused"))
        db.add(MediaImport(user_id="owner", url="https://vm.tiktok.com/test/", status="ready", slideshow_assets=json.dumps({"images": ["/uploads/photo.png"]}), expires_at=utcnow()+timedelta(minutes=5)))
        db.add(MediaMessage(sender_id="owner", receiver_id="owner", media_type=MediaType.video, storage_path="/uploads/pending.mp4", delivery_status=DeliveryStatus.pending))
        db.commit()
    asyncio.run(realtime.cleanup_old_uploads())
    assert (tmp_path/"photo.png").exists() and (tmp_path/"pending.mp4").exists()
    assert not (tmp_path/"orphan.png").exists()
    engine.dispose()


def test_slideshow_edit_authorization_queue_and_private_assets(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(imports.settings, "video_clip_enabled", True)
    monkeypatch.setattr(imports.settings, "tiktok_photo_import_enabled", True)
    monkeypatch.setattr(imports, "check_upload_rate_limit", lambda _: True)
    with sessionmaker(bind=engine)() as db:
        user = User(id="owner", username="owner", email="owner@example.com", password_hash="unused")
        db.add(user)
        job = MediaImport(id="photos", user_id="owner", url="https://vm.tiktok.com/test/", platform="tiktok", status="ready", media_kind="slideshow", seconds_per_photo=3, slideshow_assets=json.dumps({"images": ["/uploads/first.png", "/uploads/second.png"], "music": None}), source_path="/uploads/source.mp4", source_duration_ms=6000, start_ms=0, end_ms=6000, expires_at=utcnow()+timedelta(minutes=5))
        db.add(job); db.commit()
        assert can_access_media(db, "owner", "/uploads/first.png")
        assert not can_access_media(db, "other", "/uploads/first.png")
        assert not can_access_media(db, "owner", "/uploads/first")
        assert media_path_still_in_use(db, "/uploads/first.png")
        with pytest.raises(HTTPException) as error:
            imports.select_clip("photos", imports.ClipRequest(start_ms=0, end_ms=4000), user, db)
        assert error.value.status_code == 400
        response = imports.select_slideshow("photos", imports.SlideshowRequest(seconds_per_photo=1.5, volume=.3), user, db)
        assert response["status"] == "queued_clip"
        assert job.seconds_per_photo == 1.5 and job.volume == .3
        job.status = "cancelled"; db.commit()
        assert not can_access_media(db, "owner", "/uploads/first.png")
        assert not media_path_still_in_use(db, "/uploads/first.png")
    engine.dispose()
