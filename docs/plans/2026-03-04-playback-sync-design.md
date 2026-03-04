# Playback Sync Design

## Summary
- Backend owns chart loading, timing, LED frame generation, and WebSocket payloads so the UI sees concrete game progress instead of fake `clock_tick` messages.
- Front end fetches and plays the selected song audio at the same moment it starts the WebSocket session so music and LED visualization remain in sync.
- Errors (missing audio/chart, WebSocket disconnects, playback failure) reset the session to `idle` and surface friendly status copy.

## Goals
1. `start_session` loads the requested chart/audio pair, transitions the global `GameSession` to `PLAYING`, and streams real `led_frame`/`lane_event` data derived from the chart timing.
2. The UI’s Start action fetches `/api/songs/{song_id}/audio`, plays it via an `<audio>` element, and only then sends `start_session` over the WebSocket.
3. Both ends share richer payloads (e.g., `progress_ms`, `levels`) so the canvas can follow the backend-decided timeline instead of relying on manual key presses.

## Architecture & Data Flow
1. `rythm_jump/api/charts.py` remains responsible for listing songs and serving `/songs/{id}/audio`, but `_charts_root_dir()` must resolve to the repo-local `songs/` folder (current use of `parents[3]` points outside the repo and misses `songs/demo`).
2. `rythm_jump/api/ws.py`:
   - Validates `song_id`, loads the chart via `engine/chart_loader.load_chart`, and ensures the corresponding audio file exists before switching the session state.
   - Spawns an asyncio ticker (100ms) that advances `progress_ms`, emits `led_frame` payloads with left/right intensity plus lane hits based on the chart, and regularly sends `session_state` updates (`playing`, `complete`).
   - Pushes fallback `error` events if chart/audio is missing so the client can bounce back to `idle`.
   - Handles stop requests by halting the ticker, resetting the session, and signaling `state: idle` to clients.
3. Front-end `web/game.js`:
   - On Start: fetch `/api/songs/<id>/audio`, set it on a hidden `<audio id="song-audio">`, `await audio.play()`, and only after the promise resolves send `start_session` to the WebSocket.
   - Subscribe to new WS payloads (`led_frame`, optional `progress_ms`) and set `state.levels`/`state.lastAction` from that data instead of relying on manual clock ticks. Continue rendering the visualizer from these exact values.
   - Maintain the existing reconnect logic, keyboard handler, and manual `lane_event` sending so testing and manual input stay available.

## Error Handling & UX
- Backend emits `error` payloads plus `session_state: idle` if the chart/audio lookup fails; the front end displays the error near the run-status indicator and ensures the `<audio>` resource is paused/reset.
- If the audio playback promise rejects (user blocked autoplay), the UI shows “Playback blocked” and does not send `start_session` until the user retries.
- WebSocket disconnects or `led_frame` payload gaps reset `state.runStatus` to `Disconnected` and attempt reconnection, preserving the audio element source for a retry.

## Testing & Verification
- Add backend unit tests verifying `_charts_root_dir()` points inside the repo and that `get_audio()` raises 404 when the file is absent.
- Add integration test for `ws.session_stream`: start with `start_session`, ensure at least one `led_frame` payload (with left/right levels) is emitted before the session closes.
- Front-end manual verification: start a session, confirm the `<audio>` element plays, the visualizer lights up in sync with the backend `led_frame` data, and stop resets the UI.
- Document the flow in this design file, then follow up with a concrete implementation plan saved to `docs/plans/2026-03-04-playback-sync-plan.md` before touching code.
