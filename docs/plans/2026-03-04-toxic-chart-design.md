# Toxic Chart Design

## Goal
Ensure the `toxic` song chart contains enough lane timings so that starting the session keeps the backend in `PLAYING` and the UI receives actual bar/led events instead of immediately returning to `idle`.

## Context
`web/game.js` drives the session via `start_session`, and the backend emits led frames as long as `State.PLAYING` persists. An empty chart causes the session to immediately revert to `idle`, leaving “Waiting for events...” and no lane activity. The audio file already exists under `songs/toxic/audio.mp3`, so we simply need a realistic hit pattern to power the UI while keeping the tempo and travel time already defined in the chart metadata.

## Design
1. **Tempo and spacing** – Keep the existing `bpm` of 150 (beat interval = 400 ms). Use this to compute note positions with a consistent grid (e.g., 16th notes every 200 ms) so the lane timings align with the song’s pace.
2. **Alternating lane coverage** – Distribute hits between the left and right lanes in a repeating pattern (e.g., L–R–L–L–R–R–L–R) to keep both LED channels active while staying simple. Each lane receives 32–40 hits so the session stays `PLAYING` for at least 25–30 seconds regardless of audio duration.
3. **Travel time + offset** – Keep `travel_time_ms` at 1200 ms. All note timestamps are absolute hit times (increasing) and start at 1200 ms to give the travel animation time to appear. No global offset adjustments are needed.
4. **Maintain judgement windows** – Preserve the current `judgement_windows_ms` (`perfect`: 50, `good`: 100) so future scoring logic has the expected structure.

## Validation
- After updating `songs/toxic/chart.json`, verify the UI shows lane hit events and `state.runStatus` stays “PLAYING” until the chart finishes.
- Optionally run an integration test (or manual WebSocket session) to confirm `led_frame` events persist beyond the first tick.
