"""Judgement helpers used by the Rhythm Jump session engine."""


def judge(delta_ms: int, perfect: int, good: int) -> str:
    """Return the judgement string for the provided hit window."""
    if perfect < 0:
        message = "perfect must be >= 0"
        raise ValueError(message)
    if good < 0:
        message = "good must be >= 0"
        raise ValueError(message)
    if perfect > good:
        message = "perfect must be <= good"
        raise ValueError(message)

    absolute_delta = abs(delta_ms)
    if absolute_delta <= perfect:
        return "perfect"
    if absolute_delta <= good:
        return "good"
    return "miss"
