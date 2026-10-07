from app.services.delivery_sync import DeliveryGroup


def test_waits_for_every_device_and_sealing():
    group = DeliveryGroup()
    group.add("a", ["alice"])
    assert group.mark_ready("a", "alice")
    assert not group.complete()  # another target may still be registered
    group.add("b", ["bob", "bob-second-pc"])
    group.sealed = True
    assert not group.complete()
    group.mark_ready("b", "bob")
    assert not group.complete()
    group.mark_ready("b", "bob-second-pc")
    assert group.complete()


def test_rejects_wrong_socket_and_message():
    group = DeliveryGroup()
    group.add("a", ["alice"])
    group.sealed = True
    assert not group.mark_ready("a", "outsider")
    assert not group.mark_ready("unknown", "alice")
    assert not group.complete()


def test_failed_recipient_does_not_block_other_recipient():
    group = DeliveryGroup()
    group.add("a", ["alice"])
    group.add("b", ["bob"])
    group.sealed = True
    group.mark_ready("a", "alice")
    group.remove("b")
    assert group.complete()


def test_repeated_ready_is_idempotent():
    group = DeliveryGroup()
    group.add("a", ["alice"])
    group.mark_ready("a", "alice")
    group.mark_ready("a", "alice")
    assert group.ready == {("a", "alice")}
