from rhythm_jump.headless import should_start


def test_should_start_when_contact_pressed_in_headless_mode() -> None:
    assert should_start(contact_pressed=True, mode='headless') is True
