from fastapi import FastAPI

import pytest

from rythm_jump.bootstrap import (
    attach_runtime_stack,
    build_runtime_stack,
)
from rythm_jump.config import build_led_config
from rythm_jump.hw.audio_playback import NoOpAudioPlayer
from rythm_jump.hw.led_output import NoOpLedOutput


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
