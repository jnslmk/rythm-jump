"""Compatibility shims for dependencies that expect older stdlib APIs."""

from __future__ import annotations

import collections
from collections.abc import MutableSequence

try:
    import numpy as np
except ImportError:  # pragma: no cover - optional dependency
    np = None  # type: ignore[invalid-assignment]
__all__ = ["ensure_mutable_sequence", "ensure_numpy_aliases"]


def ensure_mutable_sequence() -> None:
    """Expose ``collections.MutableSequence`` for packages that still import it."""
    if hasattr(collections, "MutableSequence"):
        return

    collections.MutableSequence = MutableSequence


def ensure_numpy_aliases() -> None:
    """Re-introduce deprecated NumPy aliases required by upstream libs."""
    if np is None:
        return

    for alias, target in (("float", float), ("int", int)):
        if not hasattr(np, alias):
            setattr(np, alias, target)


ensure_mutable_sequence()
ensure_numpy_aliases()
