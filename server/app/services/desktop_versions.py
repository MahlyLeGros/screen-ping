"""Desktop version catalog — stepwise updates (N → N+1) instead of jumping to latest."""

from __future__ import annotations

import json
from pathlib import Path

_DESKTOP_DIR = Path(__file__).resolve().parent.parent / "desktop"
_VERSIONS_PATH = _DESKTOP_DIR / "versions.json"
_LATEST_PATH = _DESKTOP_DIR / "latest.json"

UPDATES_BASE = "https://screenping.xyz/desktop/updates"


def parse_version(version: str) -> tuple[int, int, int]:
    cleaned = version.lstrip("vV").strip()
    parts = cleaned.split(".")
    nums = []
    for i in range(3):
        try:
            nums.append(int(parts[i]) if i < len(parts) else 0)
        except ValueError:
            nums.append(0)
    return nums[0], nums[1], nums[2]


def is_version_older(current: str, other: str) -> bool:
    return parse_version(current) < parse_version(other)


def installer_name(version: str) -> str:
    return f"Screen Ping Setup {version}.exe"


def installer_url(version: str) -> str:
    from urllib.parse import quote

    return f"{UPDATES_BASE}/{quote(installer_name(version))}"


def feed_url_for_version(version: str) -> str:
    return f"{UPDATES_BASE}/v/{version}/"


def load_versions() -> list[str]:
    if not _VERSIONS_PATH.is_file():
        latest = load_latest_meta()
        ver = latest.get("version")
        return [ver] if ver else []
    try:
        data = json.loads(_VERSIONS_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    versions = [str(v).strip() for v in data if str(v).strip()]
    return sorted(set(versions), key=parse_version)


def load_latest_meta() -> dict[str, str]:
    if _LATEST_PATH.is_file():
        try:
            data = json.loads(_LATEST_PATH.read_text(encoding="utf-8-sig"))
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        except (OSError, json.JSONDecodeError):
            pass
    return {
        "version": "1.0.3",
        "download_url": installer_url("1.0.3"),
        "update_protocol": "screenping://update",
    }


def next_version(from_version: str) -> str | None:
    """Return the next published version after `from_version`, or None if up to date."""
    versions = load_versions()
    if not versions:
        latest = load_latest_meta().get("version")
        if latest and is_version_older(from_version, latest):
            return latest
        return None
    newer = [v for v in versions if is_version_older(from_version, v)]
    return newer[0] if newer else None


def absolute_latest() -> str | None:
    versions = load_versions()
    if versions:
        return versions[-1]
    return load_latest_meta().get("version")


def next_update_payload(from_version: str) -> dict:
    latest = absolute_latest() or load_latest_meta().get("version", "")
    nxt = next_version(from_version)
    payload: dict = {
        "from": from_version,
        "latest": latest,
        "next": nxt,
        "versions": load_versions(),
    }
    if nxt:
        payload["download_url"] = installer_url(nxt)
        payload["feed_url"] = feed_url_for_version(nxt)
        payload["version"] = nxt
    else:
        payload["download_url"] = installer_url(latest) if latest else load_latest_meta().get("download_url", "")
        payload["version"] = latest
    return payload
