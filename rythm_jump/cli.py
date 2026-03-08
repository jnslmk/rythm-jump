"""CLI helpers for running Rhythm Jump in development."""

import os
import sys


def dev() -> None:
    """Run the development server with auto-reload."""
    os.execvp(  # noqa: S606
        sys.executable,
        [
            sys.executable,
            "-m",
            "uvicorn",
            "rythm_jump.main:app",
            "--reload",
            "--host",
            "0.0.0.0",  # noqa: S104
            "--port",
            "8000",
        ],
    )
