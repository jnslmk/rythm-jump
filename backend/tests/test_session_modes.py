from rhythm_jump.engine.session import GameSession, Mode, State


def test_browser_attached_disconnect_aborts_playing_session() -> None:
    session = GameSession(mode=Mode.BROWSER_ATTACHED)

    session.start()
    session.on_browser_disconnected()

    assert session.state == State.ABORTED_DISCONNECTED


def test_headless_disconnect_does_not_abort_playing_session() -> None:
    session = GameSession(mode=Mode.HEADLESS)

    session.start()
    session.on_browser_disconnected()

    assert session.state == State.PLAYING


def test_disconnect_while_idle_is_noop() -> None:
    session = GameSession(mode=Mode.BROWSER_ATTACHED)

    session.on_browser_disconnected()

    assert session.state == State.IDLE


def test_browser_disconnect_is_idempotent() -> None:
    session = GameSession(mode=Mode.BROWSER_ATTACHED)

    session.start()
    session.on_browser_disconnected()
    session.on_browser_disconnected()

    assert session.state == State.ABORTED_DISCONNECTED


def test_start_after_aborted_disconnected_is_noop() -> None:
    session = GameSession(mode=Mode.BROWSER_ATTACHED)

    session.start()
    session.on_browser_disconnected()
    session.start()

    assert session.state == State.ABORTED_DISCONNECTED
