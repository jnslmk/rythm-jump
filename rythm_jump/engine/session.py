"""Session management helpers shared by the Rhythm Jump runtime."""

from enum import StrEnum


class State(StrEnum):
    """Possible states of the game session."""

    IDLE = "idle"
    PLAYING = "playing"
    ABORTED_DISCONNECTED = "aborted_disconnected"


class GameSession:
    """Represent the lifecycle of a game session."""

    def __init__(self) -> None:
        """Initialize the session state machine."""
        self.state = State.IDLE

    def start(self) -> None:
        """Start the session if it is currently idle."""
        if self.state == State.IDLE:
            self.state = State.PLAYING

    def start_from_contact(self) -> None:
        """Alias to start triggered by a physical contact event."""
        self.start()

    def handle_input(self, _lane: str) -> None:
        """Handle a lane input when the session is playing."""
        if self.state == State.PLAYING:
            # Here we would normally trigger scoring/judgement logic.
            # For now, it's a placeholder.
            pass
