def judge(delta_ms: int, perfect: int, good: int) -> str:
    absolute_delta = abs(delta_ms)
    if absolute_delta <= perfect:
        return 'perfect'
    if absolute_delta <= good:
        return 'good'
    return 'miss'
