# Rhythm Jump Game Browser + Headless Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a Python-on-Pi rhythm game with browser-based setup/testing (visualizer + keyboard play) and a fully headless gameplay mode triggered by contact switch input.

**Architecture:** Build a Python backend service that owns game clock, audio, GPIO inputs, and WS2811 rendering. Serve a local browser UI for setup/testing and stream live state over WebSocket. Support two runtime profiles: browser-attached (disconnect aborts game) and headless (no browser needed).

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, Pydantic, asyncio, websockets, pygame (audio), rpi_ws281x, RPi.GPIO or gpiozero, React + TypeScript + Vite.

---

### Task 1: Backend Skeleton And Health API

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/rhythm_jump/__init__.py`
- Create: `backend/rhythm_jump/main.py`
- Create: `backend/rhythm_jump/api/http.py`
- Create: `backend/tests/test_health.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_health.py
from fastapi.testclient import TestClient
from rhythm_jump.main import app


def test_health_ok():
    client = TestClient(app)
    resp = client.get('/api/health')
    assert resp.status_code == 200
    assert resp.json() == {'ok': True}
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_health.py -v`
Expected: FAIL because app/routes do not exist yet.

**Step 3: Write minimal implementation**

```python
# backend/rhythm_jump/main.py
from fastapi import FastAPI
from rhythm_jump.api.http import router

app = FastAPI()
app.include_router(router)
```

```python
# backend/rhythm_jump/api/http.py
from fastapi import APIRouter

router = APIRouter()

@router.get('/api/health')
def health() -> dict[str, bool]:
    return {'ok': True}
```

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_health.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/pyproject.toml backend/rhythm_jump backend/tests/test_health.py
git commit --no-gpg-sign -m "feat(backend): bootstrap fastapi service with health endpoint"
```

### Task 2: Shared Models And Chart Validation

**Files:**
- Create: `backend/rhythm_jump/models/chart.py`
- Create: `backend/rhythm_jump/engine/chart_loader.py`
- Create: `backend/tests/test_chart_validation.py`
- Create: `songs/<song-id>/chart.json`

**Step 1: Write the failing test**

```python
# backend/tests/test_chart_validation.py
from rhythm_jump.engine.chart_loader import load_chart


def test_independent_lanes_allowed(tmp_path):
    path = tmp_path / 'chart.json'
    path.write_text('''{
      "song_id":"toxic",
      "travel_time_ms":650,
      "global_offset_ms":0,
      "judgement_windows_ms":{"perfect":30,"good":70},
      "left":[1000,2000],
      "right":[1500,2500]
    }''')
    chart = load_chart(path)
    assert chart.left != chart.right
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_chart_validation.py -v`
Expected: FAIL missing loader/model.

**Step 3: Write minimal implementation**

- Add Pydantic chart models with lane arrays and timing fields.
- Add loader that reads JSON and validates non-empty combined lanes.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_chart_validation.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/models/chart.py backend/rhythm_jump/engine/chart_loader.py backend/tests/test_chart_validation.py
git commit --no-gpg-sign -m "feat(engine): add chart schema and validation for independent lanes"
```

### Task 3: Game Session State Machine (Browser-Attached + Headless)

**Files:**
- Create: `backend/rhythm_jump/engine/session.py`
- Create: `backend/tests/test_session_modes.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_session_modes.py
from rhythm_jump.engine.session import Session, Mode


def test_browser_disconnect_aborts_when_attached():
    s = Session(mode=Mode.BROWSER_ATTACHED)
    s.start()
    s.on_browser_disconnected()
    assert s.state == 'aborted_disconnected'


def test_headless_ignores_browser_disconnect():
    s = Session(mode=Mode.HEADLESS)
    s.start()
    s.on_browser_disconnected()
    assert s.state == 'playing'
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_session_modes.py -v`
Expected: FAIL missing session engine.

**Step 3: Write minimal implementation**

- Define mode enum and state transitions.
- Implement disconnect behavior based on mode.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_session_modes.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/engine/session.py backend/tests/test_session_modes.py
git commit --no-gpg-sign -m "feat(engine): implement dual mode session state machine"
```

### Task 4: Scoring And Input Judgement

**Files:**
- Create: `backend/rhythm_jump/engine/scoring.py`
- Create: `backend/tests/test_scoring.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_scoring.py
from rhythm_jump.engine.scoring import judge


def test_perfect_good_miss_windows():
    assert judge(delta_ms=10, perfect=30, good=70) == 'perfect'
    assert judge(delta_ms=50, perfect=30, good=70) == 'good'
    assert judge(delta_ms=120, perfect=30, good=70) == 'miss'
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_scoring.py -v`
Expected: FAIL missing scoring function.

