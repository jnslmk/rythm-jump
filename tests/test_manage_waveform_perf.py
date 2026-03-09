import os
from pathlib import Path
from typing import Any

import pytest
from playwright.sync_api import Error, sync_playwright

MAIN_WAVEFORM_FIRST_RENDER_MIN_FILL_RECTS = 9_000
MAIN_WAVEFORM_CACHED_RENDER_MAX_FILL_RECTS = 50


def _perf_dom_html() -> str:
    return """
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
            width="3200"
            height="88"
            style="width: 3200px; height: 88px;"
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
        <span id="audio-time"></span>
      </div>
      <input id="song-bpm" value="120" />
      <input id="global-offset" value="0" />
      <button id="btn-tap-bpm"></button>
      <button id="btn-analyze-audio"></button>
    </section>
  </body>
</html>
"""


def _build_wave_surfer_mock_script() -> str:
    return """
(() => {
  const timelinePlugin = { create: () => ({}) };
  const regionsPlugin = {
    create: () => ({
      clearRegions() {},
      addRegion() {}
    })
  };

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
      return plugin || {};
    }

    getDuration() {
      return this._duration;
    }

    getCurrentTime() {
      return this._currentTime;
    }

    zoom(_) {}
    playPause() {}
    destroy() {}
  }

  window.TimelinePlugin = timelinePlugin;
  window.RegionsPlugin = regionsPlugin;
  window.WaveSurfer = {
    create() {
      return new MockWaveSurfer();
    }
  };

  const waveformPointCount = 120000;
  const lowBand = Array.from(
    { length: waveformPointCount },
    (_, i) => Math.max(0, Math.min(1, Math.abs(Math.sin(i * 0.008))))
  );
  const midBand = Array.from(
    { length: waveformPointCount },
    (_, i) => Math.max(0, Math.min(1, Math.abs(Math.sin(i * 0.012 + 0.7))))
  );
  const highBand = Array.from(
    { length: waveformPointCount },
    (_, i) => Math.max(0, Math.min(1, Math.abs(Math.sin(i * 0.021 + 1.4))))
  );

  const chartPayload = {
    bpm: 120,
    global_offset_ms: 0,
    left: [],
    right: [],
    audio_analysis: {
      beat_times_ms: [],
      beat_descriptors: [],
      waveform_band_low: lowBand,
      waveform_band_mid: midBand,
      waveform_band_high: highBand
    }
  };

  window.fetch = async (url) => {
    if (String(url).endsWith('/api/charts/perf-song')) {
      return {
        ok: true,
        json: async () => chartPayload
      };
    }
    if (String(url).endsWith('/api/songs')) {
      return {
        ok: true,
        json: async () => ['perf-song']
      };
    }
    throw new Error(`Unexpected fetch in perf test: ${String(url)}`);
  };
})();
"""


def test_manage_waveform_overview_draw_speed_budget() -> None:
    budget_ms = float(os.getenv("WAVEFORM_OVERVIEW_DRAW_BUDGET_MS", "16.0"))
    frame_count = int(os.getenv("WAVEFORM_OVERVIEW_DRAW_FRAME_COUNT", "180"))
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
        page.set_content(_perf_dom_html())
        page.add_script_tag(content=_build_wave_surfer_mock_script())
        page.add_script_tag(path=str(spectral_waveform_js_path))
        page.add_script_tag(path=str(manage_js_path))

        result: dict[str, Any] = page.evaluate(
            """async ({ frameCount }) => {
          await window.loadSong('perf-song');
          await new Promise((resolve) => setTimeout(resolve, 20));

          const scrollContainer = document.getElementById('spectral-waveform-scroll');
          const durationMs = 180000;
          const maxLeft = Math.max(
            scrollContainer.scrollWidth - scrollContainer.clientWidth,
            1
          );

          const startMs = performance.now();
          for (let i = 0; i < frameCount; i += 1) {
            const ratio = i / Math.max(frameCount - 1, 1);
            scrollContainer.scrollLeft = ratio * maxLeft;
            window.renderManageOverviewWaveform(ratio * durationMs);
          }
          const elapsedMs = performance.now() - startMs;
          return {
            elapsedMs,
            perFrameMs: elapsedMs / Math.max(frameCount, 1),
            frameCount
          };
        }""",
            {"frameCount": frame_count},
        )

        browser.close()

    assert result["perFrameMs"] <= budget_ms, (
        "Overview draw budget exceeded: "
        f"{result['perFrameMs']:.2f}ms/frame over {result['frameCount']} frames "
        f"(budget: {budget_ms:.2f}ms/frame, total: {result['elapsedMs']:.2f}ms)"
    )


def test_main_waveform_reuses_cached_base_between_frames() -> None:
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
        width="3200"
        height="88"
        style="width: 3200px; height: 88px;"
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
        counts: dict[str, Any] = page.evaluate(
            """() => {
          const pointCount = 120000;
          const analysis = {
            waveform_band_low: Array.from(
              { length: pointCount },
              (_, i) => Math.max(0, Math.min(1, Math.abs(Math.sin(i * 0.008))))
            ),
            waveform_band_mid: Array.from(
              { length: pointCount },
              (_, i) => Math.max(0, Math.min(1, Math.abs(Math.sin(i * 0.012 + 0.7))))
            ),
            waveform_band_high: Array.from(
              { length: pointCount },
              (_, i) => Math.max(0, Math.min(1, Math.abs(Math.sin(i * 0.021 + 1.4))))
            ),
            beat_times_ms: Array.from({ length: 256 }, (_, i) => i * 600),
            beat_descriptors: []
          };

          const ctxProto = CanvasRenderingContext2D.prototype;
          const originalFillRect = ctxProto.fillRect;
          let fillRectCount = 0;
          ctxProto.fillRect = function patchedFillRect(...args) {
            fillRectCount += 1;
            return originalFillRect.apply(this, args);
          };

          const controller = window.SpectralWaveform.createController({
            canvas: '#main',
            scrollContainer: '#scroll',
            overviewCanvas: '#overview',
            getAnalysis: () => analysis,
            getBeatTimesMs: () => analysis.beat_times_ms,
            getDurationMs: () => 180000,
            getProgressMs: () => 0,
            getRmsMax: () => 1,
            getZoom: () => 1,
            shouldAutoFollow: () => false,
            showTimeAxis: false
          });
          controller.attach();

          fillRectCount = 0;
          controller.renderMain(1000);
          const firstRenderFillRects = fillRectCount;

          fillRectCount = 0;
          controller.renderMain(1100);
          const secondRenderFillRects = fillRectCount;

          ctxProto.fillRect = originalFillRect;
          return { firstRenderFillRects, secondRenderFillRects };
        }""",
        )
        browser.close()

    assert counts["firstRenderFillRects"] > MAIN_WAVEFORM_FIRST_RENDER_MIN_FILL_RECTS
    assert counts["secondRenderFillRects"] < MAIN_WAVEFORM_CACHED_RENDER_MAX_FILL_RECTS
