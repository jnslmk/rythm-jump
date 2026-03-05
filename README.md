# Rhythm Jump

Rhythm Jump is a two-lane rhythm runner with a FastAPI backend and React web setup UI.

## Browser Setup Mode Quickstart

1. Install dependencies:
```bash
cd backend && uv sync --group dev
cd ../web && npm install
```
2. Run both services:
```bash
./scripts/dev.sh
```
3. Open `http://localhost:5173` and use Setup + Chart Editor.

## Headless Mode Quickstart

1. Install backend dependencies:
```bash
cd backend && uv sync --group dev
```
2. Start backend in autonomous mode:
```bash
RHYTHM_HEADLESS_MODE=1 uv run --project backend uvicorn rhythm_jump.main:app --host 0.0.0.0 --port 8000
```
3. Ensure contact switch input is wired (see `docs/hardware-wiring.md`).

For Raspberry Pi service startup, install `systemd/rhythm-jump.service` and use `scripts/run_pi.sh` as reference.

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
cd backend && uv run --group dev pytest -q
npm --prefix web test
npm --prefix web run build
```
