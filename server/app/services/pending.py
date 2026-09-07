from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DeliveryStatus, MediaMessage, utcnow
from app.services.media_access import release_media_for_message

# Statuses the sender can cancel, and that auto-timeout may fail.
CANCELLABLE_STATUSES = (
    DeliveryStatus.pending,
    DeliveryStatus.offline,
    DeliveryStatus.paused,
)


def count_in_flight_for_receiver(
    db: Session,
    receiver_id: str,
    *,
    exclude_message_id: str | None = None,
) -> int:
    """Count pings actually dispatched to the receiver's desktop and awaiting ack."""
    query = db.query(MediaMessage).filter(
        MediaMessage.receiver_id == receiver_id,
        MediaMessage.delivery_status == DeliveryStatus.pending,
        MediaMessage.dispatched_at.isnot(None),
    )
    if exclude_message_id:
        query = query.filter(MediaMessage.id != exclude_message_id)
    return query.count()


def ensure_pending_capacity(
    db: Session,
    receiver_id: str,
    *,
    exclude_message_id: str | None = None,
    additional: int = 1,
) -> None:
    if additional <= 0:
        return
    in_flight = count_in_flight_for_receiver(db, receiver_id, exclude_message_id=exclude_message_id)
    limit = settings.max_pending_pings_per_receiver
    if in_flight + additional > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many pending pings for this friend (max {limit}). Wait for delivery before sending more.",
        )


def mark_message_failed(db: Session, message: MediaMessage) -> bool:
    """Mark a non-terminal message as failed and release media. Returns True if changed."""
    if message.delivery_status in (DeliveryStatus.delivered, DeliveryStatus.failed):
        return False
    if message.delivery_status not in CANCELLABLE_STATUSES:
        return False
    message.delivery_status = DeliveryStatus.failed
    db.commit()
    release_media_for_message(db, message)
    return True


def find_stale_dispatched_pending(db: Session) -> list[MediaMessage]:
    """Dispatched pings still pending past the TTL window."""
    ttl = max(5, int(settings.pending_ping_ttl_seconds))
    cutoff = utcnow() - timedelta(seconds=ttl)
    return (
        db.query(MediaMessage)
        .filter(
            MediaMessage.delivery_status == DeliveryStatus.pending,
            MediaMessage.dispatched_at.isnot(None),
            MediaMessage.dispatched_at < cutoff,
        )
        .all()
    )
