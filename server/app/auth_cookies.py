"""HttpOnly refresh cookies for web clients; desktop keeps JSON tokens."""

from __future__ import annotations

from fastapi import HTTPException, Request, Response, status

from app.config import settings

REFRESH_COOKIE_NAME = "screenping_refresh"
CLIENT_HEADER = "x-screenping-client"
DESKTOP_CLIENT = "desktop"
PERSIST_HEADER = "x-auth-persist"


def is_desktop_client(request: Request) -> bool:
    return (request.headers.get(CLIENT_HEADER) or "").strip().lower() == DESKTOP_CLIENT


def resolve_persist(request: Request, remember_me: bool | None = None) -> bool:
    if remember_me is not None:
        return remember_me
    header = (request.headers.get(PERSIST_HEADER) or "1").strip().lower()
    return header in ("1", "true", "yes")


def set_refresh_cookie(response: Response, refresh_token: str, *, persist: bool) -> None:
    kwargs: dict = {
        "key": REFRESH_COOKIE_NAME,
        "value": refresh_token,
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": "lax",
        "path": "/api/auth",
    }
    if persist:
        kwargs["max_age"] = settings.refresh_token_expire_days * 86400
    response.set_cookie(**kwargs)


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/api/auth",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def read_refresh_token(request: Request, body_token: str | None) -> str:
    if is_desktop_client(request):
        token = (body_token or "").strip()
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
        return token

    cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    if cookie:
        return cookie

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
