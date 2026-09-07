from app.models import Friendship, FriendshipStatus
from app.services.friends import blocked_by_other


def _friendship(*, blocked_by_id: str | None) -> Friendship:
    return Friendship(
        requester_id="user-a",
        addressee_id="user-b",
        status=FriendshipStatus.blocked,
        blocked_by_id=blocked_by_id,
    )


def test_blocked_user_does_not_see_block_as_theirs():
    f = _friendship(blocked_by_id="user-b")
    assert blocked_by_other(f, "user-a") is True
    assert blocked_by_other(f, "user-b") is False


def test_blocker_still_sees_blocked_row():
    f = _friendship(blocked_by_id="user-a")
    assert blocked_by_other(f, "user-a") is False
    assert blocked_by_other(f, "user-b") is True


def test_legacy_block_without_blocker_id_stays_visible():
    f = _friendship(blocked_by_id=None)
    assert blocked_by_other(f, "user-a") is False
    assert blocked_by_other(f, "user-b") is False
