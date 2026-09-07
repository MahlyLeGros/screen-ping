"""Authenticated access to ping media files."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
import json

from jose import JWTError, jwt
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import ALGORITHM
from app.config import settings
from app.models import DeliveryStatus, MediaMessage
from app.services.friends import are_friends, is_blocked


def parse_source_layers(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict) and item.get("path")]


def media_paths_for_message(message: MediaMessage) -> list[str]:
    paths = [message.storage_path, message.audio_path]
    for item in parse_source_layers(message.source_layers):
        paths.append(str(item["path"]))
    return [p for p in paths if p]


def _media_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=settings.media_ttl_hours)


def create_media_access_token(user_id: str, paths: list[str]) -> str:
    allowed = sorted({p for p in paths if p})
    return jwt.encode(
        {
            "sub": user_id,
            "paths": allowed,
            "type": "media",
            "exp": _media_token_expiry(),
        },
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def verify_media_access_token(token: str, path: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != "media":
        return None
    allowed = payload.get("paths") or []
    if path not in allowed:
        return None
    return payload.get("sub")


def sign_media_url(path: str | None, user_id: str, paths: list[str]) -> str | None:
    if not path:
        return None
    token = create_media_access_token(user_id, paths)
    return f"{path}?{urlencode({'token': token})}"


def can_access_media(db: Session, user_id: str, storage_path: str) -> bool:
    message = (
        db.query(MediaMessage)
        .filter(
            or_(
                MediaMessage.storage_path == storage_path,
                MediaMessage.audio_path == storage_path,
                MediaMessage.source_layers.contains(storage_path),
            )
        )
        .first()
    )
    if not message:
        return False
    source_paths = {item["path"] for item in parse_source_layers(message.source_layers)}
    if storage_path in source_paths and storage_path not in (message.storage_path, message.audio_path):
        if user_id != message.sender_id:
            return False
    if user_id not in (message.sender_id, message.receiver_id):
        return False
    if message.sender_id == message.receiver_id:
        return True
    if is_blocked(db, message.sender_id, message.receiver_id):
        return False
    return are_friends(db, message.sender_id, message.receiver_id)


ACTIVE_MEDIA_STATUSES = (
    DeliveryStatus.pending,
    DeliveryStatus.offline,
    DeliveryStatus.paused,
)


def media_path_still_in_use(db: Session, storage_path: str) -> bool:
    return (
        db.query(MediaMessage.id)
        .filter(
            or_(
                MediaMessage.storage_path == storage_path,
                MediaMessage.audio_path == storage_path,
                MediaMessage.source_layers.contains(storage_path),
            ),
            MediaMessage.delivery_status.in_(ACTIVE_MEDIA_STATUSES),
        )
        .first()
        is not None
    )


def delete_upload_file(storage_path: str) -> None:
    path = resolve_upload_file(storage_path)
    if path is None:
        return
    path.unlink(missing_ok=True)


def release_media_for_message(db: Session, message: MediaMessage) -> None:
    """Delete ping files once no in-flight / offline / paused message still needs them."""
    for storage_path in set(media_paths_for_message(message)):
        if not media_path_still_in_use(db, storage_path):
            delete_upload_file(storage_path)


def resolve_upload_file(storage_path: str) -> Path | None:
    if not storage_path.startswith("/uploads/"):
        return None
    relative = storage_path.removeprefix("/uploads/").lstrip("/")
    if not relative or ".." in relative or relative.startswith("avatars/"):
        return None
    upload_root = Path(settings.upload_dir).resolve()
    candidate = (upload_root / relative).resolve()
    if upload_root not in candidate.parents and candidate != upload_root:
        return None
    if not candidate.is_file():
        return None
    return candidate
