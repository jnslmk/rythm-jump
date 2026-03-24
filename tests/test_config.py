from pathlib import Path

from rythm_jump import config

LEFT_CONTACT_PIN = 22
RIGHT_CONTACT_PIN = 23
LED_COUNT = 48


def _write_config(
    path: Path, *, led_count: object = LED_COUNT, led_invert: object = True
) -> None:
    path.write_text(
        "\n".join(
            [
                "[paths]",
                'songs_dir = "custom_songs"',
                'frontend_dir = "custom_web"',
                "",
                "[gpio]",
                f"left_contact_pin = {LEFT_CONTACT_PIN}",
                f"right_contact_pin = {RIGHT_CONTACT_PIN}",
                "",
                "[led]",
                f"count = {led_count}",
                "pin = 18",
                "freq_hz = 800000",
                "dma = 10",
                f"invert = {str(led_invert).lower()}",
                "brightness = 255",
                "channel = 0",
                "",
            ],
        ),
        encoding="utf-8",
    )


def test_build_path_config_uses_toml_values(tmp_path: Path) -> None:
    config_path = tmp_path / "rythm_jump.toml"
    _write_config(config_path)

    path_config = config.build_path_config(config_path)

    assert path_config.songs_dir == tmp_path / "custom_songs"
    assert path_config.frontend_dir == tmp_path / "custom_web"


def test_build_gpio_config_reads_toml(tmp_path: Path) -> None:
    config_path = tmp_path / "rythm_jump.toml"
    _write_config(config_path)

    gpio_config = config.build_gpio_config(config_path)

    assert gpio_config.left_contact_pin == LEFT_CONTACT_PIN
    assert gpio_config.right_contact_pin == RIGHT_CONTACT_PIN


def test_build_led_config_falls_back_on_invalid_toml_values(tmp_path: Path) -> None:
    config_path = tmp_path / "rythm_jump.toml"
    _write_config(config_path, led_count='"invalid"', led_invert='"true"')

    led_config = config.build_led_config(config_path)

    assert led_config.count == 60
    assert led_config.invert is False
