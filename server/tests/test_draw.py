from app.services.draw import (
    discard_pending_stroke,
    queue_stroke_packet,
    register_session,
    resolve_stroke_duration,
    sanitize_color,
    sanitize_draw_start,
    sanitize_duration_ms,
    sanitize_points,
    sanitize_stroke_id,
    sanitize_stroke_width,
    take_pending_stroke,
)


def test_sanitize_color():
    assert sanitize_color("#A78BFA") == "#a78bfa"
    assert sanitize_color("#fff") == "#ffffff"
    assert sanitize_color("nope") == "#a78bfa"


def test_sanitize_points_clamps():
    points = sanitize_points([{"x": -5, "y": 50}, {"x": 150, "y": 20}, {"x": "bad"}])
    assert points == [{"x": 0.0, "y": 50.0}, {"x": 100.0, "y": 20.0}]


def test_sanitize_points_relays_timestamp():
    points = sanitize_points(
        [
            {"x": 10, "y": 20, "t": 1_700_000_000_123.7},
            {"x": 30, "y": 40, "t": "nope"},
            {"x": 50, "y": 60},
        ]
    )
    assert points[0]["t"] == 1_700_000_000_123.0
    assert "t" not in points[1]
    assert "t" not in points[2]


def test_sanitize_points_rejects_absurd_timestamp():
    points = sanitize_points([{"x": 1, "y": 2, "t": -1}, {"x": 3, "y": 4, "t": 1e20}])
    assert "t" not in points[0]
    assert "t" not in points[1]


def test_sanitize_draw_start():
    parsed = sanitize_draw_start(
        {
            "receiverIds": ["a", "a", "b"],
            "durationMs": 999999,
            "color": "#22d3ee",
            "width": 99,
        }
    )
    assert parsed is not None
    assert parsed["receiverIds"] == ["a", "b"]
    assert parsed["durationMs"] == 30_000
    assert parsed["color"] == "#22d3ee"
    assert parsed["width"] == 8.0
    assert sanitize_stroke_width(0.01) == 0.15


def test_sanitize_duration_ms_clamps():
    assert sanitize_duration_ms(5400) == 5400
    assert sanitize_duration_ms(999999) == 30_000
    assert sanitize_duration_ms(None) == 3000


def test_resolve_stroke_duration_updates_session():
    register_session("sid", "sender", ["recv"], 3000)
    from app.services.draw import get_session

    session = get_session("sid")
    assert session is not None
    assert resolve_stroke_duration({"durationMs": 5400}, session) == 5400
    assert session["durationMs"] == 5400
    assert resolve_stroke_duration({}, session) == 5400


def test_sanitize_stroke_id():
    assert sanitize_stroke_id("abc") == "abc"
    assert sanitize_stroke_id("  ") is None
    assert sanitize_stroke_id(None) is None
    assert len(sanitize_stroke_id("x" * 80) or "") == 64


def test_queue_stroke_coalesces_when_rate_limited():
    discard_pending_stroke("drawer-1")
    base = {
        "sessionId": "s1",
        "strokeId": "stroke-a",
        "color": "#ffffff",
        "width": 1.0,
        "durationMs": 3000,
        "receiverIds": ["recv"],
    }
    first = queue_stroke_packet("drawer-1", {**base, "points": [{"x": 1.0, "y": 1.0}]})
    assert first is not None
    assert first["points"] == [{"x": 1.0, "y": 1.0}]
    held = queue_stroke_packet("drawer-1", {**base, "points": [{"x": 2.0, "y": 2.0}]})
    assert held is None
    pending = take_pending_stroke("drawer-1")
    assert pending is not None
    assert pending["points"] == [{"x": 2.0, "y": 2.0}]


def test_queue_stroke_flushes_previous_when_stroke_changes():
    discard_pending_stroke("drawer-2")
    base = {
        "sessionId": "s2",
        "color": "#ffffff",
        "width": 1.0,
        "durationMs": 3000,
        "receiverIds": ["recv"],
    }
    first = queue_stroke_packet(
        "drawer-2", {**base, "strokeId": "a", "points": [{"x": 1.0, "y": 1.0}]}
    )
    assert first is not None
    held = queue_stroke_packet(
        "drawer-2", {**base, "strokeId": "a", "points": [{"x": 2.0, "y": 2.0}]}
    )
    assert held is None
    ready = queue_stroke_packet(
        "drawer-2", {**base, "strokeId": "b", "points": [{"x": 9.0, "y": 9.0}]}
    )
    assert ready is not None
    assert ready["strokeId"] == "a"
    assert ready["points"] == [{"x": 2.0, "y": 2.0}]
    leftover = take_pending_stroke("drawer-2")
    assert leftover is not None
    assert leftover["strokeId"] == "b"

