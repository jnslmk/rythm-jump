from collections.abc import Iterable

from rhythm_jump.engine.session import GameSession, Mode, State


def should_start(contact_pressed: bool, mode: Mode) -> bool:
    return contact_pressed and mode == Mode.HEADLESS


def trigger_start_if_needed(session: GameSession, contact_pressed: bool) -> bool:
    if not should_start(contact_pressed=contact_pressed, mode=session.mode):
        return False

    previous_state = session.state
    session.start_from_contact()
    return previous_state != State.PLAYING and session.state == State.PLAYING


def run_headless_step(session: GameSession, contact_pressed: bool) -> bool:
    return trigger_start_if_needed(session=session, contact_pressed=contact_pressed)


def run_headless_loop(session: GameSession, contact_events: Iterable[bool]) -> bool:
    started = False
    for contact_pressed in contact_events:
        if run_headless_step(session=session, contact_pressed=contact_pressed):
            started = True
            break
    return started
