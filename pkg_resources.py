"""Lightweight helpers for distribution metadata used by the CLI."""

from importlib import metadata


class Distribution:
    """Wrap the version information returned by :mod:`importlib.metadata`."""

    def __init__(self, version: str) -> None:
        """Store the resolved version so callers can inspect it."""
        self.version = version


def get_distribution(name: str) -> Distribution:
    """Return the distribution metadata for ``name``."""
    try:
        version = metadata.version(name)
    except metadata.PackageNotFoundError as exc:
        message = f"package {name!r} not found"
        raise ImportError(message) from exc
    return Distribution(version)
