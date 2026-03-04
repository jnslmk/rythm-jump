# Playback Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Sync backend-driven LED frame playback with front-end audio so starting a session plays the song and lights the visualizer in unison.

**Architecture:** FastAPI keeps the authoritative `GameSession` and WebSocket tick loop, drives new `led_frame` payloads, and hands audio streaming to `/api/songs/{song_id}/audio`. The browser fetches the audio, waits for `play()` to resolve, then starts the WebSocket session so the UI reflects the backend’s timeline.

**Tech Stack:** Python 3.13 / FastAPI / Uvicorn, vanilla JavaScript DOM + WebSocket, pytest for backend tests, `npx eslint web/game.js` for JS linting.

---

### Task 1: Fix chart/audio discovery paths and validation

**Files:**
- Modify: `rythm_jump/api/charts.py:1-120` (adjust `_charts_root_dir`, tighten validations)
- Create: `tests/test_api_charts.py:1-60`

**Step 1: Write the failing test**
- Add `tests/test_api_charts.py` with one test asserting `_charts_root_dir()` resolves into the repo at `Path(__file__).resolve().parents[1] / "songs"` (adjust as needed) and a second test calling `get_audio("missing")` and expecting `HTTPException(status_code=404)`.

**Step 2: Run the test to observe failure**
- Run: `uv run pytest tests/test_api_charts.py -q`
- Expect failure because `_charts_root_dir()` currently climbs into `/home/jonas/git-projects/songs` and `get_audio()` only checks for `audio.mp3`.

**Step 3: Update the implementation**
- Change `_charts_root_dir()` to `Path(__file__).resolve().parents[2] / "songs"` (or another repo-local path) so it points at `rythm-jump/songs`.
- Update `get_audio()` to iterate over available extensions under that path (e.g., `song_dir.glob("audio.*")`) and return the first matching file, raising `HTTPException(status_code=404)` if none exist.

**Step 4: Run the test again**
- Run: `uv run pytest tests/test_api_charts.py -q`
- Expect PASS after the corrections.

**Step 5: Commit**
```bash
git add rythm_jump/api/charts.py tests/test_api_charts.py
git commit -m "fix: resolve songs folder relative to repo"
```

### Task 2: Backfill `start_session` with chart timing and led frames

**Files:**
- Modify: `rythm_jump/api/ws.py:1-200`
- (Optional) helper module/file if cleaner
- Create: `tests/test_ws_session.py:1-140`

**Step 1: Write the failing integration test**
- Add `tests/test_ws_session.py` that starts the FastAPI app, opens a WebSocket connection to `/ws/session/default-session`, sends a `start_session` message with `song_id` (e.g., `demo` or `britney_spears-toxic`), and asserts the stream emits at least one payload whose `type` is `led_frame` and which contains both `levels` and `progress_ms` before the test closes.

**Step 2: Run the test to see it fail**
- Run: `uv run pytest tests/test_ws_session.py -q`
- Expect failure because the handler currently only emits `session_state` and `clock_tick` messages.

**Step 3: Implement backend logic**
- Load the requested chart via `engine.chart_loader.load_chart()` and validate the song directory has audio (rely on Task 1).
- Spawn an asyncio task that ticks every 100ms, increments a `progress_ms`, checks for lane hits (left/right arrays) that fall within the current window, and emits structured `led_frame` messages containing left/right intensity plus `progress_ms` to the WebSocket before each tick.
- Emit `session_state` when the song begins (`playing`) and after the book completes (`idle` or `complete`).
- Cleanly cancel the ticker when `stop_session` arrives or the WebSocket disconnects.

**Step 4: Run the test suite again**
- Run: `uv run pytest tests/test_ws_session.py -q`
- Expect PASS now that `led_frame` payloads are emitted.

**Step 5: Commit**
```bash
git add rythm_jump/api/ws.py tests/test_ws_session.py
git commit -m "feat: emit led frames from websocket"
```

### Task 3: Front-end audio start + payload handling

**Files:**
- Modify: `web/game.js:1-220`
- (Optional) Create `<audio id="song-audio">` element inside `web/index.html` if not already present

**Step 1: Add the audio plumbing**
- Update `init()` so it ensures an `<audio id="song-audio" hidden autoplay></audio>` is available, and the start handler first fetches `/songs/{song_id}/audio`, sets the audio `src`, and waits for `audio.play()` to resolve before sending `start_session`.
- Add UI messaging around playback failure (e.g., set `state.runStatus` to `Playback blocked` if `play()` rejects).

**Step 2: Run lint to catch syntax errors**
- Run: `npx eslint web/game.js`
- Expect initial failure until the new logic is syntactically correct; fix any issues.

**Step 3: Handle new backend payloads**
- Extend the WebSocket `onmessage` handler to react to `led_frame` payloads by setting `state.levels` to the provided intensities and updating `state.lastAction` if lane hits arrive.
- Use `renderVisualizer()` in response to these levels and rely less on manual decay loops; keep the fallback animation loop to avoid visual freezing.

**Step 4: Verify behavior manually via automation**
- Reuse or update `/tmp/playwright_test.py` to confirm: the select list populates, starting the song plays audio (check `audio.paused` is false after Start) and the WebSocket receives `led_frame` messages before the session ends.
- Run: `bash -lc '. .playwright/bin/activate && python /tmp/playwright_test.py'` (update the script as necessary to match the new payload names).

**Step 5: Commit**
```bash
git add web/game.js web/index.html
git commit -m "feat: start audio with websocket session"
```
