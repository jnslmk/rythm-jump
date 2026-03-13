"""CLI helpers for development and Raspberry Pi hardware debugging."""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from rythm_jump.engine.types import Lane

from rythm_jump.config import build_gpio_config, build_led_config
from rythm_jump.engine.led_frames import LedFrame
from rythm_jump.hw.gpio_input import read_jump_box_states
from rythm_jump.hw.led_output import Ws2811LedOutput

DEFAULT_PORT = 8000
DEFAULT_GPIO_INTERVAL_S = 0.1
DEFAULT_LED_DELAY_S = 0.25
DEFAULT_LED_REPEAT = 1
INTERRUPTED_EXIT_CODE = 130
LaneStateMap = dict["Lane", bool]

NAMED_COLORS = {
    "off": (0, 0, 0),
    "red": (255, 0, 0),
    "green": (0, 255, 0),
    "blue": (0, 0, 255),
    "white": (255, 255, 255),
    "amber": (255, 191, 0),
    "pink": (255, 64, 160),
    "cyan": (0, 200, 255),
}


class LedFrameWriter(Protocol):
    """Minimal interface required by the LED debug command."""

    def write_frame(self, frame: LedFrame) -> None:
        """Render one LED frame."""


@dataclass(frozen=True, slots=True)
class LedDebugOptions:
    """Configuration for the LED output debug command."""

    pattern: str
    color_name: str
    repeat: int
    delay_s: float


def _stdout_write(message: str) -> None:
    """Write one message chunk to standard output."""
    sys.stdout.write(message)


def dev() -> None:
    """Run the development server with auto-reload."""
    host = "0.0.0.0"  # noqa: S104
    os.execvp(  # noqa: S606
        sys.executable,
        [
            sys.executable,
            "-m",
            "uvicorn",
            "rythm_jump.main:app",
            "--reload",
            "--host",
            host,
            "--port",
            str(DEFAULT_PORT),
        ],
    )


def _build_led_frame(pixels: Sequence[tuple[int, int, int]]) -> LedFrame:
    """Wrap raw RGB pixels in a `LedFrame` for output adapters."""
    return LedFrame(progress_ms=0, pixels=tuple(pixels), levels=(0.0, 0.0))


def _solid_pixels(
    led_count: int,
    color: tuple[int, int, int],
) -> tuple[tuple[int, int, int], ...]:
    """Build a full-strip solid-color pixel list."""
    return tuple(color for _ in range(led_count))


def _chase_pixels(
    led_count: int,
    color: tuple[int, int, int],
    step: int,
) -> tuple[tuple[int, int, int], ...]:
    """Build a one-pixel chase frame."""
    pixels = [(0, 0, 0) for _ in range(led_count)]
    pixels[step % led_count] = color
    return tuple(pixels)


def _lane_pixels(
    led_count: int,
    left_color: tuple[int, int, int],
    right_color: tuple[int, int, int],
) -> tuple[tuple[int, int, int], ...]:
    """Build a left/right split frame that mirrors the gameplay lanes."""
    half = led_count // 2
    return tuple(
        left_color if index < half else right_color for index in range(led_count)
    )


def _led_pattern_frames(
    *,
    led_count: int,
    pattern: str,
    color: tuple[int, int, int],
) -> list[LedFrame]:
    """Expand a named LED pattern into one or more output frames."""
    if pattern == "solid":
        return [_build_led_frame(_solid_pixels(led_count, color))]
    if pattern == "lanes":
        return [
            _build_led_frame(
                _lane_pixels(
                    led_count,
                    NAMED_COLORS["cyan"],
                    NAMED_COLORS["pink"],
                ),
            ),
        ]
    return [
        _build_led_frame(_chase_pixels(led_count, color, step))
        for step in range(led_count)
    ]


def _format_gpio_state(states: LaneStateMap) -> str:
    """Convert the lane-state map into a compact terminal string."""
    left = "ON" if states.get("left") else "off"
    right = "ON" if states.get("right") else "off"
    return f"left={left} right={right}"