**Step 3: Write minimal implementation**

```python
# backend/rhythm_jump/engine/scoring.py
def judge(delta_ms: int, perfect: int, good: int) -> str:
    d = abs(delta_ms)
    if d <= perfect:
        return 'perfect'
    if d <= good:
        return 'good'
    return 'miss'
```

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_scoring.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/engine/scoring.py backend/tests/test_scoring.py
git commit --no-gpg-sign -m "feat(engine): add hit judgement windows"
```

### Task 5: GPIO Contact Input + Debounce

**Files:**
- Create: `backend/rhythm_jump/hw/gpio_input.py`
- Create: `backend/tests/test_debounce.py`
- Create: `backend/rhythm_jump/config.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_debounce.py
from rhythm_jump.hw.gpio_input import debounce_accept


def test_debounce_threshold():
    assert not debounce_accept(last_ms=1000, now_ms=1010, threshold_ms=30)
    assert debounce_accept(last_ms=1000, now_ms=1040, threshold_ms=30)
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_debounce.py -v`
Expected: FAIL missing debounce helper.

**Step 3: Write minimal implementation**

```python
# backend/rhythm_jump/hw/gpio_input.py
def debounce_accept(last_ms: int, now_ms: int, threshold_ms: int) -> bool:
    return (now_ms - last_ms) >= threshold_ms
```

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_debounce.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/hw/gpio_input.py backend/tests/test_debounce.py backend/rhythm_jump/config.py
git commit --no-gpg-sign -m "feat(hw): add contact switch input debounce"
```

### Task 6: LED Render Pipeline And Hardware Adapter Boundary

**Files:**
- Create: `backend/rhythm_jump/engine/led_frames.py`
- Create: `backend/rhythm_jump/hw/led_output.py`
- Create: `backend/tests/test_led_projection.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_led_projection.py
from rhythm_jump.engine.led_frames import project_bar


def test_center_to_edge_projection():
    idx = project_bar(strip_len=120, progress=1.0, side='left')
    assert idx == 0
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_led_projection.py -v`
Expected: FAIL missing projection logic.

**Step 3: Write minimal implementation**

- Implement center-origin progress-to-index mapping for both lanes.
- Keep `led_output.py` behind interface for simulation vs `rpi_ws281x` backend.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_led_projection.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/engine/led_frames.py backend/rhythm_jump/hw/led_output.py backend/tests/test_led_projection.py
git commit --no-gpg-sign -m "feat(led): add center-out frame projection and output adapter"
```

### Task 7: WebSocket Runtime Stream + Control

**Files:**
- Create: `backend/rhythm_jump/api/ws.py`
- Modify: `backend/rhythm_jump/main.py`
- Create: `backend/tests/test_ws_events.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_ws_events.py
# connect websocket, send ping/control, assert session snapshot payload returned
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_ws_events.py -v`
Expected: FAIL before websocket endpoint exists.

**Step 3: Write minimal implementation**

- Add `/ws/session/{id}` endpoint.
- Broadcast live events:
  - `clock_tick`
  - `lane_event`
  - `judgement`
  - `session_state`
- In browser-attached mode, disconnect triggers abort.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_ws_events.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/api/ws.py backend/rhythm_jump/main.py backend/tests/test_ws_events.py
git commit --no-gpg-sign -m "feat(api): add websocket session stream and disconnect handling"
```

### Task 8: Browser App Bootstrap

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/lib/api.ts`

**Step 1: Write the failing test**

```ts
// web/src/App.test.tsx
import { render, screen } from '@testing-library/react'
import App from './App'

