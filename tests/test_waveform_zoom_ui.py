from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright


def test_spectral_waveform_controller_initializes_visible_window() -> None:
    spectral_waveform_js_path = (
        Path(__file__).resolve().parents[1] / "web" / "spectral-waveform.js"
    )

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
    <div id="scroll" style="width: 960px; overflow-x: auto;">
      <canvas
        id="main"
        width="2400"
        height="88"
        style="width: 2400px; height: 88px;"
      ></canvas>
    </div>
    <canvas
      id="overview"
      width="960"
      height="72"
      style="width: 960px; height: 72px;"
    ></canvas>
  </body>
</html>
""",
        )
        page.add_script_tag(path=str(spectral_waveform_js_path))

        visible_window = page.evaluate(
            """() => {
          const controller = window.SpectralWaveform.createController({
            canvas: '#main',
            scrollContainer: '#scroll',
            overviewCanvas: '#overview',
            getDurationMs: () => 60000,
            getProgressMs: () => 0,
            getRmsMax: () => 1,
            getZoom: () => 2.5,
            getAnalysis: () => null,
            getBeatTimesMs: () => []
          });
          controller.attach();
          return controller.getVisibleWindowRatios();
        }""",
        )

        browser.close()

    assert visible_window["start"] == pytest.approx(0)
    assert visible_window["end"] < 1


def test_manage_waveform_load_starts_with_zoomed_window() -> None:
    manage_js_path = Path(__file__).resolve().parents[1] / "web" / "manage.js"
    spectral_waveform_js_path = (
        Path(__file__).resolve().parents[1] / "web" / "spectral-waveform.js"
    )

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
    <form id="upload-form"><button type="submit">Upload</button></form>
    <input id="new-song-id" />
    <input id="new-song-audio" type="file" />
    <span id="upload-status"></span>
    <select id="song-edit-select"></select>
    <button id="btn-save-chart"></button>
    <span id="save-status"></span>
    <section id="song-editor">
      <h2 id="editor-title"></h2>
      <div id="waveform-container">
        <div id="waveform"></div>
        <div id="spectral-waveform-scroll" style="width: 960px; overflow-x: auto;">
          <canvas
            id="manage-spectral-waveform"
            width="960"
            height="88"
            style="height: 88px;"
          ></canvas>
          <div class="zoom-beat-grid-wrap">
            <div id="zoom-beat-grid"></div>
          </div>
        </div>
        <div class="overview-waveform-wrap" style="width: 960px;">
          <canvas
            id="manage-spectral-waveform-overview"
            width="960"
            height="72"
            style="width: 960px; height: 72px;"
          ></canvas>
        </div>
        <div id="timeline"></div>
        <button id="btn-play-pause"></button>
        <button id="btn-stop-playback"></button>
        <span id="audio-time"></span>
      </div>
      <input id="song-bpm" value="120" />
      <input id="global-offset" value="0" />
      <button id="btn-tap-bpm"></button>
      <button id="btn-auto-pattern"></button>
      <button id="btn-analyze-audio"></button>
    </section>
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
      this._currentTime = 0;
    }

    on(eventName, callback) {
      this._events.set(eventName, callback);
      if (eventName === 'ready') {
        setTimeout(() => callback(), 0);
      }
    }

    registerPlugin(plugin) {
      return plugin || { clearRegions() {}, addRegion() {} };
    }

    getDuration() {
      return this._duration;
    }

    getCurrentTime() {
      return this._currentTime;
    }

    zoom(_) {}
    pause() {}
    setTime(value) {
      this._currentTime = value;
    }
    playPause() {}
    destroy() {}
  }

  window.TimelinePlugin = { create: () => ({}) };
  window.RegionsPlugin = {
    create: () => ({
      clearRegions() {},
      addRegion() {}
    })
  };
  window.WaveSurfer = {
    create() {
      return new MockWaveSurfer();
    }
  };

  window.fetch = async (url) => {
    if (String(url).endsWith('/api/songs')) {
      return {
        ok: true,
        json: async () => ['perf-song']
      };
    }

    return {
      ok: true,
      json: async () => ({
        bpm: 120,
        global_offset_ms: 0,
        left: [],
        right: [],
        audio_analysis: {
          beat_times_ms: [0, 500, 1000, 1500, 2000],
          beat_descriptors: []
        }
      })
    };
  };
})();
""",
        )
        page.add_script_tag(path=str(spectral_waveform_js_path))
        page.add_script_tag(path=str(manage_js_path))
        page.evaluate(
            """async () => {
          await window.loadSong('perf-song');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }""",
        )

        visible_window = page.evaluate(
            """() => {
          const scrollContainer = document.getElementById('spectral-waveform-scroll');
          return {
            ratios: window.updateVisibleWaveformWindowRatios(scrollContainer),
            scrollWidth: scrollContainer.scrollWidth,
            clientWidth: scrollContainer.clientWidth
          };
        }""",
        )

        browser.close()

    assert visible_window["scrollWidth"] > visible_window["clientWidth"]
    assert visible_window["ratios"]["end"] < 1
