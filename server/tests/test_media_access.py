import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Friendship, FriendshipStatus, MediaMessage, MediaType, User
from app.services.media_access import can_access_media


@pytest.fixture
def batch_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    for name in ("sender", "alice", "bob", "outsider"):
        db.add(User(id=name, username=name, email=f"{name}@example.invalid", password_hash="unused"))
    for receiver in ("alice", "bob"):
        db.add(Friendship(requester_id="sender", addressee_id=receiver, status=FriendshipStatus.accepted))
    # The self-test is the first record for the shared file, as in a Send batch.
    for receiver in ("sender", "alice", "bob"):
        db.add(MediaMessage(sender_id="sender", receiver_id=receiver, media_type=MediaType.image,
                            storage_path="/uploads/shared.webp", audio_path="/uploads/shared.mp3",
                            source_layers=json.dumps([{"path": "/uploads/source.png"}])))
    db.commit()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("recipient", ["sender", "alice", "bob"])
@pytest.mark.parametrize("path", ["/uploads/shared.webp", "/uploads/shared.mp3"])
def test_every_batch_recipient_can_load_shared_media(batch_db, recipient, path):
    assert can_access_media(batch_db, recipient, path)


def test_batch_does_not_authorize_unrelated_user(batch_db):
    assert not can_access_media(batch_db, "outsider", "/uploads/shared.webp")


def test_source_layers_remain_sender_only_and_paths_match_exactly(batch_db):
    assert can_access_media(batch_db, "sender", "/uploads/source.png")
    assert not can_access_media(batch_db, "bob", "/uploads/source.png")
    assert not can_access_media(batch_db, "sender", "/uploads/source")


def test_blocked_recipient_is_denied_without_affecting_other_recipient(batch_db):
    friendship = batch_db.query(Friendship).filter_by(addressee_id="alice").one()
    friendship.status = FriendshipStatus.blocked
    batch_db.commit()
    assert not can_access_media(batch_db, "alice", "/uploads/shared.webp")
    assert can_access_media(batch_db, "bob", "/uploads/shared.webp")
