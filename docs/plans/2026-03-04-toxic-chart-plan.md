# Toxic Chart Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Populate `songs/toxic/chart.json` with a deterministic lane pattern so the backend session remains `PLAYING` and the UI receives timed bar/LED events.

**Architecture:** The backend already streams `led_frame`/`bar_frame` payloads per chart entry. No code changes are required; the fix is purely data-driven by supplying realistic hit timestamps for both lanes that extend through the audio's duration.

**Tech Stack:** Chart JSON files under `songs/`, FastAPI/WebSocket session streaming, browser UI for manual validation.

---

### Task 1: Populate the toxic chart with alternating lane hits

**Files:**
- Modify: `songs/toxic/chart.json`

**Step 1: Define the hit pattern**
Add a 150 BPM grid (400 ms per beat) starting at 1200 ms and alternate lanes every 400 ms up to ~64 s. This results in 80 hits per lane. Draft snippet:

```json
"left": [1200, 2000, 2800, 3600, ..., 64400],
"right": [1600, 2400, 3200, 4000, ..., 64800]
```

**Step 2: Implement the chart**
Replace the empty `left`/`right` arrays in `songs/toxic/chart.json` with the computed sequences, keeping `bpm`, `travel_time_ms`, and `judgement_windows_ms` unchanged.

**Step 3: Record the change**
Save the modified chart. Optionally run `cat songs/toxic/chart.json` to spotcheck formatting (no formatter needed). Ensure the arrays are valid JSON.

**Step 4: Manually verify the gameplay**
Start the backend (`uv run --project backend uvicorn rythm_jump.main:app --reload`), open the UI, select “Toxic”, and press Start. Confirm the `run-status` stays `PLAYING` until the new chart completes and the debug timeline shows lane triggers instead of “Waiting for events...”.

**Step 5: Commit the change**
Run:

```bash
git add songs/toxic/chart.json docs/plans/2026-03-04-toxic-chart-design.md docs/plans/2026-03-04-toxic-chart-plan.md
git commit -m "fix: add toxic hit timings"
```
