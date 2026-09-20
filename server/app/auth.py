from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
import uuid
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import RefreshSession, User, utcnow

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _token_version(user: User) -> int:
    return int(getattr(user, "token_version", 0) or 0)


def _validate_token_version(user: User, payload: dict[str, Any]) -> None:
    if payload.get("tv", 0) != _token_version(user):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")


def bump_token_version(user: User) -> None:
    user.token_version = _token_version(user) + 1


def create_access_token(subject: str, token_version: int = 0, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "access", "tv": token_version},
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def _refresh_hash(secret: str) -> str:
    return hashlib.sha256(f"{settings.secret_key}:refresh:{secret}".encode()).hexdigest()


def create_refresh_token(db: Session, user: User) -> str:
    secret = secrets.token_urlsafe(32)
    session = RefreshSession(
        user_id=user.id,
        secret_hash=_refresh_hash(secret),
        token_version=_token_version(user),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(session)
    db.commit()
    return f"{session.id}.{secret}"


def rotate_refresh_token(db: Session, token: str) -> tuple[User, str]:
    # Seamless one-time migration for desktop/web sessions issued before
    # refresh-session rotation existed. Reuse of the legacy JWT is rejected.
    if token.count(".") == 2:
        payload = decode_token(token, expected_type="refresh")
        legacy_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"screenping:legacy-refresh:{token}"))
        if db.get(RefreshSession, legacy_id):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token already used")
        user = db.get(User, payload.get("sub"))
        if not user or payload.get("tv", 0) != _token_version(user):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
        now = utcnow()
        db.add(RefreshSession(
            id=legacy_id,
            user_id=user.id,
            secret_hash=_refresh_hash(token),
            token_version=_token_version(user),
            expires_at=now,
            revoked_at=now,
            last_used_at=now,
        ))
        db.commit()
        return user, create_refresh_token(db, user)
    try:
        session_id, secret = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc
    query = db.query(RefreshSession).filter(RefreshSession.id == session_id)
    if not settings.database_url.startswith("sqlite"):
        query = query.with_for_update()
    session = query.first()
    now = utcnow()
    expires = session.expires_at.replace(tzinfo=timezone.utc) if session and session.expires_at.tzinfo is None else (session.expires_at if session else now)
    if not session or session.revoked_at or expires <= now or not hmac.compare_digest(session.secret_hash, _refresh_hash(secret)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = db.get(User, session.user_id)
    if not user or session.token_version != _token_version(user):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
    session.revoked_at = now
    session.last_used_at = now
    db.commit()
    return user, create_refresh_token(db, user)


def revoke_refresh_token(db: Session, token: str | None) -> None:
    if not token or "." not in token:
        return
    session_id = token.split(".", 1)[0]
    session = db.get(RefreshSession, session_id)
    if session and not session.revoked_at:
        session.revoked_at = utcnow()
        db.commit()


def decode_token(token: str, expected_type: str | None = None) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    if expected_type and payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return payload


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(credentials.credentials, expected_type="access")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    _validate_token_version(user, payload)
    return user


def get_user_from_token(token: str, db: Session) -> User:
    payload = decode_token(token, expected_type="access")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    _validate_token_version(user, payload)
    return user


def issue_tokens(db: Session, user: User) -> tuple[str, str]:
    tv = _token_version(user)
    return create_access_token(user.id, tv), create_refresh_token(db, user)
