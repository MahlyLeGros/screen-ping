import asyncio
from unittest.mock import AsyncMock, MagicMock

from app import socket_events as events
from app.services import draw


def test_live_targets_add_remove_pause_and_resume(monkeypatch):
    monkeypatch.setattr(draw, "_active_sessions", {})
    monkeypatch.setattr(draw, "_pending_strokes", {})
    monkeypatch.setattr(events.sio, "get_session", AsyncMock(return_value={"user_id": "sender"}))
    monkeypatch.setattr(events.sio, "emit", AsyncMock())
    monkeypatch.setattr(events, "SessionLocal", MagicMock())
    monkeypatch.setattr(events, "_authorize_draw_targets", AsyncMock(side_effect=lambda db, sender, ids: [i for i in ids if i != "blocked"]))
    monkeypatch.setattr(events.presence_manager, "desktop_sids_for_user", lambda uid: [uid])
    emit = AsyncMock(return_value=[])
    monkeypatch.setattr(events, "_emit_draw_to_receivers", emit)
    draw.register_session("live", "sender", ["alice"])
    original = draw.get_session("live")

    async def update(ids):
        emit.reset_mock()
        await events.draw_start("web", {"sessionId": "live", "receiverIds": ids})
        assert draw.get_session("live") is original
        return [(call.args[0], call.args[1]) for call in emit.call_args_list if call.args[0]]

    assert asyncio.run(update(["alice", "bob", "blocked"])) == [(["bob"], "draw:begin")]
    assert original["receiverIds"] == ["alice", "bob"]
    assert asyncio.run(update(["bob"])) == [(["alice"], "draw:end")]
    assert asyncio.run(update([])) == [(["bob"], "draw:end")]
    assert asyncio.run(update(["alice"])) == [(["alice"], "draw:begin")]


def test_cannot_update_another_senders_session(monkeypatch):
    monkeypatch.setattr(draw, "_active_sessions", {})
    draw.register_session("private", "owner", ["alice"])
    monkeypatch.setattr(events.sio, "get_session", AsyncMock(return_value={"user_id": "other"}))
    monkeypatch.setattr(events.sio, "emit", AsyncMock())
    asyncio.run(events.draw_start("web", {"sessionId": "private", "receiverIds": ["other"]}))
    assert draw.get_session("private")["receiverIds"] == ["alice"]
