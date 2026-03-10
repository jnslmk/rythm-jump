"""Measure note spawn timing against the browser audio clock."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import cast

from playwright.sync_api import Error, sync_playwright

RGB_CHANNEL_COUNT = 3


def _is_lit_pixel(pixel: object) -> bool:
    """Return True when the payload looks like a non-black RGB pixel."""
    if not isinstance(pixel, list) or len(pixel) != RGB_CHANNEL_COUNT:
        return False
    if not all(isinstance(channel, int) for channel in pixel):
        return False
    channels = cast("list[int]", pixel)
    return any(channel > 0 for channel in channels)


def parse_args() -> argparse.Namespace:
    """Parse CLI options for the timing repro."""
    parser = argparse.ArgumentParser(
        description="Measure Rhythm Jump LED/bar timing against browser audio time.",
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8000",
        help="Game URL to open.",
    )
    parser.add_argument(
        "--song-id",
        default="toxic",
        help="Song/chart identifier to load.",
    )
    parser.add_argument(
        "--hit-time-ms",
        type=int,
        required=True,
        help="Target chart hit time to measure.",
    )
    parser.add_argument(
        "--start-mode",
        choices=("ui", "audio-first"),
        default="ui",
        help="Use the real UI start flow or the legacy audio-first sequence.",
    )
    parser.add_argument(
        "--settle-ms",
        type=int,
        default=3000,
        help="Initial wait after opening the page.",
    )
    parser.add_argument(
        "--observe-ms",
        type=int,
        default=9000,
        help="How long to capture websocket traffic after starting.",
    )
    return parser.parse_args()


def build_init_script() -> str:
    """Build the browser bootstrap script used by the timing probe."""
    return """
