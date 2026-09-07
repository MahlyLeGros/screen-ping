#!/usr/bin/env python3
"""Ensure each Screen Ping Setup X.Y.Z.exe has updates/v/X.Y.Z/latest.yml (absolute URL)."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

UPDATES = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/screenping/desktop/updates")
BASE = "https://screenping.xyz/desktop/updates"
INSTALLER_RE = re.compile(r"^Screen Ping Setup (.+)\.exe$", re.IGNORECASE)


def sha512_file(path: Path) -> str:
    h = hashlib.sha512()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_feed(version: str, installer: Path) -> None:
    feed_dir = UPDATES / "v" / version
    feed_dir.mkdir(parents=True, exist_ok=True)
    dest = feed_dir / "latest.yml"
    url = f"{BASE}/{quote(installer.name)}"
    digest = sha512_file(installer)
    size = installer.stat().st_size
    release_date = datetime.fromtimestamp(installer.stat().st_mtime, tz=timezone.utc).isoformat()
    content = (
        f"version: {version}\n"
        f"files:\n"
        f"  - url: {url}\n"
        f"    sha512: {digest}\n"
        f"    size: {size}\n"
        f"path: {url}\n"
        f"sha512: {digest}\n"
        f"releaseDate: '{release_date}'\n"
    )
    dest.write_text(content, encoding="utf-8")
    print(f"feed {version} -> {dest}")


def main() -> None:
    if not UPDATES.is_dir():
        print(f"missing updates dir: {UPDATES}", file=sys.stderr)
        sys.exit(1)

    versions: list[str] = []
    for path in sorted(UPDATES.glob("Screen Ping Setup *.exe")):
        match = INSTALLER_RE.match(path.name)
        if not match:
            continue
        version = match.group(1).strip()
        versions.append(version)
        write_feed(version, path)

    versions = sorted(set(versions), key=lambda v: tuple(int(p) if p.isdigit() else 0 for p in v.split(".")))
    catalog = UPDATES / "versions.json"
    # Prefer server app catalog if passed as argv2
    app_catalog = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if app_catalog and app_catalog.is_file():
        try:
            existing = json.loads(app_catalog.read_text(encoding="utf-8-sig"))
            if isinstance(existing, list):
                versions = sorted(
                    set([*existing, *versions]),
                    key=lambda v: tuple(int(p) if p.isdigit() else 0 for p in str(v).split(".")),
                )
                app_catalog.write_text(json.dumps(versions), encoding="utf-8")
                print(f"catalog {app_catalog}")
        except Exception as exc:
            print(f"catalog update skipped: {exc}", file=sys.stderr)

    catalog.write_text(json.dumps(versions), encoding="utf-8")
    print(f"wrote {catalog} ({len(versions)} versions)")


if __name__ == "__main__":
    main()
