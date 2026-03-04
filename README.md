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
