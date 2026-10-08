"""Integration of socket handlers with real SQL transactions and controlled peers."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import DeliveryStatus, MediaMessage, MediaType, User
from app import socket_events as events


@pytest.fixture
def protocol(monkeypatch, tmp_path):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(events, "SessionLocal", sessions)
    monkeypatch.setattr(events.settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(events, "check_rate_limit", lambda _: True)
    monkeypatch.setattr(events, "are_friends", lambda _, sender, receiver: sender == "sender" and receiver in ("alice", "bob"))
    monkeypatch.setattr(events, "is_blocked", lambda *_: False)
    peer_sessions = {"web": {"user_id": "sender", "client_type": "web"},
                     "a": {"user_id": "alice", "client_type": "desktop", "delivery_sync": 1},
                     "b": {"user_id": "bob", "client_type": "desktop", "delivery_sync": 1},
                     "outsider": {"user_id": "outsider", "client_type": "desktop"}}
    monkeypatch.setattr(events.sio, "get_session", AsyncMock(side_effect=lambda sid: peer_sessions[sid]))
    emitted = []
    async def emit(event, data, to=None):
        emitted.append((event, data, to))
    monkeypatch.setattr(events.sio, "emit", emit)
    monkeypatch.setattr(events.presence_manager, "desktop_sids_for_user", lambda uid: {"alice": ["a"], "bob": ["b"]}.get(uid, []))
    monkeypatch.setattr(events.presence_manager, "web_sids_for_user", lambda uid: ["web"] if uid == "sender" else [])
    monkeypatch.setattr(events, "_delivery_groups", {})
    monkeypatch.setattr(events, "_delivery_group_tasks", {})
    monkeypatch.setattr(events, "_batch_lock", asyncio.Lock())
    with sessions() as db:
        for uid in ("sender", "alice", "bob", "outsider"):
            db.add(User(id=uid, username=uid, email=f"{uid}@example.com", password_hash="unused"))
        db.commit()
        for mid, uid in (("ma", "alice"), ("mb", "bob")):
            db.add(MediaMessage(id=mid, sender_id="sender", receiver_id=uid, media_type=MediaType.image,
                                storage_path="/uploads/shared.png", delivery_status=DeliveryStatus.pending))
        db.commit()
    yield sessions, peer_sessions, emitted
    engine.dispose()


def batch():
    return {"messages": [{"messageId": "ma", "receiverId": "alice"}, {"messageId": "mb", "receiverId": "bob"}],
            "durationMs": 2000, "delayMs": 0}


def test_long_video_requires_capability_and_keeps_full_duration(protocol):
    sessions, peers, emitted = protocol
    with sessions() as db:
        msg = db.get(MediaMessage, "ma")
        msg.media_type = MediaType.video
        msg.media_duration_ms = 120000
        db.commit()
    data = {"messageId": "ma", "receiverId": "alice", "durationMs": 120000}
    result = asyncio.run(events._dispatch_message("web", data))
    assert result["reason"] == "desktop_update_required"
    assert not any(event == "message:deliver" for event, _, _ in emitted)
    peers["a"]["max_video_duration_ms"] = 180000
    result = asyncio.run(events._dispatch_message("web", data))
    assert result["ok"]
    assert next(data["durationMs"] for event, data, _ in emitted if event == "message:deliver") == 120000


def test_group_waits_for_slow_peer_then_uses_one_start_time(protocol):
    _, _, emitted = protocol
    async def run():
        result = await events.message_send_batch("web", batch())
        assert result["ok"] and result["synchronized"]
        deliveries = [data for event, data, _ in emitted if event == "message:deliver"]
        group_id = deliveries[0]["syncGroupId"]
        assert deliveries[1]["syncGroupId"] == group_id
        await events.message_ready("outsider", {"groupId": group_id, "messageId": "ma"})
        await events.message_ready("a", {"groupId": group_id, "messageId": "ma"})
        assert not any(event == "message:start" for event, _, _ in emitted)
        await events.message_ready("b", {"groupId": group_id, "messageId": "mb"})
        starts = [(data, sid) for event, data, sid in emitted if event == "message:start"]
        assert len(starts) == 2
        assert starts[0][0]["startAt"] == starts[1][0]["startAt"]
        await events.message_ready("b", {"groupId": group_id, "messageId": "mb"})
        assert len([event for event, _, _ in emitted if event == "message:start"]) == 2
        assert not events._delivery_groups
    asyncio.run(run())


def test_legacy_desktop_does_not_wait_for_new_protocol(protocol):
    _, peers, emitted = protocol
    peers["b"].pop("delivery_sync")
    result = asyncio.run(events.message_send_batch("web", batch()))
    assert result["ok"] and not result["synchronized"]
    assert all("syncGroupId" not in data for event, data, _ in emitted if event == "message:deliver")
    assert not events._delivery_groups


def test_timeout_starts_ready_peer_and_fails_unresponsive_peer(protocol):
    sessions, _, emitted = protocol
    async def run():
        await events.message_send_batch("web", batch())
        group_id = next(iter(events._delivery_groups))
        await events.message_ready("a", {"groupId": group_id, "messageId": "ma"})
        await events._start_delivery_group(group_id, timeout=True)
        assert [sid for event, _, sid in emitted if event == "message:start"] == ["a"]
        assert any(event == "message:revoke" and sid == "b" for event, _, sid in emitted)
        with sessions() as db:
            assert db.get(MediaMessage, "mb").delivery_status == DeliveryStatus.failed
            assert db.get(MediaMessage, "ma").delivery_status == DeliveryStatus.pending
    asyncio.run(run())


def test_cancel_during_preparation_unblocks_other_peer(protocol):
    _, _, emitted = protocol
    async def run():
        await events.message_send_batch("web", batch())
        group_id = next(iter(events._delivery_groups))
        await events.message_ready("a", {"groupId": group_id, "messageId": "ma"})
        await events.message_cancel("web", {"messageId": "mb"})
        assert [sid for event, _, sid in emitted if event == "message:start"] == ["a"]
        assert not events._delivery_groups
    asyncio.run(run())


def test_immediate_ack_is_not_overwritten_by_dispatch(protocol, monkeypatch):
    sessions, _, emitted = protocol
    async def emit(event, data, to=None):
        emitted.append((event, data, to))
        if event == "message:deliver":
            await events.message_ack(to, {"messageId": data["messageId"], "status": "delivered"})
    monkeypatch.setattr(events.sio, "emit", emit)
    asyncio.run(events.message_send("web", {"messageId": "ma", "receiverId": "alice"}))
    with sessions() as db:
        assert db.get(MediaMessage, "ma").delivery_status == DeliveryStatus.delivered


def test_duplicate_send_does_not_requeue(protocol):
    _, _, emitted = protocol
    async def run():
        data = {"messageId": "ma", "receiverId": "alice"}
        await events.message_send("web", data)
        await events.message_send("web", data)
        assert len([event for event, _, _ in emitted if event == "message:deliver"]) == 1
    asyncio.run(run())


def test_unauthorized_sender_and_duplicate_receiver_rejected(protocol):
    _, _, emitted = protocol
    async def run():
        result = await events.message_send_batch("outsider", batch())
        assert not result["ok"]
        assert not any(event == "message:deliver" for event, _, _ in emitted)
        invalid = batch()
        invalid["messages"][1]["receiverId"] = "alice"
        result = await events.message_send_batch("web", invalid)
        assert result["reason"] == "invalid_payload"
    asyncio.run(run())
