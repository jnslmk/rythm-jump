def debounce_accept(last_ms: int, now_ms: int, threshold_ms: int) -> bool:
    return (now_ms - last_ms) >= threshold_ms
