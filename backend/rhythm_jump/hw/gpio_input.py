import importlib
import os
from typing import Any


def debounce_accept(last_ms: int, now_ms: int, threshold_ms: int) -> bool:
    if threshold_ms < 0:
        raise ValueError('threshold_ms must be >= 0')
    # If timestamps move backward, drop the event to avoid false positives.
    if now_ms < last_ms:
        return False
    return (now_ms - last_ms) >= threshold_ms


def _load_gpio_module() -> Any | None:
    try:
        return importlib.import_module('RPi.GPIO')
    except Exception:
        return None


def _contact_pin() -> int:
    raw_value = os.getenv('RHYTHM_CONTACT_PIN', '17')
    try:
        return int(raw_value)
    except ValueError:
        return 17


def read_contact_pressed() -> bool:
    gpio = _load_gpio_module()
    if gpio is None:
        return False

    pin = _contact_pin()
    try:
        gpio.setmode(gpio.BCM)
        gpio.setup(pin, gpio.IN, pull_up_down=gpio.PUD_UP)
        return gpio.input(pin) == gpio.LOW
    except Exception:
        return False
