"""Central configuration helpers for paths and Raspberry Pi hardware."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def repo_root_dir() -> Path:
    """Return the repository root directory."""
    return Path(__file__).resolve().parents[1]


def _read_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def _read_bool_env(name: str, *, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() == "true"


@dataclass(frozen=True, slots=True)
class PathConfig:
    """Filesystem locations used by the application."""

    repo_root: Path
    songs_dir: Path
    frontend_dir: Path


@dataclass(frozen=True, slots=True)
class GpioConfig:
    """GPIO input pin assignments."""

    left_contact_pin: int
    right_contact_pin: int


@dataclass(frozen=True, slots=True)
class LedConfig:
    """LED strip configuration for the physical output adapter."""

    count: int
    pin: int
    freq_hz: int
    dma: int
    invert: bool
    brightness: int
    channel: int


def build_path_config() -> PathConfig:
    """Return path configuration, allowing environment overrides."""
    repo_root = repo_root_dir()
    songs_dir = Path(os.getenv("RHYTHM_SONGS_DIR", repo_root / "songs")).expanduser()
    frontend_dir = Path(
        os.getenv("RHYTHM_FRONTEND_DIR", repo_root / "web"),
    ).expanduser()
    return PathConfig(
        repo_root=repo_root,
        songs_dir=songs_dir,
        frontend_dir=frontend_dir,
    )


def build_gpio_config() -> GpioConfig:
    """Return GPIO pin assignments for the two gameplay lanes."""
    return GpioConfig(
        left_contact_pin=_read_int_env("RHYTHM_LEFT_CONTACT_PIN", 17),
        right_contact_pin=_read_int_env("RHYTHM_RIGHT_CONTACT_PIN", 27),
    )


def build_led_config() -> LedConfig:
    """Return WS281x strip configuration from the environment."""
    return LedConfig(
        count=_read_int_env("RHYTHM_LED_COUNT", 70),
        pin=_read_int_env("RHYTHM_LED_PIN", 18),
        freq_hz=_read_int_env("RHYTHM_LED_FREQ_HZ", 800000),
        dma=_read_int_env("RHYTHM_LED_DMA", 10),
        invert=_read_bool_env("RHYTHM_LED_INVERT", default=False),
        brightness=_read_int_env("RHYTHM_LED_BRIGHTNESS", 255),
        channel=_read_int_env("RHYTHM_LED_CHANNEL", 0),
    )
