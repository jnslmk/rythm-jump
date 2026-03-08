from enum import StrEnum


class State(StrEnum):
    IDLE = "idle"
    PLAYING = "playing"
    ABORTED_DISCONNECTED = "aborted_disconnected"


class GameSession:
    def __init__(self) -> None:
        self.state = State.IDLE

    def start(self) -> None:
        if self.state == State.IDLE:
            self.state = State.PLAYING

    def start_from_contact(self) -> None:
        self.start()

    def handle_input(self, lane: str) -> None:
        if self.state == State.PLAYING:
            # Here we would normally trigger scoring/judgement logic.
            # For now, it's a placeholder.
            pass
