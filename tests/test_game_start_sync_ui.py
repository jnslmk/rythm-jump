from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright


def test_game_start_sends_start_session_before_audio_playback() -> None:
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
      <canvas id="game-spectral-waveform" width="960" height="88"></canvas>
      <div class="zoom-beat-grid-wrap">
        <div id="game-zoom-beat-grid"></div>
      </div>
    </div>
    <canvas id="game-spectral-waveform-overview" width="960" height="72"></canvas>
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
      this.sent = [];
      window.__mockSocket = this;
      setTimeout(() => {
        this.onopen?.();
        this.onmessage?.({
          data: JSON.stringify({
            type: 'session_state',
            state: 'idle',
            session_id: 'default-session'
          })
        });
      }, 0);
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
    }

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
  Object.defineProperty(audioProto, 'currentTime', {
    configurable: true,
    get() {
      return this.__currentTime || 0;
    },
    set(value) {
      this.__currentTime = value;
    }
  });
  Object.defineProperty(audioProto, 'muted', {
    configurable: true,
    get() {
      return this.__muted || false;
    },
    set(value) {
      this.__muted = value;
    }
  });
  audioProto.load = function load() {};
  audioProto.pause = function pause() {};
  audioProto.play = async function play() {
    window.__playCalls = window.__playCalls || [];
    window.__playCalls.push({
      currentTime: this.currentTime,
      src: this.src,
    });
  };
})();
""",
        )
        page.add_script_tag(path=str(game_js_path))
        result = page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          await new Promise((resolve) => setTimeout(resolve, 50));

          const select = document.getElementById('song-select');
          select.value = 'sync-song';
          select.dispatchEvent(new Event('change'));
          await new Promise((resolve) => setTimeout(resolve, 50));

          document.getElementById('btn-start').click();
          await new Promise((resolve) => setTimeout(resolve, 50));

          const sendsAfterClick = window.__mockSocket.sent.slice();
          const playsAfterClick = (window.__playCalls || []).slice();

          return {
            sendsAfterClick,
            playsAfterClick,
          };
        }""",
        )
        browser.close()

    assert result["sendsAfterClick"] == [
        {"type": "start_session", "song_id": "sync-song"},
    ]
    assert result["playsAfterClick"] == []


def test_game_bpm_setting_updates_game_beat_grid() -> None:
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
    <input id="game-song-bpm" type="number" value="120" />
    <button id="btn-start" type="button">Start Game</button>
    <button id="btn-stop" type="button">Stop</button>
    <div id="waveform"></div>
    <div id="game-spectral-waveform-scroll" style="width: 960px; overflow-x: auto;">
      <canvas id="game-spectral-waveform" width="960" height="88"></canvas>
      <div class="zoom-beat-grid-wrap">
        <div id="game-zoom-beat-grid"></div>
      </div>
    </div>
    <canvas id="game-spectral-waveform-overview" width="960" height="72"></canvas>
    <canvas id="visualizer" width="960" height="70"></canvas>
    <dd id="game-current-time"></dd>
    <dd id="game-track-length"></dd>
    <div id="led-beat-feedback"></div>
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
      this._duration = 3;
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
      setTimeout(() => {
        this.onopen?.();
        this.onmessage?.({
          data: JSON.stringify({
            type: 'session_state',
            state: 'idle',
            session_id: 'default-session'
          })
        });
      }, 0);
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
        setVisibleWindowStart() {},
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
        json: async () => ['grid-song']
      };
    }
    if (String(url).endsWith('/api/charts/grid-song')) {
      return {
        ok: true,
        json: async () => ({
          song_id: 'grid-song',
          bpm: 120,
          travel_time_ms: 1200,
          global_offset_ms: 0,
          judgement_windows_ms: { perfect: 50, good: 100 },
          left: [1000],
          right: [1500],
          audio_analysis: null
        })
      };
    }
    if (String(url).endsWith('/api/debug/gpio')) {
      return {
        ok: true,
        json: async () => ({ pins: {}, states: {} })
      };
    }

    return {
      ok: true,
      json: async () => ({})
    };
  };

  const audioProto = window.HTMLMediaElement.prototype;
  audioProto.load = function load() {};
  audioProto.pause = function pause() {};
  audioProto.play = async function play() {};
})();
""",
        )
        page.add_script_tag(path=str(game_js_path))
        result = page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          await new Promise((resolve) => setTimeout(resolve, 50));

          const select = document.getElementById('song-select');
          select.value = 'grid-song';
          select.dispatchEvent(new Event('change'));
          await new Promise((resolve) => setTimeout(resolve, 50));

          const bpmInput = document.getElementById('game-song-bpm');
          const initialColumns = document.querySelectorAll(
            '#game-zoom-beat-grid .beat-column'
          ).length;
          const emptyBefore = document.querySelector(
            '#game-zoom-beat-grid .beat-grid-empty'
          ) !== null;

          bpmInput.value = '60';
          bpmInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 50));

          return {
            bpmValue: bpmInput.value,
            initialColumns,
            updatedColumns: document.querySelectorAll(
              '#game-zoom-beat-grid .beat-column'
            ).length,
            emptyBefore,
          };
        }""",
        )
        browser.close()

    assert result["bpmValue"] == "60"
    assert result["emptyBefore"] is False
    assert result["initialColumns"] > result["updatedColumns"]
