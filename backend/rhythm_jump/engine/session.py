from enum import StrEnum


class Mode(StrEnum):
    BROWSER_ATTACHED = 'browser_attached'
    HEADLESS = 'headless'


class GameSession:
    def __init__(self, mode: Mode) -> None:
        self.mode = mode
        self.state = 'idle'

    def start(self) -> None:
        self.state = 'playing'

    def on_browser_disconnected(self) -> None:
        if self.state != 'playing':
            return
        if self.mode == Mode.BROWSER_ATTACHED:
            self.state = 'aborted_disconnected'
