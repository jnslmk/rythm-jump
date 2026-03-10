# Timing Repro

Use the checked-in Playwright timing probe to measure when a note first appears relative to the browser audio clock.

Example against an already-running local server:

```bash
.playwright/bin/python scripts/repro_led_timing.py \
  --url http://127.0.0.1:8000 \
  --song-id toxic \
  --hit-time-ms 6943
```

To compare with the old audio-first ordering:

```bash
.playwright/bin/python scripts/repro_led_timing.py \
  --url http://127.0.0.1:8000 \
  --song-id toxic \
  --hit-time-ms 6943 \
  --start-mode audio-first
```

Meaning of the key fields:

- `expected_spawn_audio_ms`: `hit_time_ms - travel_time_ms`
- `spawn_delta_ms`: first matching `bar_frame` audio time minus expected spawn time
- `led_spawn_delta_ms`: first lit `led_frame` audio time minus expected spawn time

Negative deltas mean the note appears early. Positive deltas mean it appears late.
