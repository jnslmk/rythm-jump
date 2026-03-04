from rhythm_jump.engine.session import GameSession, Mode, State
from rhythm_jump.headless import run_headless_step, should_start


def test_should_start_when_contact_pressed_in_headless_mode() -> None:
    assert should_start(contact_pressed=True, mode='headless') is True


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
