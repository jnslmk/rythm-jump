"""GPIO helpers for detecting the physical contact pin."""

import importlib
import os
from types import ModuleType


def debounce_accept(last_ms: int, now_ms: int, threshold_ms: int) -> bool:
    """Return True when the elapsed time exceeds the configured threshold."""
    if threshold_ms < 0:
        message = "threshold_ms must be >= 0"
        raise ValueError(message)
    # If timestamps move backward, drop the event to avoid false positives.
    if now_ms < last_ms:
        return False
    return (now_ms - last_ms) >= threshold_ms


def _load_gpio_module() -> ModuleType | None:
    """Lazily import the GPIO driver when it is available."""
    try:
        return importlib.import_module("RPi.GPIO")
    except ImportError:
        return None


def _contact_pin() -> int:
    """Return the GPIO pin that represents the contact sensor."""
    raw_value = os.getenv("RHYTHM_CONTACT_PIN", "17")
    try:
        return int(raw_value)
    except ValueError:
        return 17


def read_contact_pressed() -> bool:
    """Return True when the contact sensor is pressed."""
    gpio = _load_gpio_module()
    if gpio is None:
        return False

    pin = _contact_pin()
    try:
        gpio.setmode(gpio.BCM)
        gpio.setup(pin, gpio.IN, pull_up_down=gpio.PUD_UP)
        return gpio.input(pin) == gpio.LOW
    except (RuntimeError, AttributeError):
        return False
