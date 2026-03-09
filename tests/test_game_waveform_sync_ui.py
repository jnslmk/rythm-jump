from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright

EXPECTED_RENDER_PROGRESS_MS = 10_000


def test_game_waveform_prefers_audio_clock_for_render_progress() -> None:
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
    <button id="btn-toggle-debug" type="button">Hide overlay</button>
    <div id="waveform"></div>
    <div id="game-spectral-waveform-scroll" style="width: 960px; overflow-x: auto;">
      <canvas
        id="game-spectral-waveform"
        width="960"
        height="88"
        style="height: 88px;"
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
    <canvas id="visualizer" width="960" height="70"></canvas>
    <dd id="game-current-time"></dd>
    <dd id="game-track-length"></dd>
    <dd id="debug-remaining-time"></dd>
    <dd id="debug-perfect-window"></dd>
    <dd id="debug-good-window"></dd>
    <div id="left-lane-log"></div>
    <div id="right-lane-log"></div>
    <aside id="debug-panel"></aside>
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
      this._duration = 180;
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
        renderMain(progressMs) {
          window.__renderedProgressMs = progressMs;
        },
        renderOverview() {},
        scheduleOverviewRender() {},
        setVisibleWindowStart() {},
        stopOverviewDrag() {},
        stopScrollDrag() {},
        updateVisibleWindowRatios() {
          return { start: 0, end: 0.25 };
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
    getRenderedBarRange() {
      return null;
    }
  };
  window.WebSocket = MockWebSocket;
  window.fetch = async (url) => {
    if (String(url).endsWith('/api/songs')) {
      return {
        ok: true,
        json: async () => ['sync-song']
      };
    }

    return {
      ok: true,
      json: async () => ({
        song_id: 'sync-song',
        travel_time_ms: 1200,
        judgement_windows_ms: { perfect: 50, good: 100 },
        left: [1200],
        right: [],
        audio_analysis: {
          beat_times_ms: [0, 600, 1200, 1800],
          beat_descriptors: []
        }
      })
    };
  };

  const audioProto = window.HTMLMediaElement.prototype;
  audioProto.play = async function play() {};
  audioProto.pause = function pause() {};
})();
""",
        )
        page.add_script_tag(path=str(game_js_path))
        page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          await new Promise((resolve) => setTimeout(resolve, 20));
          const select = document.getElementById('song-select');
          select.value = 'sync-song';
          select.dispatchEvent(new Event('change'));
          await new Promise((resolve) => setTimeout(resolve, 40));

          const audio = document.getElementById('song-audio');
          Object.defineProperty(audio, 'currentTime', {
            configurable: true,
            get() {
              return 10;
            }
          });

          window.__mockSocket.onmessage({
            data: JSON.stringify({
              type: 'led_frame',
              levels: [0, 0],
              progress_ms: 9000
            })
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }""",
        )

        rendered_progress_ms = page.evaluate("() => window.__renderedProgressMs")
        browser.close()

    assert rendered_progress_ms == EXPECTED_RENDER_PROGRESS_MS
