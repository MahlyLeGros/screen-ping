from app.services.desktop_versions import is_version_older, next_version, next_update_payload


def test_old_versions_jump_directly_to_latest(tmp_path, monkeypatch):
    catalog = tmp_path / "versions.json"
    catalog.write_text('["1.0.58","1.0.59","1.0.60"]', encoding="utf-8")
    monkeypatch.setattr("app.services.desktop_versions._VERSIONS_PATH", catalog)
    monkeypatch.setattr(
        "app.services.desktop_versions.load_latest_meta",
        lambda: {"version": "1.0.60", "download_url": "x"},
    )

    assert next_version("1.0.58") == "1.0.60"
    assert next_version("1.0.59") == "1.0.60"
    assert next_version("1.0.60") is None
    assert next_version("1.0.57") == "1.0.60"
    assert next_version("0.0.0") == "1.0.60"
    assert next_version("1.0.61") is None


def test_next_payload_includes_feed(tmp_path, monkeypatch):
    catalog = tmp_path / "versions.json"
    catalog.write_text('["1.0.59","1.0.60"]', encoding="utf-8")
    monkeypatch.setattr("app.services.desktop_versions._VERSIONS_PATH", catalog)
    monkeypatch.setattr(
        "app.services.desktop_versions.load_latest_meta",
        lambda: {"version": "1.0.60", "download_url": "x"},
    )

    payload = next_update_payload("1.0.1")
    assert payload["next"] == "1.0.60"
    assert payload["feed_url"].endswith("/v/1.0.60/")
    assert "1.0.60" in payload["download_url"]
    assert is_version_older("1.0.59", "1.0.60")


def test_missing_catalog_uses_latest_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.desktop_versions._VERSIONS_PATH", tmp_path / "missing.json")
    monkeypatch.setattr("app.services.desktop_versions.load_latest_meta", lambda: {"version": "1.0.66"})
    assert next_version("1.0.3") == "1.0.66"
    assert next_version("1.0.66") is None
    assert next_version("2.0.0") is None
