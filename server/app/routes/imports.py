from datetime import timedelta
import threading
from pathlib import Path
from sqlalchemy import func

from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import DeliveryStatus, MediaImport, MediaMessage, MediaType, User, utcnow
from app.realtime import check_upload_rate_limit, presence_manager
from app.routes.media import _parse_receiver_ids, _validate_receiver
from app.services.media_access import sign_media_url
from app.services.ping_limits import sanitize_caption
from app.services.tiktok_network import validate_url
from app.services.media import save_upload
from app.services.video_import import validate_link, validate_clip, SOURCE_BYTES, LOCAL_BYTES, GLOBAL_BYTES, FINAL_BYTES

router = APIRouter(prefix="/media/imports", tags=["imports"])
_queue_lock = threading.Lock()


class ImportRequest(BaseModel):
    url: str = Field(max_length=2048)
    clip: bool = False
    replace_previous: bool = False


class ClipRequest(BaseModel):
    start_ms: int = Field(strict=True)
    end_ms: int = Field(strict=True)
    volume: float = Field(default=1.0, ge=0, le=1, allow_inf_nan=False)


def platform_enabled(platform):
    return platform == "local" or bool(getattr(settings, platform + "_import_enabled", False))


def reserve_capacity(db, user_id, reservation):
    active = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "fetching", "optimizing", "queued_clip", "cropping", "uploading")))
    stored = db.query(MediaImport).filter(MediaImport.status.notin_(("cancelled", "failed")), MediaImport.expires_at > utcnow())
    # Legacy jobs lack a reservation column value; count their maximum scratch
    # footprint too while they complete under the compatibility path.
    reserved = stored.with_entities(func.coalesce(func.sum(func.coalesce(MediaImport.reserved_bytes, 3 * FINAL_BYTES)), 0)).scalar()
    if reserved + reservation > GLOBAL_BYTES:
        raise HTTPException(429, "Temporary video storage is full; remove a video or try again later")
    if stored.filter(MediaImport.user_id == user_id).count() >= 5:
        raise HTTPException(429, "Import storage is full; remove a previous video or wait for it to expire")
    if active.count() >= 20 or active.filter(MediaImport.user_id == user_id).count() >= 2:
        raise HTTPException(429, "Import queue full; please try again shortly")


def replace_idle_imports(db, user_id):
    # The composer has one video slot. Leave in-flight work and other users alone.
    # The worker cleans cancelled files while preserving media used by sent pings.
    for previous in db.query(MediaImport).filter(MediaImport.user_id == user_id,
            MediaImport.status.in_(("ready", "awaiting_selection"))).with_for_update().all():
        previous.status = "cancelled"
    db.flush()


def new_clip_job(db, user, platform, url, reservation, status="queued", replace_previous=False):
    if replace_previous:
        replace_idle_imports(db, user.id)
    reserve_capacity(db, user.id, reservation)
    job = MediaImport(user_id=user.id, platform=platform, url=url, status=status, reserved_bytes=reservation,
                      expires_at=utcnow() + timedelta(minutes=30))
    db.add(job); db.commit(); db.refresh(job)
    return job


class ImportSendRequest(BaseModel):
    receiver_ids: list[str] = Field(min_length=1, max_length=20)
    caption: str | None = Field(default=None, max_length=500)


def owned_job(db: Session, user: User, job_id: str) -> MediaImport:
    job = db.query(MediaImport).filter(MediaImport.id == job_id).with_for_update().first()
    if not job or job.user_id != user.id:
        raise HTTPException(404, "Import not found")
    expiry = job.expires_at
    if expiry.replace(tzinfo=utcnow().tzinfo) <= utcnow():
        raise HTTPException(410, "Import expired; paste the link again")
    return job


def job_response(job: MediaImport):
    return {"id": job.id, "status": job.status, "error": job.error, "duration_ms": job.duration_ms,
            "media_url": sign_media_url(job.storage_path, job.user_id, [job.storage_path]) if job.status == "ready" else None,
            "platform": job.platform or "tiktok", "title": job.title,
            "source_duration_ms": job.source_duration_ms, "start_ms": job.start_ms, "end_ms": job.end_ms, "volume": job.volume if job.volume is not None else 1.0,
            "preview_url": sign_media_url(job.source_path, job.user_id, [job.source_path]) if job.source_duration_ms and job.source_path else None}


@router.post("")
def start_import(body: ImportRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.clip:
        if not settings.video_clip_enabled:
            raise HTTPException(503, "Video clipping is currently unavailable")
        try:
            platform, url = validate_link(body.url.strip())
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if not platform_enabled(platform):
            raise HTTPException(503, "Imports from this platform are currently unavailable; upload a file instead")
        if not check_upload_rate_limit(user.id):
            raise HTTPException(429, "Too many imports; please wait")
        with _queue_lock:
            # Covers tracks, merge, preview and copy scratch space before download.
            return job_response(new_clip_job(db, user, platform, url, 4 * SOURCE_BYTES + 2 * FINAL_BYTES, replace_previous=body.replace_previous))
    if not settings.tiktok_import_enabled:
        raise HTTPException(503, "TikTok import is currently unavailable; upload a video instead")
    try:
        url = validate_url(body.url.strip(), initial=True)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not check_upload_rate_limit(user.id):
        raise HTTPException(429, "Too many imports; please wait")
    with _queue_lock:
        reserve_capacity(db, user.id, 3 * FINAL_BYTES)
        active = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "fetching", "optimizing")))
        stored = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "fetching", "optimizing", "ready")), MediaImport.expires_at > utcnow())
        if stored.count() >= 50 or stored.filter(MediaImport.user_id == user.id).count() >= 5:
            raise HTTPException(429, "Import storage is full; remove an import or wait for it to expire")
        if active.count() >= settings.tiktok_import_queue_limit or active.filter(MediaImport.user_id == user.id).count() >= 2:
            raise HTTPException(429, "Import queue full; please try again shortly")
        job = MediaImport(user_id=user.id, url=url, reserved_bytes=3 * FINAL_BYTES,
                          expires_at=utcnow() + timedelta(minutes=settings.tiktok_import_expiry_minutes))
        db.add(job)
        db.commit()
        db.refresh(job)
    return job_response(job)


