from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright


def test_manage_song_download_form_submits_to_download_endpoint() -> None:
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
    <section id="upload-song">
      <button id="tab-upload-song" type="button">Upload File</button>
      <button id="tab-download-song" type="button">Download URL</button>
      <div id="song-source-upload">
        <form id="upload-form">
          <input id="new-song-id" />
          <input id="new-song-audio" type="file" />
          <button type="submit">Upload</button>
          <span id="upload-status"></span>
        </form>
      </div>
      <div id="song-source-download" class="hidden" aria-hidden="true">
        <form id="download-form">
          <input id="download-song-id" />
          <input id="download-song-url" />
          <button type="submit">Download</button>
          <span id="download-status"></span>
        </form>
      </div>
    </section>
    <select id="song-edit-select"></select>
    <button id="btn-save-chart"></button>
    <span id="save-status"></span>
    <section id="song-editor" class="hidden" aria-hidden="true">
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

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      _value: null,
      getItem() {
        return this._value;
      },
      setItem(key, value) {
        this._value = value;
        window.__storedSelection = { key, value };
      },
      removeItem() {}
    }
  });

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

  window.__downloadRequests = [];
  window.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/songs/download')) {
      window.__downloadRequests.push({
        url: String(url),
        body: JSON.parse(options.body)
      });
      return {
        ok: true,
        json: async () => ({ ok: true, song_id: 'downloaded-song' })
      };
    }

      if (String(url).endsWith('/api/songs')) {
        return {
          ok: true,
          json: async () => ['downloaded-song']
        };
      }

      if (String(url).endsWith('/api/charts/downloaded-song')) {
        return {
          ok: true,
          json: async () => ({
            bpm: 120,
            global_offset_ms: 0,
            left: [],
            right: [],
            audio_analysis: {
              beat_times_ms: [0, 500, 1000, 1500],
              beat_descriptors: []
            }
          })
        };
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    };
})();
""",
        )
        page.add_script_tag(path=str(spectral_waveform_js_path))
        page.add_script_tag(path=str(manage_js_path))
        result = page.evaluate(
            """async () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          await new Promise((resolve) => setTimeout(resolve, 20));
          document.getElementById('tab-download-song').click();
          document.getElementById('download-song-id').value = 'downloaded-song';
          document.getElementById('download-song-url').value =
            'https://soundcloud.com/example/track';
          document.getElementById('download-form').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true })
          );
          await new Promise((resolve) => setTimeout(resolve, 20));
          const uploadPanel = document.getElementById('song-source-upload');
          const downloadPanel = document.getElementById('song-source-download');
          return {
            requests: window.__downloadRequests,
            status: document.getElementById('download-status').textContent,
            uploadHidden: uploadPanel.classList.contains('hidden'),
            downloadHidden: downloadPanel.classList.contains('hidden'),
            selectedSong: document.getElementById('song-edit-select').value,
          };
        }""",
        )
        browser.close()

    assert result["requests"] == [
        {
            "url": "/api/songs/download",
            "body": {
                "song_id": "downloaded-song",
                "source_url": "https://soundcloud.com/example/track",
            },
        },
    ]
    assert result["status"] == "Download complete!"
    assert result["uploadHidden"] is False
    assert result["downloadHidden"] is True
    assert result["selectedSong"] == "downloaded-song"
