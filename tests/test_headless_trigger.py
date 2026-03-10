import pytest

from rythm_jump.engine.io import PollingInputSource


class _FakeRuntime:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    async def submit_lane_input(self, lane: str, *, source: str) -> None:
        self.events.append((lane, source))


@pytest.mark.anyio
async def test_run_headless_step_ignores_idle_states() -> None:
    runtime = _FakeRuntime()
    source = PollingInputSource(
        runtime,
        name="jump_box",
        read_states=lambda: {"left": False, "right": False},
    )

    triggered = await source.poll_once()

    assert triggered is False
    assert runtime.events == []


@pytest.mark.anyio
async def test_run_headless_step_submits_rising_edge_only() -> None:
    runtime = _FakeRuntime()
    states = iter(
        [
            {"left": False, "right": False},
            {"left": True, "right": False},
            {"left": True, "right": False},
            {"left": False, "right": False},
            {"left": True, "right": False},
        ],
    )
    source = PollingInputSource(
        runtime,
        name="jump_box",
        read_states=lambda: next(states),
    )

    assert await source.poll_once() is False
    assert await source.poll_once() is True
    assert await source.poll_once() is False
    assert await source.poll_once() is False
    assert await source.poll_once() is True
    assert runtime.events == [("left", "jump_box"), ("left", "jump_box")]


@pytest.mark.anyio
async def test_poll_once_uses_input_source() -> None:
    runtime = _FakeRuntime()
    source = PollingInputSource(
        runtime,
        name="jump_box",
        read_states=lambda: {"left": False, "right": True},
    )

    assert await source.poll_once() is True
    assert runtime.events == [("right", "jump_box")]
