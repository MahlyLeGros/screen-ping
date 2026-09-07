import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import settings


AFK_AFTER_SECONDS = 15 * 60


class PresenceManager:
    def __init__(self) -> None:
        self._user_sockets: dict[str, set[str]] = defaultdict(set)
        self._socket_users: dict[str, str] = {}
        self._socket_client_types: dict[str, str] = {}
        self._user_desktop_versions: dict[str, str] = {}
        self._user_last_active: dict[str, datetime] = {}

    def connect(
        self,
        user_id: str,
        sid: str,
        client_type: str = "web",
        app_version: str | None = None,
    ) -> None:
        self._user_sockets[user_id].add(sid)
        self._socket_users[sid] = user_id
        self._socket_client_types[sid] = client_type
        if client_type == "desktop" and app_version:
            self._user_desktop_versions[user_id] = app_version

    def disconnect(self, sid: str) -> str | None:
        user_id = self._socket_users.pop(sid, None)
        self._socket_client_types.pop(sid, None)
        if user_id and sid in self._user_sockets.get(user_id, set()):
            self._user_sockets[user_id].discard(sid)
            if not self._user_sockets[user_id]:
                del self._user_sockets[user_id]
        if user_id and not self.desktop_sids_for_user(user_id):
            self._user_desktop_versions.pop(user_id, None)
            self._user_last_active.pop(user_id, None)
        return user_id

    def get_desktop_version(self, user_id: str) -> str | None:
        if not self.desktop_sids_for_user(user_id):
            return None
        return self._user_desktop_versions.get(user_id)

    def touch_activity(self, user_id: str) -> None:
        self._user_last_active[user_id] = datetime.now(timezone.utc)

    def update_activity(self, user_id: str, idle_seconds: int) -> None:
        if idle_seconds < AFK_AFTER_SECONDS:
            self.touch_activity(user_id)

    def get_last_active(self, user_id: str) -> datetime | None:
        return self._user_last_active.get(user_id)

    def is_afk(self, user_id: str) -> bool:
        if not self.is_online(user_id):
            return False
        last = self._user_last_active.get(user_id)
        if not last:
            return False
        return (datetime.now(timezone.utc) - last) >= timedelta(seconds=AFK_AFTER_SECONDS)

    def presence_payload(self, user_id: str) -> dict:
        last = self.get_last_active(user_id) if self.is_online(user_id) else None
        return {
            "userId": user_id,
            "isOnline": self.is_online(user_id),
            "lastActiveAt": last.isoformat() if last else None,
        }

    def is_online(self, user_id: str) -> bool:
        return bool(self.desktop_sids_for_user(user_id))

    def is_web_online(self, user_id: str) -> bool:
        return bool(self._user_sockets.get(user_id))

    def online_user_ids(self) -> set[str]:
        return {uid for uid in self._user_sockets if self.desktop_sids_for_user(uid)}

    def desktop_sids_for_user(self, user_id: str) -> list[str]:
        return [
            sid
            for sid in self._user_sockets.get(user_id, set())
            if self._socket_client_types.get(sid) == "desktop"
        ]

    def web_sids_for_user(self, user_id: str) -> list[str]:
        return [
            sid
            for sid in self._user_sockets.get(user_id, set())
            if self._socket_client_types.get(sid) == "web"
        ]


presence_manager = PresenceManager()

# Rate limiting: user_id -> list of timestamps
_send_timestamps: dict[str, list[datetime]] = defaultdict(list)
_reset_password_attempts: dict[str, list[datetime]] = defaultdict(list)
_login_attempts_ip: dict[str, list[datetime]] = defaultdict(list)
_login_attempts_user: dict[str, list[datetime]] = defaultdict(list)
_upload_timestamps: dict[str, list[datetime]] = defaultdict(list)


def check_rate_limit(user_id: str) -> bool:
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=1)
    timestamps = [t for t in _send_timestamps[user_id] if t > window_start]
    _send_timestamps[user_id] = timestamps
    if len(timestamps) >= settings.send_rate_limit:
        return False
    timestamps.append(now)
    return True


def check_reset_password_rate_limit(email: str) -> bool:
    key = email.strip().lower()
    if not key:
        return False
    now = datetime.now(timezone.utc)
    window = timedelta(minutes=settings.reset_password_attempt_window_minutes)
    window_start = now - window
    attempts = [t for t in _reset_password_attempts[key] if t > window_start]
    _reset_password_attempts[key] = attempts
    if len(attempts) >= settings.reset_password_attempt_limit:
        return False
    attempts.append(now)
    return True


def check_login_rate_limit(client_ip: str, username: str) -> bool:
    now = datetime.now(timezone.utc)
    window = timedelta(minutes=settings.login_attempt_window_minutes)
    window_start = now - window
    ip_key = client_ip or "unknown"
    user_key = username.strip().lower()

    ip_attempts = [t for t in _login_attempts_ip[ip_key] if t > window_start]
    _login_attempts_ip[ip_key] = ip_attempts
    if len(ip_attempts) >= settings.login_attempt_limit_per_ip:
        return False

    if user_key:
        user_attempts = [t for t in _login_attempts_user[user_key] if t > window_start]
        _login_attempts_user[user_key] = user_attempts
        if len(user_attempts) >= settings.login_attempt_limit_per_user:
            return False
        user_attempts.append(now)

    ip_attempts.append(now)
    return True


def check_upload_rate_limit(user_id: str) -> bool:
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=1)
    timestamps = [t for t in _upload_timestamps[user_id] if t > window_start]
    _upload_timestamps[user_id] = timestamps
    if len(timestamps) >= settings.upload_rate_limit_per_minute:
        return False
    timestamps.append(now)
    return True


async def cleanup_old_uploads() -> None:
    upload_dir = Path(settings.upload_dir)
    if not upload_dir.exists():
        return
    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.media_ttl_hours)
    for path in upload_dir.iterdir():
        if not path.is_file():
            continue
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        if mtime < cutoff:
            path.unlink(missing_ok=True)


async def cleanup_loop() -> None:
    while True:
        await cleanup_old_uploads()
        await asyncio.sleep(300)
