from pathlib import Path

import pytest

from rythm_jump.config import build_gpio_config, build_led_config, build_path_config

LEFT_CONTACT_PIN = 22
RIGHT_CONTACT_PIN = 23
DEFAULT_LED_COUNT = 70


def test_build_path_config_uses_repo_defaults() -> None:
    config = build_path_config()

    assert config.songs_dir == Path(__file__).resolve().parents[1] / "songs"
    assert config.frontend_dir == Path(__file__).resolve().parents[1] / "web"


def test_build_gpio_config_respects_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RHYTHM_LEFT_CONTACT_PIN", str(LEFT_CONTACT_PIN))
    monkeypatch.setenv("RHYTHM_RIGHT_CONTACT_PIN", str(RIGHT_CONTACT_PIN))

    config = build_gpio_config()

    assert config.left_contact_pin == LEFT_CONTACT_PIN
    assert config.right_contact_pin == RIGHT_CONTACT_PIN


def test_build_led_config_falls_back_on_invalid_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RHYTHM_LED_COUNT", "invalid")
    monkeypatch.setenv("RHYTHM_LED_INVERT", "true")

    config = build_led_config()

    assert config.count == DEFAULT_LED_COUNT
    assert config.invert is True
