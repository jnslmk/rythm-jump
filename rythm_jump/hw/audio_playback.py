"""Audio playback adapters used by the runtime."""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pathlib import Path


class MixerMusicProtocol(Protocol):
    """Subset of pygame.mixer.music used by the backend audio player."""

    def load(self, filename: str) -> None:
        """Load an audio file."""

    def play(self, *, start: float = 0.0) -> None:
        """Start playback."""

    def pause(self) -> None:
        """Pause playback."""

    def unpause(self) -> None:
        """Resume playback."""

    def stop(self) -> None:
        """Stop playback."""


class MixerProtocol(Protocol):
    """Subset of pygame.mixer used by the backend audio player."""

    music: MixerMusicProtocol

    def get_init(self) -> object:
        """Return mixer initialization state."""

    def init(self) -> None:
        """Initialize the mixer."""

    def quit(self) -> None:
        """Release mixer resources."""


class AudioPlayer(Protocol):
    """Protocol for objects that control backend audio playback."""

    def play(self, audio_path: Path, *, start_ms: int = 0) -> None:
        """Start playing an audio file from the requested position."""

    def pause(self) -> None:
        """Pause playback."""

    def resume(self) -> None:
        """Resume playback."""

    def stop(self) -> None:
        """Stop playback."""

    def close(self) -> None:
        """Release playback resources."""


class NoOpAudioPlayer:
    """Fallback audio player used when backend playback is unavailable."""

    def play(self, audio_path: Path, *, start_ms: int = 0) -> None:
        """Ignore playback requests."""
        _ = (audio_path, start_ms)

    def pause(self) -> None:
        """Ignore pause requests."""

    def resume(self) -> None:
        """Ignore resume requests."""

    def stop(self) -> None:
        """Ignore stop requests."""

    def close(self) -> None:
        """Ignore close requests."""


class PygameAudioPlayer:
    """Best-effort backend audio playback backed by pygame.mixer."""

    def __init__(self) -> None:
        """Initialize pygame.mixer when available."""
        self._mixer = self._load_mixer()
        self._paused = False

    def _load_mixer(self) -> MixerProtocol | None:
        try:
            pygame = importlib.import_module("pygame")
        except ImportError:  # pragma: no cover - optional dependency
            return None

        mixer = getattr(pygame, "mixer", None)
        if mixer is None:
            return None
        try:
            if not mixer.get_init():
                mixer.init()
        except Exception:  # noqa: BLE001
            return None
        return mixer

    def play(self, audio_path: Path, *, start_ms: int = 0) -> None:
        """Start playback from the requested millisecond offset."""
        if self._mixer is None:
            return
        self._mixer.music.load(str(audio_path))
        self._mixer.music.play(start=max(start_ms, 0) / 1000.0)
        self._paused = False

    def pause(self) -> None:
        """Pause active playback."""
        if self._mixer is None:
            return
        self._mixer.music.pause()
        self._paused = True

    def resume(self) -> None:
        """Resume paused playback."""
        if self._mixer is None or not self._paused:
            return
        self._mixer.music.unpause()
        self._paused = False

    def stop(self) -> None:
        """Stop active playback."""
        if self._mixer is None:
            return
        self._mixer.music.stop()
        self._paused = False

    def close(self) -> None:
        """Stop playback and release the mixer."""
        if self._mixer is None:
            return
        self.stop()
        self._mixer.quit()
