"""Session management helpers shared by the Rhythm Jump runtime."""

from __future__ import annotations

from enum import StrEnum


class State(StrEnum):
    """Possible states of the game session."""

    IDLE = "idle"
    PLAYING = "playing"
    PAUSED = "paused"


class GameSession:
    """Represent the lifecycle of a game session."""

    def __init__(self) -> None:
        """Initialize the session state machine."""
        self.state = State.IDLE

    def start(self) -> bool:
        """Start the session if it is currently idle."""
        if self.state != State.IDLE:
            return False
        self.state = State.PLAYING
        return True

    def pause(self) -> bool:
        """Pause the session if it is currently playing."""
        if self.state != State.PLAYING:
            return False
        self.state = State.PAUSED
        return True

    def resume(self) -> bool:
        """Resume the session if it is currently paused."""
        if self.state != State.PAUSED:
            return False
        self.state = State.PLAYING
        return True

    def stop(self) -> bool:
        """Reset the session state to idle."""
        if self.state == State.IDLE:
            return False
        self.state = State.IDLE
        return True
