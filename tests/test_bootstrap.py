import pytest
from fastapi import FastAPI

from rythm_jump.bootstrap import (
    attach_runtime_stack,
    build_runtime_stack,
)
from rythm_jump.config import build_led_config
from rythm_jump.engine.led_frames import LedFrame
from rythm_jump.hw.audio_playback import NoOpAudioPlayer
from rythm_jump.hw.led_output import NoOpLedOutput, Ws2811LedOutput


@pytest.fixture(autouse=True)
def no_physical_led_output(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("rythm_jump.bootstrap.Ws2811LedOutput", NoOpLedOutput)


def test_build_runtime_stack_wires_runtime_and_input() -> None:
    stack = build_runtime_stack(audio_player=NoOpAudioPlayer())

    assert stack.runtime is not None
    assert stack.input_source is not None
    assert stack.polling_task is None
    assert stack.runtime.strip_len == build_led_config().count


def test_attach_runtime_stack_exposes_objects_on_app_state() -> None:
    app = FastAPI()
    stack = build_runtime_stack(audio_player=NoOpAudioPlayer())

    attach_runtime_stack(app, stack)

    assert app.state.runtime is stack.runtime
    assert app.state.input_source is stack.input_source
    assert app.state.polling_task is None


def test_ws2811_led_output_falls_back_when_strip_init_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnsupportedPixelStrip:
        def __init__(self, *args: object) -> None:
            _ = args

        def begin(self) -> None:
            message = "Hardware revision is not supported"
            raise RuntimeError(message)

    class StubModule:
        PixelStrip = UnsupportedPixelStrip
        Color = staticmethod(lambda red, green, blue: (red, green, blue))

    monkeypatch.setattr(
        "rythm_jump.hw.led_output._supports_physical_ws2811",
        lambda: True,
    )
    monkeypatch.setattr(
        "rythm_jump.hw.led_output.importlib.import_module",
        lambda name: StubModule if name == "rpi_ws281x" else None,
    )

    output = Ws2811LedOutput()

    output.write_frame(LedFrame(progress_ms=0, pixels=((0, 0, 0),), levels=(0.0, 0.0)))


def test_ws2811_led_output_skips_physical_init_off_pi(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "rythm_jump.hw.led_output._supports_physical_ws2811",
        lambda: False,
    )

    imported_names: list[str] = []

    def record_import(name: str) -> None:
        imported_names.append(name)

    monkeypatch.setattr(
        "rythm_jump.hw.led_output.importlib.import_module",
        record_import,
    )

    output = Ws2811LedOutput()

    assert imported_names == []
    output.write_frame(LedFrame(progress_ms=0, pixels=((0, 0, 0),), levels=(0.0, 0.0)))
