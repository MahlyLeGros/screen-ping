import asyncio

import socketio
from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.auth import decode_token
from app.database import SessionLocal
from app.models import DeliveryStatus, MediaMessage, User
from app.models import utcnow
from app.realtime import check_rate_limit, presence_manager
from app.services.friends import are_friends, is_blocked
from app.services.pending import (
    ensure_pending_capacity,
    find_stale_dispatched_pending,
    mark_message_failed,
)
from app.config import settings
from app.services.ping_limits import sanitize_delivery_options
from app.services.media_access import release_media_for_message, sign_media_url
from app.services.draw import (
    DRAW_MIN_INTERVAL_MS,
    discard_pending_stroke,
    end_session,
    get_session,
    queue_stroke_packet,
    register_session,
    resolve_stroke_duration,
    sanitize_color,
    sanitize_draw_start,
    sanitize_points,
    sanitize_receiver_ids,
    sanitize_stroke_id,
    sanitize_stroke_width,
    sessions_for_sender,
    take_pending_stroke,
)

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=settings.cors_origin_list)


async def _emit_draw_to_receivers(receiver_ids: list[str], event: str, payload: dict) -> list[str]:
    """Relay a draw event to desktop sockets. Returns ids that were online."""
    delivered: list[str] = []
    for receiver_id in receiver_ids:
        desktop_sids = presence_manager.desktop_sids_for_user(receiver_id)
        if not desktop_sids:
            continue
        for dsid in desktop_sids:
            await sio.emit(event, payload, to=dsid)
        delivered.append(receiver_id)
    return delivered


async def _authorize_draw_targets(db: Session, sender_id: str, receiver_ids: list[str]) -> list[str]:
    allowed: list[str] = []
    for receiver_id in receiver_ids:
        if is_blocked(db, sender_id, receiver_id):
            continue
        if sender_id != receiver_id and not are_friends(db, sender_id, receiver_id):
            continue
        allowed.append(receiver_id)
    return allowed


@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get("token")
    client_type = (auth or {}).get("client_type", "web")
    app_version = (auth or {}).get("app_version")
    if not token:
        return False
    try:
        payload = decode_token(token, expected_type="access")
        user_id = payload["sub"]
    except Exception:
        return False

    db: Session = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return False
        if payload.get("tv", 0) != int(getattr(user, "token_version", 0) or 0):
            return False
        presence_manager.connect(user_id, sid, client_type, app_version)
        await _broadcast_presence(db, user_id)
        if client_type == "web":
            await _sync_friend_presence_for(db, user_id, sid)
            await sio.emit(
                "presence:update",
                presence_manager.presence_payload(user_id),
                to=sid,
            )
    finally:
        db.close()
    await sio.save_session(sid, {"user_id": user_id, "client_type": client_type})
    return True


@sio.event
async def disconnect(sid):
    user_id = presence_manager.disconnect(sid)
    if user_id:
        db: Session = SessionLocal()
        try:
            await _broadcast_presence(db, user_id)
        finally:
            db.close()


async def _sync_friend_presence_for(db: Session, user_id: str, sid: str) -> None:
    """Push current online status for all accepted friends to one socket (e.g. on web connect)."""
    from app.models import Friendship, FriendshipStatus

    friendships = (
        db.query(Friendship)
        .filter(
            and_(
                or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
                Friendship.status == FriendshipStatus.accepted,
            )
        )
        .all()
    )
    for f in friendships:
        friend_id = f.addressee_id if f.requester_id == user_id else f.requester_id
        await sio.emit(
            "presence:update",
            presence_manager.presence_payload(friend_id),
            to=sid,
        )


async def _broadcast_presence(db: Session, user_id: str):
    from app.models import Friendship, FriendshipStatus, User

    friendships = (
        db.query(Friendship)
        .filter(
            and_(
                or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
                Friendship.status == FriendshipStatus.accepted,
            )
        )
        .all()
    )
    payload = presence_manager.presence_payload(user_id)
    targets: set[str] = set(presence_manager.web_sids_for_user(user_id))
    for f in friendships:
        friend_id = f.addressee_id if f.requester_id == user_id else f.requester_id
        targets.update(presence_manager.web_sids_for_user(friend_id))
        targets.update(presence_manager.desktop_sids_for_user(friend_id))
    for sid in targets:
        await sio.emit("presence:update", payload, to=sid)


async def _broadcast_presence_activity(db: Session, user_id: str) -> None:
    await _broadcast_presence(db, user_id)


