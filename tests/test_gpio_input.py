from rythm_jump.hw import gpio_input


class _FakeGpioModule:
    BCM = 11
    IN = 1
    PUD_UP = 21
    LOW = 0
    HIGH = 1

    def __init__(self, read_value: int) -> None:
        self.read_value = read_value
        self.setup_calls: list[tuple[int, int, int]] = []
        self.mode_calls: list[int] = []

    def setmode(self, mode: int) -> None:
        self.mode_calls.append(mode)

    def setup(self, pin: int, direction: int, pull_up_down: int) -> None:
        self.setup_calls.append((pin, direction, pull_up_down))

    def input(self, pin: int) -> int:
        return self.read_value


def test_read_contact_pressed_returns_false_when_gpio_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(gpio_input, "_load_gpio_module", lambda: None)

    assert gpio_input.read_contact_pressed() is False


def test_read_contact_pressed_uses_active_low_pull_up(monkeypatch) -> None:
    fake = _FakeGpioModule(read_value=_FakeGpioModule.LOW)
    monkeypatch.setattr(gpio_input, "_load_gpio_module", lambda: fake)
    monkeypatch.setenv("RHYTHM_CONTACT_PIN", "22")

    assert gpio_input.read_contact_pressed() is True
    assert fake.mode_calls == [_FakeGpioModule.BCM]
    assert fake.setup_calls == [(22, _FakeGpioModule.IN, _FakeGpioModule.PUD_UP)]
