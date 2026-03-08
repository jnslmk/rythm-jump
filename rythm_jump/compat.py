"""Compatibility shims for dependencies that expect older stdlib APIs."""

from __future__ import annotations

import collections

__all__ = ["ensure_mutable_sequence"]


def ensure_mutable_sequence() -> None:
    """Expose ``collections.MutableSequence`` for packages that still import it."""

    if hasattr(collections, "MutableSequence"):
        return

    from collections.abc import MutableSequence

    setattr(collections, "MutableSequence", MutableSequence)


ensure_mutable_sequence()
