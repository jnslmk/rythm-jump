# Runbook

## Local Development

1. Sync project deps:
```bash
uv sync --group dev
npm install
```
2. Start the app:
```bash
uv run uvicorn rythm_jump.main:app --reload --host 0.0.0.0 --port 8000
```

## Validate Before Merge

```bash
uv run pytest -q
uv run ruff check .
uv run ty check
npx eslint web/*.js
npx stylelint "web/*.css"
```

## Headless Runtime Operation

Start manually:
```bash
uv run uvicorn rythm_jump.main:app --host 0.0.0.0 --port 8000
```

Key checks:
- Confirm left/right contact pins match `RHYTHM_LEFT_CONTACT_PIN` and `RHYTHM_RIGHT_CONTACT_PIN`.
- Confirm LED settings match your strip wiring if physical LEDs are enabled.
- Use `docs/backend-architecture.md` as the system map when debugging.

Useful setup overrides:

```bash
export RHYTHM_SONGS_DIR=/home/pi/rhythm-jump/songs
export RHYTHM_LEFT_CONTACT_PIN=17
export RHYTHM_RIGHT_CONTACT_PIN=27
export RHYTHM_LED_PIN=18
```

Bench debug commands:

```bash
rj-debug gpio --samples 50 --interval 0.1
rj-debug led --pattern lanes --repeat 2 --delay 0.2
```

## systemd Service Operations (Pi)

Install and enable:
```bash
sudo cp systemd/rhythm-jump.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rhythm-jump.service
```

Status and logs:
```bash
sudo systemctl status rhythm-jump.service
sudo journalctl -u rhythm-jump.service -f
```
