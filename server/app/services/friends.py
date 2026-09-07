from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Friendship, FriendshipStatus, User


def get_friendship(db: Session, user_a: str, user_b: str) -> Friendship | None:
    return (
        db.query(Friendship)
        .filter(
            or_(
                (Friendship.requester_id == user_a) & (Friendship.addressee_id == user_b),
                (Friendship.requester_id == user_b) & (Friendship.addressee_id == user_a),
            )
        )
        .first()
    )


def are_friends(db: Session, user_a: str, user_b: str) -> bool:
    friendship = get_friendship(db, user_a, user_b)
    return friendship is not None and friendship.status == FriendshipStatus.accepted


def is_blocked(db: Session, user_a: str, user_b: str) -> bool:
    friendship = get_friendship(db, user_a, user_b)
    return friendship is not None and friendship.status == FriendshipStatus.blocked


def blocked_by_other(friendship: Friendship, user_id: str) -> bool:
    """True when this user is the one who was blocked (not the blocker)."""
    return (
        friendship.status == FriendshipStatus.blocked
        and friendship.blocked_by_id is not None
        and friendship.blocked_by_id != user_id
    )
