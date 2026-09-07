"""Tests for HttpOnly refresh cookie helpers."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app.auth_cookies import (
    DESKTOP_CLIENT,
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    is_desktop_client,
    read_refresh_token,
    resolve_persist,
    set_refresh_cookie,
)


def _request(
    *,
    headers: dict[str, str] | None = None,
    cookie_header: str | None = None,
) -> Request:
    merged = dict(headers or {})
    if cookie_header:
        merged["Cookie"] = cookie_header
    raw_headers = [(key.lower().encode(), value.encode()) for key, value in merged.items()]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/auth/refresh",
        "headers": raw_headers,
        "query_string": b"",
    }
    return Request(scope)


def test_is_desktop_client():
    req = _request(headers={"X-ScreenPing-Client": DESKTOP_CLIENT})
    assert is_desktop_client(req) is True
    assert is_desktop_client(_request()) is False


def test_resolve_persist_prefers_body():
    req = _request(headers={"X-Auth-Persist": "0"})
    assert resolve_persist(req, remember_me=True) is True
    assert resolve_persist(req, remember_me=False) is False
    assert resolve_persist(req) is False


def test_read_refresh_token_from_cookie():
    req = _request(cookie_header=f"{REFRESH_COOKIE_NAME}=cookie-token")
    assert read_refresh_token(req, None) == "cookie-token"


def test_read_refresh_token_desktop_requires_body():
    req = _request(headers={"X-ScreenPing-Client": DESKTOP_CLIENT})
    assert read_refresh_token(req, "body-token") == "body-token"
    with pytest.raises(HTTPException) as exc:
        read_refresh_token(req, None)
    assert exc.value.status_code == 401


def test_read_refresh_token_web_rejects_body_only():
    req = _request()
    with pytest.raises(HTTPException):
        read_refresh_token(req, "body-token")


def test_set_and_clear_refresh_cookie():
    response = Response()
    set_refresh_cookie(response, "refresh-jwt", persist=True)
    set_cookie = response.headers.get("set-cookie", "")
    assert REFRESH_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Path=/api/auth" in set_cookie

    cleared = Response()
    clear_refresh_cookie(cleared)
    assert REFRESH_COOKIE_NAME in cleared.headers.get("set-cookie", "")