def debug_jump_box_signals(
    *,
    samples: int,
    interval_s: float,
    reader: Callable[[], LaneStateMap] = read_jump_box_states,
    sleep: Callable[[float], None] = time.sleep,
    stdout: Callable[[str], None] = _stdout_write,
) -> None:
    """Poll the jump box GPIO state map and print transitions."""
    gpio_config = build_gpio_config()
    stdout(
        "Polling jump box inputs "
        f"(left pin {gpio_config.left_contact_pin}, "
        f"right pin {gpio_config.right_contact_pin})\n",
    )
    previous_state: LaneStateMap | None = None
    remaining = samples
    while remaining != 0:
        current_state = reader()
        if current_state != previous_state:
            stdout(f"{_format_gpio_state(current_state)}\n")
            previous_state = dict(current_state)
        if remaining > 0:
            remaining -= 1
        if remaining != 0:
            sleep(interval_s)


def debug_ws2811_output(
    *,
    options: LedDebugOptions,
    writer: LedFrameWriter | None = None,
    sleep: Callable[[float], None] = time.sleep,
    stdout: Callable[[str], None] = _stdout_write,
) -> None:
    """Drive the WS2811 output with a simple diagnostic pattern."""
    led_config = build_led_config()
    selected_color = NAMED_COLORS[options.color_name]
    output = writer or Ws2811LedOutput()
    stdout(
        "Driving WS2811 output "
        f"(count={led_config.count}, pin={led_config.pin}, "
        f"pattern={options.pattern}, color={options.color_name})\n",
    )
    frames = _led_pattern_frames(
        led_count=led_config.count,
        pattern=options.pattern,
        color=selected_color,
    )
    loops = options.repeat if options.repeat > 0 else 1
    for _ in range(loops):
        for frame in frames:
            output.write_frame(frame)
            sleep(options.delay_s)
    output.write_frame(
        _build_led_frame(
            _solid_pixels(led_config.count, NAMED_COLORS["off"]),
        ),
    )
    stdout("LED diagnostic finished; output cleared\n")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rj-debug")
    subparsers = parser.add_subparsers(dest="command", required=True)

    gpio_parser = subparsers.add_parser(
        "gpio",
        help="Poll left/right jump box inputs and print state transitions",
    )
    gpio_parser.add_argument(
        "--samples",
        type=int,
        default=0,
        help=(
            "Number of samples to read before exiting. Use 0 to run until interrupted."
        ),
    )
    gpio_parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_GPIO_INTERVAL_S,
        help="Polling interval in seconds.",
    )

    led_parser = subparsers.add_parser(
        "led",
        help="Drive the WS2811 strip with a simple diagnostic pattern",
    )
    led_parser.add_argument(
        "--pattern",
        choices=("solid", "chase", "lanes"),
        default="chase",
    )
    led_parser.add_argument(
        "--color",
        choices=tuple(NAMED_COLORS),
        default="amber",
    )
    led_parser.add_argument(
        "--repeat",
        type=int,
        default=DEFAULT_LED_REPEAT,
        help="How many times to run the pattern.",
    )
    led_parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_LED_DELAY_S,
        help="Delay between frames in seconds.",
    )

    return parser


def debug_hw(argv: Sequence[str] | None = None) -> int:
    """Run the hardware debug CLI."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "gpio":
            debug_jump_box_signals(samples=args.samples, interval_s=args.interval)
        else:
            debug_ws2811_output(
                options=LedDebugOptions(
                    pattern=args.pattern,
                    color_name=args.color,
                    repeat=args.repeat,
                    delay_s=args.delay,
                ),
            )
    except KeyboardInterrupt:
        sys.stdout.write("Interrupted by user\n")
        return INTERRUPTED_EXIT_CODE
    return 0


def main() -> None:
    """Compatibility entry point for direct module execution."""
    raise SystemExit(debug_hw())
