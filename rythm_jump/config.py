"""Central configuration helpers for paths and Raspberry Pi hardware."""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from pathlib import Path
import tomllib


def repo_root_dir() -> Path:
    """Return the repository root directory."""
    return Path(__file__).resolve().parents[1]


DEFAULT_CONFIG_PATH = repo_root_dir() / "rythm_jump.toml"


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


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Top-level application configuration."""

    paths: PathConfig
    gpio: GpioConfig
    led: LedConfig


def _resolve_config_path(path: str | Path | None) -> Path:
    if path is None:
        return DEFAULT_CONFIG_PATH
    return Path(path).expanduser().resolve()


def _read_toml_table(document: dict[str, object], key: str) -> dict[str, object]:
    value = document.get(key, {})
    if not isinstance(value, dict):
        message = f"{key} must be a TOML table"
        raise ValueError(message)
    return value


def _read_int(table: dict[str, object], key: str, default: int) -> int:
    value = table.get(key, default)
    if type(value) is int:
        return value
    return default


def _read_bool(table: dict[str, object], key: str, default: bool) -> bool:
    value = table.get(key, default)
    if type(value) is bool:
        return value
    return default


def _read_path(
    config_dir: Path, table: dict[str, object], key: str, default: str
) -> Path:
    raw_value = table.get(key, default)
    if not isinstance(raw_value, str):
        raw_value = default
    candidate = Path(raw_value).expanduser()
    if candidate.is_absolute():
        return candidate
    return (config_dir / candidate).resolve()


@cache
def _load_app_config_cached(config_path: Path) -> AppConfig:
    config_dir = config_path.parent
    if config_path.exists():
        document = tomllib.loads(config_path.read_text(encoding="utf-8"))
    else:
        document = {}

    paths_table = _read_toml_table(document, "paths")
    gpio_table = _read_toml_table(document, "gpio")
    led_table = _read_toml_table(document, "led")

    return AppConfig(
        paths=PathConfig(
            repo_root=repo_root_dir(),
            songs_dir=_read_path(config_dir, paths_table, "songs_dir", "songs"),
            frontend_dir=_read_path(config_dir, paths_table, "frontend_dir", "web"),
        ),
        gpio=GpioConfig(
            left_contact_pin=_read_int(gpio_table, "left_contact_pin", 17),
            right_contact_pin=_read_int(gpio_table, "right_contact_pin", 27),
        ),
        led=LedConfig(
            count=_read_int(led_table, "count", 60),
            pin=_read_int(led_table, "pin", 18),
            freq_hz=_read_int(led_table, "freq_hz", 800000),
            dma=_read_int(led_table, "dma", 10),
            invert=_read_bool(led_table, "invert", False),
            brightness=_read_int(led_table, "brightness", 255),
            channel=_read_int(led_table, "channel", 0),
        ),
    )


def clear_config_cache() -> None:
    """Clear cached config values so tests can swap configuration files."""
    _load_app_config_cached.cache_clear()


def load_app_config(path: str | Path | None = None) -> AppConfig:
    """Load the complete application configuration from TOML."""
    return _load_app_config_cached(_resolve_config_path(path))


def build_path_config(path: str | Path | None = None) -> PathConfig:
    """Return filesystem path configuration."""
    return load_app_config(path).paths


def build_gpio_config(path: str | Path | None = None) -> GpioConfig:
    """Return GPIO pin assignments for the two gameplay lanes."""
    return load_app_config(path).gpio


def build_led_config(path: str | Path | None = None) -> LedConfig:
    """Return WS281x strip configuration."""
    return load_app_config(path).led
