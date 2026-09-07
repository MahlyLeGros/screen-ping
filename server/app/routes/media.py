import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import DeliveryStatus, MediaMessage, MediaType, User
from app.schemas import (
    BatchUploadResponse,
    HistoryLayerItem,
    MessageHistoryItem,
    SendMessageRequest,
    UploadResponse,
    UserResponse,
)
from app.services.friends import are_friends, is_blocked
from app.realtime import check_upload_rate_limit
from app.services.compose_layers import compose_layers, read_layer_upload, save_compiled_webp, validate_layers_total_size
from app.services.media import save_image_bytes, save_upload
from app.services.media_access import media_paths_for_message, parse_source_layers, sign_media_url
from app.services.ping_limits import sanitize_caption, sanitize_image_layers

router = APIRouter(prefix="/media", tags=["media"])


def _parse_receiver_ids(raw: str) -> list[str]:
    ids = [part.strip() for part in raw.split(",") if part.strip()]
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one friend")
    if len(ids) > settings.max_batch_receivers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many recipients (max {settings.max_batch_receivers})",
        )
    # Preserve order while deduplicating
    seen: set[str] = set()
    unique: list[str] = []
    for rid in ids:
        if rid not in seen:
            seen.add(rid)
            unique.append(rid)
    return unique


def _validate_receiver(db: Session, sender_id: str, receiver_id: str) -> None:
    if sender_id == receiver_id:
        return
    if is_blocked(db, sender_id, receiver_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Blocked user: {receiver_id}")
    if not are_friends(db, sender_id, receiver_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Not friends with: {receiver_id}")


@router.post("/upload", response_model=BatchUploadResponse)
async def upload_media(
    receiver_ids: str,
    file: UploadFile,
    caption: str | None = None,
    sound_file: UploadFile | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not check_upload_rate_limit(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many uploads. Wait a moment before sending more.",
        )
    ids = _parse_receiver_ids(receiver_ids)
    caption = sanitize_caption(caption)
    for receiver_id in ids:
        _validate_receiver(db, current_user.id, receiver_id)

    media_type_str, _filename, media_url = await save_upload(file)
    audio_url: str | None = None

    if sound_file and sound_file.filename:
        if media_type_str not in ("image", "video"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sound attachment is only supported with images and videos",
            )
        _, _audio_name, audio_url = await save_upload(sound_file, force_audio=True)

    uploads: list[UploadResponse] = []
    for receiver_id in ids:
        message = MediaMessage(
            sender_id=current_user.id,
            receiver_id=receiver_id,
            media_type=MediaType(media_type_str),
            storage_path=media_url,
            audio_path=audio_url,
            caption=caption,
            delivery_status=DeliveryStatus.pending,
        )
        db.add(message)
        db.flush()
        uploads.append(
            UploadResponse(
                message_id=message.id,
                receiver_id=receiver_id,
                media_type=media_type_str,
                media_url=media_url,
                audio_url=audio_url,
            )
        )

    db.commit()
    return BatchUploadResponse(uploads=uploads)


@router.post("/upload-layers", response_model=BatchUploadResponse)
async def upload_media_layers(
    receiver_ids: str,
    layers: str = Form(...),
    files: list[UploadFile] = File(...),
    caption: str | None = Form(None),
    sound_file: UploadFile | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not check_upload_rate_limit(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many uploads. Wait a moment before sending more.",
        )

    ids = _parse_receiver_ids(receiver_ids)
    caption = sanitize_caption(caption)
    for receiver_id in ids:
        _validate_receiver(db, current_user.id, receiver_id)

    try:
        raw_layers = json.loads(layers)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid layers JSON") from exc

    if not isinstance(raw_layers, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="layers must be a JSON array")

    try:
        sanitized_layers = sanitize_image_layers(raw_layers)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if len(files) != len(sanitized_layers):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Number of files must match number of layers",
        )

    layer_items: list[tuple[bytes, str, dict, str]] = []
    for upload, meta in zip(files, sanitized_layers, strict=True):
        content, mime = await read_layer_upload(upload)
        layer_items.append((content, mime, meta, upload.filename or "layer"))

    validate_layers_total_size([len(item[0]) for item in layer_items])

    ordered = sorted(layer_items, key=lambda item: item[2]["zIndex"])
    try:
        compiled = compose_layers([(content, meta) for content, _mime, meta, _name in ordered])
    except (ValueError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not compose layers: {exc}",
        ) from exc
    _filename, media_url = save_compiled_webp(compiled)

    source_records = []
    for content, mime, meta, name in layer_items:
        _saved_name, path = save_image_bytes(content, mime)
        source_records.append(
            {
                "path": path,
                "mime": mime,
                "name": name,
                "layout": meta["layout"],
                "opacity": meta["opacity"],
                "zIndex": meta["zIndex"],
            }
        )
    source_layers_json = json.dumps(source_records)

    audio_url: str | None = None
    if sound_file and sound_file.filename:
        _, _audio_name, audio_url = await save_upload(sound_file, force_audio=True)

    uploads: list[UploadResponse] = []
    for receiver_id in ids:
        message = MediaMessage(
            sender_id=current_user.id,
            receiver_id=receiver_id,
            media_type=MediaType.image,
            storage_path=media_url,
            audio_path=audio_url,
            source_layers=source_layers_json,
            caption=caption,
            delivery_status=DeliveryStatus.pending,
        )
        db.add(message)
        db.flush()
        uploads.append(
            UploadResponse(
                message_id=message.id,
                receiver_id=receiver_id,
                media_type="image",
                media_url=media_url,
                audio_url=audio_url,
            )
        )

    db.commit()
    return BatchUploadResponse(uploads=uploads)


@router.post("/send")
def prepare_send(body: SendMessageRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.get(MediaMessage, body.message_id)
    if not message or message.sender_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return {"ok": True, "message_id": message.id}


@router.get("/history", response_model=list[MessageHistoryItem])
def history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    messages = (
        db.query(MediaMessage)
        .filter(MediaMessage.sender_id == current_user.id)
        .order_by(MediaMessage.created_at.desc())
        .limit(20)
        .all()
    )
    items = []
    for m in messages:
        receiver = db.get(User, m.receiver_id)
        paths = media_paths_for_message(m)
        layer_items: list[HistoryLayerItem] | None = None
        parsed = parse_source_layers(m.source_layers)
        if parsed:
            layer_items = [
                HistoryLayerItem(
                    url=sign_media_url(str(layer["path"]), current_user.id, paths) or str(layer["path"]),
                    name=str(layer.get("name") or "layer"),
                    mime=layer.get("mime"),
                    layout=layer.get("layout") or {},
                    opacity=float(layer.get("opacity") or 1),
                    zIndex=int(layer.get("zIndex") or 0),
                )
                for layer in parsed
            ]
        items.append(
            MessageHistoryItem(
                id=m.id,
                receiver_username=receiver.username if receiver else "unknown",
                media_type=m.media_type.value,
                media_url=sign_media_url(m.storage_path, current_user.id, paths) or m.storage_path,
                audio_url=sign_media_url(m.audio_path, current_user.id, paths) if m.audio_path else None,
                caption=m.caption,
                delivery_status=m.delivery_status.value,
                created_at=m.created_at,
                layers=layer_items,
            )
        )
    return items
