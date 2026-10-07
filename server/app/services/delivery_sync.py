"""Two-phase delivery state. Used by the single realtime server process."""
from dataclasses import dataclass, field


@dataclass
class DeliveryGroup:
    delay_ms: int = 0
    targets: dict[str, set[str]] = field(default_factory=dict)
    ready: set[tuple[str, str]] = field(default_factory=set)
    sealed: bool = False

    def add(self, message_id: str, socket_ids: list[str]) -> None:
        self.targets[message_id] = set(socket_ids)

    def mark_ready(self, message_id: str, sid: str) -> bool:
        if sid not in self.targets.get(message_id, set()):
            return False
        self.ready.add((message_id, sid))
        return True

    def remove(self, message_id: str) -> None:
        self.targets.pop(message_id, None)
        self.ready = {pair for pair in self.ready if pair[0] != message_id}

    def complete(self) -> bool:
        return self.sealed and all(
            (message_id, sid) in self.ready
            for message_id, sids in self.targets.items() for sid in sids
        )
