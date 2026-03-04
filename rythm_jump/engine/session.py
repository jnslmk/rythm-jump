from enum import StrEnum


class Mode(StrEnum):
    BROWSER_ATTACHED = "browser_attached"
    HEADLESS = "headless"


class State(StrEnum):
    IDLE = "idle"
    PLAYING = "playing"
    ABORTED_DISCONNECTED = "aborted_disconnected"


class GameSession:
    def __init__(self, mode: Mode) -> None:
        self.mode = mode
        self.state = State.IDLE

    def start(self) -> None:
        if self.state == State.IDLE:
            self.state = State.PLAYING

    def start_from_contact(self) -> None:
        if self.mode != Mode.HEADLESS:
            return
        self.start()

    def handle_input(self, lane: str) -> None:
        if self.state == State.PLAYING:
            # Here we would normally trigger scoring/judgement logic.
            # For now, it's a placeholder.
            pass
