from app.services.desktop_versions import is_version_older, next_version, next_update_payload


def test_next_version_steps_one_at_a_time(tmp_path, monkeypatch):
    catalog = tmp_path / "versions.json"
    catalog.write_text('["1.0.58","1.0.59","1.0.60"]', encoding="utf-8")
    monkeypatch.setattr("app.services.desktop_versions._VERSIONS_PATH", catalog)
    monkeypatch.setattr(
        "app.services.desktop_versions.load_latest_meta",
        lambda: {"version": "1.0.60", "download_url": "x"},
    )

    assert next_version("1.0.58") == "1.0.59"
    assert next_version("1.0.59") == "1.0.60"
    assert next_version("1.0.60") is None
    assert next_version("1.0.57") == "1.0.58"


def test_next_payload_includes_feed(tmp_path, monkeypatch):
    catalog = tmp_path / "versions.json"
    catalog.write_text('["1.0.59","1.0.60"]', encoding="utf-8")
    monkeypatch.setattr("app.services.desktop_versions._VERSIONS_PATH", catalog)
    monkeypatch.setattr(
        "app.services.desktop_versions.load_latest_meta",
        lambda: {"version": "1.0.60", "download_url": "x"},
    )

    payload = next_update_payload("1.0.59")
    assert payload["next"] == "1.0.60"
    assert payload["feed_url"].endswith("/v/1.0.60/")
    assert "1.0.60" in payload["download_url"]
    assert is_version_older("1.0.59", "1.0.60")
