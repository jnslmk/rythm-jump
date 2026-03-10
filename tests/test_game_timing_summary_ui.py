from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright


def test_game_timing_summary_renders_without_debug_overlay() -> None:
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
    <div id="led-beat-feedback"></div>
    <p id="game-perfect-window">Perfect ±0 ms</p>
    <p id="game-good-window">Good ±0 ms</p>
    <dd id="game-current-time"></dd>
    <dd id="game-track-length"></dd>
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
        json: async () => ['debug-song']
      };
    }

    return {
      ok: true,
      json: async () => ({
        song_id: 'debug-song',
        travel_time_ms: 1200,
        judgement_windows_ms: { perfect: 50, good: 100 },
        left: [1000],
        right: [],
        audio_analysis: {
          beat_times_ms: [0, 500, 1000, 1500],
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
        result = page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          const select = document.getElementById('song-select');
          await new Promise((resolve) => setTimeout(resolve, 20));
          select.innerHTML = '<option value="debug-song">debug-song</option>';
          select.value = 'debug-song';
          select.dispatchEvent(new Event('change'));
          await new Promise((resolve) => setTimeout(resolve, 50));

          return {
            perfect: document.getElementById('game-perfect-window')?.textContent || '',
            good: document.getElementById('game-good-window')?.textContent || '',
            hasDebugPanel: Boolean(document.getElementById('debug-panel')),
            hasDebugToggle: Boolean(document.getElementById('btn-toggle-debug')),
          };
        }""",
        )
        browser.close()

    assert result["perfect"] == "Perfect ±0.05s"
    assert result["good"] == "Good ±0.10s"
    assert result["hasDebugPanel"] is False
    assert result["hasDebugToggle"] is False
