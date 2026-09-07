import json

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.services.desktop_versions import (
    absolute_latest,
    installer_url,
    load_latest_meta,
    next_update_payload,
)

router = APIRouter(prefix="/desktop", tags=["desktop"])

_DEFAULT = {
    "version": "1.0.3",
    "download_url": "https://screenping.xyz/desktop/updates/Screen%20Ping%20Setup%201.0.3.exe",
    "update_protocol": "screenping://update",
}


def _load_latest() -> dict[str, str]:
    meta = load_latest_meta()
    return meta if meta else dict(_DEFAULT)


@router.get("/latest")
def desktop_latest():
    latest = _load_latest()
    abs_latest = absolute_latest() or latest.get("version", "")
    content = {
        **latest,
        "version": abs_latest,
        "download_url": latest.get("download_url") or installer_url(abs_latest),
        "versions": next_update_payload("0.0.0").get("versions", []),
    }
    return JSONResponse(
        content=content,
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/next")
def desktop_next(from_version: str = Query(default="0.0.0", alias="from")):
    """Next installer the client should install (stepwise), not necessarily absolute latest."""
    return JSONResponse(
        content=next_update_payload(from_version.strip() or "0.0.0"),
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/update")
def desktop_update_page():
    latest = _load_latest()
    version = absolute_latest() or latest.get("version", "")
    download = latest.get("download_url", "") or installer_url(version)
    protocol = latest.get("update_protocol", "screenping://update")
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Screen Ping — Update</title>
  <style>
    body {{
      font-family: system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 1.5rem;
    }}
    main {{
      max-width: 28rem;
      text-align: center;
      line-height: 1.5;
    }}
    h1 {{ font-size: 1.15rem; margin: 0 0 0.75rem; }}
    p {{ margin: 0.5rem 0; color: #94a3b8; font-size: 0.95rem; }}
    a.manual {{
      color: #7dd3fc;
      font-size: 0.85rem;
    }}
  </style>
  <script>
    function openApp() {{
      window.location.href = {json.dumps(protocol)};
    }}
  </script>
</head>
<body>
  <main>
    <h1>Update Screen Ping</h1>
    <p>Click below to open the app and start the update check (same as the tray menu).</p>
    <p><a href="{protocol}" style="display:inline-block;margin:1rem 0;padding:0.65rem 1.25rem;background:#38bdf8;color:#0f172a;border-radius:0.5rem;text-decoration:none;font-weight:600">Open Screen Ping and check v{version}</a></p>
    <p><a class="manual" href="{download}">Download the installer (first install)</a></p>
  </main>
</body>
</html>"""
    return HTMLResponse(html)


@router.get("/download")
def desktop_download(from_version: str | None = Query(default=None, alias="from")):
    if from_version:
        payload = next_update_payload(from_version.strip())
        url = payload.get("download_url") or _load_latest().get("download_url", "")
        return RedirectResponse(url=url, status_code=302)
    latest = _load_latest()
    return RedirectResponse(url=latest["download_url"], status_code=302)
