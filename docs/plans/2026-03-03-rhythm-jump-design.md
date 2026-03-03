# Rhythm Jump Game Design

**Date:** 2026-03-03
**Project:** `rythm-jump`

## Goals
- Build a 2-player rhythm jump game using contact-switch jump boxes as input.
- Drive a WS2811 LED strip where bars move from center to each side and arrive on beat.
- Support independent left/right lane charts (not necessarily symmetric).
- Provide local-network browser UI for setup, testing, and preview visualizer.
- Support fully headless gameplay mode on Raspberry Pi.

## Non-Goals (V1)
- Cloud/remote internet access.
- Arbitrary user music uploads at runtime.
- Fully automatic beat detection for any unknown song.

## Operating Profiles

### 1) Browser-Attached Mode (Setup/Testing)
- Browser UI connects to Pi over LAN.
- Browser provides configuration, chart editing, preview visualizer, and keyboard simulation.
- Active browser session is required during play in this mode.
- If browser disconnects, game stops immediately:
  - audio stops,
  - LEDs switch to idle frame,
  - session state set to `aborted_disconnected`.

### 2) Headless Mode (Standalone Gameplay)
- No browser required.
- Pi runs game directly with local configuration.
- Start trigger is contact switch press (step on a box).
- Game runs to completion independently.

## Architecture
- Backend: Python service on Raspberry Pi.
- Frontend: Browser app served locally by backend.
- Transport:
  - REST endpoints for configuration/state queries.
  - WebSocket for live game/visualizer events and control.
- Hardware:
  - contact switches connected to GPIO input pins (with debounce handling),
  - WS2811 LED strip output (with proper 5V level shifting and shared ground),
  - local audio output from Pi.

## Data Model

### Song Library
- Fixed local song set only.
- Layout:
  - `songs/<song_id>/audio.<ext>`
  - `songs/<song_id>/chart.json`
  - optional `songs/<song_id>/meta.json`

### Chart Schema
```json
{
  "song_id": "demo",
  "travel_time_ms": 650,
  "global_offset_ms": 0,
  "judgement_windows_ms": { "perfect": 30, "good": 70 },
  "left": [1000, 2000, 3000],
  "right": [1500, 2500, 3500]
}
```

## Backend Modules (Python)
- `engine/clock.py`: monotonic game timeline.
- `engine/chart.py`: chart parsing + validation.
- `engine/scoring.py`: hit judgement, combo, score.
- `engine/session.py`: state machine and mode handling.
- `hw/gpio_input.py`: contact switch input + debounce.
- `hw/led_output.py`: LED frame rendering + WS2811 output.
- `hw/audio.py`: playback and start timestamp capture.
- `api/http.py`: setup/config REST API.
- `api/ws.py`: live events + control channel.

## Frontend Modules (Browser)
- Setup/config panel.
- Song and chart selector.
- Chart editor for fixed song assets.
- Preview visualizer (center-out bars).
- Keyboard test mode for local simulation.
- Session state and diagnostics panel.

## Game Flow
1. Load song + chart + mode (`browser-attached` or `headless`).
2. Arm session.
3. Start condition:
   - browser-attached: explicit start from UI.
   - headless: contact switch press.
4. Countdown.
5. Play loop:
   - audio clock drives note schedule,
   - bars animate center -> edge by travel time,
   - contact events judged by timing windows.
6. End/results and return to idle.

## Error Handling
- Missing song/chart: block start, expose clear API/UI error.
- Input bounce: debounce in input layer.
- LED unavailable: fail fast in hardware mode or run simulation-only mode in setup.
- Audio init failure: block start and report actionable diagnostics.

## Testing Strategy
- Unit:
  - chart validation,
  - judgement windows,
  - state machine transitions,
  - debounce logic.
- Integration:
  - session start -> simulated inputs -> expected judgements/events.
- Frontend:
  - keyboard mapping,
  - WS stream handling,
  - visualizer timing/projection.
- Manual Pi tests:
  - browser-attached disconnect abort behavior,
  - headless start via contact switch,
  - LED timing perceived against music.

## Decisions Captured
- Language: Python backend (chosen over Rust for development velocity).
- UI: Browser-first for setup/testing.
- Deployment: Local network only.
- Modes: Both browser-attached and headless are first-class.
