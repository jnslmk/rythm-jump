def judge(delta_ms: int, perfect: int, good: int) -> str:
    if perfect < 0:
        raise ValueError("perfect must be >= 0")
    if good < 0:
        raise ValueError("good must be >= 0")
    if perfect > good:
        raise ValueError("perfect must be <= good")

    absolute_delta = abs(delta_ms)
    if absolute_delta <= perfect:
        return "perfect"
    if absolute_delta <= good:
        return "good"
    return "miss"
