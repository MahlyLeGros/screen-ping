from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth import issue_tokens
from app.config import settings
from app.models import DesktopLink, User, utcnow


def _hash_poll_secret(secret: str) -> str:
    return hashlib.sha256(f"{settings.secret_key}:desktop-link:{secret}".encode()).hexdigest()


def _secret_matches(secret: str, hashed: str) -> bool:
    return hmac.compare_digest(_hash_poll_secret(secret), hashed)


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _expired(link: DesktopLink, now: datetime) -> bool:
    return _aware(link.expires_at) <= now


def start_desktop_link(db: Session) -> tuple[str, str, int]:
    now = utcnow()
    expire_minutes = max(1, int(settings.desktop_link_expire_minutes))
    pairing_id = secrets.token_urlsafe(24)
    poll_secret = secrets.token_urlsafe(32)
    link = DesktopLink(
        pairing_id=pairing_id,
        poll_secret_hash=_hash_poll_secret(poll_secret),
        expires_at=now + timedelta(minutes=expire_minutes),
    )
    db.add(link)
    db.commit()
    return pairing_id, poll_secret, expire_minutes * 60


def _get_link(db: Session, pairing_id: str, *, for_update: bool = False) -> DesktopLink:
    query = db.query(DesktopLink).filter(DesktopLink.pairing_id == pairing_id)
    if for_update and not settings.database_url.startswith("sqlite"):
        query = query.with_for_update()
    link = query.first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This desktop login request expired.")
    return link


def approve_desktop_link(db: Session, pairing_id: str, user: User) -> None:
    link = _get_link(db, pairing_id, for_update=True)
    now = utcnow()
    if link.consumed_at or _expired(link, now):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This desktop login request expired.")
    if link.user_id and link.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This request was already used.")
    link.user_id = user.id
    db.commit()


def deny_desktop_link(db: Session, pairing_id: str, user: User) -> None:
    link = _get_link(db, pairing_id, for_update=True)
    now = utcnow()
    if link.consumed_at or _expired(link, now):
        return
    if link.user_id and link.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This request was already used.")
    link.consumed_at = now
    db.commit()


def poll_desktop_link(db: Session, pairing_id: str, poll_secret: str) -> dict:
    link = _get_link(db, pairing_id, for_update=True)
    if not _secret_matches(poll_secret, link.poll_secret_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid desktop login request.")

    now = utcnow()
    if link.consumed_at:
        if link.user_id:
            return {"status": "expired"}
        return {"status": "denied"}
    if _expired(link, now):
        return {"status": "expired"}
    if not link.user_id:
        return {"status": "pending"}

    user = db.query(User).filter(User.id == link.user_id).first()
    if not user:
        link.consumed_at = now
        db.commit()
        return {"status": "denied"}

    access_token, refresh_token = issue_tokens(user)
    link.consumed_at = now
    db.commit()
    return {
        "status": "ready",
        "access_token": access_token,
        "refresh_token": refresh_token,
    }
