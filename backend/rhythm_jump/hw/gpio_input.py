def debounce_accept(last_ms: int, now_ms: int, threshold_ms: int) -> bool:
    if threshold_ms < 0:
        raise ValueError('threshold_ms must be >= 0')
    # If timestamps move backward, drop the event to avoid false positives.
    if now_ms < last_ms:
        return False
    return (now_ms - last_ms) >= threshold_ms
