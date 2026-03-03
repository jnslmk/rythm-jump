from rhythm_jump.engine.session import GameSession, Mode


def test_browser_attached_disconnect_aborts_playing_session() -> None:
    session = GameSession(mode=Mode.BROWSER_ATTACHED)

    session.start()
    session.on_browser_disconnected()

    assert session.state == 'aborted_disconnected'


def test_headless_disconnect_does_not_abort_playing_session() -> None:
    session = GameSession(mode=Mode.HEADLESS)

    session.start()
    session.on_browser_disconnected()

    assert session.state == 'playing'
