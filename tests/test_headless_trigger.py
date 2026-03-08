from rythm_jump.engine.session import GameSession, State
from rythm_jump.headless import (
    run_headless_loop,
    run_headless_step,
    should_start,
    trigger_start_if_needed,
)
from rythm_jump.main import run_headless_polling_step


def test_should_start_when_contact_pressed() -> None:
    assert should_start(contact_pressed=True) is True
    assert should_start(contact_pressed=False) is False


def test_run_headless_step_starts_session_on_contact_press() -> None:
    session = GameSession()

    started = run_headless_step(session=session, contact_pressed=True)

    assert started is True
    assert session.state == State.PLAYING


def test_run_headless_step_ignores_no_press() -> None:
    session = GameSession()

    assert run_headless_step(session=session, contact_pressed=False) is False
    assert session.state == State.IDLE


def test_trigger_start_if_needed_returns_false_when_already_playing() -> None:
    session = GameSession()
    session.start()

    started = trigger_start_if_needed(session=session, contact_pressed=True)

    assert started is False
    assert session.state == State.PLAYING


def test_run_headless_loop_starts_on_first_valid_press_and_stops() -> None:
    session = GameSession()
    processed = 0

    def _events():
        nonlocal processed
        for event in (False, True, True):
            processed += 1
            yield event

    started = run_headless_loop(session=session, contact_events=_events())

    assert started is True
    assert session.state == State.PLAYING
    assert processed == 2


def test_run_headless_loop_returns_false_when_no_start_occurs() -> None:
    session = GameSession()
    processed = 0

    def _events():
        nonlocal processed
        for event in (False, False):
            processed += 1
            yield event

    started = run_headless_loop(session=session, contact_events=_events())

    assert started is False
    assert session.state == State.IDLE
    assert processed == 2


def test_run_headless_polling_step_uses_contact_reader() -> None:
    session = GameSession()
    events = iter([False, True])

    assert run_headless_polling_step(session, lambda: next(events)) is False
    assert session.state == State.IDLE

    assert run_headless_polling_step(session, lambda: next(events)) is True
    assert session.state == State.PLAYING


def test_run_headless_polling_step_uses_default_gpio_reader(monkeypatch) -> None:
    session = GameSession()
    monkeypatch.setattr("rythm_jump.main.read_contact_pressed", lambda: True)

    assert run_headless_polling_step(session) is True
    assert session.state == State.PLAYING
