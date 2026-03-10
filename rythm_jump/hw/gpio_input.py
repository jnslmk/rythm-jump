"""GPIO helpers for detecting physical jump box presses."""

from __future__ import annotations

import importlib
import os
from typing import TYPE_CHECKING, Protocol, cast

if TYPE_CHECKING:
    from rythm_jump.engine.types import Lane


class GPIOProtocol(Protocol):
    """Subset of the GPIO module used by the input adapter."""

    BCM: int
    IN: int
    LOW: int
    PUD_UP: int

    def setmode(self, mode: int) -> None:
        """Set the numbering mode."""

    def setup(self, channel: int, direction: int, *, pull_up_down: int) -> None:
        """Configure one GPIO channel."""

    def input(self, channel: int) -> int:
        """Read one GPIO channel."""


def debounce_accept(last_ms: int, now_ms: int, threshold_ms: int) -> bool:
    """Return True when the elapsed time exceeds the configured threshold."""
    if threshold_ms < 0:
        message = "threshold_ms must be >= 0"
        raise ValueError(message)
    if now_ms < last_ms:
        return False
    return (now_ms - last_ms) >= threshold_ms


def _load_gpio_module() -> GPIOProtocol | None:
    """Lazily import the GPIO driver when it is available."""
    try:
        return cast("GPIOProtocol", importlib.import_module("RPi.GPIO"))
    except ImportError:
        return None


def _lane_pin(lane: Lane) -> int:
    """Return the configured GPIO pin for the given lane."""
    env_var = (
        "RHYTHM_LEFT_CONTACT_PIN" if lane == "left" else "RHYTHM_RIGHT_CONTACT_PIN"
    )
    fallback = "17" if lane == "left" else "27"
    raw_value = os.getenv(env_var, fallback)
    try:
        return int(raw_value)
    except ValueError:
        return int(fallback)


def read_jump_box_states() -> dict[Lane, bool]:
    """Return the pressed state for each physical lane."""
    gpio = _load_gpio_module()
    if gpio is None:
        return {"left": False, "right": False}

    states: dict[Lane, bool] = {"left": False, "right": False}
    try:
        gpio.setmode(gpio.BCM)
        for lane in ("left", "right"):
            pin = _lane_pin(lane)
            gpio.setup(pin, gpio.IN, pull_up_down=gpio.PUD_UP)
            states[lane] = gpio.input(pin) == gpio.LOW
    except (RuntimeError, AttributeError):
        return {"left": False, "right": False}
    return states


def read_contact_pressed() -> bool:
    """Return True when any jump box lane is currently pressed."""
    return any(read_jump_box_states().values())
