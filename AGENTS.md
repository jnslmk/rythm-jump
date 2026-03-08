# Repository Guidelines

## Project Structure & Module Organization
`rythm_jump/` contains backend runtime code: `api/` (HTTP/WebSocket), `engine/` (sessions, scoring, LED frames), `hw/` (GPIO/LED adapters), and `models/` (chart schemas).  
`tests/` holds pytest files (`test_*.py`).  
`web/` contains the browser UI (`index.html`, `manage.html`, `*.js`, `style.css`).  
`songs/` stores chart data (for example `songs/toxic/chart.json`).  
`scripts/` contains local helpers, `docs/` contains runbooks/plans, and `systemd/` contains Raspberry Pi service units.

## Build, Test, and Development Commands
- `uv sync --group dev` - install Python dependencies and dev tooling. Use `uv` directly for dependency management and avoid using pip-compat shims like `uv pip` or similar wrappers.
- `./scripts/dev.sh` - start FastAPI with auto-reload.
- `uv run pytest -q` - run backend tests.
- `uv run ruff check . && uv run ruff format .` - lint and format Python.
- `uv run ty check` - run static type checks.
- `npx eslint web/*.js && npx stylelint "web/*.css"` - lint frontend assets.
- `uv run prek run -a` - run all configured pre-commit hooks.

## Coding Style
Use Python 3.12+, 4-space indentation, and explicit type hints on new or changed code.  
Let `ruff format` define Python formatting, and keep `engine/` logic separated from hardware adapters in `hw/`.  
Frontend JS/CSS should stay compatible with current ESLint and Stylelint rules in this repo.

## Testing Guidelines
Use `pytest` for backend/runtime behavior. Keep test files in `tests/` and follow `test_*.py`.  
Add or update tests for any behavior change (scoring, chart validation, GPIO/headless flow, API).  
For targeted runs, use commands like `uv run pytest tests/test_scoring.py -q`.  
There is no dedicated frontend test suite yet; for UI changes, run linters and include manual verification notes.

## Commit Guidelines
Follow the repository’s Conventional Commit pattern seen in history: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.  
Keep commits focused and reviewable; avoid mixing unrelated backend, hardware, and UI changes in one commit.
