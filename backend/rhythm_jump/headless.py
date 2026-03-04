from rhythm_jump.engine.session import GameSession, Mode


def should_start(contact_pressed: bool, mode: str) -> bool:
    return contact_pressed and mode == Mode.HEADLESS


def trigger_start_if_needed(session: GameSession, contact_pressed: bool) -> bool:
    if not should_start(contact_pressed=contact_pressed, mode=session.mode):
        return False

    session.start_from_contact()
    return True
