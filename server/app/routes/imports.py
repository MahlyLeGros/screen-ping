from datetime import timedelta
import threading

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

router = APIRouter(prefix="/media/imports", tags=["imports"])
_queue_lock = threading.Lock()


class ImportRequest(BaseModel):
    url: str = Field(max_length=2048)


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
            "media_url": sign_media_url(job.storage_path, job.user_id, [job.storage_path]) if job.status == "ready" else None}


@router.post("")
def start_import(body: ImportRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not settings.tiktok_import_enabled:
        raise HTTPException(503, "TikTok import is currently unavailable; upload a video instead")
    try:
        url = validate_url(body.url.strip(), initial=True)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not check_upload_rate_limit(user.id):
        raise HTTPException(429, "Too many imports; please wait")
    with _queue_lock:
        active = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "fetching", "optimizing")))
        stored = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "fetching", "optimizing", "ready")), MediaImport.expires_at > utcnow())
        if stored.count() >= 50 or stored.filter(MediaImport.user_id == user.id).count() >= 5:
            raise HTTPException(429, "Import storage is full; remove an import or wait for it to expire")
        if active.count() >= settings.tiktok_import_queue_limit or active.filter(MediaImport.user_id == user.id).count() >= 2:
            raise HTTPException(429, "Import queue full; please try again shortly")
        job = MediaImport(user_id=user.id, url=url, expires_at=utcnow() + timedelta(minutes=settings.tiktok_import_expiry_minutes))
        db.add(job)
        db.commit()
        db.refresh(job)
    return job_response(job)


@router.get("/{job_id}")
def import_status(job_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return job_response(owned_job(db, user, job_id))


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
