"""Live draw session helpers — ephemeral, no DB."""

from __future__ import annotations

import time
import uuid
from typing import Any

from app.services.ping_limits import MIN_DURATION_MS, MAX_DURATION_MS, DEFAULT_DURATION_MS, clamp_ms

# ~60 stroke events/sec per sender; extra points are coalesced instead of dropped
DRAW_MIN_INTERVAL_MS = 16
MAX_POINTS_PER_EVENT = 128
MAX_PENDING_POINTS = 256
MAX_RECEIVERS = 8
MIN_STROKE_WIDTH = 0.15
MAX_STROKE_WIDTH = 8.0
DEFAULT_STROKE_WIDTH = 0.8
DEFAULT_COLOR = "#a78bfa"

_last_stroke_at: dict[str, float] = {}
_pending_strokes: dict[str, dict[str, Any]] = {}
_active_sessions: dict[str, dict[str, Any]] = {}


def new_session_id() -> str:
    return str(uuid.uuid4())


def sanitize_color(raw: Any) -> str:
    if not isinstance(raw, str):
        return DEFAULT_COLOR
    text = raw.strip()
    if len(text) == 7 and text.startswith("#"):
        hex_part = text[1:]
        if all(c in "0123456789abcdefABCDEF" for c in hex_part):
            return f"#{hex_part.lower()}"
    if len(text) == 4 and text.startswith("#"):
        hex_part = text[1:]
        if all(c in "0123456789abcdefABCDEF" for c in hex_part):
            return f"#{hex_part[0]}{hex_part[0]}{hex_part[1]}{hex_part[1]}{hex_part[2]}{hex_part[2]}".lower()
    return DEFAULT_COLOR


def sanitize_stroke_width(raw: Any) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = DEFAULT_STROKE_WIDTH
    return max(MIN_STROKE_WIDTH, min(value, MAX_STROKE_WIDTH))


def sanitize_points(raw: Any) -> list[dict[str, float]]:
    if not isinstance(raw, list):
        return []
    points: list[dict[str, float]] = []
    for item in raw[:MAX_POINTS_PER_EVENT]:
        if not isinstance(item, dict):
            continue
        try:
            x = float(item.get("x"))
            y = float(item.get("y"))
        except (TypeError, ValueError):
            continue
        if not (x == x and y == y):  # NaN check
            continue
        point: dict[str, float] = {
            "x": max(0.0, min(100.0, x)),
            "y": max(0.0, min(100.0, y)),
        }
        raw_t = item.get("t")
        if raw_t is not None:
            try:
                t = float(raw_t)
            except (TypeError, ValueError):
                t = None
            else:
                if t == t and 0.0 <= t <= 1e15:  # NaN / absurd guard
                    point["t"] = float(int(t))
        points.append(point)
    return points


def sanitize_receiver_ids(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        rid = item.strip()
        if not rid or rid in seen:
            continue
        seen.add(rid)
        out.append(rid)
        if len(out) >= MAX_RECEIVERS:
            break
    return out


def sanitize_stroke_id(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    text = raw.strip()[:64]
    return text or None


def sanitize_duration_ms(raw: Any, default: int = DEFAULT_DURATION_MS) -> int:
    return clamp_ms(raw, default, min_ms=MIN_DURATION_MS, max_ms=MAX_DURATION_MS)


def sanitize_draw_start(data: dict[str, Any]) -> dict[str, Any] | None:
    receiver_ids = sanitize_receiver_ids(data.get("receiverIds"))
    if not receiver_ids:
        return None
    session_id = data.get("sessionId")
    if not isinstance(session_id, str) or not session_id.strip():
        session_id = new_session_id()
    else:
        session_id = session_id.strip()[:64]
    return {
        "sessionId": session_id,
        "receiverIds": receiver_ids,
        "durationMs": sanitize_duration_ms(data.get("durationMs")),
        "color": sanitize_color(data.get("color")),
        "width": sanitize_stroke_width(data.get("width")),
    }


def allow_stroke_rate(user_id: str) -> bool:
    now = time.monotonic()
    last = _last_stroke_at.get(user_id, 0.0)
    if (now - last) * 1000 < DRAW_MIN_INTERVAL_MS:
        return False
    _last_stroke_at[user_id] = now
    return True


def take_pending_stroke(user_id: str) -> dict[str, Any] | None:
    packet = _pending_strokes.pop(user_id, None)
    if not packet:
        return None
    packet["points"] = packet["points"][:MAX_POINTS_PER_EVENT]
    return packet


def discard_pending_stroke(user_id: str) -> None:
    _pending_strokes.pop(user_id, None)


def queue_stroke_packet(user_id: str, packet: dict[str, Any]) -> dict[str, Any] | None:
    """Coalesce rate-limited packets so fast strokes stay connected."""
    existing = _pending_strokes.get(user_id)
    incoming_points = list(packet["points"])
    if existing:
        same_stroke = existing.get("sessionId") == packet.get("sessionId") and existing.get(
            "strokeId"
        ) == packet.get("strokeId")
        if same_stroke:
            existing["points"].extend(incoming_points)
            if len(existing["points"]) > MAX_PENDING_POINTS:
                existing["points"] = existing["points"][-MAX_PENDING_POINTS:]
            existing["color"] = packet["color"]
            existing["width"] = packet["width"]
            existing["durationMs"] = packet["durationMs"]
            existing["receiverIds"] = packet["receiverIds"]
        else:
            ready = existing
            _pending_strokes[user_id] = {**packet, "points": incoming_points}
            ready["points"] = ready["points"][:MAX_POINTS_PER_EVENT]
            _last_stroke_at[user_id] = time.monotonic()
            return ready
    else:
        _pending_strokes[user_id] = {**packet, "points": incoming_points}

    if not allow_stroke_rate(user_id):
        return None
    return take_pending_stroke(user_id)


def register_session(
    session_id: str,
    sender_id: str,
    receiver_ids: list[str],
    duration_ms: int = DEFAULT_DURATION_MS,
) -> None:
    _active_sessions[session_id] = {
        "senderId": sender_id,
        "receiverIds": list(receiver_ids),
        "durationMs": duration_ms,
        "startedAt": time.monotonic(),
    }


def resolve_stroke_duration(data: dict[str, Any], session: dict[str, Any]) -> int:
    default = int(session.get("durationMs") or DEFAULT_DURATION_MS)
    duration_ms = sanitize_duration_ms(data.get("durationMs"), default)
    session["durationMs"] = duration_ms
    return duration_ms


def get_session(session_id: str) -> dict[str, Any] | None:
    return _active_sessions.get(session_id)


def end_session(session_id: str) -> dict[str, Any] | None:
    return _active_sessions.pop(session_id, None)


def sessions_for_sender(sender_id: str) -> list[str]:
    return [sid for sid, meta in _active_sessions.items() if meta.get("senderId") == sender_id]
