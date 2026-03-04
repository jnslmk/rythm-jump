from rhythm_jump.engine.session import GameSession, Mode, State
from rhythm_jump.headless import run_headless_loop, run_headless_step, should_start, trigger_start_if_needed
from rhythm_jump.main import is_headless_mode_enabled, run_headless_polling_step


def test_should_start_when_contact_pressed_in_headless_mode() -> None:
    assert should_start(contact_pressed=True, mode=Mode.HEADLESS) is True


def test_run_headless_step_starts_session_on_contact_press() -> None:
    session = GameSession(mode=Mode.HEADLESS)

    started = run_headless_step(session=session, contact_pressed=True)

    assert started is True
    assert session.state == State.PLAYING


def test_run_headless_step_ignores_no_press_and_non_headless() -> None:
    idle_headless = GameSession(mode=Mode.HEADLESS)
    browser_session = GameSession(mode=Mode.BROWSER_ATTACHED)

    assert run_headless_step(session=idle_headless, contact_pressed=False) is False
    assert idle_headless.state == State.IDLE

    assert run_headless_step(session=browser_session, contact_pressed=True) is False
    assert browser_session.state == State.IDLE


def test_trigger_start_if_needed_returns_false_when_already_playing() -> None:
    session = GameSession(mode=Mode.HEADLESS)
    session.start()

    started = trigger_start_if_needed(session=session, contact_pressed=True)

    assert started is False
    assert session.state == State.PLAYING


def test_run_headless_loop_starts_on_first_valid_press_and_stops() -> None:
    session = GameSession(mode=Mode.HEADLESS)
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
    session = GameSession(mode=Mode.BROWSER_ATTACHED)

    started = run_headless_loop(session=session, contact_events=[False, True, False])

    assert started is False
    assert session.state == State.IDLE


def test_run_headless_polling_step_uses_contact_reader() -> None:
    session = GameSession(mode=Mode.HEADLESS)
    events = iter([False, True])

    assert run_headless_polling_step(session, lambda: next(events)) is False
    assert session.state == State.IDLE

    assert run_headless_polling_step(session, lambda: next(events)) is True
    assert session.state == State.PLAYING


def test_run_headless_polling_step_uses_default_gpio_reader(monkeypatch) -> None:
    session = GameSession(mode=Mode.HEADLESS)
    monkeypatch.setattr('rhythm_jump.main.read_contact_pressed', lambda: True)

    assert run_headless_polling_step(session) is True
    assert session.state == State.PLAYING


def test_is_headless_mode_enabled_from_env(monkeypatch) -> None:
    monkeypatch.setenv('RHYTHM_HEADLESS_MODE', '1')
    assert is_headless_mode_enabled() is True

    monkeypatch.setenv('RHYTHM_HEADLESS_MODE', '0')
    assert is_headless_mode_enabled() is False
