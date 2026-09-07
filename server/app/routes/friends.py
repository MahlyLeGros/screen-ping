from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Friendship, FriendshipStatus, User
from app.schemas import FriendRequestCreate, FriendResponse
from app.services.friends import blocked_by_other, get_friendship
from app.socket_events import emit_friends_update

router = APIRouter(prefix="/friends", tags=["friends"])


def _friend_presence(user_id: str) -> dict:
    from app.realtime import presence_manager

    is_online = presence_manager.is_online(user_id)
    last_active = presence_manager.get_last_active(user_id) if is_online else None
    return {"is_online": is_online, "last_active_at": last_active}


@router.get("", response_model=list[FriendResponse])
def list_friends(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friendships = (
        db.query(Friendship)
        .filter(
            (Friendship.requester_id == current_user.id) | (Friendship.addressee_id == current_user.id)
        )
        .all()
    )
    results: list[FriendResponse] = []
    for f in friendships:
        # Only the blocker sees a Blocked row. The blocked user just no longer sees them.
        if blocked_by_other(f, current_user.id):
            continue
        if f.requester_id == current_user.id:
            other = db.get(User, f.addressee_id)
            if f.status == FriendshipStatus.pending:
                direction = "outgoing"
            elif f.status == FriendshipStatus.blocked:
                direction = "blocked"
            else:
                direction = "accepted"
        else:
            other = db.get(User, f.requester_id)
            if f.status == FriendshipStatus.pending:
                direction = "incoming"
            elif f.status == FriendshipStatus.blocked:
                direction = "blocked"
            else:
                direction = "accepted"
        if not other:
            continue
        results.append(
            FriendResponse(
                id=f.id,
                user_id=other.id,
                username=other.username,
                avatar_url=other.avatar_url,
                status=f.status.value,
                direction=direction,
                **_friend_presence(other.id),
            )
        )
    return results


@router.post("/request", response_model=FriendResponse)
async def request_friend(body: FriendRequestCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target = db.query(User).filter(User.username == body.username).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add yourself")
    existing = get_friendship(db, current_user.id, target.id)
    if existing:
        if existing.status == FriendshipStatus.blocked:
            if existing.blocked_by_id == current_user.id:
                detail = "You blocked this user — unblock them from Friends first"
            else:
                detail = "Unable to add this user"
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Friendship already exists")
    friendship = Friendship(requester_id=current_user.id, addressee_id=target.id)
    db.add(friendship)
    db.commit()
    db.refresh(friendship)
    await emit_friends_update(
        [current_user.id, target.id],
        {
            "action": "request",
            "friendshipId": friendship.id,
            "fromUserId": current_user.id,
            "fromUsername": current_user.username,
        },
    )
    return FriendResponse(
        id=friendship.id,
        user_id=target.id,
        username=target.username,
        avatar_url=target.avatar_url,
        status=friendship.status.value,
        direction="outgoing",
        **_friend_presence(target.id),
    )


@router.post("/{friendship_id}/accept", response_model=FriendResponse)
async def accept_friend(friendship_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friendship = db.get(Friendship, friendship_id)
    if not friendship or friendship.addressee_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if friendship.status != FriendshipStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is not pending")
    friendship.status = FriendshipStatus.accepted
    db.commit()
    requester = db.get(User, friendship.requester_id)
    await emit_friends_update(
        [current_user.id, friendship.requester_id],
        {
            "action": "accept",
            "friendshipId": friendship.id,
            "fromUserId": current_user.id,
            "fromUsername": current_user.username,
        },
    )
    return FriendResponse(
        id=friendship.id,
        user_id=requester.id,
        username=requester.username,
        avatar_url=requester.avatar_url,
        status=friendship.status.value,
        direction="accepted",
        **_friend_presence(requester.id),
    )


@router.post("/{friendship_id}/decline")
async def decline_friend(friendship_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friendship = db.get(Friendship, friendship_id)
    if not friendship or friendship.addressee_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    requester_id = friendship.requester_id
    db.delete(friendship)
    db.commit()
    await emit_friends_update(
        [current_user.id, requester_id],
        {
            "action": "decline",
            "friendshipId": friendship_id,
            "fromUserId": current_user.id,
            "fromUsername": current_user.username,
        },
    )
    return {"ok": True}


@router.post("/{friendship_id}/remove")
async def remove_friend(friendship_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friendship = db.get(Friendship, friendship_id)
    if not friendship or current_user.id not in (friendship.requester_id, friendship.addressee_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friendship not found")
    if friendship.status == FriendshipStatus.pending and friendship.requester_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use decline for incoming requests")
    if friendship.status not in (FriendshipStatus.accepted, FriendshipStatus.pending):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove this friendship")
    other_id = friendship.addressee_id if friendship.requester_id == current_user.id else friendship.requester_id
    db.delete(friendship)
    db.commit()
    await emit_friends_update(
        [current_user.id, other_id],
        {
            "action": "remove",
            "friendshipId": friendship_id,
            "fromUserId": current_user.id,
            "fromUsername": current_user.username,
        },
    )
    return {"ok": True}


@router.post("/{friendship_id}/block")
async def block_friend(friendship_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friendship = db.get(Friendship, friendship_id)
    if not friendship or current_user.id not in (friendship.requester_id, friendship.addressee_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friendship not found")
    other_id = friendship.addressee_id if friendship.requester_id == current_user.id else friendship.requester_id
    friendship.status = FriendshipStatus.blocked
    friendship.blocked_by_id = current_user.id
    db.commit()
    await emit_friends_update(
        [current_user.id, other_id],
        {
            "action": "block",
            "friendshipId": friendship.id,
            "fromUserId": current_user.id,
            "fromUsername": current_user.username,
        },
    )
    return {"ok": True}


@router.post("/{friendship_id}/unblock", response_model=FriendResponse)
async def unblock_friend(friendship_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friendship = db.get(Friendship, friendship_id)
    if not friendship or current_user.id not in (friendship.requester_id, friendship.addressee_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friendship not found")
    if friendship.status != FriendshipStatus.blocked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not blocked")
    if friendship.blocked_by_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the user who blocked can unblock",
        )
    friendship.status = FriendshipStatus.accepted
    friendship.blocked_by_id = None
    db.commit()
    other_id = friendship.addressee_id if friendship.requester_id == current_user.id else friendship.requester_id
    other = db.get(User, other_id)
    if not other:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await emit_friends_update(
        [current_user.id, other_id],
        {
            "action": "unblock",
            "friendshipId": friendship.id,
            "fromUserId": current_user.id,
            "fromUsername": current_user.username,
        },
    )
    return FriendResponse(
        id=friendship.id,
        user_id=other.id,
        username=other.username,
        avatar_url=other.avatar_url,
        status=friendship.status.value,
        direction="accepted",
        **_friend_presence(other.id),
    )
