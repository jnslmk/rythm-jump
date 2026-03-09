from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright


def test_game_beat_grid_columns_align_to_timeline_positions() -> None:
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
  <head>
    <style>
      body {
        margin: 0;
      }

      #game-zoom-beat-grid {
        display: grid;
        width: 960px;
      }

      .beat-column {
        min-width: 0;
      }
    </style>
  </head>
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
        style="width: 960px; height: 88px;"
      ></canvas>
      <div class="zoom-beat-grid-wrap" style="width: 960px;">
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
  window.WebSocket = MockWebSocket;
  window.fetch = async (url) => {
    if (String(url).endsWith('/api/songs')) {
      return {
        ok: true,
        json: async () => ['alignment-song']
      };
    }

    return {
      ok: true,
      json: async () => ({
        song_id: 'alignment-song',
        travel_time_ms: 1200,
        global_offset_ms: 0,
        judgement_windows_ms: { perfect: 50, good: 100 },
        left: [],
        right: [],
        audio_analysis: {
          duration_ms: 2400,
          beat_times_ms: [500, 1000, 1500],
          beat_descriptors: []
        }
      })
    };
  };

  const audio = document.getElementById('song-audio');
  Object.defineProperty(audio, 'duration', {
    configurable: true,
    get() {
      return 2.4;
    }
  });
  audio.pause = function pause() {};
  audio.play = async function play() {};
})();
""",
        )
        page.add_script_tag(path=str(game_js_path))
        positions = page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          await new Promise((resolve) => setTimeout(resolve, 20));
          const select = document.getElementById('song-select');
          select.value = 'alignment-song';
          select.dispatchEvent(new Event('change'));
          await new Promise((resolve) => setTimeout(resolve, 80));

          const beatGrid = document.getElementById('game-zoom-beat-grid');
          const origin = beatGrid.getBoundingClientRect().left;
          return Array.from(
            beatGrid.querySelectorAll('.beat-column.beat-start'),
            (column) => Math.round(column.getBoundingClientRect().left - origin)
          );
        }""",
        )
        browser.close()

    assert positions == [200, 400, 600]
