"""Signup requires an email verification code; existing users stay logged in."""

from __future__ import annotations

from datetime import datetime, timezone

from app.models import User, utcnow
from app.routes.auth import _email_verified


def test_existing_users_with_timestamp_are_verified():
    user = User(
        username="old",
        email="old@example.com",
        password_hash="x",
        email_verified_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    assert _email_verified(user) is True


def test_new_signup_without_timestamp_is_unverified():
    user = User(
        username="new",
        email="new@example.com",
        password_hash="x",
        email_verified_at=None,
    )
    assert _email_verified(user) is False


def test_utcnow_sets_verified_now():
    user = User(
        username="now",
        email="now@example.com",
        password_hash="x",
        email_verified_at=utcnow(),
    )
    assert _email_verified(user) is True
