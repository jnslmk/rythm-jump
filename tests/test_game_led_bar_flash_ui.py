from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright

PERFECT_RED_MIN = 180
PERFECT_GREEN_MIN = 160
PERFECT_BLUE_MAX = 120
MISS_RED_MIN = 170
MISS_GREEN_MAX = 140
MISS_BLUE_MAX = 140


def test_game_led_bars_flash_judgement_colors_on_hit_and_miss() -> None:
    game_js_path = Path(__file__).resolve().parents[1] / "web" / "game.js"

    with sync_playwright() as playwright:
        browser = None
        try:
            browser = playwright.chromium.launch(headless=True)
        except Error as exc:  # pragma: no cover - environment dependent
            pytest.skip(f"Playwright Chromium unavailable: {exc}")

        assert browser is not None
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.set_content(
            """
<!doctype html>
<html lang="en">
  <body>
    <select id="song-select"></select>
    <button id="btn-start" type="button">Start Game</button>
    <button id="btn-stop" type="button">Stop</button>
    <div id="waveform"></div>
    <div id="game-spectral-waveform-scroll" style="width: 960px; overflow-x: auto;">
      <canvas
        id="game-spectral-waveform"
        width="960"
        height="88"
        style="width: 960px; height: 88px;"
      ></canvas>
      <div class="zoom-beat-grid-wrap">
        <div id="game-zoom-beat-grid"></div>
      </div>
    </div>
    <canvas
      id="game-spectral-waveform-overview"
      width="960"
      height="72"
      style="width: 960px; height: 72px;"
    ></canvas>
    <canvas
      id="visualizer"
      width="960"
      height="70"
      style="width: 960px; height: 70px;"
    ></canvas>
    <div id="led-beat-feedback"></div>
    <p id="game-perfect-window">Perfect ±0 ms</p>
    <p id="game-good-window">Good ±0 ms</p>
    <dd id="game-current-time"></dd>
    <dd id="game-track-length"></dd>
    <div id="left-lane-log"></div>
    <div id="right-lane-log"></div>
    <audio id="song-audio" preload="auto"></audio>
  </body>
</html>
""",
        )
        page.add_script_tag(
            content="""
(() => {
  class MockWaveSurfer {
    constructor() {
      this._events = new Map();
      this._duration = 2.4;
    }

    on(eventName, callback) {
      this._events.set(eventName, callback);
    }

    load(_) {
      setTimeout(() => this._events.get('ready')?.(), 0);
    }

    getDuration() {
      return this._duration;
    }
  }

  class MockWebSocket {
    static OPEN = 1;

    constructor() {
      this.readyState = MockWebSocket.OPEN;
      window.__mockSocket = this;
      setTimeout(() => this.onopen?.(), 0);
    }

    send(_) {}
    close() {}
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {}
    }
  });

  window.SpectralWaveform = {
    MIN_SPECTRAL_RMS: 0.001,
    createController() {
      return {
        attach() {},
        invalidateOverviewCache() {},
        renderMain() {},
        renderOverview() {},
        scheduleOverviewRender() {},
        setVisibleWindowStart() {},
        stopOverviewDrag() {},
        stopScrollDrag() {},
        updateVisibleWindowRatios() {
          return { start: 0, end: 1 };
        }
      };
    }
  };
  window.WaveSurfer = {
    create() {
      return new MockWaveSurfer();
    }
  };
  window.VisualizerProjection = {
    getPlaybackAlignedBarProgressMs(_, __, ___, progressMs) {
      return progressMs;
    },
    getRenderedBarRange(_, __, lane, span) {
      if (lane === 'left') {
        return { startIndex: 0, endIndex: span - 1 };
      }
      return { startIndex: 70 - span, endIndex: 69 };
    }
  };
  window.WebSocket = MockWebSocket;
  window.fetch = async (url) => {
    if (String(url).endsWith('/api/songs')) {
      return {
        ok: true,
        json: async () => ['flash-song']
      };
    }

    return {
      ok: true,
      json: async () => ({
        song_id: 'flash-song',
        travel_time_ms: 1000,
        global_offset_ms: 0,
        judgement_windows_ms: { perfect: 50, good: 100 },
        left: [1000],
        right: [1500],
        audio_analysis: {
          duration_ms: 2400,
          beat_times_ms: [1000, 1500],
          beat_descriptors: []
        }
      })
    };
  };

  window.__audioCurrentTimeSeconds = 0;
  const audio = document.getElementById('song-audio');
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get() {
      return window.__audioCurrentTimeSeconds;
    },
    set(value) {
      window.__audioCurrentTimeSeconds = value;
    }
  });
  Object.defineProperty(audio, 'duration', {
    configurable: true,
    get() {
      return 2.4;
    }
  });
  Object.defineProperty(audio, 'paused', {
    configurable: true,
    get() {
      return false;
    }
  });
  Object.defineProperty(audio, 'ended', {
    configurable: true,
    get() {
      return false;
    }
  });
  audio.pause = function pause() {};
  audio.play = async function play() {};
})();
""",
        )
        page.add_script_tag(path=str(game_js_path))
        colors = page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          await new Promise((resolve) => setTimeout(resolve, 20));
          const select = document.getElementById('song-select');
          select.value = 'flash-song';
          select.dispatchEvent(new Event('change'));
          await new Promise((resolve) => setTimeout(resolve, 80));

          const canvas = document.getElementById('visualizer');
          const ctx = canvas.getContext('2d');

          window.__audioCurrentTimeSeconds = 1.0;
          window.__mockSocket.onmessage({
            data: JSON.stringify({
              type: 'bar_frame',
              lane: 'left',
              hit_time_ms: 1000,
              progress_ms: 1000,
              remaining_ms: 1400,
              travel_time_ms: 1000
            })
          });
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          const perfectPixel = Array.from(ctx.getImageData(16, 35, 1, 1).data);

          window.__audioCurrentTimeSeconds = 1.65;
          window.__mockSocket.onmessage({
            data: JSON.stringify({
              type: 'bar_frame',
              lane: 'right',
              hit_time_ms: 1500,
              progress_ms: 1000,
              remaining_ms: 750,
              travel_time_ms: 1000
            })
          });
          document.getElementById('song-audio').dispatchEvent(new Event('timeupdate'));
          await new Promise((resolve) => setTimeout(resolve, 20));
          const missPixel = Array.from(ctx.getImageData(944, 35, 1, 1).data);

          return { perfectPixel, missPixel };
        }""",
        )
        browser.close()

    perfect_pixel = colors["perfectPixel"]
    miss_pixel = colors["missPixel"]

    assert perfect_pixel[0] > PERFECT_RED_MIN
    assert perfect_pixel[1] > PERFECT_GREEN_MIN
    assert perfect_pixel[2] < PERFECT_BLUE_MAX
    assert miss_pixel[0] > MISS_RED_MIN
    assert miss_pixel[1] < MISS_GREEN_MAX
    assert miss_pixel[2] < MISS_BLUE_MAX