(() => {
  window.__wsEvents = [];
  window.__wsSends = [];
  const NativeWebSocket = window.WebSocket;

  class TrackedWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      window.__lastSocket = this;
      this.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          const audio = document.getElementById('song-audio');
          window.__wsEvents.push({
            ...payload,
            receivedAtMs: performance.now(),
            audioMs: audio ? Math.round((audio.currentTime || 0) * 1000) : null,
          });
        } catch (error) {
          window.__wsEvents.push({
            type: 'parse_error',
            error: String(error),
          });
        }
      });
    }

    send(data) {
      try {
        window.__wsSends.push(JSON.parse(data));
      } catch (error) {
        window.__wsSends.push({
          type: 'send_parse_error',
          error: String(error),
        });
      }
      super.send(data);
    }
  }

  window.WebSocket = TrackedWebSocket;

  const audioProto = window.HTMLMediaElement.prototype;
  Object.defineProperty(audioProto, 'currentTime', {
    configurable: true,
    get() {
      const now = performance.now();
      const startedAt = this.__startedAtMs;
      const pausedAt = this.__pausedAtMs ?? 0;
      if (this.__isPaused !== false || typeof startedAt !== 'number') {
        return pausedAt / 1000;
      }
      return Math.max((now - startedAt) / 1000, 0);
    },
    set(value) {
      const nextMs = Math.max(Number(value) || 0, 0) * 1000;
      this.__pausedAtMs = nextMs;
      if (this.__isPaused === false) {
        this.__startedAtMs = performance.now() - nextMs;
      }
    },
  });
  Object.defineProperty(audioProto, 'paused', {
    configurable: true,
    get() {
      return this.__isPaused !== false;
    },
  });
  audioProto.play = async function play() {
    this.__isPaused = false;
    this.__startedAtMs = performance.now() - (this.__pausedAtMs ?? 0);
  };
  audioProto.pause = function pause() {
    this.__pausedAtMs = this.currentTime * 1000;
    this.__isPaused = true;
  };
  audioProto.load = function load() {};
})();
"""


def run_probe(args: argparse.Namespace) -> dict[str, object]:
    """Execute the browser timing capture."""
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except Error as exc:  # pragma: no cover - environment dependent
            message = f"Playwright Chromium unavailable: {exc}"
            raise RuntimeError(message) from exc

        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.add_init_script(build_init_script())
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_timeout(args.settle_ms)

        option_values = page.locator("#song-select option").evaluate_all(
            "(options) => options.map((option) => option.value)",
        )

        if args.start_mode == "ui":
            page.select_option("#song-select", args.song_id)
            page.wait_for_timeout(1000)
            page.click("#btn-start")
        else:
            page.evaluate(
                """async ({ songId }) => {
                  const audio = document.getElementById('song-audio');
                  audio.currentTime = 0;
                  await audio.play();
                  window.__lastSocket.send(
                    JSON.stringify({ type: 'start_session', song_id: songId })
                  );
                }""",
                {"songId": args.song_id},
            )

        page.wait_for_timeout(args.observe_ms)
        payload = {
            "options": option_values,
            "events": page.evaluate("() => window.__wsEvents"),
            "sends": page.evaluate("() => window.__wsSends"),
        }
        browser.close()
        return payload


def resolve_expected_spawn_ms(song_id: str, hit_time_ms: int) -> tuple[int, int]:
    """Load chart metadata and compute the expected bar spawn time."""
    chart_path = Path.cwd() / "songs" / song_id / "chart.json"
    chart = json.loads(chart_path.read_text(encoding="utf-8"))
    travel_time_ms = int(chart["travel_time_ms"])
    return travel_time_ms, hit_time_ms - travel_time_ms


def extract_report(
    *,
    song_id: str,
    hit_time_ms: int,
    events: list[dict[str, object]],
    sends: list[dict[str, object]],
    options: list[str],
) -> dict[str, object]:
    """Summarize the first matching bar and LED frame timing."""
    travel_time_ms, expected_spawn_ms = resolve_expected_spawn_ms(song_id, hit_time_ms)
    target_frames = [
        event
        for event in events
        if event.get("type") == "bar_frame" and event.get("hit_time_ms") == hit_time_ms
    ]
    target_led_frames = []
    for event in events:
        if event.get("type") != "led_frame":
            continue
        pixels = event.get("pixels")
        if not isinstance(pixels, list):
            continue
        if any(_is_lit_pixel(pixel) for pixel in pixels):
            target_led_frames.append(event)

    report: dict[str, object] = {
        "song_options": options,
        "travel_time_ms": travel_time_ms,
        "target_hit_time_ms": hit_time_ms,
        "expected_spawn_audio_ms": expected_spawn_ms,
        "ws_sends": sends,
        "event_count": len(events),
    }

    if target_frames:
        first_bar_frame = target_frames[0]
        report["first_bar_frame_audio_ms"] = first_bar_frame.get("audioMs")
        report["first_bar_frame_progress_ms"] = first_bar_frame.get("progress_ms")
        first_bar_frame_audio_ms = first_bar_frame.get("audioMs")
        if isinstance(first_bar_frame_audio_ms, int):
            report["spawn_delta_ms"] = first_bar_frame_audio_ms - expected_spawn_ms
    else:
        report["first_event_types"] = [event.get("type") for event in events[:20]]

    if target_led_frames:
        first_led_frame = target_led_frames[0]
        report["first_led_frame_audio_ms"] = first_led_frame.get("audioMs")
        report["first_led_frame_progress_ms"] = first_led_frame.get("progress_ms")
        first_led_frame_audio_ms = first_led_frame.get("audioMs")
        if isinstance(first_led_frame_audio_ms, int):
            report["led_spawn_delta_ms"] = first_led_frame_audio_ms - expected_spawn_ms

    return report


def main() -> int:
    """Run the timing repro and print a machine-readable summary."""
    args = parse_args()
    payload = run_probe(args)
    events = cast("list[dict[str, object]]", payload["events"])
    sends = cast("list[dict[str, object]]", payload["sends"])
    options = cast("list[str]", payload["options"])
    report = extract_report(
        song_id=args.song_id,
        hit_time_ms=args.hit_time_ms,
        events=events,
        sends=sends,
        options=options,
    )
    print(json.dumps(report, indent=2, sort_keys=True))  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