test('renders setup shell', () => {
  render(<App />)
  expect(screen.getByText('Rhythm Jump Setup')).toBeInTheDocument()
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test`
Expected: FAIL before app/test setup.

**Step 3: Write minimal implementation**

- Create React app shell with health probe to backend.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test`
Expected: PASS.

**Step 5: Commit**

```bash
git add web
git commit --no-gpg-sign -m "feat(web): bootstrap setup frontend"
```

### Task 9: Browser Visualizer And Keyboard Play Mode

**Files:**
- Create: `web/src/features/visualizer/VisualizerCanvas.tsx`
- Create: `web/src/features/visualizer/useSessionStream.ts`
- Create: `web/src/features/input/useKeyboardInput.ts`
- Create: `web/src/features/input/keyboard.test.ts`

**Step 1: Write the failing test**

```ts
// web/src/features/input/keyboard.test.ts
import { mapKeyToSide } from './useKeyboardInput'

test('maps keys to sides', () => {
  expect(mapKeyToSide('a')).toBe('left')
  expect(mapKeyToSide('l')).toBe('right')
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test keyboard`
Expected: FAIL before hook implementation.

**Step 3: Write minimal implementation**

- Keyboard mappings:
  - left: `A`, `Space`
  - right: `L`, `Enter`
- Visualizer draws center-out bars from WS state stream.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/features
git commit --no-gpg-sign -m "feat(web): add visualizer and keyboard gameplay testing"
```

### Task 10: Browser Setup GUI + Chart Editor

**Files:**
- Create: `web/src/features/setup/SetupPanel.tsx`
- Create: `web/src/features/setup/ModeSelector.tsx`
- Create: `web/src/features/setup/SongSelector.tsx`
- Create: `web/src/features/setup/CalibrationPanel.tsx`
- Create: `web/src/features/chart/ChartEditor.tsx`
- Create: `web/src/features/chart/chart-editor.test.ts`
- Create: `backend/rhythm_jump/api/charts.py`

**Step 1: Write the failing test**

```ts
// web/src/features/chart/chart-editor.test.ts
test('saves independent left/right arrays', async () => {
  // simulate edits and assert outbound payload
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test chart-editor`
Expected: FAIL before editor and API wiring.

**Step 3: Write minimal implementation**

- Setup UI controls:
  - runtime mode (browser-attached / headless)
  - song selection
  - travel time and offset calibration
  - start/stop session controls
- Chart editor saves to backend REST endpoint.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/features backend/rhythm_jump/api/charts.py
git commit --no-gpg-sign -m "feat(web): add full setup gui and chart editing workflow"
```

### Task 11: Headless Start Trigger And Boot Behavior

**Files:**
- Create: `backend/rhythm_jump/headless.py`
- Modify: `backend/rhythm_jump/engine/session.py`
- Create: `backend/tests/test_headless_trigger.py`
- Create: `systemd/rhythm-jump.service`

**Step 1: Write the failing test**

```python
# backend/tests/test_headless_trigger.py
from rhythm_jump.headless import should_start


def test_contact_switch_press_starts_headless_session():
    assert should_start(contact_pressed=True, mode='headless')
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_headless_trigger.py -v`
Expected: FAIL missing headless trigger function.

**Step 3: Write minimal implementation**

- Implement headless loop watching contact switch events.
- Start session on valid press event.
- Add systemd unit for auto-start backend on boot.

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_headless_trigger.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/rhythm_jump/headless.py backend/rhythm_jump/engine/session.py backend/tests/test_headless_trigger.py systemd/rhythm-jump.service
git commit --no-gpg-sign -m "feat(headless): add contact-triggered autonomous mode and boot service"
```

### Task 12: End-To-End Verification And Documentation

**Files:**
- Create: `README.md`
- Create: `docs/hardware-wiring.md`
- Create: `docs/runbook.md`
- Create: `scripts/dev.sh`
- Create: `scripts/run_pi.sh`
- Create: `.github/workflows/ci.yml`

**Step 1: Write failing verification checks**

- Add CI job definitions; expect failures until dependencies/scripts are in place.

**Step 2: Run checks to verify failure**

Run:
- `pytest -q`
- `npm --prefix web test`

Expected: FAIL prior to complete implementation.

**Step 3: Write minimal implementation**

- CI for Python + web test/build.
- README quickstarts:
  - browser setup mode
  - headless mode
  - disconnect behavior rules
- Wiring doc for contact switches + WS2811 level shifting.

**Step 4: Run full verification**

Run:
- `python -m pip install -e backend[dev]`
- `pytest -q`
- `npm --prefix web ci`
- `npm --prefix web test`
- `npm --prefix web run build`

Expected: PASS.

**Step 5: Commit**

```bash
git add README.md docs scripts .github/workflows/ci.yml
git commit --no-gpg-sign -m "docs: add runbook, wiring guide, and CI"
```

## Verification Gate Before Declaring Done

Run and record outputs:
- `pytest -q`
- `npm --prefix web test`
- `npm --prefix web run build`
- `python -m rhythm_jump.main` (backend boot smoke)
- Manual smoke tests:
  - browser-attached mode: disconnect aborts active game,
  - headless mode: contact switch press starts game without browser.
