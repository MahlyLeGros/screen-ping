from __future__ import annotations

import re
import secrets

import requests
from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy.orm import Session

from app.auth import hash_password, issue_tokens
from app.config import settings
from app.models import User, utcnow
from app.schemas import GoogleAuthResponse

_TOKEN_REQUEST = google_requests.Request()


def _normalized_google_profile(email: str, sub: str, email_verified: bool) -> dict:
    email = email.strip().lower()
    sub = sub.strip()
    if not email or not sub or not email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not provide a verified email.",
        )
    return {"email": email, "sub": sub}


def _verify_google_id_token(credential: str, client_id: str) -> dict:
    try:
        info = id_token.verify_oauth2_token(
            credential,
            _TOKEN_REQUEST,
            client_id,
            clock_skew_in_seconds=10,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google sign-in.",
        ) from exc
    issuer = info.get("iss")
    if issuer not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google sign-in.")
    return _normalized_google_profile(
        str(info.get("email") or ""),
        str(info.get("sub") or ""),
        bool(info.get("email_verified")),
    )


def _verify_google_access_token(access_token: str) -> dict:
    try:
        response = requests.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google sign-in.",
        ) from exc
    if response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google sign-in.")
    info = response.json()
    verified = info.get("email_verified")
    if verified in ("true", True, "1"):
        email_verified = True
    else:
        email_verified = False
    return _normalized_google_profile(
        str(info.get("email") or ""),
        str(info.get("sub") or ""),
        email_verified,
    )


def verify_google_credential(credential: str) -> dict:
    client_id = (settings.google_client_id or "").strip()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured.",
        )
    token = credential.strip()
    if token.count(".") == 2:
        return _verify_google_id_token(token, client_id)
    return _verify_google_access_token(token)


def suggest_username(email: str, db: Session) -> str:
    local = (email.split("@")[0] or "user").lower()
    base = re.sub(r"[^a-z0-9_]", "", local)[:32]
    if len(base) < 3:
        base = f"{base}user"[:32]
    candidate = base
    n = 1
    while db.query(User).filter(User.username == candidate).first():
        n += 1
        suffix = str(n)
        candidate = f"{base[: 32 - len(suffix)]}{suffix}"
    return candidate


def complete_google_auth(
    db: Session,
    *,
    email: str,
    sub: str,
    username: str | None,
    accept_terms: bool,
) -> GoogleAuthResponse:
    user = db.query(User).filter(User.google_sub == sub).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()
        if user:
            if user.google_sub and user.google_sub != sub:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This email is already linked to another Google account.",
                )
            user.google_sub = sub
            if not user.email_verified_at:
                user.email_verified_at = utcnow()
            db.commit()

    if user:
        access_token, refresh_token = issue_tokens(user)
        return GoogleAuthResponse(access_token=access_token, refresh_token=refresh_token)

    suggested = suggest_username(email, db)
    chosen = (username or "").strip()
    if not chosen:
        return GoogleAuthResponse(
            needs_username=True,
            suggested_username=suggested,
            email=email,
        )
    if len(chosen) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 3 characters.",
        )
    if not accept_terms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the Terms of Use.",
        )
    taken = db.query(User).filter((User.username == chosen) | (User.email == email)).first()
    if taken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")

    user = User(
        username=chosen,
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        google_sub=sub,
        email_verified_at=utcnow(),
        terms_accepted_at=utcnow(),
        terms_accepted_version=settings.terms_version,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    access_token, refresh_token = issue_tokens(user)
    return GoogleAuthResponse(access_token=access_token, refresh_token=refresh_token)
