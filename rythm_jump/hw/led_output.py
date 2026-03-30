"""LED output abstractions used in Rhythm Jump."""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

from rythm_jump.config import build_led_config

if TYPE_CHECKING:
    from rythm_jump.engine.led_frames import LedFrame


class PixelStripProtocol(Protocol):
    """Subset of the rpi_ws281x PixelStrip API used by the adapter."""

    def begin(self) -> None:
        """Initialize the strip."""

    def setPixelColor(self, index: int, color: int) -> None:  # noqa: N802
        """Set one pixel's color."""

    def show(self) -> None:
        """Flush the current pixel buffer."""


class LedOutput(Protocol):
    """Protocol for objects that render LED frames."""

    def write_frame(self, frame: LedFrame) -> None:
        """Render the provided LED frame."""


class NoOpLedOutput:
    """LED output that discards every frame."""

    def write_frame(self, frame: LedFrame) -> None:
        """Drop the frame without acting on it."""
        _ = frame


class SimLedOutput:
    """In-memory LED output useful for tests."""

    def __init__(self) -> None:
        """Track frames as RGB tuples."""
        self.frames: list[tuple[tuple[int, int, int], ...]] = []

    def write_frame(self, frame: LedFrame) -> None:
        """Store the current frame for later assertions."""
        self.frames.append(frame.pixels)


class Ws2811LedOutput:
    """Best-effort physical LED strip output backed by rpi_ws281x."""

    def __init__(self) -> None:
        """Initialize the physical strip when the dependency is available."""
        self._strip = self._build_strip()

    def _build_strip(self) -> PixelStripProtocol | None:
        if not _supports_physical_ws2811():
            return None

        try:
            module = importlib.import_module("rpi_ws281x")
        except ImportError:
            return None

        strip_class = getattr(module, "PixelStrip", None)
        color_factory = getattr(module, "Color", None)
        if strip_class is None or color_factory is None:
            return None

        config = build_led_config()

        try:
            strip = strip_class(
                config.count,
                config.pin,
                config.freq_hz,
                config.dma,
                config.invert,
                config.brightness,
                config.channel,
            )
            strip.begin()
        except RuntimeError:
            return None
        return cast("PixelStripProtocol", strip)

    def write_frame(self, frame: LedFrame) -> None:
        """Push the current frame to the physical strip."""
        if self._strip is None:
            return

        color_factory = importlib.import_module("rpi_ws281x").Color
        for index, (red, green, blue) in enumerate(frame.pixels):
            self._strip.setPixelColor(index, color_factory(red, green, blue))
        self._strip.show()


def _supports_physical_ws2811() -> bool:
    """Return whether the host appears to be a Raspberry Pi."""
    model_path = Path("/proc/device-tree/model")
    if model_path.exists():
        model = model_path.read_text(encoding="utf-8", errors="ignore").lower()
        if "raspberry pi" in model:
            return True

    cpuinfo_path = Path("/proc/cpuinfo")
    if not cpuinfo_path.exists():
        return False

    cpuinfo = cpuinfo_path.read_text(encoding="utf-8", errors="ignore").lower()
    return "raspberry pi" in cpuinfo or "bcm" in cpuinfo
