import asyncio
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("audio/webm", ".weba")

import socketio
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.schemas import UserResponse
from app.services.media import apply_avatar_upload, migrate_existing_avatars
from app.services.media_access import (
    can_access_media,
    resolve_upload_file,
    verify_media_access_token,
)

from app.config import settings
from app.database import Base, engine, SessionLocal
from app.realtime import cleanup_loop
from app.routes import auth, desktop, friends, media
from app.socket_events import pending_expire_loop, sio

# Import models so metadata is registered
from app import models  # noqa: F401

Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)


def _migrate_sqlite_columns() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if settings.database_url.startswith("sqlite"):
        if "media_messages" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("media_messages")}
            if "audio_path" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE media_messages ADD COLUMN audio_path VARCHAR(512)"))
            if "source_layers" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE media_messages ADD COLUMN source_layers TEXT"))
            if "dispatched_at" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE media_messages ADD COLUMN dispatched_at DATETIME"))
        if "users" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("users")}
            if "avatar_url" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512)"))
            if "token_version" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0 NOT NULL"))
            if "terms_accepted_at" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME"))
            if "terms_accepted_version" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN terms_accepted_version VARCHAR(32)"))
            if "email_verified_at" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN email_verified_at DATETIME"))
                    conn.execute(text("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL"))
            if "google_sub" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
                    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"))
        if "friendships" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("friendships")}
            if "blocked_by_id" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE friendships ADD COLUMN blocked_by_id VARCHAR(36)"))
        return

    # PostgreSQL and others
    if "media_messages" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("media_messages")}
        if "dispatched_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE media_messages ADD COLUMN dispatched_at TIMESTAMPTZ"))
        if "source_layers" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE media_messages ADD COLUMN source_layers TEXT"))
    if "users" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("users")}
        if "avatar_url" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512)"))
        if "token_version" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0 NOT NULL"))
        if "terms_accepted_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ"))
        if "terms_accepted_version" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN terms_accepted_version VARCHAR(32)"))
        if "email_verified_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ"))
                conn.execute(text("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL"))
        if "google_sub" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"))
        try:
            with engine.begin() as conn:
                row = conn.execute(
                    text(
                        "SELECT t.typname FROM pg_type t "
                        "JOIN pg_enum e ON t.oid = e.enumtypid "
                        "WHERE e.enumlabel = 'password_reset' LIMIT 1"
                    )
                ).fetchone()
                if row and str(row[0]).replace("_", "").isalnum():
                    conn.execute(text(f'ALTER TYPE "{row[0]}" ADD VALUE IF NOT EXISTS \'signup\''))
        except Exception:
            pass
    if "friendships" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("friendships")}
        if "blocked_by_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE friendships ADD COLUMN blocked_by_id VARCHAR(36)"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_columns()
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.upload_dir, "avatars").mkdir(parents=True, exist_ok=True)
    db = SessionLocal()
    try:
        migrate_existing_avatars(db)
    except Exception:
        pass
    finally:
        db.close()
    cleanup_task = asyncio.create_task(cleanup_loop())
    pending_task = asyncio.create_task(pending_expire_loop())
    yield
    cleanup_task.cancel()
    pending_task.cancel()
    for task in (cleanup_task, pending_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


_docs_kw: dict = {}
if not settings.enable_api_docs:
    _docs_kw = {"docs_url": None, "redoc_url": None, "openapi_url": None}

app = FastAPI(title="Screen Ping API", lifespan=lifespan, **_docs_kw)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(friends.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(desktop.router, prefix="/api")


@app.get("/api/media/capabilities")
def api_capabilities():
    return {"avatar_upload": True, "batch_upload": True, "api_version": 2}


@app.post("/api/media/avatar", response_model=UserResponse)
async def api_upload_avatar(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await apply_avatar_upload(file, current_user, db)


@app.post("/api/auth/me/avatar", response_model=UserResponse)
async def api_upload_avatar_auth(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await apply_avatar_upload(file, current_user, db)


@app.get("/health")
def health():
    return {"ok": True}


avatars_dir = Path(settings.upload_dir) / "avatars"
avatars_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads/avatars", StaticFiles(directory=str(avatars_dir)), name="avatar_uploads")


@app.get("/uploads/{filename}")
def serve_ping_media(
    filename: str,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if not filename or "/" in filename or ".." in filename:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    storage_path = f"/uploads/{filename}"
    user_id = verify_media_access_token(token, storage_path) if token else None
    if not user_id or not can_access_media(db, user_id, storage_path):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    file_path = resolve_upload_file(storage_path)
    if not file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)


socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# Nginx serves the website in production — do not register SPA catch-all in Docker
# (it was returning 404 for GET /api/* routes like /api/media/capabilities).
_serve_spa = os.getenv("SERVE_SPA", "true").lower() in ("1", "true", "yes")
_web_dist_candidates = [
    Path("/app/web/dist"),
    Path(__file__).resolve().parents[2] / "web" / "dist",
]
web_dist = next((p for p in _web_dist_candidates if p.is_dir()), None)
if web_dist is not None and _serve_spa:
    assets_dir = web_dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(web_dist / "index.html")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = web_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(web_dist / "index.html")
