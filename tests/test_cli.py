from dataclasses import dataclass

import pytest

from rythm_jump.cli import (
    INTERRUPTED_EXIT_CODE,
    NAMED_COLORS,
    LedDebugOptions,
    _format_gpio_state,
    _led_pattern_frames,
    debug_hw,
    debug_jump_box_signals,
    debug_ws2811_output,
)
from rythm_jump.engine.led_frames import LedFrame

LED_COUNT = 4
LED_PIN = 18
GPIO_INTERVAL_S = 0.2
CHASE_FRAME_COUNT = 4


@dataclass
class StubLedConfig:
    """Minimal LED config object for CLI tests."""

    count: int = LED_COUNT
    pin: int = LED_PIN


class StubLedOutput:
    """Capture frames written by the CLI LED test helper."""

    def __init__(self) -> None:
        """Initialize the captured frame list."""
        self.frames: list[LedFrame] = []

    def write_frame(self, frame: LedFrame) -> None:
        """Store the next emitted frame."""
        self.frames.append(frame)


def test_format_gpio_state_renders_both_lanes() -> None:
    assert _format_gpio_state({"left": True, "right": False}) == "left=ON right=off"


def test_led_pattern_frames_builds_chase_sequence() -> None:
    frames = _led_pattern_frames(
        led_count=LED_COUNT,
        pattern="chase",
        color=NAMED_COLORS["red"],
    )

    assert len(frames) == CHASE_FRAME_COUNT
    assert frames[0].pixels[0] == NAMED_COLORS["red"]
    assert frames[1].pixels[1] == NAMED_COLORS["red"]


def test_debug_jump_box_signals_prints_transitions_only() -> None:
    readings = iter(
        [
            {"left": False, "right": False},
            {"left": False, "right": False},
            {"left": True, "right": False},
        ],
    )
    lines = []

    debug_jump_box_signals(
        samples=3,
        interval_s=0,
        reader=lambda: next(readings),
        sleep=lambda _: None,
        stdout=lambda line: lines.append(line.rstrip()),
    )

    assert lines[0].startswith("Polling jump box inputs")
    assert lines[1:] == ["left=off right=off", "left=ON right=off"]


def _build_stub_led_config() -> StubLedConfig:
    """Return a deterministic LED config for CLI tests."""
    return StubLedConfig()


def test_debug_ws2811_output_clears_strip_at_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = StubLedOutput()
    lines = []
    monkeypatch.setattr("rythm_jump.cli.build_led_config", _build_stub_led_config)

    debug_ws2811_output(
        options=LedDebugOptions(
            pattern="solid",
            color_name="green",
            repeat=1,
            delay_s=0,
        ),
        writer=output,
        sleep=lambda _: None,
        stdout=lambda line: lines.append(line.rstrip()),
    )

    assert output.frames[0].pixels == ((0, 255, 0),) * LED_COUNT
    assert output.frames[-1].pixels == ((0, 0, 0),) * LED_COUNT
    assert lines[-1] == "LED diagnostic finished; output cleared"


def test_debug_hw_dispatches_gpio_command(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {}

    def fake_debug_jump_box_signals(*, samples: int, interval_s: float) -> None:
        called["samples"] = samples
        called["interval_s"] = interval_s

    monkeypatch.setattr(
        "rythm_jump.cli.debug_jump_box_signals",
        fake_debug_jump_box_signals,
    )

    exit_code = debug_hw(["gpio", "--samples", "2", "--interval", "0.2"])

    assert exit_code == 0
    assert called == {"samples": 2, "interval_s": GPIO_INTERVAL_S}


def test_debug_hw_returns_130_on_keyboard_interrupt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_debug_jump_box_signals(*, samples: int, interval_s: float) -> None:
        _ = (samples, interval_s)
        raise KeyboardInterrupt

    monkeypatch.setattr(
        "rythm_jump.cli.debug_jump_box_signals",
        fake_debug_jump_box_signals,
    )

    assert debug_hw(["gpio", "--samples", "1"]) == INTERRUPTED_EXIT_CODE
