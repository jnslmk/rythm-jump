# Rhythm Jump

Rhythm Jump is a two-lane rhythm runner with a FastAPI backend and a browser-based setup UI built with vanilla JavaScript and `oat.css`.

Runtime configuration now lives in [`rythm_jump.toml`](rythm_jump.toml). Adjust GPIO pins,
LED strip settings, and content paths there before starting the service.

## Browser Setup Mode Quickstart

1. Install dependencies:
```bash
uv sync --group dev
npm install
```
2. Start the app:
```bash
sudo -E env PATH="$PATH" uv run uvicorn rythm_jump.main:app --reload --host 0.0.0.0 --port 8000
```
3. Open `http://localhost:8000/` for the game UI or `http://localhost:8000/manage.html` for song management.

## Headless Mode Quickstart

1. Install dependencies:
```bash
uv sync --group dev
```
2. Start the backend in autonomous mode:
```bash
uv run uvicorn rythm_jump.main:app --host 0.0.0.0 --port 8000
```
3. Ensure the jump-box contact inputs and LED strip are wired as expected.

For Raspberry Pi service startup, install `systemd/rhythm-jump.service` and use [docs/runbook.md](docs/runbook.md) as the reference.

## Hardware Debugging

The repository includes a small hardware-debug CLI for Raspberry Pi bring-up and bench testing.

Poll the jump-box GPIO inputs and print state transitions:

```bash
uv run rj-debug gpio --samples 50 --interval 0.1
```

Drive the WS2811 strip with a lane split, solid color, or chase pattern:

```bash
uv run rj-debug led --pattern lanes --repeat 2 --delay 0.2
uv run rj-debug led --pattern solid --color green --repeat 1 --delay 0.2
uv run rj-debug led --pattern chase --color amber --repeat 1 --delay 0.05
```

The browser game UI also exposes these diagnostics in a `Hardware Debug` section. Use `Refresh Inputs` to read the current GPIO state and `Run LED Test` to trigger the selected LED pattern without leaving the page.

## Hardware Setup

### Bill of Materials (BOM)
- **Controller:** Raspberry Pi 4 or 5.
- **Power:** DD4012SA Buck Converter (24V to 5V). *Note: 1A limit, monitor for undervoltage.*
- **LEDs:** WS2811 LED Strip (5V, 12V, or 24V).
- **Data Conditioning (LEDs):**
  - **Level Shifter:** 74AHCT125 (3.3V to 5V logic conversion).
  - **Data Resistor:** 249Ω (QuinLED recommended) or 220Ω.
  - **Power Capacitor:** 1000µF (35V rated for 24V systems).
- **Jump Box (Inputs):**
  - **Switch:** Momentary contact switch.
  - **Pull-up Resistor:** 10kΩ.
- **Power Supply:** 24V DC Main Power Supply.

### Wiring Diagram

```text
24V DC MAIN POWER SUPPLY
=========================
(+) 24V -------------------+-------------------------------------------+
                           |                                           |
(-) GND (Common) ----------|----------+--------------------------------|--+
                           |          |                                |  |
                           |          |                                |  |
    [ DD4012SA BUCK ]      |          |      [ WS2811 LED STRIP ]      |  |
    [ 24V -> 5V     ]      |          |      [ (12V or 5V)*     ]      |  |
    +---------------+      |          |      +------------------+      |  |
    | IN+  <--------+------+          |      | VCC <------------+------+  |
    | IN-  <--------------------------+      | DAT <-----------[ 249Ω Res ]  |
    |               |                 |      | GND <----------------------+  |
    | OUT+ -------->+ [ 5.1V to Pi ]  |      +------------------+         |
    | OUT- -------->+ [ GND to Pi  ]  |               ^                   |
    +---------------+                 |               |                   |
                                      |      [ 1000µF 35V CAP ]           |
                                      |      [ (Across VCC/GND)]          |
                                      |               |                   |
    RASPBERRY PI (4/5)                |               |                   |
    ==================                |               |                   |
    [ Pin 2  (5V)  ] <----------------+               |                   |
    [ Pin 6  (GND) ] <----------------+               |                   |
    [ Pin 1  (3.3V)] --------+                        |                   |
                             |                        |                   |
    [ Pin 17 (G17) ] <---+---[ 10kΩ Res ]             |                   |
                         |                            |                   |
    [ Pin 18 (G18) ] ----|----[ LEVEL SHIFTER ]-------+                   |
                         |    [ (3.3V -> 5V)  ]                           |
                         |           ^                                    |
                         |           |                                    |
    JUMP BOX (SWITCH)    |     [ 5V Power for ]                           |
    =================    |     [ Level Shifter]                           |
    [ Terminal A ] <-----+                                                |
    [ Terminal B ] -------------------------------------------------------+
```

## Disconnect Behavior Rules

- Browser-attached sessions: if the last browser websocket disconnects while playing, session transitions to `aborted_disconnected`.
- Browser-attached sessions with multiple connections: disconnecting one connection does not abort while another remains connected.
- Headless sessions: browser disconnect logic does not apply; contact-triggered runtime controls starts.

## Verification

```bash
uv run pytest -q
npx eslint web/*.js
npx stylelint "web/*.css"
```