async def emit_friends_update(user_ids: list[str], payload: dict) -> None:
    """Push a friends-list change to every web and desktop socket of the involved users."""
    sids: set[str] = set()
    for uid in user_ids:
        sids.update(presence_manager.web_sids_for_user(uid))
        sids.update(presence_manager.desktop_sids_for_user(uid))
    for sid in sids:
        await sio.emit("friends:update", payload, to=sid)


@sio.on("presence:heartbeat")
async def presence_heartbeat(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    client_type = session.get("client_type")
    if not user_id or client_type != "desktop":
        return
    idle_seconds = int(data.get("idleSeconds", 0) or 0)
    was_afk = presence_manager.is_afk(user_id)
    presence_manager.update_activity(user_id, idle_seconds)
    if presence_manager.is_afk(user_id) != was_afk:
        db: Session = SessionLocal()
        try:
            await _broadcast_presence_activity(db, user_id)
        finally:
            db.close()


@sio.on("desktop:update-request")
async def desktop_update_request(sid, _data):
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    client_type = session.get("client_type")
    if not user_id or client_type != "web":
        return

    desktop_sids = presence_manager.desktop_sids_for_user(user_id)
    if not desktop_sids:
        await sio.emit("desktop:update-result", {"ok": False, "reason": "desktop_offline"}, to=sid)
        return

    for dsid in desktop_sids:
        await sio.emit("desktop:update-check", {}, to=dsid)
    await sio.emit("desktop:update-result", {"ok": True}, to=sid)


@sio.on("message:send")
async def message_send(sid, data):
    session = await sio.get_session(sid)
    sender_id = session.get("user_id")
    receiver_id = data.get("receiverId")
    message_id = data.get("messageId")
    options = sanitize_delivery_options(data)
    if not sender_id or not receiver_id or not message_id:
        await sio.emit("message:result", {"messageId": message_id, "status": "failed", "reason": "invalid_payload"}, to=sid)
        return

    if not check_rate_limit(sender_id):
        await sio.emit("message:result", {"messageId": message_id, "status": "failed", "reason": "rate_limited"}, to=sid)
        return

    db: Session = SessionLocal()
    try:
        if is_blocked(db, sender_id, receiver_id):
            await sio.emit("message:result", {"messageId": message_id, "status": "failed", "reason": "blocked"}, to=sid)
            return
        if sender_id != receiver_id and not are_friends(db, sender_id, receiver_id):
            await sio.emit("message:result", {"messageId": message_id, "status": "failed", "reason": "not_friends"}, to=sid)
            return

        message = db.get(MediaMessage, message_id)
        if not message or message.sender_id != sender_id or message.receiver_id != receiver_id:
            await sio.emit("message:result", {"messageId": message_id, "status": "failed", "reason": "message_not_found"}, to=sid)
            return

        if message.delivery_status in (DeliveryStatus.delivered, DeliveryStatus.failed):
            await sio.emit("message:result", {"messageId": message_id, "status": "failed", "reason": "already_sent"}, to=sid)
            return

        desktop_sids = presence_manager.desktop_sids_for_user(receiver_id)
        if not desktop_sids:
            message.delivery_status = DeliveryStatus.offline
            db.commit()
            await sio.emit("message:result", {"messageId": message_id, "status": "offline"}, to=sid)
            return

        try:
            ensure_pending_capacity(db, receiver_id, exclude_message_id=message_id)
        except HTTPException:
            await sio.emit(
                "message:result",
                {"messageId": message_id, "status": "failed", "reason": "too_many_pending"},
                to=sid,
            )
            return

        paths = [p for p in (message.storage_path, message.audio_path) if p]
        payload = {
            "messageId": message.id,
            "fromUserId": sender_id,
            "mediaType": message.media_type.value,
            "mediaUrl": sign_media_url(message.storage_path, receiver_id, paths),
            "audioUrl": sign_media_url(message.audio_path, receiver_id, paths),
            "caption": message.caption,
            "durationMs": options["durationMs"],
            "delayMs": options["delayMs"],
            "audioDelayMs": options["audioDelayMs"],
            "fadeInMs": options["fadeInMs"],
            "fadeOutMs": options["fadeOutMs"],
            "layout": options["layout"],
            "captionLayout": options["captionLayout"],
        }
        for dsid in desktop_sids:
            await sio.emit("message:deliver", payload, to=dsid)
        message.delivery_status = DeliveryStatus.pending
        message.dispatched_at = utcnow()
        db.commit()
    finally:
        db.close()


async def _notify_sender_result(message: MediaMessage, *, reason: str | None = None) -> None:
    payload: dict = {"messageId": message.id, "status": message.delivery_status.value}
    if reason:
        payload["reason"] = reason
    for wsid in presence_manager.web_sids_for_user(message.sender_id):
        await sio.emit("message:result", payload, to=wsid)


async def _revoke_on_receiver(message: MediaMessage) -> None:
    for dsid in presence_manager.desktop_sids_for_user(message.receiver_id):
        await sio.emit("message:revoke", {"messageId": message.id}, to=dsid)


@sio.on("message:cancel")
async def message_cancel(sid, data):
    session = await sio.get_session(sid)
    sender_id = session.get("user_id")
    message_id = data.get("messageId") if isinstance(data, dict) else None
    if not sender_id or not message_id:
        await sio.emit(
            "message:result",
            {"messageId": message_id, "status": "failed", "reason": "invalid_payload"},
            to=sid,
        )
        return

    db: Session = SessionLocal()
    try:
        message = db.get(MediaMessage, message_id)
        if not message or message.sender_id != sender_id:
            await sio.emit(
                "message:result",
                {"messageId": message_id, "status": "failed", "reason": "message_not_found"},
                to=sid,
            )
            return
        if message.delivery_status == DeliveryStatus.failed:
            await sio.emit(
                "message:result",
                {"messageId": message_id, "status": "failed", "reason": "cancelled"},
                to=sid,
            )
            return
        if not mark_message_failed(db, message):
            await sio.emit(
                "message:result",
                {"messageId": message_id, "status": message.delivery_status.value, "reason": "not_cancellable"},
                to=sid,
            )
            return
        await _revoke_on_receiver(message)
        await _notify_sender_result(message, reason="cancelled")
    finally:
        db.close()


@sio.on("message:ack")
async def message_ack(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    message_id = data.get("messageId")
    status_value = data.get("status", "delivered")

    db: Session = SessionLocal()
    try:
        message = db.get(MediaMessage, message_id)
        if not message or message.receiver_id != user_id:
            return
        # Already cancelled / timed out / delivered — ignore late desktop acks.
        if message.delivery_status in (DeliveryStatus.delivered, DeliveryStatus.failed):
            return
        presence_manager.touch_activity(user_id)
        if status_value == "paused":
            message.delivery_status = DeliveryStatus.paused
        elif status_value == "failed":
            message.delivery_status = DeliveryStatus.failed
        else:
            message.delivery_status = DeliveryStatus.delivered
        db.commit()
        if message.delivery_status in (DeliveryStatus.delivered, DeliveryStatus.failed):
            release_media_for_message(db, message)

        await _notify_sender_result(message)
    finally:
        db.close()


async def expire_stale_pending_pings() -> int:
    """Fail dispatched pendings past TTL; notify sender + revoke on receiver. Returns count."""
    db: Session = SessionLocal()
    expired: list[tuple[str, str, str]] = []  # message_id, sender_id, receiver_id
    try:
        stale = find_stale_dispatched_pending(db)
        for message in stale:
            sender_id = message.sender_id
            receiver_id = message.receiver_id
            message_id = message.id
            if mark_message_failed(db, message):
                expired.append((message_id, sender_id, receiver_id))
    finally:
        db.close()

    for message_id, sender_id, receiver_id in expired:
        for dsid in presence_manager.desktop_sids_for_user(receiver_id):
            await sio.emit("message:revoke", {"messageId": message_id}, to=dsid)
        payload = {"messageId": message_id, "status": "failed", "reason": "timeout"}
        for wsid in presence_manager.web_sids_for_user(sender_id):
            await sio.emit("message:result", payload, to=wsid)
    return len(expired)


async def pending_expire_loop() -> None:
    while True:
        try:
            await expire_stale_pending_pings()
        except Exception:
            pass
        await asyncio.sleep(10)


@sio.on("draw:start")
async def draw_start(sid, data):
    session = await sio.get_session(sid)
    sender_id = session.get("user_id")
    if not sender_id or not isinstance(data, dict):
        await sio.emit("draw:result", {"ok": False, "reason": "invalid_payload"}, to=sid)
        return

    parsed = sanitize_draw_start(data)
    if not parsed:
        await sio.emit("draw:result", {"ok": False, "reason": "invalid_payload"}, to=sid)
        return

    db: Session = SessionLocal()
    try:
        allowed = await _authorize_draw_targets(db, sender_id, parsed["receiverIds"])
    finally:
        db.close()

    if not allowed:
        await sio.emit("draw:result", {"ok": False, "reason": "no_targets"}, to=sid)
        return

    # One active session per sender — end previous ones.
    for old_id in sessions_for_sender(sender_id):
        old = end_session(old_id)
        if old:
            await _emit_draw_to_receivers(
                old["receiverIds"],
                "draw:end",
                {"sessionId": old_id, "fromUserId": sender_id},
            )

    register_session(parsed["sessionId"], sender_id, allowed, parsed["durationMs"])
    payload = {
        "sessionId": parsed["sessionId"],
        "fromUserId": sender_id,
        "durationMs": parsed["durationMs"],
        "color": parsed["color"],
        "width": parsed["width"],
    }
    online = await _emit_draw_to_receivers(allowed, "draw:begin", payload)
    await sio.emit(
        "draw:result",
        {
            "ok": True,
            "action": "start",
            "sessionId": parsed["sessionId"],
            "receiverIds": allowed,
            "onlineIds": online,
        },
        to=sid,
    )


_draw_flush_tasks: dict[str, asyncio.Task] = {}


async def _emit_draw_stroke_packet(sender_id: str, packet: dict) -> None:
    await _emit_draw_to_receivers(
        packet["receiverIds"],
        "draw:stroke",
        {
            "sessionId": packet["sessionId"],
            "fromUserId": sender_id,
            "points": packet["points"],
            "color": packet["color"],
            "width": packet["width"],
            "durationMs": packet["durationMs"],
            "strokeId": packet.get("strokeId"),
        },
    )


async def _flush_pending_draw_stroke(sender_id: str) -> None:
    try:
        await asyncio.sleep(DRAW_MIN_INTERVAL_MS / 1000)
        packet = take_pending_stroke(sender_id)
        if packet:
            await _emit_draw_stroke_packet(sender_id, packet)
    finally:
        _draw_flush_tasks.pop(sender_id, None)


def _schedule_draw_flush(sender_id: str) -> None:
    existing = _draw_flush_tasks.get(sender_id)
    if existing and not existing.done():
        return
    _draw_flush_tasks[sender_id] = asyncio.create_task(_flush_pending_draw_stroke(sender_id))


@sio.on("draw:stroke")
async def draw_stroke(sid, data):
    session = await sio.get_session(sid)
    sender_id = session.get("user_id")
    if not sender_id or not isinstance(data, dict):
        return

    session_id = data.get("sessionId")
    if not isinstance(session_id, str) or not session_id.strip():
        return
    session_id = session_id.strip()
    meta = get_session(session_id)
    if not meta or meta.get("senderId") != sender_id:
        return

    points = sanitize_points(data.get("points"))
    if len(points) < 1:
        return

    receiver_ids = sanitize_receiver_ids(data.get("receiverIds")) or list(meta["receiverIds"])
    receiver_ids = [rid for rid in receiver_ids if rid in meta["receiverIds"]]
    if not receiver_ids:
        return

    packet = {
        "sessionId": session_id,
        "receiverIds": receiver_ids,
        "points": points,
        "color": sanitize_color(data.get("color")),
        "width": sanitize_stroke_width(data.get("width")),
        "durationMs": resolve_stroke_duration(data, meta),
        "strokeId": sanitize_stroke_id(data.get("strokeId")),
    }
    ready = queue_stroke_packet(sender_id, packet)
    if ready:
        await _emit_draw_stroke_packet(sender_id, ready)
        return
    _schedule_draw_flush(sender_id)


@sio.on("draw:clear")
async def draw_clear(sid, data):
    session = await sio.get_session(sid)
    sender_id = session.get("user_id")
    if not sender_id or not isinstance(data, dict):
        return

    session_id = data.get("sessionId")
    if not isinstance(session_id, str) or not session_id.strip():
        return
    session_id = session_id.strip()
    meta = get_session(session_id)
    if not meta or meta.get("senderId") != sender_id:
        return

    discard_pending_stroke(sender_id)
    receiver_ids = sanitize_receiver_ids(data.get("receiverIds")) or list(meta["receiverIds"])
    receiver_ids = [rid for rid in receiver_ids if rid in meta["receiverIds"]]
    await _emit_draw_to_receivers(
        receiver_ids,
        "draw:clear",
        {"sessionId": session_id, "fromUserId": sender_id},
    )


@sio.on("draw:end")
async def draw_end(sid, data):
    session = await sio.get_session(sid)
    sender_id = session.get("user_id")
    if not sender_id or not isinstance(data, dict):
        return

    session_id = data.get("sessionId")
    if not isinstance(session_id, str) or not session_id.strip():
        return
    session_id = session_id.strip()
    meta = end_session(session_id)
    if not meta or meta.get("senderId") != sender_id:
        return

    leftover = take_pending_stroke(sender_id)
    if leftover:
        await _emit_draw_stroke_packet(sender_id, leftover)

    await _emit_draw_to_receivers(
        list(meta["receiverIds"]),
        "draw:end",
        {"sessionId": session_id, "fromUserId": sender_id},
    )
    await sio.emit(
        "draw:result",
        {"ok": True, "action": "end", "sessionId": session_id},
        to=sid,
    )