import mimetypes
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

Image.MAX_IMAGE_PIXELS = 20_000_000

ALLOWED_IMAGE = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO = {"video/mp4", "video/webm"}
ALLOWED_AUDIO = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/mp4",
    "audio/webm",
    "audio/aac",
    "audio/x-m4a",
    "audio/flac",
    "audio/x-flac",
}

AUDIO_EXTENSIONS = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
}

MIME_TO_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/webm": ".webm",
    "audio/aac": ".aac",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
}

BLOCKED_UPLOAD_EXTENSIONS = {
    ".html",
    ".htm",
    ".svg",
    ".xhtml",
    ".xml",
    ".js",
    ".mjs",
    ".php",
}


def sniff_media_mime(content: bytes) -> str | None:
    """Detect media type from file header bytes (ignores client Content-Type)."""
    if len(content) < 4:
        return None

    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if content[:4] == b"RIFF" and len(content) >= 12:
        if content[8:12] == b"WEBP":
            return "image/webp"
        if content[8:12] == b"WAVE":
            return "audio/wav"
    if content[:4] == b"fLaC":
        return "audio/flac"
    if content[:4] == b"OggS":
        return "audio/ogg"
    if content[:3] == b"ID3":
        return "audio/mpeg"
    if content[0:1] == b"\xff" and len(content) >= 2 and (content[1] & 0xE0) == 0xE0:
        return "audio/mpeg"
    if content[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    if len(content) >= 12 and content[4:8] == b"ftyp":
        brand = content[8:12]
        if brand in (b"M4A ", b"M4B ", b"mp4a"):
            return "audio/mp4"
        return "video/mp4"

    return None


def _resolve_upload_mime(file: UploadFile) -> str:
    raw = (file.content_type or "").strip()
    if raw and raw not in {"application/octet-stream", "application/octetstream"}:
        mime = raw
    else:
        mime = mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    if mime == "audio/mp3":
        return "audio/mpeg"

    ext = Path(file.filename or "").suffix.lower()
    if ext in AUDIO_EXTENSIONS:
        return AUDIO_EXTENSIONS[ext]

    return mime


def _media_type_for_mime(mime: str) -> str:
    if mime in ALLOWED_IMAGE:
        return "image"
    if mime in ALLOWED_VIDEO:
        return "video"
    if mime in ALLOWED_AUDIO:
        return "audio"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported file type: {mime}")


def _max_bytes_for_type(media_type: str) -> int:
    if media_type == "image":
        return settings.max_image_bytes
    if media_type == "video":
        return settings.max_video_bytes
    return settings.max_audio_bytes


def _extension_for_mime(mime: str) -> str:
    ext = MIME_TO_EXT.get(mime) or mimetypes.guess_extension(mime) or ""
    if ext == ".jpe":
        ext = ".jpg"
    ext = ext.lower()
    if not ext or ext in BLOCKED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported or unsafe file type: {mime}",
        )
    return ext


async def save_upload(file: UploadFile, force_audio: bool = False) -> tuple[str, str, str]:
    content = await file.read()
    mime = sniff_media_mime(content)
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unrecognized or unsupported file type",
        )

    if force_audio:
        if mime not in ALLOWED_AUDIO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Sound file must be audio, got: {mime}")
        media_type = "audio"
        max_bytes = settings.max_audio_bytes
    else:
        media_type = _media_type_for_mime(mime)
        max_bytes = _max_bytes_for_type(media_type)

    if len(content) > max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    ext = _extension_for_mime(mime)
    filename = f"{uuid.uuid4().hex}{ext}"
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / filename
    dest.write_bytes(content)
    return media_type, filename, f"/uploads/{filename}"


def save_image_bytes(content: bytes, mime: str) -> tuple[str, str]:
    """Store original image bytes without re-encoding."""
    if mime not in ALLOWED_IMAGE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported file type: {mime}")
    if len(content) > settings.max_image_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    ext = _extension_for_mime(mime)
    filename = f"{uuid.uuid4().hex}{ext}"
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / filename
    dest.write_bytes(content)
    return filename, f"/uploads/{filename}"


def _avatars_dir() -> Path:
    path = Path(settings.upload_dir) / "avatars"
    path.mkdir(parents=True, exist_ok=True)
    return path


def compress_avatar_bytes(content: bytes) -> bytes:
    """Resize to avatar_max_px and encode as WebP so profile photos stay tiny on disk."""
    try:
        img = Image.open(BytesIO(content))
        img = ImageOps.exif_transpose(img)
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar must be an image") from exc
    except Image.DecompressionBombError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar image is too large") from exc

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")

    img.thumbnail((settings.avatar_max_px, settings.avatar_max_px), Image.Resampling.LANCZOS)
    out = BytesIO()
    img.save(out, format="WEBP", quality=settings.avatar_webp_quality, method=6)
    return out.getvalue()


def persist_avatar_file(user_id: str, content: bytes) -> str:
    compressed = compress_avatar_bytes(content)
    avatars_dir = _avatars_dir()
    for old in avatars_dir.glob(f"{user_id}.*"):
        old.unlink(missing_ok=True)
    filename = f"{user_id}.webp"
    (avatars_dir / filename).write_bytes(compressed)
    return f"/uploads/avatars/{filename}"


def migrate_existing_avatars(db) -> None:
    """Recompress leftover JPEG/PNG avatars and point user records at the WebP files."""
    from app.models import User

    avatars_dir = _avatars_dir()
    changed = False
    for path in list(avatars_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
            continue
        user_id = path.stem
        if path.suffix.lower() == ".webp" and path.stat().st_size <= 80_000:
            new_url = f"/uploads/avatars/{path.name}"
        else:
            try:
                new_url = persist_avatar_file(user_id, path.read_bytes())
            except Exception:
                continue
        user = db.get(User, user_id)
        if user is not None and user.avatar_url != new_url:
            user.avatar_url = new_url
            changed = True
    if changed:
        db.commit()
    _repair_missing_avatar_urls(db)


def _repair_missing_avatar_urls(db) -> None:
    from app.models import User

    avatars_dir = _avatars_dir()
    changed = False
    users = db.query(User).filter(User.avatar_url.isnot(None)).all()
    for user in users:
        stored = Path(user.avatar_url or "").name
        if stored and (avatars_dir / stored).is_file():
            continue
        for ext in (".webp", ".jpg", ".jpeg", ".png", ".gif"):
            candidate = avatars_dir / f"{user.id}{ext}"
            if candidate.is_file():
                user.avatar_url = f"/uploads/avatars/{candidate.name}"
                changed = True
                break
    if changed:
        db.commit()


async def apply_avatar_upload(file: UploadFile, user, db):
    avatar_url = await save_avatar(file, user.id)
    user.avatar_url = avatar_url
    db.commit()
    db.refresh(user)
    return user


async def save_avatar(file: UploadFile, user_id: str) -> str:
    content = await file.read()
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    if mime not in ALLOWED_IMAGE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar must be an image (JPEG, PNG, GIF, WebP)")

    if len(content) > settings.max_avatar_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Avatar too large (max 2MB)")

    return persist_avatar_file(user_id, content)
