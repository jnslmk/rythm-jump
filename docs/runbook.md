# Runbook

## Local Development

1. Sync backend deps:
```bash
cd backend && uv sync --group dev
```
2. Install web deps:
```bash
cd ../web && npm install
```
3. Start both:
```bash
./scripts/dev.sh
```

## Validate Before Merge

```bash
cd backend && uv run --group dev pytest -q
npm --prefix web test
npm --prefix web run build
```

## Headless Runtime Operation

Start manually:
```bash
RHYTHM_HEADLESS_MODE=1 uv run --project backend uvicorn rhythm_jump.main:app --host 0.0.0.0 --port 8000
```

Key checks:
- Confirm `RHYTHM_HEADLESS_MODE=1` is set.
- Confirm contact pin wiring and env pin value match.
- Watch backend logs for `headless poll error` messages.

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
