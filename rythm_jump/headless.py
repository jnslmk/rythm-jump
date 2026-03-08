"""Headless helpers that run a session without any UI."""

from collections.abc import Iterable

from rythm_jump.engine.session import GameSession, State


def should_start(*, contact_pressed: bool) -> bool:
    """Return whether a session should start given the current contact state."""
    return contact_pressed


def trigger_start_if_needed(session: GameSession, *, contact_pressed: bool) -> bool:
    """Attempt to start the session when contact is pressed."""
    if not should_start(contact_pressed=contact_pressed):
        return False

    previous_state = session.state
    session.start_from_contact()
    return previous_state != State.PLAYING and session.state == State.PLAYING


def run_headless_step(session: GameSession, *, contact_pressed: bool) -> bool:
    """Process a single headless contact event."""
    return trigger_start_if_needed(
        session=session,
        contact_pressed=contact_pressed,
    )


def run_headless_loop(session: GameSession, contact_events: Iterable[bool]) -> bool:
    """Walk through contact events until a session start occurs."""
    started = False
    for contact_pressed in contact_events:
        if run_headless_step(session=session, contact_pressed=contact_pressed):
            started = True
            break
    return started
