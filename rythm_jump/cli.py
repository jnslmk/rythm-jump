def dev() -> None:
    """Run development server with auto-reload."""
    import os
    import sys

    os.execvp(
        sys.executable,
        [
            sys.executable,
            "-m",
            "uvicorn",
            "rythm_jump.main:app",
            "--reload",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
        ],
    )