@router.post("/upload")
async def upload_source(file: UploadFile = File(...), replace_previous: bool = Form(False), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not settings.video_clip_enabled:
        raise HTTPException(503, "Video clipping is currently unavailable")
    if not check_upload_rate_limit(user.id):
        raise HTTPException(429, "Too many uploads; please wait")
    with _queue_lock:
        job = new_clip_job(db, user, "local", "", 2 * LOCAL_BYTES + 2 * SOURCE_BYTES + 2 * FINAL_BYTES, "uploading", replace_previous=replace_previous)
    target = Path(settings.upload_dir) / f"source-{job.id}.input"
    try:
        size = 0
        with target.open("wb") as output:
            while chunk := await file.read(256 * 1024):
                size += len(chunk)
                if size > LOCAL_BYTES:
                    raise HTTPException(413, "Source file exceeds 50 MiB")
                output.write(chunk)
        if not size:
            raise HTTPException(400, "Empty video file")
        db.refresh(job)
        if job.status != "uploading":
            raise HTTPException(409, "Upload cancelled or expired")
        job.title = (file.filename or "Uploaded video")[:300]
        job.source_path = "/uploads/" + target.name
        job.status = "queued"
        db.commit()
        return job_response(job)
    except BaseException:
        target.unlink(missing_ok=True)
        job.status = "failed"; job.reserved_bytes = 0; db.commit()
        raise
    finally:
        await file.close()


@router.post("/{job_id}/clip")
def select_clip(job_id: str, body: ClipRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not settings.video_clip_enabled:
        raise HTTPException(503, "Video clipping is currently unavailable")
    job = owned_job(db, user, job_id)
    if job.status not in ("awaiting_selection", "ready") or not job.source_path or not job.source_duration_ms:
        raise HTTPException(409, "Wait until the source video is ready")
    try:
        validate_clip(job.source_duration_ms, body.start_ms, body.end_ms)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not check_upload_rate_limit(user.id):
        raise HTTPException(429, "Too many edits; please wait")
    with _queue_lock:
        active = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "fetching", "optimizing", "uploading", "queued_clip", "cropping")))
        if active.count() >= 20 or active.filter(MediaImport.user_id == user.id).count() >= 2:
            raise HTTPException(429, "Processing queue full; try again shortly")
        job.start_ms = body.start_ms; job.end_ms = body.end_ms
        job.volume = body.volume
        job.status = "queued_clip"; job.error = None
        job.expires_at = utcnow() + timedelta(minutes=30)
        db.commit()
    return job_response(job)


@router.get("/{job_id}")
def import_status(job_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = owned_job(db, user, job_id)
    if job.platform and job.status not in ("failed", "cancelled"):
        job.expires_at = utcnow() + timedelta(minutes=30)
        db.commit()
    return job_response(job)


@router.delete("/{job_id}")
def cancel_import(job_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = owned_job(db, user, job_id)
    job.status = "cancelled"
    db.commit()
    return {"ok": True}


@router.post("/{job_id}/send")
async def send_import(job_id: str, receiver_ids: str = Form(...), caption: str | None = Form(None),
                      duration_ms: int | None = Form(None, ge=2000, le=180000),
                      sound_file: UploadFile | None = File(None),
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = owned_job(db, user, job_id)
    if job.status != "ready" or not job.storage_path:
        raise HTTPException(409, "Wait until the video is ready")
    if job.platform and (not job.duration_ms or job.duration_ms > 30000):
        raise HTTPException(409, "Choose an excerpt of up to 30 seconds first")
    if not check_upload_rate_limit(user.id):
        raise HTTPException(429, "Too many sends; please wait")
    ids = _parse_receiver_ids(receiver_ids)
    for receiver in ids:
        _validate_receiver(db, user.id, receiver)
        requested_duration = min(duration_ms or job.duration_ms or 3000, job.duration_ms or 3000)
        if requested_duration > 30_000 and not presence_manager.supports_long_video(receiver):
            raise HTTPException(409, "Every recipient must be online with desktop 1.0.66 or newer for videos longer than 30 seconds")
    audio_url = None
    if sound_file and sound_file.filename:
        _, _, audio_url = await save_upload(sound_file, force_audio=True)
    uploads = []
    for receiver in ids:
        message = MediaMessage(sender_id=user.id, receiver_id=receiver, media_type=MediaType.video,
                               storage_path=job.storage_path, media_duration_ms=job.duration_ms,
                               audio_path=audio_url, caption=sanitize_caption(caption), delivery_status=DeliveryStatus.pending)
        db.add(message)
        db.flush()
        uploads.append({"message_id": message.id, "receiver_id": receiver, "media_type": "video", "media_url": job.storage_path, "audio_url": audio_url})
    db.commit()
    return {"uploads": uploads}
